/**
 * Manifest of an embedded workflow: frozen JSON (API format) + list of
 * patchable fields applied before POST /prompt (ROADMAP Sprint 3).
 *
 * User-facing manifest strings (name, description, label, hint,
 * placeholder, option labels) hold i18n keys resolved with t() by the
 * screens; language-neutral values ("Steps", "euler"…) pass through t()
 * unchanged.
 */

import type { Ionicons } from '@expo/vector-icons';
import type { WorkflowIconKey } from '../components/WorkflowIcon';
import type { PromptGraph } from '../api/types';

/** Target of a patch: a graph node's input. */
export interface PatchTarget {
  nodeId: string;
  input: string;
}

interface FieldBase {
  key: string;
  label: string;
  /** Help text displayed under the field. */
  hint?: string;
  /**
   * Conditional visibility: the field is shown only while another field's
   * value equals `equals` (e.g. the distilled-LoRA strengths, revealed only
   * when the `distilled` toggle is On), or, with `filled`, once that field
   * holds a value (e.g. the second reference photo, offered after the first). Hidden fields are still patched at
   * launch — a select that hides one typically also removes its target node,
   * making the value moot (cf. patch.ts passthroughBypass + the number guard).
   */
  showWhen?: { key: string; equals: string | number } | { key: string; filled: true };
  /**
   * Advanced setting: rendered after the other fields, folded behind an
   * "Advanced settings" toggle (unfolded automatically when one of them
   * fails validation). Patched at launch like any field, folded or not.
   */
  advanced?: boolean;
}

export interface TextField extends FieldBase {
  kind: 'text';
  target: PatchTarget;
  default: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
}

export interface NumberField extends FieldBase {
  kind: 'number';
  target: PatchTarget;
  /**
   * Extra targets patched with the same value (e.g. the same threshold set
   * on both detection chains of the inpaint). Remix only reads `target`.
   */
  extraTargets?: PatchTarget[];
  default: number;
  min?: number;
  max?: number;
  integer?: boolean;
}

/** Seed: random by default, optional fixed value. */
export interface SeedField extends FieldBase {
  kind: 'seed';
  target: PatchTarget;
}

/**
 * Model field: file-typed input (unet, clip, vae…) picked from the server's
 * installed files. Options come from the target's /object_info enum (already
 * fetched by useAvailability — cf. requirements.modelFieldOptions), so the
 * list is exactly what the server will accept; the frozen graph value stays
 * as `default`/fallback when the list is unavailable.
 */
export interface ModelField extends FieldBase {
  kind: 'model';
  target: PatchTarget;
  /** Frozen graph value — used until the user picks something else. */
  default: string;
  /**
   * Case-insensitive regex narrowing the offered files to the compatible
   * family (e.g. 'krea2'); when nothing matches, the full list is offered.
   */
  filter?: string;
  /**
   * The last choice is remembered per workflow (fieldPrefs store) and
   * re-applied as the initial value on subsequent launches.
   */
  remember?: boolean;
  /**
   * Also offer the GGUF files of the same folder (ComfyUI-GGUF's
   * UnetLoaderGGUF enum, merged after the target's own list). Picking a
   * `.gguf` swaps the target UNETLoader for an UnetLoaderGGUF at patch time
   * (cf. patch.applyModelValue), and remix accepts either loader in that slot
   * (cf. match.walk). A Q8_0 GGUF holds about half the memory of a bf16
   * model (Krea 2 Turbo: 13.7 GB vs 24.4 GB) for a near-identical render —
   * what keeps a 64 GB Mac out of swap on the heavier workflows. Optional on
   * the server: without ComfyUI-GGUF the list simply has no GGUF entries.
   */
  ggufLoader?: boolean;
  /**
   * Shown as a two-way Standard / GGUF switch instead of the file picker
   * (requires ggufLoader): each side resolves to a file of the filtered list
   * (cf. modelVariant.pickVariantFile). When the form has advanced fields,
   * the regular picker is offered there too, to pick the exact file (e.g.
   * Q8_0 vs Q4_K_M).
   */
  variantSwitch?: boolean;
}

