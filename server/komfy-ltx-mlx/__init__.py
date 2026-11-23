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

`KomfyLTX25MLX` covers four Komfy workflows, always on the distilled plan:
no image = text to video, `first_image` = image to video, `first_image` +
`last_image` = first/last frame (`--image PATH 0 S --image PATH last S`),
`first_image` + `voice` = talking video (`a2v --distilled`, the clip length
following the voice plus `silence_after`, the LoRAs fused through
a2v_lora.py), with an optional `last_image` end anchor as well. LoRAs:
`lora_name` plus the optional `extra_loras` JSON list, all fused together.
`KomfyLTX25UpscaleMLX` upscales a clip x2 (`ic-lora` with the
Pixel-Spatial-Upscaler IC-LoRA and an optional identity LoRA), the source's
audio muxed back. Both embed the API graph in the mp4's `prompt` tag.

Character references (optional `ref_1`..`ref_3`): the photos are laid out on
a reference sheet (reference_sheet.py), looped into a static video at the
output size, and the render switches to `ltx-2-mlx ic-lora` with the
Ingredients IC-LoRA and that video as `--video-conditioning`. Text to video
only: with a start image the clip leaves it after frame 0, so the node
refuses the combination. `audio=False` and `tile_frames` do not apply
there. ic-lora runs Lightricks' Ingredients recipe: one stage at full size on the dev transformer with the pack's distilled LoRA
fused at 0.5 (measured on 0.18 with a 2.5 pack: the default distilled
two-stage plan gives a mosaic, the distilled single stage copies the sheet).
It always renders audio. Needs ltx-2-mlx 0.17+ for IC-LoRA on 2.5 packs.

Configuration (environment of the ComfyUI process, all optional):
  KOMFY_LTX_MLX_BIN    path to the ltx-2-mlx executable
                       (default ~/ltx-2-mlx/.venv/bin/ltx-2-mlx)
  KOMFY_LTX_MLX_PACKS  extra folders holding model packs, os.pathsep-separated

Install: symlink this folder into custom_nodes/ (see README.md), then
restart ComfyUI.
"""

import glob
import json
import math
import mimetypes
import os
import queue
import re
import shlex
import shutil
import signal
import subprocess
import tempfile
import threading
import wave

import numpy as np
from PIL import Image

import comfy.model_management as mm
import comfy.utils
import folder_paths

from .reference_sheet import build_sheet, tensor_to_uint8

HOME = os.path.expanduser("~")
DEFAULT_BIN = os.path.join(HOME, "ltx-2-mlx", ".venv", "bin", "ltx-2-mlx")
# Ingredients was trained on 121-frame clips: the length used when the
# duration is left to the prompt (ic-lora has no predicted duration).
REFS_DEFAULT_SECONDS = 5.0
NO_PACK = "(no LTX MLX pack found)"
NO_LORA = "None"
# A pack folder carries one of these next to its safetensors (the pitfall
# noted in the Rushes pilot: pointing the CLI at a wrong path makes it try a
# HuggingFace download instead of failing).
PACK_MARKERS = ("split_model.json", "embedded_config.json")
# Homebrew locations: the child needs ffmpeg, and a ComfyUI started by a
# launchd agent or the Komfy supervisor often has a bare PATH.
EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin"]
TQDM_RE = re.compile(r"(\d+)/(\d+)\s*\[")
# Voice to video: the a2v wrapper that fuses a LoRA (a2v has no --lora flag).
A2V_LORA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "a2v_lora.py")
VOICE_MAX_SECONDS = 20.0
# Appended to the prompt when a voice drives the clip. Measured: without a
# speaking description (and with "a mocking half smile") the mouth stayed
# shut in every mode; spelling out the articulation made the lips follow.
LIP_SYNC_HINT = (
    " The lips clearly follow the spoken words, the mouth opens on every"
    " syllable, the head stays steady."
)
# x2 video upscale: the Pixel-Spatial-Upscaler IC-LoRA of the 2.5 pack.
UPSCALE_LORA_HINT = "pixel-spatial-upscaler-x2"
LOG_TAIL = 60


# Voice files are served back to the app through ComfyUI's /view, which takes
# the type from Python's mimetypes table. That table maps .m4a (what Voice
# Memos records) to audio/mp4a-latm, a type the iPhone's player refuses from
# a URL ("Cannot Open"), so the voice could not be played in the form.
# audio/mp4 is the registered type for an MPEG-4 audio file. Process-wide,
# set once when ComfyUI loads this node.
mimetypes.add_type("audio/mp4", ".m4a")


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


def _default_ingredients(loras):
    return _default_lora(loras, "ingredients", "2.5")


def _dev_recipe(pack):
    """ic-lora flags of the Ingredients recipe for a pack: single stage, dev
    transformer, the pack's distilled LoRA at 0.5."""
    dev = os.path.join(pack, "transformer-dev.safetensors")
    distilled = sorted(glob.glob(os.path.join(pack, "*distilled-lora*.safetensors")))
    if not os.path.isfile(dev) or not distilled:
        # A distilled-only pack (e.g. a converted community checkpoint) has
        # neither: references stay on a pack that ships the dev transformer.
        raise RuntimeError(
            f"Character references need the pack's transformer-dev.safetensors and its "
            f"distilled LoRA (*distilled-lora*.safetensors) in {pack}. A distilled-only "
            f"pack cannot render them: pick the official LTX 2.5 pack for references"
        )
    return ["--single-stage", "--dev-transformer", "transformer-dev.safetensors",
            "--distilled-lora", distilled[0], "--distilled-lora-strength", "0.5"]


