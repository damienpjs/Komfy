/**
 * KREA2 Turbo — upscale, in two modes picked by the `mode` field.
 *
 * "Sans diffusion" (nodes 10 → 11): the pixel upscaler alone, then a lanczos
 * resample to a fraction of its native scale. No latent round-trip at all, so
 * the result is deterministic and cannot drift — but ESRGAN only sharpens what
 * is already there, it invents no texture (and amplifies JPEG artefacts).
 *
 * "Génératif" (node 8, the historical behaviour, untouched):
 * LoadImage → UltimateSDUpscale: the pixel upscaler (4x-UltraSharp)
 * enlarges the image, then KREA2 refines it tile by tile at low denoise
 * (0.2) — enough to synthesize real texture, too little to restructure
 * anything, so faces keep their identity. cfg 1.0 (negative unused) also
 * means no prompt drift on the tiles. Tiled processing keeps the memory
 * cost per pass at one ~1024² latent whatever the output size — sized for
 * the M3 Max (64 GB unified memory).
 * Validated against /object_info: UltimateSDUpscale (mode Linear, seam fix
 * None), UpscaleModelLoader {4x-UltraSharp.pth, ESRGAN_4x.pth}, same
 * loaders as the t2i (krea2_turbo_bf16, Qwen3-VL type krea2, qwen VAE).
 */

import type { PromptGraph } from '../api/types';
import type { WorkflowManifest } from './types';

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
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'Positive prompt (optional detail guidance)' },
  },
  '5': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'Negative prompt (unused at cfg 1)' },
  },
  '6': {
    class_type: 'LoadImage',
    inputs: {
      image: '',
    },
    _meta: { title: 'Image to upscale' },
  },
  '7': {
    class_type: 'UpscaleModelLoader',
    inputs: {
      model_name: '4x-UltraSharp.pth',
    },
    _meta: { title: 'Load pixel upscaler' },
  },
  '8': {
    class_type: 'UltimateSDUpscale',
    inputs: {
      image: ['6', 0],
      model: ['1', 0],
      positive: ['4', 0],
      negative: ['5', 0],
      vae: ['3', 0],
      upscale_by: 2,
      seed: 0,
      steps: 8,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 0.2,
      upscale_model: ['7', 0],
      mode_type: 'Linear',
      tile_width: 1024,
      tile_height: 1024,
      mask_blur: 8,
      tile_padding: 32,
      seam_fix_mode: 'None',
      seam_fix_denoise: 1.0,
      seam_fix_width: 64,
      seam_fix_mask_blur: 8,
      seam_fix_padding: 16,
      force_uniform_tiles: true,
      tiled_decode: false,
      batch_size: 1,
    },
    _meta: { title: 'Ultimate SD Upscale (tiled, low denoise)' },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: {
      images: ['8', 0],
      filename_prefix: 'komfy/krea2-upscale',
    },
    _meta: { title: 'Save Image' },
  },
  // Non-generative branch (mode "sans diffusion"): the pixel upscaler alone,
  // then a plain resample. Deterministic — no latent, no seed, no prompt, so
  // no identity drift by construction. Bypassed in generative mode, where
  // UltimateSDUpscale drives the same upscale model itself.
  '10': {
    class_type: 'ImageUpscaleWithModel',
    inputs: {
      upscale_model: ['7', 0],
      image: ['6', 0],
    },
    _meta: { title: 'Pixel upscale (model native scale)' },
  },
  // The upscale model has a fixed scale (×4 for UltraSharp, ×2 for
  // RealESRGAN_x2plus) and /object_info does not expose it, so the factor is
  // expressed as a FRACTION of that native scale — correct whatever model the
  // upscaler field picks. scale_by 1.0 = raw model output, no resampling.
  '11': {
    class_type: 'ImageScaleBy',
    inputs: {
      image: ['10', 0],
      upscale_method: 'lanczos',
      scale_by: 0.5,
    },
    _meta: { title: 'Fraction of the native scale' },
  },
};

/**
 * Output size in "sans diffusion" mode, as a fraction of the upscale model's
 * own scale — the only model-independent way to express it (cf. node 11).
 */
const scaleOption = (label: string, scale: number) => ({
  label,
  patches: [{ target: { nodeId: '11', input: 'scale_by' }, value: scale }],
});

const tileOption = (size: number) => ({
  label: `${size} px`,
  patches: [
    { target: { nodeId: '8', input: 'tile_width' }, value: size },
    { target: { nodeId: '8', input: 'tile_height' }, value: size },
  ],
});

