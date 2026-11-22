"""Komfy: multilingual voice cloning with XTTS v2 (ComfyUI custom node).

`KomfyXTTS` says a line in a cloned voice in one of XTTS v2's 17 languages
(French among them, which IndexTTS 2.5 lacks). Like KomfyIndexTTS it writes
an mp4 (an animated waveform over the speech), so the Komfy gallery, viewer
and remix handle it like any clip, and core LoadAudio reads its audio track
back (the talking-video workflow takes it as its voice).

XTTS runs out of process, in its own virtualenv (the maintained `coqui-tts`
fork), the same way komfy-indextts runs IndexTTS:

  - a child process in its own process group, which returns all its memory
    to the OS when it exits;
  - its progress (one step per sentence, printed by runner.py) feeds
    ComfyUI's progress bar, and an Interrupt kills the child;
  - on failure, the tail of its log is raised.

Installed or not: the `engine` input lists `XTTS-v2` only when the
virtualenv and the weights are found, otherwise one entry naming what is
missing. The Komfy app checks the workflow's literal against that list
(/object_info), so a half-done install shows up in the app before a launch,
and ComfyUI's own validation refuses the prompt with the reason. The check
runs on every /object_info, so finishing the install needs no restart.

Saved voices are shared with komfy-indextts: `models/voices` (registered by
whichever of the two packages loads first, completed by the other).

Configuration (environment of the ComfyUI process, optional):
  KOMFY_XTTS_DIR     the folder holding .venv and checkpoints
                     (default ~/Documents/xtts)
  KOMFY_XTTS_DEVICE  auto (CUDA when present, else CPU), cpu, cuda or mps

Install: see README.md, then restart ComfyUI.
"""

import json
import mimetypes
import os
import queue
import re
import shutil
import signal
import subprocess
import tempfile
import threading
import wave

import numpy as np

import comfy.model_management as mm
import comfy.utils
import folder_paths

HOME = os.path.expanduser("~")
DEFAULT_DIR = os.path.join(HOME, "Documents", "xtts")
RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runner.py")
POSIX = os.name != "nt"
ENGINE = "XTTS-v2"
# Files the runner loads from <dir>/checkpoints (XTTS v2's Hugging Face repo).
WEIGHTS = ("config.json", "model.pth", "vocab.json")
VOICE_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}
NO_VOICE = "None"
# XTTS v2's languages (config.json `languages`), French first: the reason
# this node exists next to IndexTTS.
LANGUAGES = ["fr", "en", "es", "de", "it", "pt", "pl", "tr", "ru", "nl",
             "cs", "ar", "zh-cn", "hu", "ko", "ja", "hi"]
DEVICES = ("auto", "cpu", "cuda", "mps")
# Homebrew locations: ffmpeg, for a ComfyUI started with a bare PATH on a
# Mac. Directories that do not exist (Linux, Windows) are harmless.
EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin"]
PROGRESS_RE = re.compile(r"^@@progress (\d+)/(\d+)")
LOG_TAIL = 60
NAME_MAX = 64

# The waveform video, identical to komfy-indextts: the app's ground and
# signature yellow, the part already spoken lit, the rest dimmed.
VIDEO_SIZE = 1080
VIDEO_FPS = 30
WAVE_W, WAVE_H = 960, 420
COLOR_BG = "0x141719"
COLOR_LIT = "0xE7F950"
COLOR_DIM = "0x3A3F1A"

# Python maps .m4a to audio/mp4a-latm, which the iPhone player refuses.
mimetypes.add_type("audio/mp4", ".m4a")


# --------------------------------------------------------------------------
# The voices model folder (shared with komfy-indextts)
# --------------------------------------------------------------------------

VOICES_DIR = os.path.join(folder_paths.models_dir, "voices")


def _register_voices():
    os.makedirs(VOICES_DIR, exist_ok=True)
    known = folder_paths.folder_names_and_paths.get("voices")
    if known is None:
        folder_paths.folder_names_and_paths["voices"] = ([VOICES_DIR], set(VOICE_EXTENSIONS))
        return
    paths, extensions = known
    if VOICES_DIR not in paths:
        paths.append(VOICES_DIR)
    extensions.update(VOICE_EXTENSIONS)


_register_voices()


# --------------------------------------------------------------------------
# Install check
# --------------------------------------------------------------------------

def _xtts_paths():
    root = os.path.expanduser(os.environ.get("KOMFY_XTTS_DIR", DEFAULT_DIR))
    if POSIX:
        python = os.path.join(root, ".venv", "bin", "python")
    else:
        python = os.path.join(root, ".venv", "Scripts", "python.exe")
    return root, python, os.path.join(root, "checkpoints")


