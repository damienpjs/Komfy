"""Komfy: LTX 2.5 on Apple Silicon through MLX (ComfyUI custom node).

ComfyUI runs LTX 2.5 on PyTorch MPS about 16 times slower than the MLX port
(dgrauet/ltx-2-mlx). This node keeps ComfyUI as Komfy's single backend (queue,
history, gallery, remix) and delegates the generation itself to the
`ltx-2-mlx` CLI, run in a separate process with its own virtualenv:

  - ComfyUI's own models are unloaded first, so the MLX process gets the
    unified memory (a 22B q8 pack does not fit next to a loaded KREA2);
  - the child process returns every byte to the OS when it exits, which an
    in-process MLX pipeline would not guarantee;
  - tqdm progress from the child is parsed into ComfyUI's progress bar (so
    the Komfy queue shows a real percentage), and an Interrupt from the app
    terminates the child's whole process group.

One node class covers the three Komfy workflows: no image = text to video,
`first_image` = image to video, `first_image` + `last_image` = first/last
frame (`--image PATH 0 S --image PATH last S`).

Configuration (environment of the ComfyUI process, all optional):
  KOMFY_LTX_MLX_BIN    path to the ltx-2-mlx executable
                       (default ~/ltx-2-mlx/.venv/bin/ltx-2-mlx)
  KOMFY_LTX_MLX_PACKS  extra folders holding model packs, os.pathsep-separated

Install: symlink this folder into custom_nodes/ (see README.md), then
restart ComfyUI.
"""

import glob
import os
import queue
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading

import numpy as np
from PIL import Image

import comfy.model_management as mm
import comfy.utils
import folder_paths

HOME = os.path.expanduser("~")
DEFAULT_BIN = os.path.join(HOME, "ltx-2-mlx", ".venv", "bin", "ltx-2-mlx")
NO_PACK = "(no LTX MLX pack found)"
NO_LORA = "None"
# A pack folder carries one of these next to its safetensors (the pitfall
# noted in the Rushes pilot: pointing the CLI at a wrong path makes it try a
# HuggingFace download instead of failing).
PACK_MARKERS = ("split_model.json", "embedded_config.json")
MODES = ["distilled", "two_stage", "two_stages_hq", "one_stage"]
# Homebrew locations: the child needs ffmpeg, and a ComfyUI started by a
# launchd agent or the Komfy supervisor often has a bare PATH.
EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin"]
TQDM_RE = re.compile(r"(\d+)/(\d+)\s*\[")
LOG_TAIL = 60


# --------------------------------------------------------------------------
# Model pack discovery
# --------------------------------------------------------------------------

def _is_pack(path):
    return (
        os.path.isdir(path)
        and any(os.path.isfile(os.path.join(path, m)) for m in PACK_MARKERS)
        and bool(glob.glob(os.path.join(path, "*.safetensors")))
    )


def _local_roots():
    roots = []
    env = os.environ.get("KOMFY_LTX_MLX_PACKS", "")
    roots += [p for p in env.split(os.pathsep) if p]
    roots += [
        os.path.join(folder_paths.models_dir, "ltx_mlx"),
        os.path.join(HOME, "models"),
        os.path.join(HOME, "checkpoints"),
        os.path.join(HOME, "ltx-2-mlx"),
        os.path.join(HOME, "ltx-2-mlx", "models"),
    ]
    return roots


def _hf_hub_dir():
    if os.environ.get("HF_HUB_CACHE"):
        return os.environ["HF_HUB_CACHE"]
    hf_home = os.environ.get("HF_HOME", os.path.join(HOME, ".cache", "huggingface"))
    return os.path.join(hf_home, "hub")


