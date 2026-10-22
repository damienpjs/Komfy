/**
 * KREA2: Draw & Replace.
 *
 * The hand-drawn mask of `inpaint-draw` feeding the crop-and-regenerate pass
 * of `krea2-detect-replace`: the user paints the area, and instead of
 * sampling the whole image (where a small area is a handful of latent tokens
 * and the prompt gets diluted by the rest of the scene), the area is cropped,
 * upscaled to the detail resolution, regenerated on its own, then pasted
 * back with a feathered edge. Same result as Detect & Replace, for anything
 * no detector can find.
 *
 * LoadImage + LoadImageMask (PNG uploaded by the `mask` field) → GrowMask →
 * MaskToSEGS → DetailerForEach → SaveImage.
 *
 * MaskToSEGS settings:
 *  - `combined: false`: each separate painted stroke becomes its own SEGS,
 *    cropped and regenerated on its own (DetailerForEach loops over them).
 *    `true` would merge every stroke into one bounding box, which brings back
 *    the dilution as soon as two strokes are far apart. Not exposed: patches
 *    cannot carry a boolean.
 *  - `bbox_fill: false`: the noise mask inside the crop is the painted shape,
 *    not its bounding rectangle; the crop_factor only adds context around it.
 *  - `drop_size: 10`: stray specks smaller than 10 px are ignored.
 *
 * DetailerForEach parameters mirror the zone pass of Detect & Replace
 * (patch.ts insertZonePass: euler/simple, feather 5, noise_mask_feather 20),
 * except that steps/cfg/denoise are fields here. The detail resolution
 * defaults to 512 like the zones: guide_size is the target for the painted
 * area's short side, so at 1024 a small area came back far denser in detail
 * than the rest of the image. 1024 (Krea 2's native scale) stays one tap
 * away. The `detail` select patches guide_size and max_size (2×) together.
 *
 * MaskToSEGS signature taken from ComfyUI-Impact-Pack (segs_nodes.py); the
 * other class_types and DetailerForEach inputs are those already validated
 * for inpaint-draw and krea2-detect-replace.
 */

import type { PromptGraph } from '../api/types';
import { GUIDE_SIZE_OPTIONS } from './types';
import type { SelectOption, WorkflowManifest } from './types';

const DEFAULT_DETAIL = 512;

const graph: PromptGraph = {
  '1': {
    class_type: 'UNETLoader',
    inputs: {
      unet_name: 'krea2_turbo_bf16.safetensors',
      weight_dtype: 'default',
    },
    _meta: { title: 'Load Krea 2 Turbo (diffusion model)' },
  },
  '2': {
    class_type: 'CLIPLoader',
    inputs: {
      clip_name: 'qwen3vl_4b_fp8_scaled.safetensors',
      type: 'krea2',
    },
    _meta: { title: 'Load Qwen3-VL text encoder (type: krea2)' },
  },
  '3': {
    class_type: 'VAELoader',
    inputs: {
      vae_name: 'qwen_image_vae.safetensors',
    },
    _meta: { title: 'Load Qwen Image VAE' },
  },
  '4': {
    class_type: 'LoadImage',
    inputs: {
      image: '',
    },
    _meta: { title: 'Source image' },
  },
  '5': {
    class_type: 'LoadImageMask',
    inputs: {
      image: '',
      channel: 'red',
    },
    _meta: { title: 'Hand-drawn mask (grayscale PNG uploaded by the app)' },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'Positive prompt (content of the painted area)' },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'Negative prompt (used when cfg > 1)' },
  },
  '8': {
    class_type: 'GrowMask',
    inputs: {
      mask: ['5', 0],
      expand: 8,
      tapered_corners: true,
    },
    _meta: { title: 'Grow / shrink the painted area' },
  },
  '9': {
    class_type: 'MaskToSEGS',
    inputs: {
      mask: ['8', 0],
      combined: false,
      crop_factor: 3.0,
      bbox_fill: false,
      drop_size: 10,
      contour_fill: false,
    },
    _meta: { title: 'Painted area → SEGS (one per stroke, cropped with context)' },
  },
  '10': {
    class_type: 'DetailerForEach',
    inputs: {
      image: ['4', 0],
      segs: ['9', 0],
      model: ['1', 0],
      clip: ['2', 0],
      vae: ['3', 0],
      guide_size: DEFAULT_DETAIL,
      guide_size_for: true,
      max_size: DEFAULT_DETAIL * 2,
      seed: 0,
      steps: 8,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      positive: ['6', 0],
      negative: ['7', 0],
      denoise: 0.8,
      feather: 5,
      noise_mask: true,
      force_inpaint: true,
      wildcard: '',
      cycle: 1,
      inpaint_model: false,
      noise_mask_feather: 20,
    },
    _meta: { title: 'Crop, regenerate and paste back the painted area' },
  },
  '11': {
    class_type: 'SaveImage',
    inputs: {
      images: ['10', 0],
      filename_prefix: 'komfy/krea2-draw-replace',
    },
    _meta: { title: 'Save Image' },
  },
};

