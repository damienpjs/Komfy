"""Komfy: one XTTS v2 generation, run by the XTTS virtualenv.

Started by the KomfyXTTS node (__init__.py) with
`<xtts>/.venv/<bin|Scripts>/python runner.py job.json`. Reads the job, loads
the model from <xtts>/checkpoints, writes one WAV and exits, so every byte
goes back to the OS.

The line is split into sentences and said one sentence at a time, exactly
as coqui-tts's own `tts_to_file` does (same splitter, same 10000-sample
pause between sentences), so a render matches the API the voice was first
validated with; doing the loop here gives a real progress step per sentence.

Progress goes to stdout as `@@progress N/100` lines, which the node turns
into ComfyUI's progress bar: 0 to 30 while the model loads, then 30 to 100
across the sentences.
"""

import json
import os
import random
import sys
import wave

LOAD_SHARE = 30
# coqui-tts's Synthesizer pause between two sentences (PAD_SILENCE_SAMPLES).
SENTENCE_PAUSE = 10000


def progress(n, label=""):
    print(f"@@progress {int(n)}/100 {label}".rstrip(), flush=True)


def fail(message):
    print(message, flush=True)
    sys.exit(2)


def check_versions():
    """The known breakages of this stack, named before the model loads
    rather than as a stack trace in the middle of the GPT."""
    try:
        import transformers
    except ImportError:
        fail("transformers is missing from the XTTS virtualenv: reinstall coqui-tts")
    major = int(transformers.__version__.split(".")[0])
    if major >= 5:
        fail(f"transformers {transformers.__version__} breaks the XTTS GPT "
             "(past_key_values is None): install 'transformers>=4.57,<5' in the XTTS virtualenv")
    try:
        import TTS  # noqa: F401
    except ImportError as exc:
        fail(f"coqui-tts is not importable in the XTTS virtualenv ({exc}). "
             "Install it with: uv pip install coqui-tts torch torchaudio six 'transformers>=4.57,<5'")


def pick_device(torch, wanted):
    if wanted == "auto":
        # CPU on a Mac: measured at about real time on an M3 Max, and it
        # leaves the GPU to the image and video models. MPS stays opt-in.
        return "cuda" if torch.cuda.is_available() else "cpu"
    if wanted == "cuda" and not torch.cuda.is_available():
        fail("KOMFY_XTTS_DEVICE=cuda but PyTorch sees no CUDA device in the XTTS virtualenv")
    if wanted == "mps" and not torch.backends.mps.is_available():
        fail("KOMFY_XTTS_DEVICE=mps but PyTorch sees no MPS device")
    return wanted


def write_wav(samples, rate, path):
    import numpy as np

    pcm = (np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0) * 32767.0).astype("<i2")
    with wave.open(path, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(int(rate))
        out.writeframes(pcm.tobytes())


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        job = json.load(f)

    check_versions()
    import numpy as np
    import torch
    from TTS.api import TTS

    seed = int(job["seed"]) % (2**32)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    device = pick_device(torch, job["device"])
    progress(0, f"loading XTTS v2 on {device}")
    checkpoints = job["checkpoints"]
    tts = TTS(
        model_path=checkpoints,
        config_path=os.path.join(checkpoints, "config.json"),
        progress_bar=False,
    ).to(device)
    synth = tts.synthesizer
    progress(LOAD_SHARE, "model loaded")

    sentences = synth.split_into_sentences(job["text"], job["language"]) or [job["text"]]
    speech = []
    for i, sentence in enumerate(sentences):
        wav = tts.tts(
            text=sentence,
            speaker_wav=job["speaker"],
            language=job["language"],
            split_sentences=False,
            temperature=float(job["temperature"]),
            speed=float(job["speed"]),
        )
        samples = np.asarray(wav, dtype=np.float32).ravel()
        print(f"{len(samples) / synth.output_sample_rate:.2f} s: {sentence}", flush=True)
        speech.extend(samples.tolist())
        if i < len(sentences) - 1:
            speech.extend([0.0] * SENTENCE_PAUSE)
        progress(LOAD_SHARE + (i + 1) * (100 - LOAD_SHARE) / len(sentences),
                 f"sentence {i + 1}/{len(sentences)}")

    if not speech:
        fail("XTTS returned no audio")
    write_wav(speech, synth.output_sample_rate, job["output"])
    if not os.path.isfile(job["output"]):
        fail("XTTS returned without writing " + job["output"])


if __name__ == "__main__":
    main()
