"""Komfy: a line said in a cloned voice with VoxCPM2 (ComfyUI custom node).

`KomfyVoxCPM` says a line in a saved or uploaded voice, in any of VoxCPM2's
30 languages (French and English among them, detected from the text, no
language to pick). The tone comes from one of two places:

  - an emotion (a short English instruction VoxCPM2 reads before the text,
    e.g. "(sarcastic, mocking, exasperated)"), plus optional free words;
  - a tone clip: a few seconds said the way the line should sound. VoxCPM2
    continues that clip with the new text (its "prompt" mode), the voice
    sample still fixing the timbre. A clip spoken by someone else takes the
    timbre over (measured: 0.59 similarity to the chosen voice, 0.89 to the
    clip's speaker), so by default it is first converted into the chosen
    voice with CosyVoice3's voice conversion.

The result is an mp4 (an animated waveform over the speech), so the Komfy
gallery, viewer and remix handle it like any clip, and core LoadAudio reads
its audio track back (the talking-video workflow takes it as its voice, and
the voice workflow can take it back as a tone clip).

Both models run out of process, each in its own virtualenv:

  - a child process in its own process group, which returns all its memory
    to the OS when it exits;
  - its progress (`@@progress n/100` lines) feeds ComfyUI's progress bar, and
    an Interrupt kills the child;
  - on failure, the tail of its log is raised.

Installed or not: the `engine` input lists `VoxCPM2` only when the VoxCPM
virtualenv and weights are found, otherwise one entry naming what is
missing. The Komfy app checks the workflow's literal against that list
(/object_info), so a half-done install shows in the app before a launch.
The check runs on every /object_info: finishing the install needs no
restart. CosyVoice3 (voice conversion) and the Whisper transcriber are only
needed for a tone clip, and checked when one is used.

Saved voices: `models/voices` (one sample per voice, wav/mp3/m4a/flac/ogg).

Configuration (environment of the ComfyUI process, optional):
  KOMFY_VOXCPM_DIR      .venv, checkpoints (VoxCPM2) and asr (faster-whisper)
                        (default ~/Documents/voxcpm)
  KOMFY_VOXCPM_DEVICE   auto (CUDA, else MPS, else CPU), cpu, cuda or mps
  KOMFY_COSYVOICE_DIR   the CosyVoice repository with its .venv and
                        pretrained_models/Fun-CosyVoice3-0.5B
                        (default ~/Documents/cosyvoice)

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
HERE = os.path.dirname(os.path.abspath(__file__))
RUNNER = os.path.join(HERE, "runner.py")
VC_RUNNER = os.path.join(HERE, "vc_runner.py")
POSIX = os.name != "nt"
ENGINE = "VoxCPM2"
# Files the runner loads from <dir>/checkpoints (openbmb/VoxCPM2 on Hugging Face).
WEIGHTS = ("config.json", "model.safetensors", "audiovae.pth", "tokenizer.json")
# faster-whisper "small" (Systran/faster-whisper-small) in <dir>/asr.
ASR_WEIGHTS = ("model.bin", "config.json", "tokenizer.json")
COSY_MODEL = os.path.join("pretrained_models", "Fun-CosyVoice3-0.5B")
VOICE_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}
NO_VOICE = "None"
DEVICES = ("auto", "cpu", "cuda", "mps")

# The instruction VoxCPM2 reads before the text for each emotion. Worded as
# on the 2026-11-25 bench, where the maintainer rated sarcastic and happy
# best; sad and whispered were weak (a tone clip does them better).
EMOTIONS = {
    "neutral": "",
    "happy": "very happy, excited, almost laughing",
    "angry": "furious, shouting with anger",
    "sad": "sad, slow, voice trembling, close to tears",
    "sarcastic": "sarcastic, mocking, exasperated",
    "surprised": "very surprised, amazed",
    "calm": "calm, soft, relaxed",
    "whispered": "whispering very softly",
}
TONE_MODES = ("emotion", "clip")
TONE_FROM = ("other_voice", "same_voice")

# A tone clip is continued by VoxCPM2: a few seconds are enough, a long one
# slows the render and drifts. Without a transcript the clip is cut to this
# length before Whisper reads it; with one, it is used whole up to the hard cap.
TONE_AUTO_SECONDS = 15.0
TONE_MAX_SECONDS = 30.0
# CosyVoice3 extracts speech tokens from at most 30 s: the voice sample given
# to the conversion is cut to this.
VC_TARGET_SECONDS = 25.0
# The voice sample: 10 to 25 s is what clones best; a longer recording is cut
# rather than slowing every render.
SPEAKER_MAX_SECONDS = 30.0

# Homebrew locations: ffmpeg, for a ComfyUI started with a bare PATH on a
# Mac. Directories that do not exist (Linux, Windows) are harmless.
EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin"]
PROGRESS_RE = re.compile(r"^@@progress (\d+)/(\d+)")
LOG_TAIL = 60
NAME_MAX = 64

# The waveform video: the app's ground and signature yellow, the part
# already spoken lit, the rest dimmed.
VIDEO_SIZE = 1080
VIDEO_FPS = 30
WAVE_W, WAVE_H = 960, 420
COLOR_BG = "0x141719"
COLOR_LIT = "0xE7F950"
COLOR_DIM = "0x3A3F1A"

# Python maps .m4a to audio/mp4a-latm, which the iPhone player refuses.
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
# Install checks
# --------------------------------------------------------------------------

def _venv_python(root):
    if POSIX:
        return os.path.join(root, ".venv", "bin", "python")
    return os.path.join(root, ".venv", "Scripts", "python.exe")


def _voxcpm_paths():
    root = os.path.expanduser(os.environ.get("KOMFY_VOXCPM_DIR", os.path.join(HOME, "Documents", "voxcpm")))
    return root, _venv_python(root), os.path.join(root, "checkpoints"), os.path.join(root, "asr")


def _cosy_paths():
    root = os.path.expanduser(os.environ.get("KOMFY_COSYVOICE_DIR", os.path.join(HOME, "Documents", "cosyvoice")))
    return root, _venv_python(root), os.path.join(root, COSY_MODEL)


def _install_problem():
    """None when VoxCPM2 can run, else what is missing (shown to the user)."""
    _, python, checkpoints, _ = _voxcpm_paths()
    if not os.path.isfile(python):
        return f"no virtualenv at {python} (set KOMFY_VOXCPM_DIR?)"
    for name in WEIGHTS:
        if not os.path.isfile(os.path.join(checkpoints, name)):
            return f"no {name} in {checkpoints}"
    return None


def _asr_problem():
    _, _, _, asr = _voxcpm_paths()
    for name in ASR_WEIGHTS:
        if not os.path.isfile(os.path.join(asr, name)):
            return f"no {name} in {asr}"
    return None


def _cosy_problem():
    root, python, model = _cosy_paths()
    if not os.path.isfile(python):
        return f"no virtualenv at {python} (set KOMFY_COSYVOICE_DIR?)"
    if not os.path.isfile(os.path.join(model, "cosyvoice3.yaml")):
        return f"no Fun-CosyVoice3-0.5B in {os.path.join(root, 'pretrained_models')}"
    return None


def _engine_choices():
    problem = _install_problem()
    return [ENGINE] if problem is None else [f"unavailable: {problem}"]


# --------------------------------------------------------------------------
# Child processes
# --------------------------------------------------------------------------

def _child_env():
    env = os.environ.copy()
    # ComfyUI's own interpreter settings must not leak into the child venvs.
    for key in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"):
        env.pop(key, None)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    # Every weight is read from disk: a render never downloads.
    env["HF_HUB_OFFLINE"] = "1"
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
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
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


def _run(cmd, env, cwd, what):
    """Runs one child; `@@progress n/total` lines drive ComfyUI's bar."""
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
                    print(f"[komfy-voxcpm] {line[len('@@progress '):].strip()}")
                continue
            print(f"[komfy-voxcpm] {line.rstrip()}")
            tail.append(line.rstrip())
            del tail[:-LOG_TAIL]
        proc.wait()
    except BaseException:
        if proc.poll() is None:
            _terminate(proc)
        raise
    if proc.returncode != 0:
        raise RuntimeError(f"{what} failed (exit {proc.returncode}):\n" + "\n".join(tail[-25:]))