/**
 * Generalist model source: one picker offering both checkpoints
 * (CheckpointLoaderSimple — self-contained MODEL+CLIP+VAE) and diffusion
 * models (UNETLoader — needing a separate CLIP encoder + VAE). Picking a
 * checkpoint hides the CLIP/VAE rows; picking a diffusion model reveals the
 * CLIP type + CLIP file + VAE rows, pre-filled by a name heuristic over the
 * server's own enums (cf. modelCoupling.ts) — nothing model-specific is
 * baked into the manifest. At patch time the graph is rewired to the chosen
 * loader and the unused loaders are dropped (cf. insertModelSource).
 */
export interface ModelSourceField extends FieldBase {
  kind: 'modelSource';
  /**
   * Id of the CheckpointLoaderSimple node CREATED at patch time in checkpoint
   * mode (not frozen in the graph — a dangling loader would break remix
   * matching, cf. match.tryMatch). Its enum is fetched via the node type
   * added to requiredClassTypes.
   */
  checkpointNodeId: string;
  /** UNETLoader node (MODEL in diffusion mode). */
  unetNodeId: string;
  /** CLIPLoader node (CLIP in diffusion mode). */
  clipNodeId: string;
  /** VAELoader node (VAE in diffusion mode). */
  vaeNodeId: string;
  /**
   * Empty-latent node. Its channel count must match the model family: the
   * frozen graph is 16-channel (EmptySD3LatentImage, for the diffusion
   * models), swapped in place to 4-channel (EmptyLatentImage) in checkpoint
   * mode — the usual SD1.5/SDXL case. Both nodes share the width/height/
   * batch_size signature, so only class_type changes (cf. insertModelSource).
   *
   * Absent when the workflow has no empty latent because it starts from an
   * encoded image: VAEEncode derives the channel count from the VAE, so
   * there is nothing to swap (cf. the hand-drawn inpaint).
   */
  latentNodeId?: string;
  /** MODEL consumers rewired to the active model output (e.g. KSampler). */
  modelTargets: PatchTarget[];
  /** CLIP consumers rewired to the active CLIP output (CLIPTextEncode). */
  clipTargets: PatchTarget[];
  /** VAE consumers rewired to the active VAE output (VAEDecode). */
  vaeTargets: PatchTarget[];
  /** Frozen fallbacks — used until the picker (server enums) takes over. */
  defaultUnet: string;
  defaultClip: string;
  defaultClipType: string;
  defaultVae: string;
  defaultCheckpoint: string;
  /** Last full selection is remembered per workflow (fieldPrefs, JSON). */
  remember?: boolean;
  /**
   * Same as ModelField.ggufLoader, on the diffusion branch: the GGUF files of
   * ComfyUI-GGUF's UnetLoaderGGUF are merged after the UNETLoader list, and
   * picking a `.gguf` swaps the unet loader node for an UnetLoaderGGUF at
   * patch time (cf. patch.insertModelSource). Checkpoint mode is unaffected.
   */
  ggufLoader?: boolean;
}

/** Value of a modelSource field. */
export interface ModelSourceValue {
  mode: 'checkpoint' | 'diffusion';
  /** ckpt_name (checkpoint mode). */
  checkpoint: string;
  /** unet_name (diffusion mode). */
  unet: string;
  /** clip_name (diffusion mode). */
  clip: string;
  /** CLIPLoader.type enum value (diffusion mode). */
  clipType: string;
  /** vae_name (diffusion mode). */
  vae: string;
}

export interface SelectOption {
  label: string;
  /**
   * One choice can patch several inputs (e.g. width + height). A `[nodeId,
   * slot]` value rewires an input to another node's output — used to reconnect
   * a consumer when the option also removes a mid-chain node via `bypassNodes`.
   */
  patches: { target: PatchTarget; value: string | number | [string, number] }[];
  /**
   * Node ids removed from the graph when this option is chosen — the way an
   * optional branch (e.g. an extra SaveImage sink) is toggled off. The nodes
   * stay in the frozen graph (so their class_types are still validated against
   * the server); patch.ts deletes them at launch, then drops every input still
   * reading one of them. So either a sink nothing else reads from, or a node
   * plugged only into OPTIONAL sockets (e.g. a second reference image): a
   * required input left unplugged would be rejected by the server.
   */
  bypassNodes?: string[];
  /**
   * Mid-chain nodes removed AND short-circuited when this option is chosen:
   * each listed node is deleted, and every input reading its `output` slot is
   * rewired to whatever currently feeds the node's `input` — the graph flows
   * straight through, exactly as ComfyUI's own bypass (CTRL+B). Unlike
   * `bypassNodes` (for sinks nothing reads from), this preserves the consumers,
   * so the upstream may be a node created earlier at patch time (e.g. the tail
   * of a loras chain) — the connection is read live from the graph, never
   * hardcoded. Order the field AFTER whatever builds that upstream. Independent
   * nodes only: a passthrough node must not feed another node listed here.
   */
  passthroughNodes?: { nodeId: string; output: number; input: string }[];
}

