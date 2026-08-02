/**
 * KREA2 Turbo — image-to-image.
 * LoadImage → VAEEncode → KSampler (partial denoise) → VAEDecode → Save.
 * Same loaders as the t2i (UNETLoader krea2_turbo_bf16, Qwen3-VL type
 * krea2, qwen_image VAE — validated against /object_info). Denoise, steps,
 * sampler and scheduler configurable; LoRAs chained on the model.
 */

import type { PromptGraph } from '../api/types';
import type { SelectOption, WorkflowManifest } from './types';

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
    _meta: { title: 'Positive prompt' },
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
    _meta: { title: 'Image source' },
  },
  '7': {
    class_type: 'VAEEncode',
    inputs: {
      pixels: ['6', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Encode (image → latent)' },
  },
  '8': {
    class_type: 'KSampler',
    inputs: {
      model: ['1', 0],
      positive: ['4', 0],
      negative: ['5', 0],
      latent_image: ['7', 0],
      seed: 0,
      steps: 8,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 0.6,
    },
    _meta: { title: 'Turbo sampler (denoise partiel)' },
  },
  '9': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['8', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Decode' },
  },
  '10': {
    class_type: 'SaveImage',
    inputs: {
      images: ['9', 0],
      filename_prefix: 'komfy/krea2-img2img',
    },
    _meta: { title: 'Save Image' },
  },
};

// Enums checked against /object_info/KSampler (curated to the most useful).
const samplerOption = (name: string): SelectOption => ({
  label: name,
  patches: [{ target: { nodeId: '8', input: 'sampler_name' }, value: name }],
});
const schedulerOption = (name: string): SelectOption => ({
  label: name,
  patches: [{ target: { nodeId: '8', input: 'scheduler' }, value: name }],
});

export const krea2Img2Img: WorkflowManifest = {
  id: 'krea2-img2img',
  name: 'wf.i2i.name',
  description: 'wf.i2i.description',
  icon: 'images-outline',
  graph,
  saveNodeId: '10',
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.common.sourceImage',
      target: { nodeId: '6', input: 'image' },
      required: true,
    },
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '4', input: 'text' },
      default: '',
      placeholder: 'wf.i2i.promptPlaceholder',
      multiline: true,
      required: true,
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
      modelSource: { nodeId: '1', output: 0 },
      modelTargets: [{ nodeId: '8', input: 'model' }],
      defaultStrength: 0.9,
    },
    {
      kind: 'number',
      key: 'denoise',
      label: 'Denoise',
      target: { nodeId: '8', input: 'denoise' },
      default: 0.6,
      min: 0.05,
      max: 1,
      hint: 'wf.i2i.denoiseHint',
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
    },
    {
      kind: 'select',
      key: 'sampler',
      label: 'Sampler',
      defaultIndex: 0,
      options: [
        'euler',
        'euler_ancestral',
        'dpmpp_2m',
        'dpmpp_2m_sde',
        'dpmpp_sde',
        'uni_pc',
        'ddim',
        'lcm',
        'res_multistep',
      ].map(samplerOption),
    },
    {
      kind: 'select',
      key: 'scheduler',
      label: 'Scheduler',
      defaultIndex: 0,
      options: [
        'simple',
        'normal',
        'karras',
        'exponential',
        'sgm_uniform',
        'beta',
        'kl_optimal',
      ].map(schedulerOption),
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '8', input: 'seed' },
    },
  ],
};