def _sheet_video(refs, width, height, frames, fps, folder, env):
    """Writes the reference sheet as a static mp4 of `frames` frames."""
    ffmpeg = shutil.which("ffmpeg", path=env["PATH"])
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found: needed to build the reference video")
    sheet = build_sheet([tensor_to_uint8(r) for r in refs], width, height)
    png = os.path.join(folder, "sheet.png")
    Image.fromarray(sheet).save(png)
    mp4 = os.path.join(folder, "sheet.mp4")
    res = subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-loop", "1", "-framerate", str(fps), "-i", png,
         "-frames:v", str(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "12",
         "-pix_fmt", "yuv420p", mp4],
        capture_output=True, text=True, env=env,
    )
    if res.returncode != 0 or not os.path.isfile(mp4):
        raise RuntimeError("Could not encode the reference video:\n" + res.stderr[-800:])
    return mp4


def _frames_covering(seconds, fps):
    """Smallest LTX frame count (8k + 1) whose length covers `seconds`."""
    k = max(1, math.ceil((seconds * fps - 1) / 8.0))
    return 8 * k + 1


def _write_wav(audio, path):
    """ComfyUI AUDIO ({"waveform": [B, C, T], "sample_rate"}) as 16-bit WAV.
    Returns the duration in seconds."""
    rate = int(audio["sample_rate"])
    samples = audio["waveform"][0].detach().cpu().float().numpy()  # [C, T]
    pcm = (np.clip(samples, -1.0, 1.0).T * 32767.0).astype("<i2")
    with wave.open(path, "wb") as out:
        out.setnchannels(samples.shape[0])
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())
    return samples.shape[1] / float(rate)


def _prepare_voice(raw, seconds, normalize, folder, env):
    """The voice track a2v gets: loudness-normalized (a phone recording at
    -25 dB mean barely moved the lips; about -18 dB did), then padded with
    silence to `seconds` (a2v rejects a track shorter than the clip)."""
    ffmpeg = shutil.which("ffmpeg", path=env["PATH"])
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found: needed to prepare the voice")
    filters = (["loudnorm=I=-16:TP=-1.5:LRA=11"] if normalize else []) + [
        f"apad=whole_dur={seconds:.3f}"]
    out = os.path.join(folder, "voice.wav")
    res = subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-i", raw, "-af", ",".join(filters), "-ar", "48000", out],
        capture_output=True, text=True, env=env,
    )
    if res.returncode != 0 or not os.path.isfile(out):
        raise RuntimeError("Could not prepare the voice:\n" + res.stderr[-800:])
    return out