export interface SelectField extends FieldBase {
  kind: 'select';
  options: SelectOption[];
  defaultIndex: number;
  /**
   * The last choice is remembered per workflow (fieldPrefs store) and
   * re-applied as the initial value on subsequent launches.
   */
  remember?: boolean;
}

/** A LoRA selected in the form. */
export interface LoraSelection {
  /** Path relative to the loras folder, as returned by /models/loras. */
  name: string;
  strength: number;
}

/** What every LoRAs field shares: the form side (cards, picker, validation). */
interface LorasFieldBase extends FieldBase {
  kind: 'loras';
  defaultStrength?: number;
  /**
   * Initial selection (imported workflows: the absorbed chain's LoRAs,
   * editable in the form). Absent = empty form (embedded workflows).
   */
  default?: LoraSelection[];
  /**
   * Case-insensitive regex narrowing the picker to the compatible family
   * (e.g. 'ltx'); when nothing matches, the full list is offered.
   */
  filter?: string;
  /**
   * Strength bounds of the slider and of validation, when the backend has
   * its own (the KomfyLTX25MLX lora_strength input stops at ±2). Absent =
   * the slider's ±10, with no bound enforced at launch.
   */
  strengthRange?: { min: number; max: number };
  /**
   * The last selection is remembered per workflow (fieldPrefs store, as
   * JSON) and re-applied as the initial value on subsequent launches.
   */
  remember?: boolean;
}

/**
 * LoRAs field: chain of LoraLoaderModelOnly nodes inserted at patch time
 * between `modelSource` and each `modelTargets` input (pattern of the
 * embedded KREA2 workflows — the Qwen3-VL CLIP takes no LoRA patch).
 */
export interface ChainLorasField extends LorasFieldBase {
  /** MODEL output upstream of the chain (e.g. UNETLoader). */
  modelSource: { nodeId: string; output: number };
  /** MODEL inputs rewired to the end of the chain (e.g. KSampler.model). */
  modelTargets: PatchTarget[];
  nodeInputs?: undefined;
  /**
   * LoRAs the workflow ALWAYS applies, inserted at the head of the chain
   * (before the user's) and not editable — the LoRA a workflow is built
   * around, e.g. the KREA2 identity-edit weights without which the edit no
   * longer preserves the subject.
   *
   * They are deliberately not frozen as graph nodes: a LoraLoaderModelOnly
   * sitting in the frozen graph would be swallowed by the remix chain
   * absorption (cf. match.resolveThroughLoras) and come back as a removable
   * user LoRA. Inserted at patch time instead, they stay out of the form, are
   * stripped off again on remix, and their file is still checked against the
   * server (cf. requirements.checkAvailability).
   */
  fixed?: LoraSelection[];
  /**
   * File names `fixed` used to hold before a newer version replaced them. A
   * render whose chain opens with one of them is remixed with today's fixed
   * LoRA: the old file is dropped instead of coming back as a user LoRA
   * stacked on top of its own replacement.
   */
  formerFixed?: string[];
}

/**
 * LoRAs field of a node that applies the LoRAs itself instead of taking a
 * MODEL (KomfyLTX25MLX: the ltx-2-mlx CLI fuses them, `--lora` repeated).
 * The first LoRA goes to the node's single-LoRA inputs, so a one-LoRA render
 * keeps exactly the graph it had before the list existed (and still runs on
 * a server that predates the list); the others travel as JSON in `extra`,
 * an optional input left out of the graph when there are none.
 */
