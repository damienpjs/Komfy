# komfy-ltx-mlx

ComfyUI custom nodes that run **LTX 2.5 through MLX** on Apple Silicon, so the
Komfy video workflows (text → video, image → video, image + voice → talking
video, first/last frame, x2 video upscale) go through ComfyUI like every
other workflow: queue, progress, history, gallery and remix keep working.

Why not run LTX 2.5 inside ComfyUI directly? On a Mac, PyTorch MPS is about
16× slower than the MLX port for the same render. This node delegates the
generation to the [`ltx-2-mlx`](https://github.com/dgrauet/ltx-2-mlx) CLI
(0.18.0+: LTX 2.5 packs, and IC-LoRA on 2.5 for the character references) in
a separate process:

1. ComfyUI unloads its own models (the 22B pack needs the unified memory);
2. `ltx-2-mlx generate|a2v|ic-lora …` runs in its own virtualenv and returns
   all its memory to the OS when it exits;
3. its tqdm progress feeds ComfyUI's progress bar; an Interrupt kills it;
4. the `.mp4` (+ optional last-frame `.png`) lands in ComfyUI's output
   folder, re-muxed without re-encoding with the API graph in its `prompt`
   tag (where ComfyUI's SaveVideo puts it): the recipe outlives the server
   history, and komfy-listing's `GET /komfy/recipe` reads it for the app.

Every render uses the distilled plan. The CFG plans (`two_stage`,
`two_stages_hq`, `one_stage`) were removed on 2026-11-21: with a character
LoRA they spoke in voice-over and gave mannered gestures, and the final
quality now comes from the x2 video upscale.

## Nodes

`KomfyLTX25MLX` ("LTX 2.5 (MLX) · Komfy", category `Komfy/LTX MLX`).

| Input | Notes |
|---|---|
| `model_pack` | Discovered packs (folders holding `split_model.json` or `embedded_config.json`) |
| `width`/`height` | Rounded to multiples of 64 (stage 1 runs at half size) |
| `fit_to_image` | With a first image, derive the short side from the image ratio (no crop) |
| `duration` | Seconds, snapped to 8k+1 frames; `0` = predicted from the prompt |
| `first_image` / `last_image` | Optional; first → `--image P 0 S`, last → `--image P last S` |
| `keyframes` | Optional JSON: images pinned on frames in between, with optional per-stretch prompts (see below). Empty = the plain render |
| `lora_name` | Any file in `models/loras` (e.g. a character LoRA), or `None` |
| `extra_loras` | Optional JSON list of more LoRAs fused with `lora_name`, in order: `[{"name": "x.safetensors", "strength": 1.0}]` (one `--lora` each). Empty = `lora_name` alone |
| `low_ram` / `tile_frames` | Memory levers for long or large clips |
| `save_last_frame` | Writes the last clean frame (the one before last with an end anchor) |
| `ref_1`..`ref_3` | Optional character photos: with one or more, the render switches to `ltx-2-mlx ic-lora` (see below) |
| `ingredients_lora` / `ingredients_strength` | The Ingredients IC-LoRA for 2.5 and its strength (1.0 recommended) |
| `reference_strength` | Strength of the reference sheet video (`--video-conditioning`) |
| `voice` | Optional AUDIO (core LoadAudio): switches the render to `ltx-2-mlx a2v --distilled` (see below) |
| `voice_normalize` | Bring the voice to about -16 LUFS first (default on) |
| `lip_sync_hint` | Append a sentence describing the articulation to the prompt (default on) |
| `silence_after` | Seconds of silence added after the voice, lengthening the clip (default 0) |

`KomfyLTX25UpscaleMLX` ("LTX 2.5 video upscale x2 (MLX) · Komfy").

| Input | Notes |
|---|---|
| `video` | VIDEO (core LoadVideo; Komfy passes a gallery clip as `sub/clip.mp4 [output]`) |
| `prompt` | The clip's description, ideally the prompt it was made with |
| `lora_name` / `lora_strength` | Optional identity LoRA (the character LoRA of the take) |
| `upscaler_lora` / `upscaler_strength` | The Pixel-Spatial-Upscaler x2 IC-LoRA (found by name when left out) and its strength (1.0) |
| `low_ram` | Memory lever |

### Keyframes

`keyframes` (with a `first_image`, no voice or references, a duration > 0)
pins more images on frame numbers of the clip, one render passing through
all of them:

```json
{"opening": "what happens from the first image on",
 "keys": [{"image": "a.png", "frame": 48, "strength": 1.0,
           "prompt": "what happens from this keyframe on"}]}
```

`image` is a ComfyUI annotated filename (`a.png` in the input folder,
`sub/a.png [output]` in the output folder), opened upright and passed as
`--image PATH FRAME STRENGTH guide` (a keyframe at any pixel frame).
`frame` is a 0-based pixel frame of the output, the number the Komfy
viewer's frame grabber reports, so a shot rebuilt with the same duration
and frame rate puts each retouched frame back where it was grabbed.
Two images (first, keys, last) stay at least 8 frames apart: the VAE packs
8 pixel frames into one latent frame. An extra `source` key (the clip the
frames came from, for the app) is ignored.

The prompts are optional. With at least one, each stretch (first image to
the next keyframe, keyframe to keyframe, last keyframe to the end) becomes
a Prompt Relay `--segment TEXT LEN`, LEN in latent frames: the main prompt
applies everywhere, a stretch prompt only to its stretch. The segments must
cover the whole clip and the CLI refuses an empty one, so a stretch without
a prompt gets a neutral continuity sentence. Prompt Relay does not work with
modality tiling: the node refuses stretch prompts with `tile_frames` > 1.
The parsing, checks and segment lengths live in `keyframes.py` (pure
functions). Not measured on renders yet: each keyframe adds one latent
frame of tokens, and a retouch that does not match its frame shows as a
snap on that frame (lower its strength).

### Voice to video (a2v)

With `voice` plugged (and a `first_image`, no references), the node writes
the voice to WAV, normalizes it (a phone recording at -25 dB mean barely moved
the lips, about -18 dB did), pads it with silence to cover every frame (a2v
rejects a short track) and runs `a2v --distilled --audio voice.wav --image
first.png 0 S`, plus `--image last.png last S` when `last_image` is plugged.
The clip length follows the voice plus `silence_after` (8k + 1 frames covering
both, 20 s at most); `duration`, `audio`, `tile_frames` do not apply. a2v has no
`--lora` flag: with LoRAs the node runs `a2v_lora.py` with the ltx-2-mlx
virtualenv's python, which sets the pipeline's pending LoRAs so they are fused
like in `generate` (the log shows one "Fusing LoRA" line per LoRA).

Measured on 2026-11-21 (M3 Max, 2.5 q8, character LoRA at 1.0, 512x768,
105 frames, about 2.5 min): the distilled plan speaks with the character's
lips; the CFG plans gave voice-over. The prompt must describe the person
speaking: with "a mocking half smile" the mouth stayed shut in every mode.

With a last image (measured on 2026-11-22, same setup, about 5 min): the
clip reaches the last image and the lips follow the voice, provided the
prompt describes the last image's pose and does not ask for a closed mouth
("ending with a closed-mouth smile" froze the lips halfway through the
speech). On a 105-frame clip the motion reached the last image smoothly. With
`silence_after` (137 and 153 frames, seed 12) the lips stopped with the voice
but the motion drifted (the other hand raised) and the last image showed up
only on the final frames, as a cut: keep the silence short when the last
image matters, and try another seed when it pops in.

### Video upscale x2

`ic-lora --single-stage` at twice the source size with the Pixel-Spatial-
Upscaler x2 IC-LoRA at 1.0, the source as `--video-conditioning` at 1.0 and
the optional identity LoRA, then the source's audio muxed back
(`-map 0:v -map 1:a -c copy`). Frames and frame rate follow the source.
Measured on a 512x768 talking take (105 frames): about 38 min with free
memory, 74 min under memory pressure; motion and mouth shapes identical to
the source, so the lip sync carries over; identity LoRA 1.0 a clear gain
over none, 1.2 and 1.5 only mark moustache and skin a little more.

### Character references (Ingredients IC-LoRA)

Lightricks' Ingredients IC-LoRA keeps characters consistent with a
*reference sheet*: one panel per element on a black background, no text, fed
as a static video at the output size. `reference_sheet.py` lays 1 to 3
photos out on that sheet (the grid that gives them the most area), the node
loops it into an mp4 of the clip's length and runs `ic-lora` with
`--lora <Ingredients> S --video-conditioning sheet.mp4 S` on Lightricks'
recipe: one stage at full size, dev transformer, the pack's distilled LoRA at
0.5 (`--single-stage --dev-transformer ... --distilled-lora ... 0.5`). Measured
on ltx-2-mlx 0.18 with the 2.5 q8 pack at 768x448x49: the default distilled
two-stage plan returns a mosaic and the distilled single stage copies the
sheet; this recipe renders the character (5 min for 2 s). It always renders
audio and has no CFG: `audio=False` and `tile_frames` are ignored there. With a
duration of 0, the clip is 5 s (the LoRA was trained on 121 frames at 24 fps).
The prompt works best in the model card's two parts: `Reference sheet: <what
the photos show>` then `Generated video: <the action>`.

What the tests showed (2026-11-19, M3 Max, 5 s at 512x768, 13 min a render):

- References work **without a start image** only (text to video): the
  character comes out with the referenced face and teeth. With a start image
  the clip leaves it after frame 0 and films the sheet itself (the native
  LTX 2.3 graph recomposed the scene the same way). Ingredients was trained
  without first-frame conditioning, so the node refuses references together
  with `first_image`.
- Cut-outs on black (the model card's "clean panels") beat photos with their
  background: with backgrounds, each panel tends to become a shot of its own.
  The sheet trims black margins so cut-outs fill their panel.
- A close-up panel can still open the clip as a short shot of its own.

## Install

```bash
# 1. The MLX runtime and an LTX 2.5 pack
git clone https://github.com/dgrauet/ltx-2-mlx ~/ltx-2-mlx
cd ~/ltx-2-mlx && uv sync --all-extras
hf download dgrauet/ltx-2.5-mlx-q8 --local-dir ~/models/ltx-2.5-mlx-q8

# Optional, for the character references: the Ingredients IC-LoRA (gated:
# accept the license on the model page first)
hf download Lightricks/LTX-2.5-22b-IC-LoRA-Ingredients \
  ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors \
  --local-dir <comfy models>/loras/ltx/ic-lora

# For the x2 video upscale: the Pixel-Spatial-Upscaler IC-LoRA
hf download Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler \
  ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors \
  --local-dir <comfy models>/loras/ltx/ic-lora

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
