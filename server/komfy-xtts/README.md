# komfy-xtts

A ComfyUI custom node that says a line in a **cloned voice** with
[XTTS v2](https://huggingface.co/coqui/XTTS-v2), in 17 languages including
French. It backs the **Multilingual** mode of the Komfy **Generate a voice**
entry, next to IndexTTS 2.5 (`komfy-indextts`, the **Emotions** mode, which
has no French). Both read the same saved voices and write the same kind of
clip, so the result feeds the talking-video workflow (`ltx25-a2v`) the same
way.

XTTS runs out of process, in its own virtualenv, like komfy-indextts runs
IndexTTS:

1. the node writes a small job file and starts
   `<xtts>/.venv/bin/python runner.py job.json` (`.venv\Scripts\python.exe`
   on Windows) in its own process group;
2. `runner.py` checks the known breakages first (see Install), seeds Python,
   NumPy and PyTorch, loads the model from `<xtts>/checkpoints`, says the line
   one sentence at a time and exits, so its memory goes back to the OS;
3. progress: 0 to 30 % for the load, then one step per sentence; an
   Interrupt kills the child (process group on macOS and Linux, `taskkill /T`
   on Windows); a failure raises the tail of its log;
4. ffmpeg turns the speech into the same mp4 as komfy-indextts (the waveform
   lit as it plays, AAC audio, the API graph in the `prompt` tag).

The weights are read from `checkpoints/` with `HF_HUB_OFFLINE=1`: a render
never downloads anything.

Timing on an M3 Max, on the CPU: about 20 s to load, then roughly real time
(a 6 s line in 6 to 9 s). It needs about 3 GB of RAM and no GPU memory, so
it can sit next to a loaded image model. ComfyUI runs one job at a time, so
it never competes with an IndexTTS or LTX render.

## Installed or not

The required `engine` input lists `XTTS-v2` only when the virtualenv and the
weights (`config.json`, `model.pth`, `vocab.json`) are found. Otherwise its
only entry names what is missing, e.g.
`unavailable: no virtualenv at /home/me/Documents/xtts/.venv/bin/python`.

- The Komfy app compares its workflow's `XTTS-v2` with that list, so the
  Multilingual mode is dimmed and its form shows "XTTS-v2" as missing.
- ComfyUI refuses a prompt sent anyway, with the entry above as the reason.
- The list is rebuilt on every `/object_info`: finishing the install needs no
  restart. Linking the package does (a new custom node).

## Node

`KomfyXTTS` ("XTTS v2 voice · Komfy", category `Komfy/Voice`).

| Input | Notes |
|---|---|
| `engine` | `XTTS-v2`, or what is missing (above) |
| `voice` | `None` + the files of `models/voices` (shared with komfy-indextts) |
| `text` | The line. Split into sentences (coqui-tts's own splitter), said one by one with a short pause between them |
| `language` | `fr en es de it pt pl tr ru nl cs ar zh-cn hu ko ja hi`. The language of the line, not of the sample |
| `temperature` | 0.1 to 1, default 0.75 (the model's own). Lower is steadier, higher livelier and more likely to stumble |
| `speed` | 0.5 to 2, default 1 |
| `seed` | Seeds random, NumPy and PyTorch. The same seed gives the same take |
| `filename_prefix` | Default `komfy/voice` (the app sets its own) |
| `voice_audio` | Optional AUDIO (core LoadAudio): a new sample, used instead of `voice` |
| `save_voice_as` | Optional, with `voice_audio`: also saves the sample as `models/voices/<name>.wav`, same rules as komfy-indextts |

Measured on the maintainer's voice: a clean 25 s sample clones better than an
85 s phone recording, which added silence or mumbling after the line.

## Install

Any OS with Python 3.10 to 3.12 and [uv](https://docs.astral.sh/uv/).
macOS / Linux:

```bash
mkdir -p ~/Documents/xtts && cd ~/Documents/xtts
uv venv --python 3.11 .venv
uv pip install --python .venv/bin/python coqui-tts torch torchaudio six "transformers>=4.57,<5"
COQUI_TOS_AGREED=1 .venv/bin/python -c "from TTS.utils.manage import ModelManager; print(ModelManager().download_model('tts_models/multilingual/multi-dataset/xtts_v2'))"
mkdir checkpoints && cp -L <the printed folder>/{config.json,model.pth,vocab.json,speakers_xtts.pth,mel_stats.pth} checkpoints/
```

Windows (PowerShell), the same in `%USERPROFILE%\Documents\xtts`, with
`.venv\Scripts\python.exe` and `Copy-Item` for the last step. With an NVIDIA
GPU, install the CUDA build of torch and torchaudio from pytorch.org instead
of the default one.

Three traps, all checked by `runner.py` with a clear message:

- `coqui-tts` does not pull `torch` / `torchaudio`: install them yourself;
- it imports `six` without declaring it;
- `transformers` 5.x breaks the XTTS GPT (`'NoneType' object has no attribute
  'get_seq_length'`): keep it below 5.

Then link the node into ComfyUI's data folder and restart ComfyUI:

```bash
ln -s "<repo>/server/komfy-xtts" <comfy-data-dir>/custom_nodes/komfy-xtts
```

On Windows: `mklink /D <comfy-data-dir>\custom_nodes\komfy-xtts <repo>\server\komfy-xtts`
(or copy the folder). Voices go in `<comfy-data-dir>/models/voices`, as for
komfy-indextts. The node also needs `ffmpeg` on the PATH of the ComfyUI
process (Homebrew's `/opt/homebrew/bin` is added on a Mac).

## Licence

The XTTS v2 weights are under the Coqui Public Model License: non-commercial
use only, of the model and of what it outputs. Downloading them asks you to
accept it (`COQUI_TOS_AGREED=1` above); the node sets the same variable for
its child process so coqui-tts never stops on that prompt. The `coqui-tts`
code itself is MPL 2.0.

## Configuration

Environment of the ComfyUI process, optional:

| Variable | Default | Meaning |
|---|---|---|
| `KOMFY_XTTS_DIR` | `~/Documents/xtts` | The folder holding `.venv` and `checkpoints` |
| `KOMFY_XTTS_DEVICE` | `auto` | `auto` = CUDA when PyTorch sees it, else CPU. `cpu`, `cuda`, or `mps` (Apple GPU, not measured) |