def _install_problem():
    """None when XTTS can run, else what is missing (shown to the user)."""
    root, python, checkpoints = _xtts_paths()
    if not os.path.isfile(python):
        return f"no virtualenv at {python} (set KOMFY_XTTS_DIR?)"
    for name in WEIGHTS:
        if not os.path.isfile(os.path.join(checkpoints, name)):
            return f"no {name} in {checkpoints}"
    return None


def _engine_choices():
    problem = _install_problem()
    return [ENGINE] if problem is None else [f"unavailable: {problem}"]


# --------------------------------------------------------------------------
# Helpers (the packages are symlinked separately, so each stands alone)
# --------------------------------------------------------------------------

def _child_env():
    env = os.environ.copy()
    # ComfyUI's own interpreter settings must not leak into the XTTS venv.
    for key in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"):
        env.pop(key, None)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    # The weights are read from checkpoints/: a render never downloads.
    env["HF_HUB_OFFLINE"] = "1"
    # The CPML licence of the XTTS v2 weights, accepted at install time
    # (README); without it coqui-tts would stop on an interactive prompt.
    env.setdefault("COQUI_TOS_AGREED", "1")
    env.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
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


def _spawn_options():
    """The child in its own process group, so an Interrupt reaches all of it."""
    if POSIX:
        return {"start_new_session": True}
    return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}


def _terminate(proc):
    if not POSIX:
        # taskkill /T takes the child's own children down with it.
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                       capture_output=True)
        proc.wait()
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=15)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.wait()


def _run(cmd, env, cwd):
    """Runs the child; `@@progress n/total` lines drive ComfyUI's bar."""
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, cwd=cwd,
        **_spawn_options(),
    )
    lines = queue.Queue()
    reader = threading.Thread(target=_read_stream, args=(proc.stdout, lines), daemon=True)
    reader.start()

    tail, pbar, last, done = [], None, -1, False
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
            m = PROGRESS_RE.search(line)
            if m:
                n, total = int(m.group(1)), int(m.group(2))
                if pbar is None:
                    pbar = comfy.utils.ProgressBar(total)
                if n != last:
                    pbar.update_absolute(n, total)
                    last = n
                    print(f"[komfy-xtts] {line[len('@@progress '):].strip()}")
                continue
            print(f"[komfy-xtts] {line.rstrip()}")
            tail.append(line.rstrip())
            del tail[:-LOG_TAIL]
        proc.wait()
    except BaseException:
        if proc.poll() is None:
            _terminate(proc)
        raise
    if proc.returncode != 0:
        raise RuntimeError(f"XTTS failed (exit {proc.returncode}):\n" + "\n".join(tail[-25:]))


def _write_wav(audio, path):
    """ComfyUI AUDIO ({"waveform": [B, C, T], "sample_rate"}) as 16-bit WAV.
    Deterministic: the same upload always gives the same bytes."""
    rate = int(audio["sample_rate"])
    samples = audio["waveform"][0].detach().cpu().float().numpy()  # [C, T]
    pcm = (np.clip(samples, -1.0, 1.0).T * 32767.0).astype("<i2")
    with wave.open(path, "wb") as out:
        out.setnchannels(samples.shape[0])
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(pcm.tobytes())
    return samples.shape[1] / float(rate)


def _ffmpeg(env):
    ffmpeg = shutil.which("ffmpeg", path=env["PATH"])
    if not ffmpeg:
        raise RuntimeError("ffmpeg not found: needed to read the voice and write the clip")
    return ffmpeg


def _as_wav(src, folder, env):
    """XTTS reads WAV reliably; anything else (an m4a voice memo, an mp3)
    is decoded to WAV first, so no codec library is needed in its venv."""
    if os.path.splitext(src)[1].lower() == ".wav":
        return src
    out = os.path.join(folder, "speaker.wav")
    res = subprocess.run([_ffmpeg(env), "-y", "-v", "error", "-i", src, out],
                         capture_output=True, text=True, env=env)
    if res.returncode != 0 or not os.path.isfile(out):
        raise RuntimeError(f"Could not decode the voice sample {src}:\n" + res.stderr[-800:])
    return out


def _sanitize_name(raw):
    """A voice name safe as a file name in models/voices: letters, digits,
    space, dot, dash and underscore; no extension, no path."""
    name = raw.strip()
    base, ext = os.path.splitext(name)
    if ext.lower() in VOICE_EXTENSIONS:
        name = base
    name = re.sub(r"[^\w .-]+", "-", name, flags=re.UNICODE)
    name = re.sub(r"\s+", " ", name).strip(" .-")
    return name[:NAME_MAX].rstrip(" .-")


