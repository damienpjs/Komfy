# komfy-ltx-mlx

ComfyUI custom node that runs **LTX 2.5 through MLX** on Apple Silicon, so the
Komfy LTX 2.5 workflows (text → video, image → video, first/last frame) go
through ComfyUI like every other workflow: queue, progress, history, gallery
and remix keep working.

Why not run LTX 2.5 inside ComfyUI directly? On a Mac, PyTorch MPS is about
16× slower than the MLX port for the same render. This node delegates the
generation to the [`ltx-2-mlx`](https://github.com/dgrauet/ltx-2-mlx) CLI
(0.16.0+, which covers LTX 2.5 packs) in a separate process:

1. ComfyUI unloads its own models (the 22B pack needs the unified memory);
2. `ltx-2-mlx generate …` runs in its own virtualenv and returns all its
   memory to the OS when it exits;
3. its tqdm progress feeds ComfyUI's progress bar; an Interrupt kills it;
4. the `.mp4` (+ optional last-frame `.png`) lands in ComfyUI's output folder.

## Node

`KomfyLTX25MLX` ("LTX 2.5 (MLX) · Komfy", category `Komfy/LTX MLX`).

| Input | Notes |
|---|---|
| `model_pack` | Discovered packs (folders holding `split_model.json` or `embedded_config.json`) |
| `mode` | `distilled` (fast, no CFG) · `two_stage` · `two_stages_hq` · `one_stage` (dev + CFG) |
| `width`/`height` | Rounded to multiples of 64 (32 for `one_stage`) |
| `fit_to_image` | With a first image, derive the short side from the image ratio (no crop) |
| `duration` | Seconds, snapped to 8k+1 frames; `0` = predicted from the prompt |
| `first_image` / `last_image` | Optional; first → `--image P 0 S`, last → `--image P last S` |
| `negative_prompt` | CFG modes only; empty = upstream default |
| `lora_name` | Any file in `models/loras` (e.g. a character LoRA), or `None` |
| `low_ram` / `tile_frames` | Memory levers for long or large clips |
| `save_last_frame` | Writes the last clean frame (the one before last with an end anchor) |

## Install

```bash
# 1. The MLX runtime and an LTX 2.5 pack
git clone https://github.com/dgrauet/ltx-2-mlx ~/ltx-2-mlx
cd ~/ltx-2-mlx && uv sync --all-extras
hf download dgrauet/ltx-2.5-mlx-q8 --local-dir ~/models/ltx-2.5-mlx-q8

# 2. The node (macOS / Linux)
ln -s "<repo>/server/komfy-ltx-mlx" <comfy-data-dir>/custom_nodes/komfy-ltx-mlx
# then restart ComfyUI
```

Pack search order: `$KOMFY_LTX_MLX_PACKS` (os.pathsep-separated), then
`<comfy models>/ltx_mlx`, `~/models`, `~/checkpoints`, `~/ltx-2-mlx`,
`~/ltx-2-mlx/models` (each one or two levels deep), then the HuggingFace cache.
The executable defaults to `~/ltx-2-mlx/.venv/bin/ltx-2-mlx`
(override: `KOMFY_LTX_MLX_BIN`). The child always runs with
`HF_HUB_OFFLINE=1`: a wrong pack path fails instead of downloading 75 GB.

macOS 26 + MLX 0.31 GPU-watchdog stalls: export
`AGX_RELAX_CDM_CTXSTORE_TIMEOUT=1` before starting ComfyUI (see
ltx-2-mlx `docs/PIPELINES.md`); the node passes its environment through.

No network access of its own, no route: security relies on the Tailscale
perimeter like the rest of the ComfyUI API (see the Komfy README §Security).
