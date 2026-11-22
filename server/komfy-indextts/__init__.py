"""Komfy: voice cloning with IndexTTS 2.5 (ComfyUI custom node).

`KomfyIndexTTS` says a line in a cloned voice, with an optional mix of the
eight IndexTTS emotions, and writes it as an mp4 (an animated waveform over
the speech) so the Komfy gallery, viewer and remix handle it like any clip,
and core LoadAudio reads its audio track back (the talking-video workflow
takes it as its voice).

IndexTTS runs out of process, in its own virtualenv (the official repo
installed with `uv sync`), the same way komfy-ltx-mlx runs ltx-2-mlx:

  - a child process in its own session, which returns all its memory to the
    OS when it exits;
  - its progress (IndexTTS's own callback, printed by runner.py) feeds
    ComfyUI's progress bar, and an Interrupt kills its process group;
  - on failure, the tail of its log is raised.

Installed or not: the optional `engine` input lists `IndexTTS-2.5` only
when the virtualenv and the checkpoints are found, otherwise one entry
naming what is missing. The Komfy app checks its workflow's literal against
that list (/object_info), so a half-done install shows up in the app before
a launch, and ComfyUI's validation refuses the prompt with the reason.
Optional, so graphs saved before it existed still run.

ComfyUI's models are NOT unloaded first: IndexTTS needs about 6 to 8 GB and
a loaded Krea stays useful for the next job.

Saved voices live in `models/voices` (registered here as the `voices`
model folder): the `voice` combo lists them. A new sample plugged into
`voice_audio` (core LoadAudio) replaces the saved voice for this render,
and `save_voice_as` stores it in `models/voices/<name>.wav` for next time.

Configuration (environment of the ComfyUI process, optional):
  KOMFY_INDEXTTS_DIR  the index-tts checkout holding .venv and checkpoints
                      (default ~/Documents/index-tts)

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
POSIX = os.name != "nt"
ENGINE = "IndexTTS-2.5"
DEFAULT_DIR = os.path.join(HOME, "Documents", "index-tts")
RUNNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "runner.py")
VOICE_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}
# First entry of the voice list, always present: the combo stays valid when
# a new sample replaces the saved voice, or before any voice is saved.
NO_VOICE = "None"
# IndexTTS 2.5's languages (its web UI offers the same five). No French.
LANGUAGES = ["EN", "ZH", "JA", "ES", "AR"]
# Order of IndexTTS's emotion vector (infer_v2_5.normalize_emo_vec).
EMOTIONS = ["happy", "angry", "sad", "afraid", "disgusted", "melancholic", "surprised", "calm"]
# Homebrew locations: ffmpeg, for a ComfyUI started with a bare PATH.
EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin"]
PROGRESS_RE = re.compile(r"^@@progress (\d+)/(\d+)")
TQDM_RE = re.compile(r"(\d+)/(\d+)\s*\[")
LOG_TAIL = 60
NAME_MAX = 64

# The waveform video: the app's ground and signature yellow (theme tokens
# bg and brand), the part already spoken lit, the rest dimmed.
VIDEO_SIZE = 1080
VIDEO_FPS = 30
WAVE_W, WAVE_H = 960, 420
COLOR_BG = "0x141719"
COLOR_LIT = "0xE7F950"
COLOR_DIM = "0x3A3F1A"

# Same fix as komfy-ltx-mlx (each package must stand alone): Python maps
# .m4a to audio/mp4a-latm, which the iPhone player refuses from a URL.
mimetypes.add_type("audio/mp4", ".m4a")


# --------------------------------------------------------------------------
# The voices model folder
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
# Helpers (copied from komfy-ltx-mlx: the packages are symlinked separately)
# --------------------------------------------------------------------------

def _indextts_paths():
    root = os.path.expanduser(os.environ.get("KOMFY_INDEXTTS_DIR", DEFAULT_DIR))
    if POSIX:
        python = os.path.join(root, ".venv", "bin", "python")
    else:
        python = os.path.join(root, ".venv", "Scripts", "python.exe")
    return root, python, os.path.join(root, "checkpoints")


def _install_problem():
    """None when IndexTTS can run, else what is missing (shown to the user)."""
    root, python, checkpoints = _indextts_paths()
    if not os.path.isfile(python):
        return f"no virtualenv at {python} (set KOMFY_INDEXTTS_DIR?)"
    if not os.path.isfile(os.path.join(checkpoints, "config.yaml")):
        return f"no config.yaml in {checkpoints}"
    return None


def _engine_choices():
    problem = _install_problem()
    return [ENGINE] if problem is None else [f"unavailable: {problem}"]


def _indextts_dir():
    problem = _install_problem()
    if problem is not None:
        raise RuntimeError(
            f"IndexTTS is not installed: {problem}. See server/komfy-indextts/README.md")
    return _indextts_paths()


def _child_env(checkpoints):
    env = os.environ.copy()
    # ComfyUI's own interpreter settings must not leak into the IndexTTS venv.
    for key in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"):
        env.pop(key, None)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    # IndexTTS fetches its helper models (w2v-bert, campplus, bigvgan) into
    # checkpoints/hf_cache on its first run. Once they are there, never let
    # a render start a download.
    cache = os.path.join(checkpoints, "hf_cache")
    if os.path.isdir(cache) and os.listdir(cache):
        env["HF_HUB_OFFLINE"] = "1"
    # PyTorch on MPS: fall back to the CPU for the few ops it lacks.
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
    """Runs the child; `@@progress n/total` lines drive ComfyUI's bar, the
    inner tqdm bars (one per segment) are kept out of the log tail."""
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
                    print(f"[komfy-indextts] {line[len('@@progress '):].strip()}")
                continue
            if TQDM_RE.search(line):
                continue
            print(f"[komfy-indextts] {line.rstrip()}")
            tail.append(line.rstrip())
            del tail[:-LOG_TAIL]
        proc.wait()
    except BaseException:
        if proc.poll() is None:
            _terminate(proc)
        raise
    if proc.returncode != 0:
        raise RuntimeError(f"IndexTTS failed (exit {proc.returncode}):\n" + "\n".join(tail[-25:]))


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
    """IndexTTS reads WAV and FLAC reliably; anything else (an m4a voice
    memo, an mp3) is decoded to WAV first."""
    if os.path.splitext(src)[1].lower() in (".wav", ".flac"):
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


def _parse_mix(raw):
    """The emotion mix: a JSON list of 8 numbers in 0..1 (EMOTIONS order).
    None when every value is 0 (neutral: IndexTTS takes the emotion from
    the voice sample itself)."""
    try:
        values = json.loads(raw) if raw and raw.strip() else [0.0] * len(EMOTIONS)
    except json.JSONDecodeError as exc:
        raise ValueError(f"emotion_mix is not JSON: {exc}") from exc
    if not isinstance(values, list) or len(values) != len(EMOTIONS):
        raise ValueError(f"emotion_mix must list {len(EMOTIONS)} numbers ({', '.join(EMOTIONS)})")
    try:
        values = [max(0.0, min(1.0, float(v))) for v in values]
    except (TypeError, ValueError) as exc:
        raise ValueError("emotion_mix must hold numbers between 0 and 1") from exc
    return values if any(v > 0 for v in values) else None


def _wav_seconds(path):
    with wave.open(path, "rb") as f:
        return f.getnframes() / float(f.getframerate())


def _render_clip(speech, out_path, graph, folder, env):
    """The speech as an mp4: its whole waveform drawn dim, lit from left to
    right as it plays (so the first frame, the gallery thumbnail, already
    shows the whole line), AAC audio, and the API graph in the `prompt` tag
    like the LTX nodes (komfy-listing's GET /komfy/recipe reads it)."""
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

class KomfyIndexTTS:
    """A line in a cloned voice (IndexTTS 2.5), with a mix of 8 emotions."""

    @classmethod
    def INPUT_TYPES(cls):
        voices = [NO_VOICE] + folder_paths.get_filename_list("voices")
        return {
            "required": {
                "voice": (voices, {"tooltip": "Saved voice sample (models/voices); None with a new sample"}),
                "text": ("STRING", {"multiline": True, "default": ""}),
                "lang": (LANGUAGES, {"default": "EN"}),
                "emotion_mix": ("STRING", {
                    "default": "[0, 0, 0, 0, 0, 0, 0, 0]",
                    "tooltip": "JSON list of 8 weights in 0..1: " + ", ".join(EMOTIONS)
                               + ". All zeros = neutral (the emotion of the sample)",
                }),
                "emotion_strength": ("FLOAT", {
                    "default": 0.4, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "Scales the mix (IndexTTS emo_alpha). Past about 0.5 the voice drifts "
                               "away from the sample's timbre",
                }),
                "speed": ("FLOAT", {
                    "default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05,
                    "tooltip": "Speaking rate: 2 = twice as fast (IndexTTS duration_factor = 1 / speed)",
                }),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1, "control_after_generate": True}),
                "filename_prefix": ("STRING", {"default": "komfy/voice"}),
            },
            "optional": {
                "engine": (_engine_choices(), {
                    "tooltip": "IndexTTS-2.5 when its virtualenv and checkpoints are found; "
                               "otherwise what is missing (see README)",
                }),
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

    def generate(self, voice, text, lang, emotion_mix, emotion_strength, speed, seed,
                 filename_prefix, engine=ENGINE, voice_audio=None, save_voice_as="",
                 komfy_graph=None):
        root, python, checkpoints = _indextts_dir()
        if not text.strip():
            raise ValueError("The text to say is empty")
        if lang not in LANGUAGES:
            raise ValueError(f"Language {lang} is not one of IndexTTS 2.5's: {', '.join(LANGUAGES)}")
        mix = _parse_mix(emotion_mix)
        speed = max(0.5, min(2.0, float(speed)))

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
        tmpdir = tempfile.mkdtemp(prefix="komfy-tts-", dir=folder_paths.get_temp_directory())
        try:
            env = _child_env(checkpoints)
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
                "dir": root,
                "checkpoints": checkpoints,
                "speaker": speaker,
                "text": text,
                "lang": lang,
                "output": speech,
                "emo_vector": mix,
                "emo_alpha": float(emotion_strength),
                "duration_factor": 1.0 / speed,
                "seed": int(seed),
            }
            job_path = os.path.join(tmpdir, "job.json")
            with open(job_path, "w", encoding="utf-8") as f:
                json.dump(job, f)

            print(f"[komfy-indextts] {lang} voice={'upload' if voice_audio is not None else voice} "
                  f"mix={mix} strength={emotion_strength:g} speed={speed:g} seed={seed}")
            _run([python, RUNNER, job_path], env, root)
            if not os.path.isfile(speech):
                raise RuntimeError("IndexTTS exited without writing the speech")

            _render_clip(speech, out_path, komfy_graph, tmpdir, env)
            if save_path and not os.path.isfile(save_path):
                shutil.copyfile(speaker, save_path)
                print(f"[komfy-indextts] voice saved as {save_path}")

            results = [{"filename": stem + ".mp4", "subfolder": subfolder, "type": "output"}]
            return {"ui": {"images": results, "animated": (True,)}}
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


NODE_CLASS_MAPPINGS = {"KomfyIndexTTS": KomfyIndexTTS}
NODE_DISPLAY_NAME_MAPPINGS = {"KomfyIndexTTS": "IndexTTS 2.5 voice · Komfy"}
