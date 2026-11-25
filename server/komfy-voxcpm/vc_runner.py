"""Komfy: one CosyVoice3 voice conversion, run by the CosyVoice virtualenv.

Started by the KomfyVoxCPM node (__init__.py) with the CosyVoice checkout as
working directory: `<cosyvoice>/.venv/<bin|Scripts>/python vc_runner.py
job.json`. Says the tone clip (`source`) again in the timbre of the voice
sample (`target`), keeping its words, rhythm and intonation, then exits.

Why: VoxCPM2 continues a tone clip in the clip's own voice, whatever the
voice sample says (measured 2026-11-25: 0.59 similarity to the chosen voice
for a raw clip of another speaker, 0.85 to 0.88 once converted). Converting
first keeps the tone and gives back the chosen voice.

CosyVoice picks CUDA or the CPU by itself (on an M3 Max CPU, about 20 s for
a 7 s clip plus 8 s of loading); it leaves the GPU to the other models.
"""

import json
import os
import sys


def progress(n, label=""):
    print(f"@@progress {int(n)}/100 {label}".rstrip(), flush=True)


def fail(message):
    print(message, flush=True)
    sys.exit(2)


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        job = json.load(f)

    # The checkout's own packages and its Matcha-TTS submodule.
    root = os.getcwd()
    sys.path.insert(0, os.path.join(root, "third_party", "Matcha-TTS"))
    sys.path.insert(0, root)
    # CosyVoice's frontend loads a text normaliser at start: ttsfrd, else
    # wetext, whose constructor downloads a snapshot from modelscope.cn. A
    # voice conversion reads no text, and that download retried a file the
    # server refused (403) for about 40 s on every render (2026-11-25). A
    # None entry makes both imports fail at once, so the frontend falls back
    # to no normaliser and nothing goes to the network.
    sys.modules["ttsfrd"] = None
    sys.modules["wetext"] = None
    try:
        import random

        import numpy as np
        import soundfile as sf
        import torch
        from cosyvoice.cli.cosyvoice import AutoModel
    except ImportError as exc:
        fail(f"CosyVoice is not importable from {root} ({exc}): see server/komfy-voxcpm/README.md")

    seed = int(job["seed"]) % (2**32)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    progress(5, "loading CosyVoice3")
    model = AutoModel(model_dir=job["model_dir"])
    progress(40, "converting the tone clip")
    chunks = [out["tts_speech"] for out in model.inference_vc(job["source"], job["target"], stream=False)]
    if not chunks:
        fail("CosyVoice3 returned no audio")
    wav = torch.cat(chunks, dim=1).squeeze(0).cpu().numpy()
    sf.write(job["output"], wav, model.sample_rate, subtype="PCM_16")
    print(f"converted tone clip: {len(wav) / model.sample_rate:.2f} s", flush=True)
    progress(100, "converted")


if __name__ == "__main__":
    main()
