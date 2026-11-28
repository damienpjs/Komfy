# komfy-voxcpm

A ComfyUI custom node that says a line in a **cloned voice** with
[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) (Apache 2.0), in 30
languages, French and English included, detected from the text. It backs the
Komfy **Generate a voice** entry. The tone comes from an **emotion** or from
a **tone clip**:

- **Emotion**: the node writes a short English instruction before the text
  (`(sarcastic, mocking, exasperated)`), which VoxCPM2 reads as a direction
  and does not say. Optional free words (`style`) are added to it.
- **Tone clip**: a few seconds said the way the line should sound. VoxCPM2
  continues the clip with the new text (its prompt mode) while the voice
  sample still sets the timbre. A clip spoken by someone else would impose
  its own timbre, so by default it is first converted into the chosen voice
  with [CosyVoice3](https://github.com/FunAudioLLM/CosyVoice)'s voice
  conversion (`tone_from = other_voice`). Without a transcript, the clip is
  transcribed with faster-whisper.

The clip comes back as an mp4 (the waveform lit as it plays, AAC audio, the
API graph in the `prompt` tag), so it goes through the gallery, remix and
"Use in" like any clip: into the talking video as its voice, or back into
this node as the tone clip of the next line.

## How it runs

Both models run out of process, each in its own virtualenv:

1. the node writes a small job file and starts
   `<voxcpm>/.venv/bin/python runner.py job.json` (`.venv\Scripts\python.exe`
   on Windows) in its own process group; with a tone clip from another
   voice, `<cosyvoice>/.venv/bin/python vc_runner.py` runs first, from the
   CosyVoice checkout;
2. each child seeds Python, NumPy and PyTorch, loads its weights from disk
   (`HF_HUB_OFFLINE=1`, and CosyVoice's text normaliser, which would fetch
   from modelscope.cn, is never loaded: a render never downloads), writes
   one WAV and exits, so its memory goes back to the OS;
3. progress goes to ComfyUI's bar by phase (VoxCPM2 has no step callback);
   an Interrupt kills the child (process group on macOS and Linux,
   `taskkill /T` on Windows); a failure raises the tail of its log;
4. ffmpeg decodes every input (a saved m4a voice, an uploaded clip) to mono
   WAV and writes the mp4.

Timing on an M3 Max (2026-11-25): about 15 s per line with an emotion or a
clip in the same voice (VoxCPM2 on the GPU, model load included), about 50 s
when a clip from another voice is converted first (CosyVoice3 on the CPU).
The first line after a big image or video render can take 20 s more, while
the weights come back from disk. Those figures need the CPU threads that
`scripts/start-comfy.*` sets: a node pack that imports ultralytics otherwise
sets `OMP_NUM_THREADS=1` for the whole ComfyUI process, and the converted clip
then took 95 s (CosyVoice3 on one core). When starting ComfyUI another way,
export `OMP_NUM_THREADS` first. VoxCPM2 needs about 8 GB; ComfyUI runs one job
at a time, so it never competes with an image or LTX render.

## Installed or not

The required `engine` input lists `VoxCPM2` only when the virtualenv and the
weights (`config.json`, `model.safetensors`, `audiovae.pth`,
`tokenizer.json` in `checkpoints/`) are found. Otherwise its only entry names
what is missing, e.g. `unavailable: no virtualenv at /home/me/Documents/voxcpm/.venv/bin/python`.

- The Komfy app compares its workflow's `VoxCPM2` with that list, so the
  catalogue row is dimmed and the form shows the engine as missing.
- ComfyUI refuses a prompt sent anyway, with the entry above as the reason.
- The list is rebuilt on every `/object_info`: finishing the install needs no
  restart. Linking the package does (a new custom node).

Whisper (`asr/`) and CosyVoice3 are only needed for a tone clip: a render
that needs a missing one fails at once with what to install, and a typed
transcript or `same_voice` avoids them.

## Node

`KomfyVoxCPM` ("VoxCPM2 voice · Komfy", category `Komfy/Voice`).

| Input | Notes |
|---|---|
| `engine` | `VoxCPM2`, or what is missing (above) |
| `voice` | `None` + the files of `models/voices`. Cut to its first 30 s |
| `text` | The line, in any of the 30 languages |
| `tone_mode` | `emotion` (the next two inputs) or `clip` (the tone clip) |
| `emotion` | `neutral happy angry sad sarcastic surprised calm whispered` |
| `style` | Free words added to the emotion's instruction (pace, register, energy); parentheses are stripped |
| `tone_from` | `other_voice` (convert the clip into the chosen voice first) or `same_voice` (use it as is) |
| `tone_text` | What the tone clip says. Empty: Whisper transcribes the first 15 s. Typed: the whole clip is used, 30 s at most |
| `cfg` | Guidance, 1 to 4, default 2. Measured on the maintainer's voice: 1.5 slows the pace and drops more words, 3 changes little |
| `steps` | Diffusion steps, 4 to 30, default 10. 20 took about 40 % longer with no measured gain |
| `seed` | Seeds random, NumPy and PyTorch. The same seed gives the same take |
| `filename_prefix` | Default `komfy/voice` (the app sets its own) |
| `voice_audio` (optional) | A new voice sample (AUDIO), used instead of `voice` |
| `save_voice_as` (optional) | With a new sample: also save it as `models/voices/<name>.wav`. A name taken by another sample is refused; the same sample saved again (a remix) is accepted |
| `tone_audio` (optional) | The tone clip (AUDIO), read in `clip` mode |

Bench notes (2026-11-25, two French voices, rated by ear): as emotions,
sarcastic and happy came out best, sad and whispered weak; with a tone clip
every take was rated good or top, sadness included. A raw clip from another
speaker kept that speaker's timbre (0.59 similarity to the chosen voice);
converted, 0.85 to 0.88.

## Install

Three pieces, each in its own folder. Paths below are the defaults; see
Configuration to move them. `HF_HUB_DISABLE_XET=1` avoids a download that
stalled on Hugging Face's Xet protocol.

**VoxCPM2** (required, about 5 GB):

```bash
mkdir -p ~/Documents/voxcpm && cd ~/Documents/voxcpm
uv venv -p 3.11 .venv
uv pip install -p .venv/bin/python voxcpm soundfile faster-whisper
HF_HUB_DISABLE_XET=1 .venv/bin/hf download openbmb/VoxCPM2 --local-dir checkpoints
HF_HUB_DISABLE_XET=1 .venv/bin/hf download Systran/faster-whisper-small --local-dir asr
```

**CosyVoice3** (optional, for tone clips from another voice, about 5 GB).
The repository pins its requirements for CUDA on Linux: drop those lines, and
build its old packages with an old setuptools (it also needs `pkg_resources`
at run time):

```bash
git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git ~/Documents/cosyvoice
cd ~/Documents/cosyvoice
uv venv -p 3.10 .venv
grep -v -E "extra-index|deepspeed|gradio|fastapi|grpcio|tensorboard|tensorrt|onnxruntime-gpu|uvicorn" requirements.txt > requirements-local.txt
echo "setuptools<70" > build-constraints.txt
uv pip install -p .venv/bin/python -r requirements-local.txt "setuptools<70" --build-constraint build-constraints.txt
HF_HUB_DISABLE_XET=1 .venv/bin/hf download FunAudioLLM/Fun-CosyVoice3-0.5B-2512 \
  --local-dir pretrained_models/Fun-CosyVoice3-0.5B \
  --exclude "llm.rl.pt" --exclude "speech_tokenizer_v3.batch.onnx" \
  --exclude "flow.decoder.estimator.fp32.onnx"
```

The three excluded files (about 4 GB) are a reinforcement-tuned LLM, a batch
tokenizer and a TensorRT source, none of which this node loads.

**The node**: one or more voice samples in `models/voices` (10 to 25 s of
one person speaking, no music), then link the package and restart ComfyUI:

```bash
mkdir -p <comfy-data-dir>/models/voices
cp my-voice-25s.wav <comfy-data-dir>/models/voices/me.wav
ln -s "<repo>/server/komfy-voxcpm" <comfy-data-dir>/custom_nodes/komfy-voxcpm
```

On Windows, use `.venv\Scripts\python.exe` and `.venv\Scripts\hf.exe` in the
commands above, and a directory junction (`mklink /J`) for the link.
ffmpeg must be on the PATH (on a Mac, the Homebrew folders are added for a
ComfyUI started with a bare PATH).

## Configuration

Environment of the ComfyUI process, all optional:

| Variable | Default | Meaning |
|---|---|---|
| `KOMFY_VOXCPM_DIR` | `~/Documents/voxcpm` | Holds `.venv`, `checkpoints` (VoxCPM2) and `asr` (faster-whisper) |
| `KOMFY_VOXCPM_DEVICE` | `auto` | `auto` (CUDA, else MPS, else CPU), `cpu`, `cuda` or `mps` |
| `KOMFY_COSYVOICE_DIR` | `~/Documents/cosyvoice` | The CosyVoice checkout, with `.venv` and `pretrained_models/Fun-CosyVoice3-0.5B` |

## Licences

VoxCPM2 and CosyVoice3 are Apache 2.0, faster-whisper is MIT and the Whisper
weights are MIT. VoxCPM2's model card forbids impersonation, fraud and
disinformation, and asks that AI-generated speech be labelled: clone a voice
only with its owner's consent.
