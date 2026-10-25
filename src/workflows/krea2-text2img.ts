/**
 * Text-to-image, locked on KREA2 Turbo. The form offers a single choice,
 * Standard (bf16 UNETLoader, node 1) or GGUF (ComfyUI-GGUF: node 1 swapped
 * in place for an UnetLoaderGGUF, cf. ModelField.ggufLoader), plus prompt,
 * format, LoRAs and seed. The rest (exact model file, negative prompt,
 * sampler settings, CLIP encoder node 2, VAE node 3) sits in the folded
 * advanced settings.
 * Frozen defaults reproduce the original KREA2 Turbo setup (validated
 * against /object_info, ComfyUI 0.27.0): Qwen3-VL text encoder (type krea2),
 * qwen_image VAE, 16-channel SD3 latent, turbo sampler 8 steps / CFG 1.0.
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
    _meta: { title: 'Load diffusion model' },
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
    _meta: { title: 'Positive prompt' },
  },
  '5': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: 'blurry, low quality, cartoon, watermark, text, deformed',
    },
    _meta: { title: 'Negative prompt (used when cfg > 1)' },
  },
  '6': {
    class_type: 'EmptySD3LatentImage',
    inputs: {
      width: 1024,
      height: 1024,
      batch_size: 1,
    },
    _meta: { title: 'Empty latent (16-ch)' },
  },
  '7': {
    class_type: 'KSampler',
    inputs: {
      model: ['1', 0],
      positive: ['4', 0],
      negative: ['5', 0],
      latent_image: ['6', 0],
      seed: 0,
      steps: 8,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1.0,
    },
    _meta: { title: 'Turbo sampler (8 steps, cfg 1)' },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['7', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Decode' },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: {
      images: ['8', 0],
      filename_prefix: 'komfy/krea2-text2img',
    },
    _meta: { title: 'Save Image' },
  },
};

export const krea2Text2Img: WorkflowManifest = {
  id: 'krea2-text2img',
  name: 'wf.t2i.name',
  description: 'wf.t2i.description',
  icon: 'color-wand-outline',
  graph,
  saveNodeId: '9',
  fields: [
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '4', input: 'text' },
      default: '',
      placeholder:
        'a sleek black cat with glowing neon eyes, cyberpunk city at night…',
      multiline: true,
      required: true,
    },
    {
      kind: 'dimensions',
      key: 'format',
      label: 'wf.common.dimensions',
      widthTarget: { nodeId: '6', input: 'width' },
      heightTarget: { nodeId: '6', input: 'height' },
      // Landscape presets ("Invert" for portrait).
      options: [
        { width: 1024, height: 1024 },
        { width: 1216, height: 832 },
        { width: 1344, height: 896 },
        { width: 1536, height: 1024 },
        { width: 1664, height: 960 },
        // 1728×972 requested, rounded to the nearest multiple of 8 → 976.
        { width: 1728, height: 976 },
        { width: 1792, height: 1008 },
        { width: 1920, height: 1080 },
      ],
      default: { width: 1024, height: 1024 },
    },
    // KREA2 only, in two variants (bf16 or GGUF): a Standard / GGUF switch,
    // the exact file in the advanced settings.
    {
      kind: 'model',
      key: 'unet',
      label: 'wf.common.model',
      hint: 'wf.t2i.variantHint',
      target: { nodeId: '1', input: 'unet_name' },
      default: 'krea2_turbo_bf16.safetensors',
      filter: 'krea-?2',
      remember: true,
      ggufLoader: true,
      variantSwitch: true,
    },
    {
      kind: 'loras',
      key: 'loras',
      label: 'LoRAs',
      hint: 'wf.common.lorasHint',
      modelSource: { nodeId: '1', output: 0 },
      modelTargets: [{ nodeId: '7', input: 'model' }],
      defaultStrength: 0.9,
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '7', input: 'seed' },
    },
    // Advanced settings: tuned for the Turbo sampler, folded by default.
    {
      kind: 'text',
      key: 'negative',
      label: 'wf.common.negativePrompt',
      target: { nodeId: '5', input: 'text' },
      default: 'blurry, low quality, cartoon, watermark, text, deformed',
      placeholder: 'wf.common.negativePlaceholder',
      hint: 'wf.common.negativeHint',
      multiline: true,
      advanced: true,
    },
    {
      kind: 'number',
      key: 'steps',
      label: 'Steps',
      target: { nodeId: '7', input: 'steps' },
      default: 8,
      min: 1,
      max: 60,
      integer: true,
      hint: 'wf.common.stepsHint',
      advanced: true,
    },
    {
      kind: 'number',
      key: 'cfg',
      label: 'CFG',
      target: { nodeId: '7', input: 'cfg' },
      default: 1.0,
      min: 0,
      max: 20,
      hint: 'wf.common.cfgHint',
      advanced: true,
    },
    // Sampler & scheduler: the `model` field is a server-driven single-select
    // over a node-input enum, reused here for the KSampler enums (no hardcoded
    // list in the repo, the server's /object_info is the source of truth).
    {
      kind: 'model',
      key: 'sampler',
      label: 'Sampler',
      hint: 'wf.common.samplerHint',
      target: { nodeId: '7', input: 'sampler_name' },
      default: 'euler',
      remember: true,
      advanced: true,
    },
    {
      kind: 'model',
      key: 'scheduler',
      label: 'Scheduler',
      target: { nodeId: '7', input: 'scheduler' },
      default: 'simple',
      remember: true,
      advanced: true,
    },
    // KREA2 companions: the CLIPLoader type stays frozen on `krea2`.
    {
      kind: 'model',
      key: 'clip',
      label: 'wf.t2i.clip',
      hint: 'wf.t2i.clipHint',
      target: { nodeId: '2', input: 'clip_name' },
      default: 'qwen3vl_4b_fp8_scaled.safetensors',
      filter: 'qwen3',
      remember: true,
      advanced: true,
    },
    {
      kind: 'model',
      key: 'vae',
      label: 'wf.t2i.vae',
      hint: 'wf.t2i.vaeHint',
      target: { nodeId: '3', input: 'vae_name' },
      default: 'qwen_image_vae.safetensors',
      filter: 'qwen',
      remember: true,
      advanced: true,
    },
  ],
};