export const krea2Upscale: WorkflowManifest = {
  id: 'krea2-upscale',
  name: 'wf.upscale.name',
  description: 'wf.upscale.description',
  icon: 'expand-outline',
  graph,
  saveNodeId: '9',
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.common.sourceImage',
      target: { nodeId: '6', input: 'image' },
      required: true,
    },
    // Mode switch. Ordered right after the image so it reads first, which is
    // why patch.ts guards the seed/select/loras patches against the node this
    // option removes — the fields below still target node 8 when it is gone.
    {
      kind: 'select',
      key: 'mode',
      label: 'wf.upscale.mode',
      hint: 'wf.upscale.modeHint',
      defaultIndex: 0,
      remember: true,
      options: [
        // Historical behaviour: node 8 does everything, the pixel branch is dropped.
        { label: 'wf.upscale.modeGenerative', patches: [], bypassNodes: ['10', '11'] },
        // Pure pixel: the sink reads the resample, and the whole diffusion side
        // goes — the sampler AND the loaders/encoders that only fed it. Leaving
        // them dangling would cost nothing at run time (ComfyUI executes
        // backwards from the outputs) but it would make the prompt ambiguous to
        // remix: two orphaned CLIPTextEncode with no way to tell them apart.
        {
          label: 'wf.upscale.modePixel',
          patches: [{ target: { nodeId: '9', input: 'images' }, value: ['11', 0] }],
          bypassNodes: ['8', '1', '2', '3', '4', '5'],
        },
      ],
    },
    {
      kind: 'number',
      key: 'upscale_by',
      label: 'wf.upscale.factor',
      target: { nodeId: '8', input: 'upscale_by' },
      default: 2,
      min: 1,
      max: 4,
      hint: 'wf.upscale.factorHint',
      showWhen: { key: 'mode', equals: 0 },
    },
    {
      kind: 'select',
      key: 'native_scale',
      label: 'wf.upscale.factor',
      hint: 'wf.upscale.nativeScaleHint',
      defaultIndex: 2,
      remember: true,
      showWhen: { key: 'mode', equals: 1 },
      options: [
        scaleOption('wf.upscale.scaleNative', 1),
        scaleOption('wf.upscale.scaleThreeQuarters', 0.75),
        scaleOption('wf.upscale.scaleHalf', 0.5),
      ],
    },
    {
      kind: 'number',
      key: 'denoise',
      label: 'Denoise',
      target: { nodeId: '8', input: 'denoise' },
      default: 0.2,
      min: 0.05,
      max: 0.5,
      hint: 'wf.upscale.denoiseHint',
      showWhen: { key: 'mode', equals: 0 },
    },
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '4', input: 'text' },
      default: '',
      placeholder: 'wf.upscale.promptPlaceholder',
      multiline: true,
      hint: 'wf.upscale.promptHint',
      showWhen: { key: 'mode', equals: 0 },
    },
    {
      kind: 'text',
      key: 'negative',
      label: 'wf.common.negativePrompt',
      target: { nodeId: '5', input: 'text' },
      default: '',
      placeholder: 'wf.common.negativePlaceholder',
      hint: 'wf.common.negativeHint',
      multiline: true,
      showWhen: { key: 'mode', equals: 0 },
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
      showWhen: { key: 'mode', equals: 0 },
    },
    {
      kind: 'model',
      key: 'upscaler',
      label: 'wf.upscale.upscaler',
      hint: 'wf.upscale.upscalerHint',
      target: { nodeId: '7', input: 'model_name' },
      default: '4x-UltraSharp.pth',
      remember: true,
    },
    {
      kind: 'loras',
      key: 'loras',
      label: 'LoRAs',
      hint: 'wf.common.lorasHint',
      modelSource: { nodeId: '1', output: 0 },
      modelTargets: [{ nodeId: '8', input: 'model' }],
      defaultStrength: 0.9,
      showWhen: { key: 'mode', equals: 0 },
    },
    {
      kind: 'number',
      key: 'steps',
      label: 'Steps',
      target: { nodeId: '8', input: 'steps' },
      default: 8,
      min: 1,
      max: 30,
      integer: true,
      hint: 'wf.common.turboStepsHint',
      showWhen: { key: 'mode', equals: 0 },
    },
    {
      kind: 'select',
      key: 'tile_size',
      label: 'wf.upscale.tileSize',
      hint: 'wf.upscale.tileSizeHint',
      defaultIndex: 1,
      remember: true,
      showWhen: { key: 'mode', equals: 0 },
      options: [768, 1024, 1280].map(tileOption),
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '8', input: 'seed' },
      showWhen: { key: 'mode', equals: 0 },
    },
  ],
};