def _finalize(src, dst, graph, env, audio_from=None):
    """Moves the CLI's mp4 to `dst`, re-muxed without re-encoding: the API
    graph goes into the `prompt` tag (where ComfyUI's SaveVideo puts it), so
    the recipe outlives the server history, and `audio_from` (the source of
    an upscale) supplies the audio track. Without ffmpeg, or if the re-mux
    fails, the file is kept as is, except when the audio was required."""
    ffmpeg = shutil.which("ffmpeg", path=env["PATH"])
    cmd = [ffmpeg or "ffmpeg", "-y", "-v", "error", "-i", src]
    if audio_from:
        cmd += ["-i", audio_from, "-map", "0:v", "-map", "1:a?"]
    else:
        cmd += ["-map", "0"]
    cmd += ["-c", "copy"]
    if graph:
        cmd += ["-movflags", "use_metadata_tags", "-metadata", "prompt=" + json.dumps(graph)]
    cmd += [dst]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env) if ffmpeg else None
    if res is not None and res.returncode == 0 and os.path.isfile(dst):
        os.remove(src)
        return
    if audio_from:
        raise RuntimeError("Could not mux the source audio back:\n"
                           + (res.stderr[-800:] if res else "ffmpeg not found"))
    print("[komfy-ltx-mlx] recipe not embedded: "
          + (res.stderr[-300:] if res else "ffmpeg not found"))
    shutil.move(src, dst)


def _resolve_pack(model_pack):
    packs = _discover_packs()
    if model_pack not in packs:
        raise RuntimeError(
            f"LTX MLX pack '{model_pack}' not found. Searched: "
            + ", ".join(_local_roots() + [_hf_hub_dir()])
            + ". Set KOMFY_LTX_MLX_PACKS to the folder holding it."
        )
    return packs[model_pack]


def _binary():
    binary = os.environ.get("KOMFY_LTX_MLX_BIN", DEFAULT_BIN)
    if not os.access(binary, os.X_OK):
        raise RuntimeError(f"ltx-2-mlx executable not found at {binary} (set KOMFY_LTX_MLX_BIN)")
    return binary


def _output_path(prefix, w, h):
    """(absolute .mp4 path, stem, subfolder, folder) under ComfyUI's output."""
    full_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
        prefix, folder_paths.get_output_directory(), w, h)
    os.makedirs(full_folder, exist_ok=True)
    stem = f"{filename}_{counter:05}_"
    return os.path.join(full_folder, stem + ".mp4"), stem, subfolder, full_folder


def _default_lora(loras, *needles):
    for name in loras:
        low = name.lower()
        if all(n in low for n in needles):
            return name
    return NO_LORA


