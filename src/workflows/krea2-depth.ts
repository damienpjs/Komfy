/**
 * KREA2 Turbo — ControlNet Depth.
 * LoadImage → DepthAnythingV2Preprocessor → Krea2ControlImageEncode →
 * Krea2ControlApply: the sampler follows the depth structure of the source
 * photo while the prompt drives the content. Same loaders as the t2i, plus
 * the krea2/depth-control-lora chained on the model (Krea2ControlLoRALoader).
 * Validated against /object_info (custom_nodes.comfyui-krea2-controlnet and
 * comfyui_controlnet_aux): channel_mode ∈ {rgb, grayscale}, resolution
 * multiples of 64. The /object_info enum also lists depth_anything_v2_vitg,
 * but that checkpoint was never publicly released (HF returns 401 and the
 * node 404s at runtime) — only vits/vitb/vitl are offered.
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
      clip_name: 'qwen3vl_4b_bf16.safetensors',
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
    class_type: 'Krea2ControlLoRALoader',
    inputs: {
      model: ['1', 0],
      lora_name: 'krea2/depth-control-lora.safetensors',
      strength: 0.98,
    },
    _meta: { title: 'Depth control LoRA' },
  },
  '5': {
    class_type: 'LoadImage',
    inputs: {
      image: '',
    },
    _meta: { title: 'Structure source image' },
  },
  '6': {
    class_type: 'DepthAnythingV2Preprocessor',
    inputs: {
      image: ['5', 0],
      ckpt_name: 'depth_anything_v2_vits.pth',
      resolution: 1024,
    },
    _meta: { title: 'Depth Anything V2 (depth map)' },
  },
  '7': {
    class_type: 'EmptySD3LatentImage',
    inputs: {
      width: 1024,
      height: 1024,
      batch_size: 1,
    },
    _meta: { title: 'Empty latent (16-ch)' },
  },
  '8': {
    class_type: 'Krea2ControlImageEncode',
    inputs: {
      control_image: ['6', 0],
      vae: ['3', 0],
      latent: ['7', 0],
      resize: 'match_latent_size',
      upscale_method: 'lanczos',
      crop: 'center',
      channel_mode: 'grayscale',
      normalize: 'per_image_minmax',
      invert: false,
      batch_mode: 'independent_images',
    },
    _meta: { title: 'Encode depth map → control latent' },
  },
  '9': {
    class_type: 'Krea2ControlApply',
    inputs: {
      model: ['4', 0],
      control_latent: ['8', 0],
    },
    _meta: { title: 'Apply depth control' },
  },
  '10': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'Positive prompt' },
  },
  '11': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: 'blurry, plastic skin, oversaturated, deformed',
    },
    _meta: { title: 'Negative prompt (unused at cfg 1)' },
  },
  '12': {
    class_type: 'KSampler',
    inputs: {
      model: ['9', 0],
      positive: ['10', 0],
      negative: ['11', 0],
      latent_image: ['7', 0],
      seed: 0,
      steps: 8,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1.0,
    },
    _meta: { title: 'Turbo sampler (8 steps, cfg 1)' },
  },
  '13': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['12', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Decode' },
  },
  '14': {
    class_type: 'SaveImage',
    inputs: {
      images: ['13', 0],
      filename_prefix: 'komfy/krea2-depth',
    },
    _meta: { title: 'Save Image' },
  },
};

// Enums checked against /object_info/Krea2ControlImageEncode.
const channelModeOption = (key: string, value: string): SelectOption => ({
  label: key,
  patches: [{ target: { nodeId: '8', input: 'channel_mode' }, value }],
});

// Multiples of 64 (server constraint) — the map is re-cropped to the latent.
const depthResolutionOption = (value: number): SelectOption => ({
  label: `${value} px`,
  patches: [{ target: { nodeId: '6', input: 'resolution' }, value }],
});

// Enum checked against /object_info/DepthAnythingV2Preprocessor.
const depthModelOption = (key: string, file: string): SelectOption => ({
  label: key,
  patches: [{ target: { nodeId: '6', input: 'ckpt_name' }, value: file }],
});

export const krea2Depth: WorkflowManifest = {
  id: 'krea2-depth',
  name: 'wf.depth.name',
  description: 'wf.depth.description',
  icon: 'layers-outline',
  graph,
  saveNodeId: '14',
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.common.sourceImage',
      hint: 'wf.depth.imageHint',
      target: { nodeId: '5', input: 'image' },
      required: true,
    },
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '10', input: 'text' },
      default: '',
      placeholder: 'wf.depth.promptPlaceholder',
      multiline: true,
      required: true,
    },
    {
      kind: 'text',
      key: 'negative',
      label: 'wf.common.negativePrompt',
      target: { nodeId: '11', input: 'text' },
      default: 'blurry, plastic skin, oversaturated, deformed',
      placeholder: 'wf.common.negativePlaceholder',
      hint: 'wf.common.negativeHint',
      multiline: true,
    },
    {
      kind: 'select',
      key: 'channelMode',
      label: 'wf.depth.channelMode',
      hint: 'wf.depth.channelModeHint',
      defaultIndex: 0,
      remember: true,
      options: [
        channelModeOption('wf.depth.modeGrayscale', 'grayscale'),
        channelModeOption('wf.depth.modeRgb', 'rgb'),
      ],
    },
    {
      kind: 'number',
      key: 'strength',
      label: 'wf.depth.strength',
      hint: 'wf.depth.strengthHint',
      target: { nodeId: '4', input: 'strength' },
      default: 0.98,
      min: 0,
      max: 2,
    },
    {
      kind: 'select',
      key: 'depthModel',
      label: 'wf.depth.depthModel',
      hint: 'wf.depth.depthModelHint',
      defaultIndex: 0,
      remember: true,
      options: [
        depthModelOption('wf.depth.vits', 'depth_anything_v2_vits.pth'),
        depthModelOption('wf.depth.vitb', 'depth_anything_v2_vitb.pth'),
        depthModelOption('wf.depth.vitl', 'depth_anything_v2_vitl.pth'),
      ],
    },
    {
      kind: 'select',
      key: 'depthResolution',
      label: 'wf.depth.depthResolution',
      hint: 'wf.depth.depthResolutionHint',
      defaultIndex: 2,
      remember: true,
      options: [512, 768, 1024, 1536].map(depthResolutionOption),
    },
    {
      kind: 'dimensions',
      key: 'format',
      label: 'wf.common.dimensions',
      hint: 'wf.depth.dimensionsHint',
      widthTarget: { nodeId: '7', input: 'width' },
      heightTarget: { nodeId: '7', input: 'height' },
      // Landscape presets ("Invert" for portrait) — same list as the t2i.
      options: [
        { width: 1024, height: 1024 },
        { width: 1216, height: 832 },
        { width: 1344, height: 896 },
        { width: 1344, height: 1216 },
        { width: 1536, height: 1024 },
        { width: 1664, height: 960 },
        { width: 1792, height: 1008 },
        { width: 1920, height: 1080 },
      ],
      default: { width: 1024, height: 1024 },
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
      modelTargets: [{ nodeId: '4', input: 'model' }],
      defaultStrength: 0.9,
    },
    {
      kind: 'number',
      key: 'steps',
      label: 'Steps',
      target: { nodeId: '12', input: 'steps' },
      default: 8,
      min: 1,
      max: 30,
      integer: true,
      hint: 'wf.common.turboStepsHint',
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '12', input: 'seed' },
    },
  ],
};
