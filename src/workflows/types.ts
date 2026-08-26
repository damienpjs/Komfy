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
   * when the `distilled` toggle is On). Hidden fields are still patched at
   * launch — a select that hides one typically also removes its target node,
   * making the value moot (cf. patch.ts passthroughBypass + the number guard).
   */
  showWhen?: { key: string; equals: string | number };
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
   * the server); patch.ts deletes them at launch. Only safe for sinks nothing
   * else reads from.
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

/**
 * LoRAs field: chain of LoraLoaderModelOnly nodes inserted at patch time
 * between `modelSource` and each `modelTargets` input (pattern of the
 * embedded KREA2 workflows — the Qwen3-VL CLIP takes no LoRA patch).
 */
export interface LorasField extends FieldBase {
  kind: 'loras';
  /** MODEL output upstream of the chain (e.g. UNETLoader). */
  modelSource: { nodeId: string; output: number };
  /** MODEL inputs rewired to the end of the chain (e.g. KSampler.model). */
  modelTargets: PatchTarget[];
  defaultStrength?: number;
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
   * Initial selection (imported workflows: the absorbed chain's LoRAs,
   * editable in the form). Absent = empty form (embedded workflows).
   */
  default?: LoraSelection[];
}

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
   * Absent ⇒ DEFAULT_GUIDE_SIZE. See GUIDE_SIZE_OPTIONS.
   */
  guideSize?: number;
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
  /** Absent = no cap: one pass per zone, the cost is linear. */
  maxZones?: number;
  defaultStrength?: number;
  defaultDenoise: number;
  defaultSteps: number;
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
  | MaskField
  | LorasField
  | ZonesField;

export interface WorkflowManifest {
  id: string;
  name: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
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
  | DimensionsValue
  | ZonesValue
  | ModelSourceValue
>;
