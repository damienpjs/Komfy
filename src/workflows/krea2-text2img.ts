/**
 * Generalist text-to-image. The user picks any model via the `modelSource`
 * field: a checkpoint (self-contained MODEL/CLIP/VAE — a CheckpointLoaderSimple
 * is spliced in at patch time) or a diffusion model (UNETLoader, node 1 — with
 * its own CLIP encoder + VAE, nodes 2 & 3). At patch time the graph is rewired
 * to the chosen loader and the unused ones dropped (cf. insertModelSource); the
 * latent (node 6) switches to 4-channel for a checkpoint.
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
      kind: 'text',
      key: 'negative',
      label: 'wf.common.negativePrompt',
      target: { nodeId: '5', input: 'text' },
      default: 'blurry, low quality, cartoon, watermark, text, deformed',
      placeholder: 'wf.common.negativePlaceholder',
      hint: 'wf.common.negativeHint',
      multiline: true,
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
    {
      kind: 'modelSource',
      key: 'model',
      label: 'wf.common.model',
      hint: 'wf.modelSource.hint',
      checkpointNodeId: 'komfy_checkpoint',
      unetNodeId: '1',
      clipNodeId: '2',
      vaeNodeId: '3',
      latentNodeId: '6',
      modelTargets: [{ nodeId: '7', input: 'model' }],
      clipTargets: [
        { nodeId: '4', input: 'clip' },
        { nodeId: '5', input: 'clip' },
      ],
      vaeTargets: [{ nodeId: '8', input: 'vae' }],
      defaultUnet: 'krea2_turbo_bf16.safetensors',
      defaultClip: 'qwen3vl_4b_fp8_scaled.safetensors',
      defaultClipType: 'krea2',
      defaultVae: 'qwen_image_vae.safetensors',
      defaultCheckpoint: '',
      remember: true,
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
      kind: 'number',
      key: 'steps',
      label: 'Steps',
      target: { nodeId: '7', input: 'steps' },
      default: 8,
      min: 1,
      max: 60,
      integer: true,
      hint: 'wf.common.stepsHint',
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
    },
    // Sampler & scheduler: the `model` field is a server-driven single-select
    // over a node-input enum — reused here for the KSampler enums (no hardcoded
    // list in the repo, the server's /object_info is the source of truth).
    {
      kind: 'model',
      key: 'sampler',
      label: 'Sampler',
      hint: 'wf.common.samplerHint',
      target: { nodeId: '7', input: 'sampler_name' },
      default: 'euler',
      remember: true,
    },
    {
      kind: 'model',
      key: 'scheduler',
      label: 'Scheduler',
      target: { nodeId: '7', input: 'scheduler' },
      default: 'simple',
      remember: true,
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '7', input: 'seed' },
    },
  ],
};