export interface NodeLorasField extends LorasFieldBase {
  nodeInputs: {
    nodeId: string;
    /** Combo input of the first LoRA (e.g. lora_name). */
    name: string;
    /** Its strength (e.g. lora_strength). */
    strength: string;
    /** Optional STRING input: the other LoRAs, `[{"name","strength"}]`. */
    extra: string;
    /** `name` value meaning "no LoRA" (e.g. 'None'). */
    none: string;
  };
  /**
   * Keys of the single-LoRA fields this one replaced (a `model` field and a
   * `number` field): read back from the presets and remembered choices
   * saved before, so they still bring their LoRA.
   */
  legacyKeys?: { name: string; strength: string };
}

export type LorasField = ChainLorasField | NodeLorasField;

/** Value of a dimensions field: preset or custom, invertible. */
export interface DimensionsValue {
  width: number;
  height: number;
  /** true = portrait (width/height swapped at patch time). */
  inverted: boolean;
  /** true = free input (not a preset). */
  custom: boolean;
}

/**
 * Dimensions field: landscape presets + "Invert" (portrait) + free input.
 * Patches the latent node's width and height.
 */
export interface DimensionsField extends FieldBase {
  kind: 'dimensions';
  widthTarget: PatchTarget;
  heightTarget: PatchTarget;
  /** Presets (landscape orientation, width ≥ height). */
  options: { width: number; height: number }[];
  default: { width: number; height: number };
}

/**
 * Input image field: photo picked on the phone, uploaded via
 * POST /upload/image; the value is the server-side filename (input
 * folder), patched into the LoadImage node.
 */
export interface ImageField extends FieldBase {
  kind: 'image';
  target: PatchTarget;
  required?: boolean;
  /**
   * Optional image left empty: its LoadImage node is removed at launch and
   * every input reading it is unplugged, instead of sending an empty
   * filename the server would reject. The consumer's socket must therefore
   * be optional (e.g. the reference photos of the LTX character sheet).
   * On remix, the missing node is expected, not a mismatch.
   */
  omitWhenEmpty?: boolean;
}

/**
 * Audio input (a voice): an audio file picked in the Files app (a Voice
 * Memos recording saved to Files, an AirDrop, iCloud Drive) or the sound of
 * a video from the photo library, uploaded to the input folder like a photo.
 * The value is the server-side filename, patched into a core LoadAudio,
 * which also decodes the audio track of a video (PyAV).
 */
export interface AudioField extends FieldBase {
  kind: 'audio';
  target: PatchTarget;
  required?: boolean;
  /** Longest audio the server accepts (seconds): shown in red beyond it. */
  maxSeconds?: number;
  /**
   * Optional audio left empty: its LoadAudio node is removed at launch and
   * the input reading it unplugged (same contract as ImageField's), e.g.
   * the new voice sample of the voice workflow, which overrides a saved one.
   */
  omitWhenEmpty?: boolean;
}

/**
 * Emotion mixer (IndexTTS voice): eight weights in 0..1, one per emotion
 * (cf. emotions.ts for the order and the presets), patched as a JSON list
 * into a STRING input. All zeros = neutral.
 */
export interface EmotionsField extends FieldBase {
  kind: 'emotions';
  target: PatchTarget;
}

/**
 * Video input: any clip of the server (output or input folder, picked in
 * the media picker) or one imported from Photos into input/komfy-video. The
 * value is a loader filename, annotated for the output folder
 * (`sub/clip.mp4 [output]`, cf. utils/annotated), that core LoadVideo
 * resolves: a render goes on to the next workflow with no round trip to the
 * phone.
 */
export interface VideoField extends FieldBase {
  kind: 'video';
  target: PatchTarget;
  required?: boolean;
  /** Show the x2 output size and the time estimate (video upscale). */
  upscaleEstimate?: boolean;
}

/**
 * Hand-drawn mask field: the user paints over the image held by another
 * field (`sourceKey`), the strokes are rasterized and encoded to a PNG in
 * JS (cf. utils/maskRaster + utils/png — Komfy has no native canvas, see
 * the README's Expo Go constraint), uploaded via POST /upload/image, and
 * the value becomes the server-side filename patched into LoadImageMask.
 *
 * Same value shape as `image` (a filename string), so patch/match/remix
 * treat the two identically.
 */