def _wav_seconds(path):
    with wave.open(path, "rb") as f:
        return f.getnframes() / float(f.getframerate())


def _render_clip(speech, out_path, graph, folder, env):
    """The speech as an mp4, the same picture as komfy-indextts: the whole
    waveform drawn dim, lit from left to right as it plays, AAC audio, and
    the API graph in the `prompt` tag (komfy-listing's GET /komfy/recipe)."""
    ffmpeg = _ffmpeg(env)
    seconds = max(0.1, _wav_seconds(speech))
    x, y = (VIDEO_SIZE - WAVE_W) // 2, (VIDEO_SIZE - WAVE_H) // 2
    dim, lit = os.path.join(folder, "dim.png"), os.path.join(folder, "lit.png")
    wave_pic = "aformat=channel_layouts=mono,showwavespic=s={w}x{h}:colors={c}:draw=full,format=rgba"
    stills = (
        f"color=c={COLOR_BG}:s={VIDEO_SIZE}x{VIDEO_SIZE}:d=1,split[b1][b2];"
        f"[0:a]asplit[a1][a2];"
        f"[a1]{wave_pic.format(w=WAVE_W, h=WAVE_H, c=COLOR_DIM)}[dw];"
        f"[a2]{wave_pic.format(w=WAVE_W, h=WAVE_H, c=COLOR_LIT)}[lw];"
        f"[b1][dw]overlay={x}:{y}[d];[b2][lw]overlay={x}:{y}[l]"
    )
    res = subprocess.run(
        [ffmpeg, "-y", "-v", "error", "-i", speech, "-filter_complex", stills,
         "-map", "[d]", "-frames:v", "1", dim, "-map", "[l]", "-frames:v", "1", lit],
        capture_output=True, text=True, env=env,
    )
    if res.returncode != 0:
        raise RuntimeError("Could not draw the waveform:\n" + res.stderr[-800:])
    length = f"{seconds + 0.2:.3f}"
    cmd = [
        ffmpeg, "-y", "-v", "error",
        "-loop", "1", "-framerate", str(VIDEO_FPS), "-t", length, "-i", dim,
        "-loop", "1", "-framerate", str(VIDEO_FPS), "-t", length, "-i", lit,
        "-i", speech,
        "-filter_complex",
        f"[0:v][1:v]xfade=transition=wiperight:duration={seconds:.3f}:offset=0,format=yuv420p[v]",
        "-map", "[v]", "-map", "2:a",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-tune", "stillimage",
        "-c:a", "aac", "-b:a", "192k", "-shortest",
        "-movflags", "+faststart+use_metadata_tags",
    ]
    if graph:
        cmd += ["-metadata", "prompt=" + json.dumps(graph)]
    cmd += [out_path]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if res.returncode != 0 or not os.path.isfile(out_path):
        raise RuntimeError("Could not write the clip:\n" + res.stderr[-800:])


def _output_path(prefix):
    """(absolute .mp4 path, stem, subfolder) under ComfyUI's output."""
    full_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
        prefix, folder_paths.get_output_directory(), VIDEO_SIZE, VIDEO_SIZE)
    os.makedirs(full_folder, exist_ok=True)
    stem = f"{filename}_{counter:05}_"
    return os.path.join(full_folder, stem + ".mp4"), stem, subfolder


def _same_file(a, b):
    if os.path.getsize(a) != os.path.getsize(b):
        return False
    with open(a, "rb") as fa, open(b, "rb") as fb:
        while True:
            ca, cb = fa.read(1 << 20), fb.read(1 << 20)
            if ca != cb:
                return False
            if not ca:
                return True


# --------------------------------------------------------------------------
# Node
# --------------------------------------------------------------------------