def _discover_packs():
    """Label -> absolute pack folder. Local folders are labelled by their
    basename (deduplicated with a suffix), HuggingFace cache snapshots by
    their repo id."""
    found = []  # (label, path)
    for root in _local_roots():
        if _is_pack(root):
            found.append((os.path.basename(root.rstrip(os.sep)), root))
            continue
        if not os.path.isdir(root):
            continue
        try:
            children = sorted(os.listdir(root))
        except OSError:
            continue
        for name in children:
            child = os.path.join(root, name)
            if _is_pack(child):
                found.append((name, child))
            elif os.path.isdir(child) and not name.startswith("."):
                try:
                    for sub in sorted(os.listdir(child)):
                        if _is_pack(os.path.join(child, sub)):
                            found.append((sub, os.path.join(child, sub)))
                except OSError:
                    pass
    for repo in sorted(glob.glob(os.path.join(_hf_hub_dir(), "models--*ltx*mlx*"))):
        repo_id = os.path.basename(repo)[len("models--"):].replace("--", "/", 1)
        snaps = sorted(glob.glob(os.path.join(repo, "snapshots", "*")), key=os.path.getmtime, reverse=True)
        for snap in snaps:
            if _is_pack(snap):
                found.append((repo_id, snap))
                break

    packs, seen_paths = {}, set()
    for label, path in found:
        real = os.path.realpath(path)
        if real in seen_paths:
            continue
        seen_paths.add(real)
        unique, n = label, 2
        while unique in packs:
            unique, n = f"{label} ({n})", n + 1
        packs[unique] = real
    return packs


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _round_to(value, multiple):
    return max(multiple, int(round(value / multiple)) * multiple)


def _frames_for(duration, fps):
    """LTX frame grid: 8k + 1 pixel frames, at least 9."""
    k = max(1, int(round(duration * fps / 8.0)))
    return 8 * k + 1


def _save_png(image_tensor, folder, name):
    arr = np.clip(255.0 * image_tensor.cpu().numpy(), 0, 255).astype(np.uint8)
    path = os.path.join(folder, name)
    Image.fromarray(arr).save(path)
    return path


def _child_env():
    env = os.environ.copy()
    # ComfyUI's own interpreter settings must not leak into the MLX venv.
    for key in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"):
        env.pop(key, None)
    env["PYTHONUNBUFFERED"] = "1"
    # A pack is always passed as a local folder: never let a typo turn into
    # a 75 GB download.
    env["HF_HUB_OFFLINE"] = "1"
    env["PATH"] = os.pathsep.join(EXTRA_PATH + [env.get("PATH", "")])
    return env


def _read_stream(stream, out):
    """Splits the child's merged output on \\r and \\n (tqdm redraws with \\r)."""
    buf = b""
    while True:
        chunk = stream.read1(4096) if hasattr(stream, "read1") else stream.read(4096)
        if not chunk:
            break
        buf += chunk
        parts = re.split(rb"[\r\n]", buf)
        buf = parts.pop()
        for part in parts:
            if part.strip():
                out.put(part.decode("utf-8", "replace"))
    if buf.strip():
        out.put(buf.decode("utf-8", "replace"))
    out.put(None)


def _terminate(proc):
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=15)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()


def _count_frames(path, env):
    ffprobe = shutil.which("ffprobe", path=env["PATH"])
    if not ffprobe:
        return None
    res = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-count_packets",
         "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", path],
        capture_output=True, text=True, env=env,
    )
    try:
        return int(res.stdout.strip())
    except ValueError:
        return None


def _extract_frame(video, index, png, env):
    ffmpeg = shutil.which("ffmpeg", path=env["PATH"])
    if not ffmpeg:
        print("[komfy-ltx-mlx] ffmpeg not found: last frame not saved")
        return False
    res = subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-i", video, "-vf", f"select=eq(n\\,{index})",
         "-vsync", "0", "-frames:v", "1", png],
        capture_output=True, text=True, env=env,
    )
    return res.returncode == 0 and os.path.isfile(png)


# --------------------------------------------------------------------------
# Node
# --------------------------------------------------------------------------