export interface MaskField extends FieldBase {
  kind: 'mask';
  target: PatchTarget;
  /** Key of the `image` field whose picture is painted over. */
  sourceKey: string;
  required?: boolean;
}

/**
 * Working resolutions of the detailer (DetailerForEach guide_size).
 * The face crop is regenerated at this resolution: higher = more real
 * detail on large images (the face is no longer downscaled before the
 * pass), at the cost of speed and VRAM. max_size (anti-overflow ceiling)
 * is computed automatically at 2× this value at patch time.
 */
export const GUIDE_SIZE_OPTIONS = [512, 768, 1024, 1280] as const;

/** Default guide_size (= historical behavior: guide 512 / max 1024). */
export const DEFAULT_GUIDE_SIZE = 512;

/**
 * Detail levels offered per Detect & Replace zone: GUIDE_SIZE_OPTIONS plus
 * two lower steps for distant elements. guide_size is the target for the
 * bbox's short side, so a far, small zone regenerated at 512 comes back much
 * denser in detail than its surroundings. With max_size at 2×, the sampled
 * crop is capped at 512 px (256) or 768 px (384) on its long side.
 * Kept separate from GUIDE_SIZE_OPTIONS on purpose: Draw & Replace exposes
 * that list as a select whose value (and saved presets) is an index, which
 * prepending would shift. A zone stores the value in px.
 */
export const ZONE_GUIDE_SIZE_OPTIONS = [256, 384, ...GUIDE_SIZE_OPTIONS] as const;

/**
 * Seed stride between two batch jobs in allZones mode. DetailerForEach
 * derives `seed + i` for each seg it iterates over, so a single pass burns
 * one seed per detected zone — a count only known once the detector has
 * run. Striding by a zone count no photo will reach keeps the jobs of a
 * batch from landing on each other's seeds.
 */
export const ALL_ZONES_SEED_STRIDE = 64;

/** One Detect & Replace zone: dedicated content + LoRAs + denoise. */
export interface ZoneValue {
  prompt: string;
  loras: LoraSelection[];
  /** Replacement strength for THIS zone (0.05–1). */
  denoise: number;
  /**
   * Detail level = DetailerForEach guide_size for THIS zone (px).
   * Absent ⇒ DEFAULT_GUIDE_SIZE. See ZONE_GUIDE_SIZE_OPTIONS.
   */
  guideSize?: number;
  /**
   * Modified area for THIS zone (px), overriding the shared dilation field.
   * Absent ⇒ the shared value is used as-is. A per-zone value is applied as a
   * delta on the detected SEGS (ImpactDilateMaskInSEGS), never by re-running
   * the detector: the numbering stays the one detection everyone shares.
   */
  dilation?: number;
  /**
   * Bypass: the zone keeps its place in the numbering (left → right) but
   * NO pass is generated — it is not altered at all.
   */
  bypass?: boolean;
}

/** Zones field value: replacements (index = zone number, left → right) + shared settings. */
export interface ZonesValue {
  zones: ZoneValue[];
  /**
   * true = `zones[0]` alone is used, and its pass is fed the raw SEGS:
   * DetailerForEach iterates over every detected zone natively (no filter,
   * no numbering, no count limit). The rest of `zones` is kept so
   * toggling back restores the per-zone setup.
   */
  allZones?: boolean;
  steps: number;
  seed: number | 'random';
}

/**
 * Zones field (Detect & Replace). Two patch-time shapes, cf. ZonesValue.allZones:
 *  - one identity per zone: for each replacement i, the chain
 *      ImpactSEGSOrderedFilter(ascending x1, take_start=i) → DetailerForEach
 *    wired in series on the image (last detailer output → imageTargets);
 *  - same identity for every zone: a single DetailerForEach fed `segsSource`
 *    directly — it is a for-each over the whole SEGS batch.
 * Each replacement has its own CLIPTextEncode and LoRA chain.
 */