const detailOption = (size: number): SelectOption => ({
  label: `${size} px`,
  patches: [
    { target: { nodeId: '10', input: 'guide_size' }, value: size },
    { target: { nodeId: '10', input: 'max_size' }, value: size * 2 },
  ],
});

export const krea2DrawReplace: WorkflowManifest = {
  id: 'krea2-draw-replace',
  name: 'wf.drawReplace.name',
  description: 'wf.drawReplace.description',
  icon: 'crop-outline',
  graph,
  saveNodeId: '11',
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.common.sourceImage',
      target: { nodeId: '4', input: 'image' },
      required: true,
    },
    {
      kind: 'mask',
      key: 'mask',
      label: 'wf.drawReplace.mask',
      target: { nodeId: '5', input: 'image' },
      sourceKey: 'image',
      required: true,
      hint: 'wf.drawReplace.maskHint',
    },
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '6', input: 'text' },
      default: '',
      placeholder: 'wf.drawReplace.promptPlaceholder',
      hint: 'wf.drawReplace.promptHint',
      multiline: true,
      required: true,
    },
    {
      kind: 'text',
      key: 'negative',
      label: 'wf.common.negativePrompt',
      target: { nodeId: '7', input: 'text' },
      default: '',
      placeholder: 'wf.common.negativePlaceholder',
      hint: 'wf.common.negativeHint',
      multiline: true,
    },
    {
      kind: 'model',
      key: 'model',
      label: 'wf.common.model',
      hint: 'wf.common.modelHint',
      target: { nodeId: '1', input: 'unet_name' },
      default: 'krea2_turbo_bf16.safetensors',
      filter: 'krea2',
      remember: true,
    },
    {
      kind: 'loras',
      key: 'loras',
      label: 'LoRAs',
      hint: 'wf.common.lorasHint',
      modelSource: { nodeId: '1', output: 0 },
      modelTargets: [{ nodeId: '10', input: 'model' }],
      defaultStrength: 0.9,
    },
    {
      kind: 'number',
      key: 'grow',
      label: 'wf.drawReplace.grow',
      target: { nodeId: '8', input: 'expand' },
      default: 8,
      min: -64,
      max: 64,
      integer: true,
      hint: 'wf.drawReplace.growHint',
    },
    {
      kind: 'number',
      key: 'crop_factor',
      label: 'wf.drawReplace.cropFactor',
      target: { nodeId: '9', input: 'crop_factor' },
      default: 3.0,
      min: 1,
      max: 10,
      hint: 'wf.drawReplace.cropFactorHint',
    },
    {
      kind: 'select',
      key: 'detail',
      label: 'wf.drawReplace.detail',
      hint: 'wf.drawReplace.detailHint',
      defaultIndex: GUIDE_SIZE_OPTIONS.indexOf(DEFAULT_DETAIL),
      options: GUIDE_SIZE_OPTIONS.map(detailOption),
    },
    {
      kind: 'number',
      key: 'denoise',
      label: 'Denoise',
      target: { nodeId: '10', input: 'denoise' },
      default: 0.8,
      min: 0.05,
      max: 1,
      hint: 'wf.drawReplace.denoiseHint',
    },
    {
      kind: 'number',
      key: 'steps',
      label: 'Steps',
      target: { nodeId: '10', input: 'steps' },
      default: 8,
      min: 1,
      max: 50,
      integer: true,
      hint: 'wf.common.turboStepsHint',
    },
    {
      kind: 'number',
      key: 'cfg',
      label: 'CFG',
      target: { nodeId: '10', input: 'cfg' },
      default: 1.0,
      min: 0,
      max: 10,
      hint: 'wf.common.cfgHint',
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '10', input: 'seed' },
    },
  ],
};