# --------------------------------------------------------------------------
# Audio helpers
# --------------------------------------------------------------------------

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
        raise RuntimeError("ffmpeg not found: needed to read the audio and write the clip")
    return ffmpeg


def _to_wav(src, out, env, seconds=None):
    """Any audio (a saved m4a voice, an uploaded clip) as a mono 16-bit WAV,
    optionally cut to its first `seconds`: no codec library needed in the
    child venvs, and every model reads the same file."""
    cmd = [_ffmpeg(env), "-y", "-v", "error", "-i", src]
    if seconds is not None:
        cmd += ["-t", f"{seconds:.3f}"]
    cmd += ["-ac", "1", "-c:a", "pcm_s16le", out]
    res = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if res.returncode != 0 or not os.path.isfile(out):
        raise RuntimeError(f"Could not decode {os.path.basename(src)}:\n" + res.stderr[-800:])
    return out


def _wav_seconds(path):
    with wave.open(path, "rb") as f:
        return f.getnframes() / float(f.getframerate())


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


def _style_prefix(emotion, style):
    """The parenthesised instruction VoxCPM2 reads before the text: the
    emotion's words, then the user's own (parentheses stripped, so they
    cannot close the instruction early)."""
    words = [EMOTIONS.get(emotion, "")]
    extra = re.sub(r"[()]", " ", style or "")
    extra = re.sub(r"\s+", " ", extra).strip(" ,")
    if extra:
        words.append(extra)
    words = [w for w in words if w]
    return f"({', '.join(words)})" if words else ""


