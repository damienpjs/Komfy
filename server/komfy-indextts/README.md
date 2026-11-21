# komfy-indextts

A ComfyUI custom node that says a line in a **cloned voice** with
[IndexTTS 2.5](https://github.com/index-tts/index-tts), with an optional mix
of its eight emotions. It backs the **Generate a voice** workflow of the
Komfy Video section, whose output feeds the talking-video workflow
(Image + voice, `ltx25-a2v`).

IndexTTS runs out of process, in its own virtualenv, like komfy-ltx-mlx runs
ltx-2-mlx:

1. the node writes a small job file and starts
   `<index-tts>/.venv/bin/python runner.py job.json` in its own session;
2. `runner.py` seeds Python, NumPy and PyTorch, loads the model, says the
   line and exits, so its memory goes back to the OS;
3. its progress (IndexTTS's own callback, the one its web UI uses) feeds
   ComfyUI's progress bar: 0 to 30 % for the load, then the synthesis; an
   Interrupt kills the process group; a failure raises the tail of its log;
4. ffmpeg turns the speech into an mp4: the whole waveform drawn dim on the
   app's charcoal, lit in the app's yellow from left to right as it plays
   (so the first frame, the gallery thumbnail, already shows the line), AAC
   audio, and the API graph in the `prompt` tag. komfy-listing's
   `GET /komfy/recipe` reads it back for remix and "Use in", and core
   LoadAudio decodes the mp4's audio track, which is how the talking video
   takes it as its voice.

ComfyUI's own models are **not** unloaded: IndexTTS needs about 6 to 8 GB,
and a loaded Krea stays useful for the next job.

Timing on an M3 Max (MPS, fp32): about 25 s to load, then 25 to 40 s for a
5 s line; about 70 s per render in all.

## Node

`KomfyIndexTTS` ("IndexTTS 2.5 voice · Komfy", category `Komfy/Voice`).

| Input | Notes |
|---|---|
| `voice` | `None` + the files of `models/voices` (`.wav .mp3 .m4a .flac .ogg`) |
| `text` | The line to say. IndexTTS splits long text in segments; keep it under 20 s for the talking video |
| `lang` | `EN`, `ZH`, `JA`, `ES`, `AR` (IndexTTS 2.5's languages; no French) |
| `emotion_mix` | JSON list of 8 weights in 0..1: happy, angry, sad, afraid, disgusted, melancholic, surprised, calm. All zeros = neutral (the tone of the sample) |
| `emotion_strength` | Scales the mix (IndexTTS `emo_alpha`), default 0.4 |
| `speed` | 0.5 to 2, default 1. Sent as `duration_factor = 1 / speed` |
| `seed` | Seeds random, NumPy and PyTorch; sampling stays on (`use_random=False` only fixes the emotion vector) |
| `filename_prefix` | Default `komfy/voice` (the app sets its own) |
| `voice_audio` | Optional AUDIO (core LoadAudio): a new sample, used instead of `voice` |
| `save_voice_as` | Optional, with `voice_audio`: also saves the sample as `models/voices/<name>.wav` |

The mix gets what the IndexTTS web UI's vector mode applied: a per-emotion
bias (surprised and calm are damped), the total capped at 0.8, then the
strength scaling it. Measured on the maintainer's voice: the neutral clone
sounds like him; a strength of 0.6 or 1.0 drifts away from his timbre, 0.4
or lower keeps it.

Saving a sample: the name is cleaned (letters, digits, space, dot, dash,
underscore) and checked **before** the render. A name already used by
another sample (any extension, any case) is refused with an error; the same
sample saved again under its own name (a remix of that render) is accepted.
The file is written once the render succeeds.

## Install

```bash
git clone https://github.com/index-tts/index-tts ~/Documents/index-tts
cd ~/Documents/index-tts
uv sync --extra webui
hf download IndexTeam/IndexTTS-2.5 --local-dir checkpoints
```

On its first render IndexTTS downloads a few helper models (w2v-bert,
campplus, bigvgan) into `checkpoints/hf_cache`. Once that folder is filled,
the node runs it with `HF_HUB_OFFLINE=1`, so a render never starts a
download.

Then add at least one voice and link the node into ComfyUI's data folder:

```bash
mkdir -p <comfy-data-dir>/models/voices
cp my-voice-25s.wav <comfy-data-dir>/models/voices/me.wav
ln -s "<repo>/server/komfy-indextts" <comfy-data-dir>/custom_nodes/komfy-indextts
```

A good sample: 10 to 25 s of one person speaking, no music or other voice,
leveled (IndexTTS keeps the first 15 s). Restart ComfyUI.

Configuration (environment of the ComfyUI process, optional):

| Variable | Default | Meaning |
|---|---|---|
| `KOMFY_INDEXTTS_DIR` | `~/Documents/index-tts` | The checkout holding `.venv` and `checkpoints` |

The node also needs `ffmpeg` (Homebrew's `/opt/homebrew/bin` is added to
the child's PATH for a ComfyUI started with a bare one).
