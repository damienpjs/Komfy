"""Komfy: one VoxCPM2 generation, run by the VoxCPM virtualenv.

Started by the KomfyVoxCPM node (__init__.py) with
`<voxcpm>/.venv/<bin|Scripts>/python runner.py job.json`. Reads the job,
loads VoxCPM2 from <voxcpm>/checkpoints, writes one WAV and exits, so every
byte goes back to the OS.

Two ways to set the tone, both with the voice sample as `reference_wav_path`
(the timbre):
  - the text starts with a parenthesised instruction (the emotion), which
    VoxCPM2 reads as a style direction and does not say;
  - a tone clip as `prompt_wav_path` + `prompt_text`: VoxCPM2 continues the
    clip with the new text, keeping its delivery. Without a transcript the
    clip is transcribed here with faster-whisper (<voxcpm>/asr, CPU).

Progress goes to stdout as `@@progress N/100` lines, which the node turns
into ComfyUI's progress bar. VoxCPM2 gives no step callback, so the steps
are the phases: load, transcript, speech.
"""

import json
import os
import random
import sys


def progress(n, label=""):
    print(f"@@progress {int(n)}/100 {label}".rstrip(), flush=True)


def fail(message):
    print(message, flush=True)
    sys.exit(2)


def pick_device(torch, wanted):
    if wanted == "auto":
        if torch.cuda.is_available():
            return "cuda"
        # MPS: about 5 to 15 s per line on an M3 Max (2026-11-25 bench),
        # against several times that on the CPU.
        return "mps" if torch.backends.mps.is_available() else "cpu"
    if wanted == "cuda" and not torch.cuda.is_available():
        fail("KOMFY_VOXCPM_DEVICE=cuda but PyTorch sees no CUDA device in the VoxCPM virtualenv")
    if wanted == "mps" and not torch.backends.mps.is_available():
        fail("KOMFY_VOXCPM_DEVICE=mps but PyTorch sees no MPS device")
    return wanted


def transcribe(asr_dir, path):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        fail("faster-whisper is missing from the VoxCPM virtualenv: uv pip install faster-whisper "
             "(or type what the tone clip says)")
    model = WhisperModel(asr_dir, device="cpu", compute_type="int8")
    segments, info = model.transcribe(path, beam_size=5)
    text = " ".join(s.text.strip() for s in segments).strip()
    print(f"tone clip transcript ({info.language}): {text}", flush=True)
    return text


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        job = json.load(f)

    try:
        import numpy as np
        import soundfile as sf
        import torch
        from voxcpm import VoxCPM
    except ImportError as exc:
        fail(f"VoxCPM is not importable in its virtualenv ({exc}). "
             "Install it with: uv pip install voxcpm soundfile faster-whisper")

    seed = int(job["seed"]) % (2**32)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    prompt_wav = job.get("prompt_wav")
    prompt_text = (job.get("prompt_text") or "").strip()
    if prompt_wav and not prompt_text:
        progress(2, "transcribing the tone clip")
        prompt_text = transcribe(job["asr"], prompt_wav)
        if not prompt_text:
            fail("Whisper heard no words in the tone clip: use a clip with speech, or type what it says")

    device = pick_device(torch, job["device"])
    progress(10, f"loading VoxCPM2 on {device}")
    model = VoxCPM.from_pretrained(job["checkpoints"], load_denoiser=False, optimize=False, device=device)
    progress(50, "model loaded")

    kwargs = dict(
        text=job["text"],
        reference_wav_path=job["speaker"],
        cfg_value=float(job["cfg"]),
        inference_timesteps=int(job["steps"]),
    )
    if prompt_wav:
        kwargs.update(prompt_wav_path=prompt_wav, prompt_text=prompt_text)
    print(f"text: {job['text']}", flush=True)
    wav = model.generate(**kwargs)
    rate = model.tts_model.sample_rate
    if wav is None or len(wav) == 0:
        fail("VoxCPM2 returned no audio")
    sf.write(job["output"], np.asarray(wav, dtype=np.float32), rate, subtype="PCM_16")
    print(f"{len(wav) / rate:.2f} s of speech at {rate} Hz", flush=True)
    progress(100, "done")
    if not os.path.isfile(job["output"]):
        fail("VoxCPM2 returned without writing " + job["output"])


if __name__ == "__main__":
    main()