export interface ZonesField extends FieldBase {
  kind: 'zones';
  /** LoadImage IMAGE output. */
  imageSource: { nodeId: string; output: number };
  /** BboxDetectorSEGS SEGS output (all detected zones). */
  segsSource: { nodeId: string; output: number };
  modelSource: { nodeId: string; output: number };
  clipSource: { nodeId: string; output: number };
  vaeSource: { nodeId: string; output: number };
  /** Shared negative CLIPTextEncode. */
  negativeSource: { nodeId: string; output: number };
  /** IMAGE inputs rewired to the last detailer's output (SaveImage.images). */
  imageTargets: PatchTarget[];
  /**
   * Shared dilation (modified area around the detection) a zone may override.
   * `fieldKey` is the number field carrying it — the form reads it to show the
   * inherited value; `nodeId`/`input` is where that field lands in the graph,
   * read back at patch time as the base a per-zone value is a delta of. The
   * number field MUST come before the zones field in `fields` (patching runs
   * in order). Absent ⇒ no per-zone override offered.
   */
  dilation?: {
    fieldKey: string;
    nodeId: string;
    input: string;
    min: number;
    max: number;
  };
  /** Absent = no cap: one pass per zone, the cost is linear. */
  maxZones?: number;
  defaultStrength?: number;
  defaultDenoise: number;
  defaultSteps: number;
}

/** Where the source sits on the expanded canvas (Photoshop's "anchor"). */
export type OutpaintAnchor =
  | 'tl'
  | 't'
  | 'tr'
  | 'l'
  | 'c'
  | 'r'
  | 'bl'
  | 'b'
  | 'br';

/**
 * Value of an outpaint field. Paddings are in SOURCE pixels, the unit the
 * user sees; everything the graph needs (working size, working paddings,
 * restored size) is derived from them at patch time (cf. outpaint.planOutpaint).
 */
export interface OutpaintValue {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Pixel budget of the generated canvas, in megapixels (× 1024²). */
  budget: number;
  anchor: OutpaintAnchor;
  /**
   * Template the paddings came from ('ratio:16:9', 'zoom:1.5'), re-applied
   * when the source changes. Cleared by any manual edit.
   */
  template?: string | null;
  /** Source pixel size, measured by the form (0 = not measured yet). */
  sourceWidth: number;
  sourceHeight: number;
  /**
   * Remix of a render made at working resolution: the paddings were read in
   * the working source's pixels (this size) and are rescaled to source pixels
   * once the form has measured the source.
   */
  pendingScale?: { width: number; height: number } | null;
}

/**
 * Outpaint field (Krea 2 AnyPaint): the canvas expansion drawn in the form,
 * per side, over the picture held by `sourceKey`. One value drives several
 * nodes, all computed from the source size (cf. patch.insertOutpaint):
 *  - `scale`: ImageScale fitting the source to the working resolution;
 *  - `prepare`: Krea2AnyPaintPrepare left/top/right/bottom (working px);
 *  - `upscale`, `mask`, `pasteMask`, `feather`, `placeMask`, `composite`:
 *    the restoration branch (generated canvas back to source scale, original
 *    pixels pasted over it beyond the redraw band, cf. outpaint.restoreGeometry).
 *    A select may drop that branch: missing nodes are skipped.
 * The seam width is read live from `prepare.boundary_redraw_px`, so the
 * number field driving it must come BEFORE this field.
 */
export interface OutpaintField extends FieldBase {
  kind: 'outpaint';
  /** Key of the `image` field holding the source picture. */
  sourceKey: string;
  nodes: {
    scale: string;
    prepare: string;
    upscale: string;
    /** Empty SolidMask at the source size (also how remix reads that size). */
    mask: string;
    /** Full SolidMask at the pasted size. */
    pasteMask: string;
    /** FeatherMask fading the pasted area in on the grown sides. */
    feather: string;
    /** MaskComposite placing the pasted area on the source-sized mask. */
    placeMask: string;
    composite: string;
  };
  /** Working-resolution choices (megapixels) and the default one. */
  budgets: number[];
  defaultBudget: number;
}

/** One keyframe between the first and the last image (cf. KeyframesField). */
export interface KeyframeValue {
  /**
   * Form-only identity (the sheet and async lookups follow a keyframe by it
   * while the list re-sorts). Never sent to the node.
   */
  id: string;
  /** Server-side filename: an upload, or an annotated output (`sub/a.png [output]`). */
  image: string;
  /**
   * Pixel frame of the clip, 0-based: the number the viewer's frame grabber
   * shows. At least KEYFRAME_MIN_GAP frames from every other image.
   */
  frame: number;
  /** Anchor strength, 0..1. */
  strength: number;
  /** What happens from this keyframe to the next image ('' = the main prompt alone). */
  prompt: string;
}