class KomfyXTTS:
    """A line in a cloned voice (XTTS v2), 17 languages including French."""

    @classmethod
    def INPUT_TYPES(cls):
        voices = [NO_VOICE] + folder_paths.get_filename_list("voices")
        return {
            "required": {
                "engine": (_engine_choices(), {
                    "tooltip": "XTTS-v2 when its virtualenv and weights are found; "
                               "otherwise what is missing (see README)",
                }),
                "voice": (voices, {"tooltip": "Saved voice sample (models/voices); None with a new sample"}),
                "text": ("STRING", {"multiline": True, "default": ""}),
                "language": (LANGUAGES, {"default": "fr"}),
                "temperature": ("FLOAT", {
                    "default": 0.75, "min": 0.1, "max": 1.0, "step": 0.05,
                    "tooltip": "Sampling temperature: lower is steadier, higher livelier "
                               "and more likely to stumble",
                }),
                "speed": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1, "control_after_generate": True}),
                "filename_prefix": ("STRING", {"default": "komfy/voice"}),
            },
            "optional": {
                "voice_audio": ("AUDIO", {"tooltip": "A new voice sample: used instead of the saved voice"}),
                "save_voice_as": ("STRING", {
                    "default": "",
                    "tooltip": "With a new sample: also save it as models/voices/<name>.wav",
                }),
            },
            "hidden": {"komfy_graph": "PROMPT"},
        }

    RETURN_TYPES = ()
    FUNCTION = "generate"
    OUTPUT_NODE = True
    CATEGORY = "Komfy/Voice"

    def generate(self, engine, voice, text, language, temperature, speed, seed,
                 filename_prefix, voice_audio=None, save_voice_as="", komfy_graph=None):
        problem = _install_problem()
        if problem is not None:
            raise RuntimeError(f"XTTS is not installed: {problem}. See server/komfy-xtts/README.md")
        root, python, checkpoints = _xtts_paths()
        if not text.strip():
            raise ValueError("The text to say is empty")
        if language not in LANGUAGES:
            raise ValueError(f"Language {language} is not one of XTTS v2's: {', '.join(LANGUAGES)}")
        device = os.environ.get("KOMFY_XTTS_DEVICE", "auto").strip().lower()
        if device not in DEVICES:
            raise ValueError(f"KOMFY_XTTS_DEVICE={device} is not one of {', '.join(DEVICES)}")
        speed = max(0.5, min(2.0, float(speed)))
        temperature = max(0.1, min(1.0, float(temperature)))

        # Checked before the render: a name already taken by another sample
        # is refused, the same sample saved again (a remix) is accepted.
        save_path = None
        if voice_audio is not None and (save_voice_as or "").strip():
            name = _sanitize_name(save_voice_as)
            if not name:
                raise ValueError(f"'{save_voice_as}' is not a usable voice name")
            save_path = os.path.join(VOICES_DIR, name + ".wav")
            taken = [f for f in os.listdir(VOICES_DIR)
                     if os.path.splitext(f)[0].lower() == name.lower()
                     and os.path.splitext(f)[1].lower() in VOICE_EXTENSIONS]
            if taken and not (os.path.isfile(save_path) and taken == [os.path.basename(save_path)]):
                raise ValueError(f"A voice named '{name}' already exists ({taken[0]}): pick another name")

        out_path, stem, subfolder = _output_path(filename_prefix)
        tmpdir = tempfile.mkdtemp(prefix="komfy-xtts-", dir=folder_paths.get_temp_directory())
        try:
            env = _child_env()
            if voice_audio is not None:
                speaker = os.path.join(tmpdir, "sample.wav")
                _write_wav(voice_audio, speaker)
                if save_path and os.path.isfile(save_path) and not _same_file(speaker, save_path):
                    raise ValueError(
                        f"A voice named '{os.path.basename(save_path)[:-4]}' already exists: pick another name")
            else:
                if voice == NO_VOICE:
                    raise ValueError("No voice: pick a saved voice or add a new voice sample")
                speaker = folder_paths.get_full_path("voices", voice)
                if not speaker:
                    raise RuntimeError(f"Voice '{voice}' not found in models/voices")
                speaker = _as_wav(speaker, tmpdir, env)

            speech = os.path.join(tmpdir, "speech.wav")
            job = {
                "checkpoints": checkpoints,
                "speaker": speaker,
                "text": text,
                "language": language,
                "output": speech,
                "temperature": temperature,
                "speed": speed,
                "seed": int(seed),
                "device": device,
            }
            job_path = os.path.join(tmpdir, "job.json")
            with open(job_path, "w", encoding="utf-8") as f:
                json.dump(job, f)

            print(f"[komfy-xtts] {language} voice={'upload' if voice_audio is not None else voice} "
                  f"temperature={temperature:g} speed={speed:g} seed={seed} device={device}")
            _run([python, RUNNER, job_path], env, root)
            if not os.path.isfile(speech):
                raise RuntimeError("XTTS exited without writing the speech")

            _render_clip(speech, out_path, komfy_graph, tmpdir, env)
            if save_path and not os.path.isfile(save_path):
                shutil.copyfile(speaker, save_path)
                print(f"[komfy-xtts] voice saved as {save_path}")

            results = [{"filename": stem + ".mp4", "subfolder": subfolder, "type": "output"}]
            return {"ui": {"images": results, "animated": (True,)}}
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


NODE_CLASS_MAPPINGS = {"KomfyXTTS": KomfyXTTS}
NODE_DISPLAY_NAME_MAPPINGS = {"KomfyXTTS": "XTTS v2 voice · Komfy"}