def _resolve_loras(lora_name, lora_strength, extra_loras):
    """(path, strength) of every LoRA to fuse: lora_name first, then the
    extra_loras JSON list, in order. Raises on a malformed list or a file
    missing from models/loras."""
    wanted = []
    if lora_name and lora_name != NO_LORA:
        wanted.append((lora_name, float(lora_strength)))
    text = (extra_loras or "").strip()
    if text:
        try:
            items = json.loads(text)
        except ValueError as e:
            raise ValueError(f"extra_loras is not valid JSON: {e}") from None
        if not isinstance(items, list):
            raise ValueError("extra_loras must be a JSON list")
        for item in items:
            name = item.get("name") if isinstance(item, dict) else None
            strength = item.get("strength", 1.0) if isinstance(item, dict) else None
            if not isinstance(name, str) or not name.strip() or isinstance(strength, bool) \
                    or not isinstance(strength, (int, float)) or not math.isfinite(strength):
                raise ValueError(f"extra_loras: bad entry {item!r} (expected name + strength)")
            wanted.append((name.strip(), float(strength)))
    resolved = []
    for name, strength in wanted:
        path = folder_paths.get_full_path("loras", name)
        if not path:
            raise RuntimeError(f"LoRA '{name}' not found in models/loras")
        resolved.append((path, strength))
    return resolved


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
                # LoRAs after lora_name, all fused together (`--lora` repeated):
                # JSON [{"name": path under models/loras, "strength": float}].
                # A string, not combos: the count is free, and an empty value
                # leaves the render exactly as with lora_name alone.
                "extra_loras": ("STRING", {
                    "default": "",
                    "tooltip": 'More LoRAs, applied with lora_name: [{"name": "x.safetensors", "strength": 1.0}]',
                }),
                "ref_1": ("IMAGE", {"tooltip": "Character reference photo: switches the render to the Ingredients IC-LoRA"}),
                "ref_2": ("IMAGE",),
                "ref_3": ("IMAGE",),
                # A path under models/loras, not a list: a combo would make the
                # server reject every render when the gated LoRA is not installed,
                # even without references. Resolved only when a photo is plugged.
                "ingredients_lora": ("STRING", {"default": _default_ingredients(loras)}),
                "ingredients_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.05}),
                "reference_strength": ("FLOAT", {
                    "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Strength of the reference sheet video (ic-lora --video-conditioning)",
                }),
                "voice": ("AUDIO", {
                    "tooltip": "A voice to speak: switches the render to ltx-2-mlx a2v (distilled). "
                               "Needs a first image; the clip length follows the voice",
                }),
                "voice_normalize": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "Bring the voice to about -16 LUFS before the render (quiet phone recordings barely move the lips)",
                }),
                "lip_sync_hint": ("BOOLEAN", {
                    "default": True,
                    "tooltip": "With a voice: append a sentence describing the articulation to the prompt",
                }),
                "silence_after": ("FLOAT", {
                    "default": 0.0, "min": 0.0, "max": 10.0, "step": 0.5,
                    "tooltip": "With a voice: seconds of silence added after it, lengthening the clip "
                               "(time to close the mouth and reach the last image)",
                }),
            },
            "hidden": {"komfy_graph": "PROMPT"},
        }

    RETURN_TYPES = ()
    FUNCTION = "generate"
    OUTPUT_NODE = True
    CATEGORY = "Komfy/LTX MLX"

    def generate(self, model_pack, prompt, width, height, fit_to_image,
                 duration, frame_rate, seed, first_strength, last_strength, lora_name,
                 lora_strength, audio, low_ram, tile_frames, save_last_frame, filename_prefix,
                 first_image=None, last_image=None, ref_1=None, ref_2=None, ref_3=None,
                 ingredients_lora=NO_LORA, ingredients_strength=1.0, reference_strength=1.0,
                 voice=None, voice_normalize=True, lip_sync_hint=True, silence_after=0.0,
                 extra_loras="", komfy_graph=None):
        pack = _resolve_pack(model_pack)
        binary = _binary()
        if not prompt.strip():
            raise ValueError("The prompt is empty")
        if last_image is not None and first_image is None:
            raise ValueError("A last image needs a first image")
        refs = [r for r in (ref_1, ref_2, ref_3) if r is not None]
        if refs and ingredients_lora.strip() in ("", NO_LORA):
            raise ValueError("Character references need the Ingredients IC-LoRA (ingredients_lora)")
        if refs and first_image is not None:
            # Measured on 0.18: with a start image the clip leaves it after
            # frame 0 and films the sheet. Fail before a 13-minute render.
            raise ValueError("Character references work in text to video only: remove the first image")
        # Resolved before anything heavy: a missing file fails in a second.
        loras = _resolve_loras(lora_name, lora_strength, extra_loras)
        voice_seconds = None
        if voice is not None:
            # a2v --distilled takes the same --image anchors as generate
            # (measured 2026-11-22: a last image holds, the lips still follow
            # the voice as long as the prompt does not ask for a closed mouth).
            if first_image is None or refs:
                raise ValueError("A voice needs a start image (and no references)")
            voice_seconds = voice["waveform"].shape[-1] / float(voice["sample_rate"])
            if voice_seconds + silence_after > VOICE_MAX_SECONDS:
                raise ValueError(
                    f"The voice lasts {voice_seconds:.1f} s"
                    + (f" plus {silence_after:g} s of silence" if silence_after > 0 else "")
                    + f": keep the total under {VOICE_MAX_SECONDS:g} s")

        # The distilled plan samples stage 1 at half resolution, whose sides
        # must stay multiples of 32: full size in multiples of 64.
        mult = 64
        if fit_to_image and first_image is not None:
            img_h, img_w = int(first_image.shape[1]), int(first_image.shape[2])
            long_side = max(width, height)
            if img_w >= img_h:
                width, height = long_side, long_side * img_h / img_w
            else:
                width, height = long_side * img_w / img_h, long_side
        w, h = _round_to(width, mult), _round_to(height, mult)

        out_path, stem, subfolder, full_folder = _output_path(filename_prefix, w, h)

        tmpdir = tempfile.mkdtemp(prefix="komfy-ltx-", dir=folder_paths.get_temp_directory())
        try:
            env = _child_env()
            frames = _frames_for(duration, frame_rate) if duration > 0 else None
            if refs and frames is None:
                frames = _frames_for(REFS_DEFAULT_SECONDS, frame_rate)
            if voice is not None:
                # The voice (plus the silence asked after it) sets the length;
                # it is normalized and padded to cover every frame. Distilled
                # only: measured with a character LoRA, the CFG plans speak in
                # voice-over instead of the lips.
                frames = _frames_covering(voice_seconds + silence_after, frame_rate)
                raw = os.path.join(tmpdir, "voice-raw.wav")
                _write_wav(voice, raw)
                track = _prepare_voice(raw, frames / frame_rate + 0.3, voice_normalize, tmpdir, env)
                if loras:
                    python = os.path.join(os.path.dirname(binary), "python")
                    if not os.access(python, os.X_OK):
                        raise RuntimeError(f"No python next to {binary}: needed to fuse the LoRA into a2v")
                    cmd = [python, A2V_LORA]
                    for path, strength in loras:
                        cmd += [path, f"{strength:g}"]
                    cmd += ["--"]
                else:
                    cmd = [binary, "a2v"]
                cmd += ["--distilled", "--audio", track]
                if lip_sync_hint:
                    prompt = prompt.rstrip() + LIP_SYNC_HINT
            elif refs:
                cmd = [binary, "ic-lora"] + _dev_recipe(pack)
            else:
                cmd = [binary, "generate", "--distilled"]
            raw_out = os.path.join(tmpdir, "render.mp4")
            cmd += [
                "--model", pack,
                "--prompt", prompt,
                "-H", str(h), "-W", str(w),
                "--frame-rate", str(frame_rate),
                "--seed", str(seed),
                "--output", raw_out,
            ]
            if frames:
                cmd += ["--frames", str(frames)]
            if first_image is not None:
                cmd += ["--image", _save_png(first_image[0], tmpdir, "first.png"), "0", f"{first_strength:g}"]
            if last_image is not None:
                cmd += ["--image", _save_png(last_image[0], tmpdir, "last.png"), "last", f"{last_strength:g}"]
            if refs:
                ingredients = folder_paths.get_full_path("loras", ingredients_lora.strip())
                if not ingredients:
                    raise RuntimeError(f"Ingredients IC-LoRA '{ingredients_lora}' not found in models/loras")
                cmd += ["--lora", ingredients, f"{ingredients_strength:g}"]
                sheet = _sheet_video(refs, w, h, frames, frame_rate, tmpdir, env)
                cmd += ["--video-conditioning", sheet, f"{reference_strength:g}"]
            if voice is None:
                for path, strength in loras:
                    cmd += ["--lora", path, f"{strength:g}"]
            if not audio and not refs and voice is None:
                cmd += ["--no-audio"]
            if low_ram:
                cmd += ["--low-ram"]
            if tile_frames > 1 and not refs and voice is None:
                cmd += ["--tile-frames", str(tile_frames)]

            print("[komfy-ltx-mlx] " + shlex.join(cmd))
            mm.unload_all_models()
            mm.soft_empty_cache()

            _run(cmd, env, tmpdir)

            if not os.path.isfile(raw_out):
                raise RuntimeError(f"ltx-2-mlx exited without writing {raw_out}")
            _finalize(raw_out, out_path, komfy_graph, env)

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