/** Value of a keyframes field. */
export interface KeyframesValue {
  /** What happens from the first image to the first keyframe ('' = none). */
  opening: string;
  /** Sorted by frame. */
  keys: KeyframeValue[];
  /**
   * Clip the keyframes were taken from (`output/sub/clip.mp4`): the timeline
   * draws its frames and places a picked picture on the frame it came from.
   * Travels in the graph (the node ignores it) so a remix brings it back.
   */
  source: string | null;
}

/**
 * Keyframes timeline (LTX 2.5 first/last frame): extra pictures pinned on
 * frame numbers between the two end images, one render passing through all
 * of them, with an optional prompt per stretch. Patched as one JSON string
 * into the node's `keyframes` input (cf. server/komfy-ltx-mlx/keyframes.py),
 * left out of the graph when there are none, so a plain first/last render
 * keeps the graph it always had.
 *
 * The timeline also shows the two end images: the fields named by
 * `ends` are drawn inside it instead of on their own (they stay ordinary
 * image and number fields for patching, remix, presets and "Use in").
 */
export interface KeyframesField extends FieldBase {
  kind: 'keyframes';
  /** STRING input receiving the JSON. */
  target: PatchTarget;
  ends: {
    first: string;
    last: string;
    firstStrength: string;
    lastStrength: string;
  };
  /** Number fields setting the clip length (frame numbers depend on them). */
  durationKey: string;
  fpsKey: string;
  /** Temporal tiles number field: stretch prompts need it at 1. */
  tileFramesKey?: string;
  maxKeys: number;
}

export type WorkflowField =
  | TextField
  | NumberField
  | SeedField
  | SelectField
  | ModelField
  | ModelSourceField
  | DimensionsField
  | ImageField
  | AudioField
  | EmotionsField
  | VideoField
  | MaskField
  | LorasField
  | ZonesField
  | OutpaintField
  | KeyframesField;

/** What one run of a workflow produces: the launch bar counts in it. */
export type OutputKind = 'image' | 'video' | 'voice';

export interface WorkflowManifest {
  id: string;
  name: string;
  description: string;
  /**
   * A workflow icon key (WorkflowIcon). Imports made before the redesign
   * hold an Ionicons name instead, drawn as the graph icon.
   */
  icon: keyof typeof Ionicons.glyphMap | WorkflowIconKey;
  /**
   * What one run produces, for the launch bar's wording (×2 images, ×2
   * videos, ×2 takes). Absent = 'image' (imported workflows included).
   */
  output?: OutputKind;
  /** Graph in API format (Save (API Format)), never mutated directly. */
  graph: PromptGraph;
  fields: WorkflowField[];
  /**
   * SaveImage node whose filename_prefix is set at launch.
   * Absent for text-result workflows (no image produced).
   */
  saveNodeId?: string;
  /**
   * Secondary sink nodes (extra SaveImage/VHS_VideoCombine — e.g. the LTX
   * first-pass preview save) whose filename_prefix must follow the SAME chosen
   * output folder as `saveNodeId`, keeping their own basename. Without this
   * they'd stay on their frozen `komfy/…` prefix and ignore the destination.
   * Nodes dropped by a select's bypass are skipped.
   */
  auxSaveNodeIds?: string[];
  /**
   * Text-result workflow: output node (e.g. ShowText|pysssss) whose text
   * surfaces in /history outputs. Its presence switches the launch screen
   * to the result screen (no batch, no destination).
   */
  textNodeId?: string;
}

/** Values entered in the form, by field.key. */
export type FieldValues = Record<
  string,
  | string
  | number
  | 'random'
  | LoraSelection[]
  /** An emotions field's mix (8 weights). */
  | number[]
  | DimensionsValue
  | ZonesValue
  | ModelSourceValue
  | OutpaintValue
  | KeyframesValue
>;

/** Whether a field is shown (and validated) given the current form values. */
export function isFieldShown(field: WorkflowField, values: FieldValues): boolean {
  const cond = field.showWhen;
  if (!cond) return true;
  if ('filled' in cond) {
    const v = values[cond.key];
    return v != null && v !== '';
  }
  return values[cond.key] === cond.equals;
}