class KomfyLTX25MLX:
    """LTX 2.5 text/image/first-last-frame to video + audio, through MLX."""

    @classmethod
    def INPUT_TYPES(cls):
        packs = list(_discover_packs().keys()) or [NO_PACK]
        loras = [NO_LORA] + folder_paths.get_filename_list("loras")
        return {
            "required": {
                "model_pack": (packs, {"tooltip": "ltx-2-mlx model pack (LTX 2.5 q8 recommended on 64 GB)"}),
                "prompt": ("STRING", {"multiline": True, "default": ""}),
                "negative_prompt": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "CFG modes only (ignored by distilled). Empty = upstream default negative",
                }),
                "mode": (MODES, {"default": "distilled"}),
                "width": ("INT", {"default": 768, "min": 128, "max": 3840, "step": 32}),
                "height": ("INT", {"default": 512, "min": 128, "max": 3840, "step": 32}),
                "fit_to_image": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "With a first image: keep the longer side, derive the other from the image ratio (no crop)",
                }),
                "duration": ("FLOAT", {
                    "default": 5.0, "min": 0.0, "max": 20.0, "step": 0.5,
                    "tooltip": "Seconds. 0 = predicted from the prompt by the LTX 2.5 duration head",
                }),
                "frame_rate": ("INT", {"default": 24, "min": 8, "max": 50}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1, "control_after_generate": True}),
                "first_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "last_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "lora_name": (loras,),
                "lora_strength": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.05}),
                "audio": ("BOOLEAN", {"default": True}),
                "low_ram": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Stream transformer blocks from disk: lower peak memory, slower",
                }),
                "tile_frames": ("INT", {
                    "default": 1, "min": 1, "max": 8,
                    "tooltip": "Temporal tiles: caps attention memory on long clips (1 = off)",
                }),
                "save_last_frame": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Also save the last clean frame as PNG, to start the next segment from it",
                }),
                "filename_prefix": ("STRING", {"default": "komfy/ltx25"}),
            },
            "optional": {
                "first_image": ("IMAGE",),
                "last_image": ("IMAGE",),
            },
        }

    RETURN_TYPES = ()
    FUNCTION = "generate"
    OUTPUT_NODE = True
    CATEGORY = "Komfy/LTX MLX"

    def generate(self, model_pack, prompt, negative_prompt, mode, width, height, fit_to_image,
                 duration, frame_rate, seed, first_strength, last_strength, lora_name,
                 lora_strength, audio, low_ram, tile_frames, save_last_frame, filename_prefix,
                 first_image=None, last_image=None):
        packs = _discover_packs()
        if model_pack not in packs:
            raise RuntimeError(
                f"LTX MLX pack '{model_pack}' not found. Searched: "
                + ", ".join(_local_roots() + [_hf_hub_dir()])
                + ". Set KOMFY_LTX_MLX_PACKS to the folder holding it."
            )
        binary = os.environ.get("KOMFY_LTX_MLX_BIN", DEFAULT_BIN)
        if not os.access(binary, os.X_OK):
            raise RuntimeError(f"ltx-2-mlx executable not found at {binary} (set KOMFY_LTX_MLX_BIN)")
        if not prompt.strip():
            raise ValueError("The prompt is empty")
        if last_image is not None and first_image is None:
            raise ValueError("A last image needs a first image")

        # Every mode except one_stage samples stage 1 at half resolution,
        # whose sides must stay multiples of 32: full size in multiples of 64.
        mult = 32 if mode == "one_stage" else 64
        if fit_to_image and first_image is not None:
            img_h, img_w = int(first_image.shape[1]), int(first_image.shape[2])
            long_side = max(width, height)
            if img_w >= img_h:
                width, height = long_side, long_side * img_h / img_w
            else:
                width, height = long_side * img_w / img_h, long_side
        w, h = _round_to(width, mult), _round_to(height, mult)

        out_dir = folder_paths.get_output_directory()
        full_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
            filename_prefix, out_dir, w, h)
        os.makedirs(full_folder, exist_ok=True)
        stem = f"{filename}_{counter:05}_"
        out_path = os.path.join(full_folder, stem + ".mp4")

        tmpdir = tempfile.mkdtemp(prefix="komfy-ltx-", dir=folder_paths.get_temp_directory())
        try:
            cmd = [
                binary, "generate", "--" + mode.replace("_", "-"),
                "--model", packs[model_pack],
                "--prompt", prompt,
                "-H", str(h), "-W", str(w),
                "--frame-rate", str(frame_rate),
                "--seed", str(seed),
                "--output", out_path,
            ]
            frames = _frames_for(duration, frame_rate) if duration > 0 else None
            if frames:
                cmd += ["--frames", str(frames)]
            if first_image is not None:
                cmd += ["--image", _save_png(first_image[0], tmpdir, "first.png"), "0", f"{first_strength:g}"]
            if last_image is not None:
                cmd += ["--image", _save_png(last_image[0], tmpdir, "last.png"), "last", f"{last_strength:g}"]
            if negative_prompt.strip() and mode != "distilled":
                cmd += ["--negative-prompt", negative_prompt]
            if lora_name != NO_LORA:
                cmd += ["--lora", folder_paths.get_full_path("loras", lora_name), f"{lora_strength:g}"]
            if not audio:
                cmd += ["--no-audio"]
            if low_ram:
                cmd += ["--low-ram"]
            if tile_frames > 1:
                cmd += ["--tile-frames", str(tile_frames)]

            print("[komfy-ltx-mlx] " + shlex.join(cmd))
            mm.unload_all_models()
            mm.soft_empty_cache()

            env = _child_env()
            self._run(cmd, env, tmpdir)

            if not os.path.isfile(out_path):
                raise RuntimeError(f"ltx-2-mlx exited without writing {out_path}")

            results = [{"filename": stem + ".mp4", "subfolder": subfolder, "type": "output"}]
            if save_last_frame:
                count = frames or _count_frames(out_path, env)
                if count:
                    # With an end anchor the very last frame comes out
                    # corrupted (Rushes pilot): take the one before it.
                    index = max(0, count - (2 if last_image is not None else 1))
                    png = os.path.join(full_folder, stem + "last.png")
                    if _extract_frame(out_path, index, png, env):
                        results.append({"filename": stem + "last.png", "subfolder": subfolder, "type": "output"})
            return {"ui": {"images": results, "animated": (True,)}}
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    @staticmethod
    def _run(cmd, env, cwd):
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, cwd=cwd,
            start_new_session=True,
        )
        lines = queue.Queue()
        reader = threading.Thread(target=_read_stream, args=(proc.stdout, lines), daemon=True)
        reader.start()

        tail, pbar, bar_total, bar_n, done = [], None, None, -1, False
        try:
            while not done:
                if mm.processing_interrupted():
                    _terminate(proc)
                    raise mm.InterruptProcessingException()
                try:
                    line = lines.get(timeout=0.25)
                except queue.Empty:
                    continue
                if line is None:
                    done = True
                    continue
                m = TQDM_RE.search(line)
                if m:
                    n, total = int(m.group(1)), int(m.group(2))
                    if total != bar_total or n < bar_n:
                        pbar, bar_total = comfy.utils.ProgressBar(total), total
                        bar_n = -1
                    if n != bar_n:
                        pbar.update_absolute(n, total)
                        bar_n = n
                        print(f"[komfy-ltx-mlx] {line.strip()}")
                    continue
                print(f"[komfy-ltx-mlx] {line.rstrip()}")
                tail.append(line.rstrip())
                del tail[:-LOG_TAIL]
            proc.wait()
        except BaseException:
            if proc.poll() is None:
                _terminate(proc)
            raise
        if proc.returncode != 0:
            raise RuntimeError(f"ltx-2-mlx failed (exit {proc.returncode}):\n" + "\n".join(tail[-25:]))


NODE_CLASS_MAPPINGS = {"KomfyLTX25MLX": KomfyLTX25MLX}
NODE_DISPLAY_NAME_MAPPINGS = {"KomfyLTX25MLX": "LTX 2.5 (MLX) · Komfy"}