class KomfyLTX25UpscaleMLX:
    """x2 upscale of an LTX clip (pixels, motion and mouth kept frame for
    frame), with an optional identity LoRA, through ltx-2-mlx ic-lora.

    Recipe validated on 2026-11-21: one stage at twice the source size with
    the Pixel-Spatial-Upscaler x2 IC-LoRA at 1.0 and the source as
    `--video-conditioning` at 1.0. A character LoRA on top sharpens the face
    toward the character (1.0 a clear gain, 1.2 to 1.5 marginal); the mouth
    shapes stay those of the source, so a lip-synced take stays in sync. The
    source's audio is muxed back without re-encoding. About 38 min for 4.4 s
    at 1024x1536 on an M3 Max with free memory.
    """

    @classmethod
    def INPUT_TYPES(cls):
        packs = list(_discover_packs().keys()) or [NO_PACK]
        loras = [NO_LORA] + folder_paths.get_filename_list("loras")
        return {
            "required": {
                "model_pack": (packs, {"tooltip": "ltx-2-mlx model pack (LTX 2.5)"}),
                "video": ("VIDEO", {"tooltip": "The clip to upscale (an LTX output: 8k + 1 frames)"}),
                "prompt": ("STRING", {
                    "multiline": True, "default": "",
                    "tooltip": "Describe the clip, ideally the prompt it was made with",
                }),
                "lora_name": (loras, {"tooltip": "Identity LoRA (e.g. the character LoRA of the source take)"}),
                "lora_strength": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.05}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1, "control_after_generate": True}),
                "low_ram": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Stream transformer blocks from disk: lower peak memory, slower",
                }),
                "filename_prefix": ("STRING", {"default": "komfy/ltx25-upscale"}),
            },
            "optional": {
                # A path under models/loras, not a list (same reason as the
                # Ingredients LoRA: a combo would reject every render when it
                # is missing). The default is found by name.
                "upscaler_lora": ("STRING", {"default": _default_lora(loras, UPSCALE_LORA_HINT, "2.5")}),
                "upscaler_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.05}),
            },
            "hidden": {"komfy_graph": "PROMPT"},
        }

    RETURN_TYPES = ()
    FUNCTION = "upscale"
    OUTPUT_NODE = True
    CATEGORY = "Komfy/LTX MLX"

    def upscale(self, model_pack, video, prompt, lora_name, lora_strength, seed, low_ram,
                filename_prefix, upscaler_lora=None, upscaler_strength=1.0, komfy_graph=None):
        pack = _resolve_pack(model_pack)
        binary = _binary()
        if not prompt.strip():
            raise ValueError("The prompt is empty")
        if upscaler_lora is None:
            # Optional input left out of the graph (the Komfy workflow does):
            # look the IC-LoRA up by name, as the widget default does.
            upscaler_lora = _default_lora(folder_paths.get_filename_list("loras"), UPSCALE_LORA_HINT, "2.5")
        upscaler = folder_paths.get_full_path("loras", upscaler_lora.strip()) \
            if upscaler_lora.strip() not in ("", NO_LORA) else None
        if not upscaler:
            raise RuntimeError(
                "Pixel-Spatial-Upscaler x2 IC-LoRA not found in models/loras "
                "(ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors, see the node README)")

        src_w, src_h = video.get_dimensions()
        fps = int(round(float(video.get_frame_rate())))
        count = int(video.get_frame_count())
        if count < 9:
            raise ValueError(f"The clip has {count} frames: at least 9 are needed")
        # LTX clips already hold 8k + 1 frames; anything else is trimmed down.
        frames = 8 * ((count - 1) // 8) + 1
        w, h = _round_to(2 * src_w, 32), _round_to(2 * src_h, 32)
        out_path, stem, subfolder, _ = _output_path(filename_prefix, w, h)

        tmpdir = tempfile.mkdtemp(prefix="komfy-ltx-up-", dir=folder_paths.get_temp_directory())
        try:
            env = _child_env()
            source = video.get_stream_source()
            if not isinstance(source, str):
                path = os.path.join(tmpdir, "source.mp4")
                with open(path, "wb") as f:
                    f.write(source.read())
                source = path
            raw_out = os.path.join(tmpdir, "upscale.mp4")
            cmd = [
                binary, "ic-lora", "--single-stage",
                "--model", pack,
                "--prompt", prompt,
                "-W", str(w), "-H", str(h),
                "--frames", str(frames),
                "--frame-rate", str(fps),
                "--seed", str(seed),
                "--lora", upscaler, f"{upscaler_strength:g}",
            ]
            if lora_name != NO_LORA:
                lora_path = folder_paths.get_full_path("loras", lora_name)
                if not lora_path:
                    raise RuntimeError(f"LoRA '{lora_name}' not found in models/loras")
                cmd += ["--lora", lora_path, f"{lora_strength:g}"]
            cmd += ["--video-conditioning", source, "1.0", "--output", raw_out]
            if low_ram:
                cmd += ["--low-ram"]

            print("[komfy-ltx-mlx] " + shlex.join(cmd))
            mm.unload_all_models()
            mm.soft_empty_cache()
            _run(cmd, env, tmpdir)
            if not os.path.isfile(raw_out):
                raise RuntimeError(f"ltx-2-mlx exited without writing {raw_out}")
            _finalize(raw_out, out_path, komfy_graph, env, audio_from=source)
            results = [{"filename": stem + ".mp4", "subfolder": subfolder, "type": "output"}]
            return {"ui": {"images": results, "animated": (True,)}}
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


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


NODE_CLASS_MAPPINGS = {
    "KomfyLTX25MLX": KomfyLTX25MLX,
    "KomfyLTX25UpscaleMLX": KomfyLTX25UpscaleMLX,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "KomfyLTX25MLX": "LTX 2.5 (MLX) · Komfy",
    "KomfyLTX25UpscaleMLX": "LTX 2.5 video upscale x2 (MLX) · Komfy",
}