def _render_clip(speech, out_path, graph, folder, env):
    """The speech as an mp4: the whole waveform drawn dim, lit from left to
    right as it plays, AAC audio, and the API graph in the `prompt` tag
    (komfy-listing's GET /komfy/recipe)."""
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


# --------------------------------------------------------------------------
# Node
# --------------------------------------------------------------------------

class KomfyVoxCPM:
    """A line in a cloned voice (VoxCPM2), with an emotion or a tone clip."""

    @classmethod
    def INPUT_TYPES(cls):
        voices = [NO_VOICE] + folder_paths.get_filename_list("voices")
        return {
            "required": {
                "engine": (_engine_choices(), {
                    "tooltip": "VoxCPM2 when its virtualenv and weights are found; "
                               "otherwise what is missing (see README)",
                }),
                "voice": (voices, {"tooltip": "Saved voice sample (models/voices); None with a new sample"}),
                "text": ("STRING", {"multiline": True, "default": ""}),
                "tone_mode": (list(TONE_MODES), {
                    "default": "emotion",
                    "tooltip": "emotion: the emotion and style words below; clip: the tone clip",
                }),
                "emotion": (list(EMOTIONS), {"default": "neutral"}),
                "style": ("STRING", {
                    "default": "",
                    "tooltip": "Free words added to the emotion (pace, register, energy)",
                }),
                "tone_from": (list(TONE_FROM), {
                    "default": "other_voice",
                    "tooltip": "other_voice: the tone clip is first converted into the chosen voice "
                               "(CosyVoice3); same_voice: used as is",
                }),
                "tone_text": ("STRING", {
                    "default": "",
                    "tooltip": "What the tone clip says; empty: transcribed by Whisper",
                }),
                "cfg": ("FLOAT", {
                    "default": 2.0, "min": 1.0, "max": 4.0, "step": 0.1,
                    "tooltip": "Guidance: how closely the voice follows the text, emotion and clip",
                }),
                "steps": ("INT", {
                    "default": 10, "min": 4, "max": 30,
                    "tooltip": "Diffusion steps per chunk of sound: more is a little finer and slower",
                }),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1, "control_after_generate": True}),
                "filename_prefix": ("STRING", {"default": "komfy/voice"}),
            },
            "optional": {
                "voice_audio": ("AUDIO", {"tooltip": "A new voice sample: used instead of the saved voice"}),
                "save_voice_as": ("STRING", {
                    "default": "",
                    "tooltip": "With a new sample: also save it as models/voices/<name>.wav",
                }),
                "tone_audio": ("AUDIO", {"tooltip": "The tone clip (tone_mode clip)"}),
            },
            "hidden": {"komfy_graph": "PROMPT"},
        }

    RETURN_TYPES = ()
    FUNCTION = "generate"
    OUTPUT_NODE = True
    CATEGORY = "Komfy/Voice"

    def generate(self, engine, voice, text, tone_mode, emotion, style, tone_from, tone_text,
                 cfg, steps, seed, filename_prefix, voice_audio=None, save_voice_as="",
                 tone_audio=None, komfy_graph=None):
        problem = _install_problem()
        if problem is not None:
            raise RuntimeError(f"VoxCPM2 is not installed: {problem}. See server/komfy-voxcpm/README.md")
        root, python, checkpoints, asr = _voxcpm_paths()
        if not text.strip():
            raise ValueError("The text to say is empty")
        if tone_mode not in TONE_MODES:
            raise ValueError(f"tone_mode {tone_mode} is not one of {', '.join(TONE_MODES)}")
        if emotion not in EMOTIONS:
            raise ValueError(f"Emotion {emotion} is not one of {', '.join(EMOTIONS)}")
        if tone_from not in TONE_FROM:
            raise ValueError(f"tone_from {tone_from} is not one of {', '.join(TONE_FROM)}")
        use_clip = tone_mode == "clip"
        if use_clip and tone_audio is None:
            raise ValueError("Tone from a clip, but no tone clip was given")
        device = os.environ.get("KOMFY_VOXCPM_DEVICE", "auto").strip().lower()
        if device not in DEVICES:
            raise ValueError(f"KOMFY_VOXCPM_DEVICE={device} is not one of {', '.join(DEVICES)}")
        cfg = max(1.0, min(4.0, float(cfg)))
        steps = max(4, min(30, int(steps)))
        transcript = (tone_text or "").strip()
        convert = use_clip and tone_from == "other_voice"
        # Checked before any render, so a missing piece fails in a second.
        if use_clip and not transcript and _asr_problem():
            raise RuntimeError(f"No transcript and no Whisper to make one: {_asr_problem()}. "
                               "Type what the tone clip says, or see README")
        if convert and _cosy_problem():
            raise RuntimeError(f"Converting the tone clip needs CosyVoice3: {_cosy_problem()}. "
                               "Pick 'same voice' if the clip is already in this voice, or see README")

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
        tmpdir = tempfile.mkdtemp(prefix="komfy-voxcpm-", dir=folder_paths.get_temp_directory())
        try:
            env = _child_env()
            if voice_audio is not None:
                sample = os.path.join(tmpdir, "sample.wav")
                _write_wav(voice_audio, sample)
                if save_path and os.path.isfile(save_path) and not _same_file(sample, save_path):
                    raise ValueError(
                        f"A voice named '{os.path.basename(save_path)[:-4]}' already exists: pick another name")
                speaker = _to_wav(sample, os.path.join(tmpdir, "speaker.wav"), env, SPEAKER_MAX_SECONDS)
            else:
                if voice == NO_VOICE:
                    raise ValueError("No voice: pick a saved voice or add a new voice sample")
                sample = folder_paths.get_full_path("voices", voice)
                if not sample:
                    raise RuntimeError(f"Voice '{voice}' not found in models/voices")
                speaker = _to_wav(sample, os.path.join(tmpdir, "speaker.wav"), env, SPEAKER_MAX_SECONDS)

            prompt_wav = None
            if use_clip:
                raw = os.path.join(tmpdir, "tone-raw.wav")
                seconds = _write_wav(tone_audio, raw)
                if transcript and seconds > TONE_MAX_SECONDS:
                    raise ValueError(f"The tone clip lasts {seconds:.1f} s: keep it under "
                                     f"{TONE_MAX_SECONDS:.0f} s (a few seconds are enough)")
                limit = None if transcript else TONE_AUTO_SECONDS
                prompt_wav = _to_wav(raw, os.path.join(tmpdir, "tone.wav"), env, limit)
                if convert:
                    cosy_root, cosy_python, cosy_model = _cosy_paths()
                    target = _to_wav(speaker, os.path.join(tmpdir, "vc-target.wav"), env, VC_TARGET_SECONDS)
                    converted = os.path.join(tmpdir, "tone-converted.wav")
                    vc_job = {"model_dir": cosy_model, "source": prompt_wav, "target": target,
                              "output": converted, "seed": int(seed)}
                    vc_path = os.path.join(tmpdir, "vc-job.json")
                    with open(vc_path, "w", encoding="utf-8") as f:
                        json.dump(vc_job, f)
                    print("[komfy-voxcpm] converting the tone clip into the chosen voice (CosyVoice3)")
                    _run([cosy_python, VC_RUNNER, vc_path], env, cosy_root, "CosyVoice3 conversion")
                    if not os.path.isfile(converted):
                        raise RuntimeError("CosyVoice3 exited without writing the converted clip")
                    prompt_wav = converted

            speech = os.path.join(tmpdir, "speech.wav")
            job = {
                "checkpoints": checkpoints,
                "asr": asr,
                "text": (_style_prefix(emotion, style) if not use_clip else "") + text.strip(),
                "speaker": speaker,
                "prompt_wav": prompt_wav,
                "prompt_text": transcript,
                "cfg": cfg,
                "steps": steps,
                "seed": int(seed),
                "device": device,
                "output": speech,
            }
            job_path = os.path.join(tmpdir, "job.json")
            with open(job_path, "w", encoding="utf-8") as f:
                json.dump(job, f)

            tone = (f"clip ({'converted' if convert else 'as is'})" if use_clip
                    else f"emotion={emotion}" + (f" style={style.strip()!r}" if style.strip() else ""))
            print(f"[komfy-voxcpm] voice={'upload' if voice_audio is not None else voice} {tone} "
                  f"cfg={cfg:g} steps={steps} seed={seed} device={device}")
            _run([python, RUNNER, job_path], env, root, "VoxCPM2")
            if not os.path.isfile(speech):
                raise RuntimeError("VoxCPM2 exited without writing the speech")

            _render_clip(speech, out_path, komfy_graph, tmpdir, env)
            if save_path and not os.path.isfile(save_path):
                shutil.copyfile(sample, save_path)
                print(f"[komfy-voxcpm] voice saved as {save_path}")

            results = [{"filename": stem + ".mp4", "subfolder": subfolder, "type": "output"}]
            return {"ui": {"images": results, "animated": (True,)}}
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)


NODE_CLASS_MAPPINGS = {"KomfyVoxCPM": KomfyVoxCPM}
NODE_DISPLAY_NAME_MAPPINGS = {"KomfyVoxCPM": "VoxCPM2 voice · Komfy"}
