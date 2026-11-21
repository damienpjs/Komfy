"""Komfy: one IndexTTS 2.5 generation, run by the IndexTTS virtualenv.

Started by the KomfyIndexTTS node (__init__.py) with
`<index-tts>/.venv/bin/python runner.py job.json`, in the index-tts folder
(IndexTTS resolves its Hugging Face cache relative to it). Reads the job,
loads the model, writes one WAV and exits, so every byte goes back to the OS.

Progress goes to stdout as `@@progress N/100` lines, which the node turns
into ComfyUI's progress bar: 0 to 30 while the model loads, then IndexTTS's
own progress callback (the one its web UI uses) mapped onto 30 to 100.
"""

import json
import os
import random
import sys

LOAD_SHARE = 30


def progress(n, label=""):
    print(f"@@progress {int(n)}/100 {label}".rstrip(), flush=True)


def main():
    with open(sys.argv[1], encoding="utf-8") as f:
        job = json.load(f)

    root = job["dir"]
    os.chdir(root)
    sys.path.insert(0, root)

    import numpy as np
    import torch

    seed = int(job["seed"]) % (2**32)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    progress(0, "loading IndexTTS 2.5")
    from indextts.infer_v2_5 import IndexTTS2

    checkpoints = job["checkpoints"]
    tts = IndexTTS2(
        cfg_path=os.path.join(checkpoints, "config.yaml"),
        model_dir=checkpoints,
        # MPS switches bf16 off by itself (slower there than fp32).
        use_bf16=True,
    )
    progress(LOAD_SHARE, "model loaded")

    def on_progress(value, desc=None):
        value = max(0.0, min(1.0, float(value or 0.0)))
        progress(LOAD_SHARE + value * (100 - LOAD_SHARE), desc or "")

    # The hook IndexTTS feeds its Gradio progress bar through.
    tts.gr_progress = on_progress

    vector = job.get("emo_vector")
    if vector is not None:
        # Same treatment as the IndexTTS web UI's vector mode: per-emotion
        # bias (surprised and calm are damped) and a total capped at 0.8.
        vector = tts.normalize_emo_vec(vector, apply_bias=True)

    tts.infer(
        spk_audio_prompt=job["speaker"],
        text=job["text"],
        lang=job["lang"],
        output_path=job["output"],
        emo_vector=vector,
        emo_alpha=float(job["emo_alpha"]),
        duration_factor=float(job["duration_factor"]),
        use_random=False,
        verbose=False,
    )
    if not os.path.isfile(job["output"]):
        print("IndexTTS returned without writing " + job["output"], flush=True)
        sys.exit(2)
    progress(100, "done")


if __name__ == "__main__":
    main()
