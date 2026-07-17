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

export interface SelectOption {
  label: string;
  /** One choice can patch several inputs (e.g. width + height). */
  patches: { target: PatchTarget; value: string | number }[];
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
  maxCount?: number;
  defaultStrength?: number;
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
 * Working resolutions of the detailer (DetailerForEach guide_size).
 * The face crop is regenerated at this resolution: higher = more real
 * detail on large images (the face is no longer downscaled before the
 * pass), at the cost of speed and VRAM. max_size (anti-overflow ceiling)
 * is computed automatically at 2× this value at patch time.
 */
export const GUIDE_SIZE_OPTIONS = [512, 768, 1024, 1280] as const;

/** Default guide_size (= historical behavior: guide 512 / max 1024). */
export const DEFAULT_GUIDE_SIZE = 512;

/** One multi-FaceSwap character: dedicated identity + LoRAs + denoise. */
export interface PersonValue {
  prompt: string;
  loras: LoraSelection[];
  /** Replacement strength for THIS face (0.05–1). */
  denoise: number;
  /**
   * Detail level = DetailerForEach guide_size for THIS face (px).
   * Absent ⇒ DEFAULT_GUIDE_SIZE. See GUIDE_SIZE_OPTIONS.
   */
  guideSize?: number;
  /**
   * Bypass: the face keeps its place in the numbering (left → right) but
   * NO pass is generated — it is not altered at all.
   */
  bypass?: boolean;
}

/** Persons field value: characters (index = face number, left → right) + shared settings. */
export interface PersonsValue {
  persons: PersonValue[];
  steps: number;
  seed: number | 'random';
}

/**
 * Characters field (multi FaceSwap): inserts at patch time, for each
 * character i, the chain
 *   ImpactSEGSOrderedFilter(ascending x1, take_start=i) → DetailerForEach
 * wired in series on the image (last detailer output → imageTargets).
 * Each character has its own identity CLIPTextEncode and LoRA chain.
 */
export interface PersonsField extends FieldBase {
  kind: 'persons';
  /** LoadImage IMAGE output. */
  imageSource: { nodeId: string; output: number };
  /** BboxDetectorSEGS SEGS output (all detected faces). */
  segsSource: { nodeId: string; output: number };
  modelSource: { nodeId: string; output: number };
  clipSource: { nodeId: string; output: number };
  vaeSource: { nodeId: string; output: number };
  /** Shared negative CLIPTextEncode. */
  negativeSource: { nodeId: string; output: number };
  /** IMAGE inputs rewired to the last detailer's output (SaveImage.images). */
  imageTargets: PatchTarget[];
  maxPersons: number;
  maxLorasPerPerson: number;
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
  | DimensionsField
  | ImageField
  | LorasField
  | PersonsField;

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
   * Text-result workflow: output node (e.g. ShowText|pysssss) whose text
   * surfaces in /history outputs. Its presence switches the launch screen
   * to the result screen (no batch, no destination).
   */
  textNodeId?: string;
}

/** Values entered in the form, by field.key. */
export type FieldValues = Record<
  string,
  string | number | 'random' | LoraSelection[] | DimensionsValue | PersonsValue
>;
