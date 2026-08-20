/**
 * Inpaint on a hand-drawn mask — model-agnostic.
 *
 * LoadImage + LoadImageMask (the mask the user painted with a finger,
 * uploaded as a PNG by the `mask` field) → GrowMask → gaussian blur →
 * optional inversion → the sampler only touches the painted area.
 *
 * Nothing here is tied to a model family or to an automatic detector: the
 * area comes from the user's finger, and the model comes from the generic
 * `modelSource` picker (any checkpoint, or any diffusion model + CLIP + VAE
 * installed on the server).
 *
 * Two ways to confine the sampling, picked by the `maskMode` select:
 *  - `SetLatentNoiseMask` (default): noise is limited to the mask, the rest
 *    of the latent is preserved. Works with every model, and `denoise` sets
 *    how much of the masked area is rewritten.
 *  - `InpaintModelConditioning`: the mask is baked into the conditioning
 *    instead. Blends edges better and is what inpaint-tuned models expect,
 *    but a model without inpainting support can react badly to it — hence
 *    the noise mask as default.
 *
 * Each option drops the other's nodes (`bypassNodes`). The default shape is
 * the frozen one, so it remixes; an image rendered in conditioning mode does
 * NOT match back (the sampler reads its latent and conditioning from a node
 * the manifest has elsewhere in the chain, which no `bypassNodes` tolerance
 * can bridge). That image stays perfectly usable — it simply won't pre-fill
 * the form on remix.
 *
 * `DifferentialDiffusion` sits on the model unconditionally: it turns the
 * blurred mask edge into a per-step denoise ramp, which is exactly what
 * makes a feathered hand-drawn boundary blend instead of showing a seam.
 * It is a no-op on a hard-edged mask, so it costs nothing when feather = 0.
 *
 * The inversion goes through an ImpactSwitch on a literal `select` rather
 * than a rewire: remix matching compares connections structurally (cf.
 * match.ts), and a literal stays recoverable by the select.
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
    _meta: { title: 'Diffusion model (or a checkpoint, cf. model source)' },
  },
  '2': {
    class_type: 'CLIPLoader',
    inputs: {
      clip_name: 'qwen3vl_4b_fp8_scaled.safetensors',
      type: 'krea2',
    },
    _meta: { title: 'Text encoder' },
  },
  '3': {
    class_type: 'VAELoader',
    inputs: {
      vae_name: 'qwen_image_vae.safetensors',
    },
    _meta: { title: 'VAE' },
  },
  '4': {
    class_type: 'LoadImage',
    inputs: {
      image: '',
    },
    _meta: { title: 'Image source' },
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
    _meta: { title: 'Negative prompt' },
  },
  '8': {
    class_type: 'GrowMask',
    inputs: {
      mask: ['5', 0],
      expand: 0,
      tapered_corners: true,
    },
    _meta: { title: 'Grow / shrink the painted area' },
  },
  '9': {
    class_type: 'ImpactGaussianBlurMask',
    inputs: {
      mask: ['8', 0],
      kernel_size: 12,
      sigma: 12.0,
    },
    _meta: { title: 'Softened mask edges (feather)' },
  },
  '10': {
    class_type: 'InvertMask',
    inputs: {
      mask: ['9', 0],
    },
    _meta: { title: 'Inverted mask (preserve mode)' },
  },
  '11': {
    class_type: 'ImpactSwitch',
    inputs: {
      select: 1,
      sel_mode: false,
      input1: ['9', 0],
      input2: ['10', 0],
    },
    _meta: { title: 'Area: 1 = repaint the drawing · 2 = preserve it' },
  },
  '12': {
    class_type: 'VAEEncode',
    inputs: {
      pixels: ['4', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Encode (image → latent)' },
  },
  '13': {
    class_type: 'SetLatentNoiseMask',
    inputs: {
      samples: ['12', 0],
      mask: ['11', 0],
    },
    _meta: { title: 'Noise limited to the mask' },
  },
  '14': {
    class_type: 'InpaintModelConditioning',
    inputs: {
      positive: ['6', 0],
      negative: ['7', 0],
      vae: ['3', 0],
      pixels: ['4', 0],
      mask: ['11', 0],
      noise_mask: true,
    },
    _meta: { title: 'Inpaint conditioning (alternative to the noise mask)' },
  },
  '15': {
    class_type: 'DifferentialDiffusion',
    inputs: {
      model: ['1', 0],
    },
    _meta: { title: 'Differential diffusion (soft mask edges)' },
  },
  '16': {
    class_type: 'KSampler',
    inputs: {
      model: ['15', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['13', 0],
      seed: 0,
      steps: 20,
      cfg: 7.0,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1.0,
    },
    _meta: { title: 'Sampler (inpaint)' },
  },
  '17': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['16', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Decode' },
  },
  '18': {
    class_type: 'SaveImage',
    inputs: {
      images: ['17', 0],
      filename_prefix: 'komfy/inpaint-draw',
    },
    _meta: { title: 'Save Image' },
  },
};

// Enums checked against /object_info/KSampler (same curation as img2img).
const samplerOption = (name: string): SelectOption => ({
  label: name,
  patches: [{ target: { nodeId: '16', input: 'sampler_name' }, value: name }],
});
const schedulerOption = (name: string): SelectOption => ({
  label: name,
  patches: [{ target: { nodeId: '16', input: 'scheduler' }, value: name }],
});

export const inpaintDraw: WorkflowManifest = {
  id: 'inpaint-draw',
  name: 'wf.inpaintDraw.name',
  description: 'wf.inpaintDraw.description',
  icon: 'brush-outline',
  graph,
  saveNodeId: '18',
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
      label: 'wf.inpaintDraw.mask',
      target: { nodeId: '5', input: 'image' },
      sourceKey: 'image',
      required: true,
      hint: 'wf.inpaintDraw.maskHint',
    },
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '6', input: 'text' },
      default: '',
      placeholder: 'wf.inpaintDraw.promptPlaceholder',
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
    // Must precede `loras`: the chain reads the MODEL connection this leaves
    // on the DifferentialDiffusion input (cf. insertLoraChain).
    {
      kind: 'modelSource',
      key: 'model',
      label: 'wf.common.model',
      hint: 'wf.modelSource.hint',
      checkpointNodeId: 'komfy_checkpoint',
      unetNodeId: '1',
      clipNodeId: '2',
      vaeNodeId: '3',
      // No latentNodeId: the latent comes from VAEEncode, which takes its
      // channel count from the VAE — nothing to swap in checkpoint mode.
      modelTargets: [{ nodeId: '15', input: 'model' }],
      clipTargets: [
        { nodeId: '6', input: 'clip' },
        { nodeId: '7', input: 'clip' },
      ],
      vaeTargets: [
        { nodeId: '12', input: 'vae' },
        { nodeId: '14', input: 'vae' },
        { nodeId: '17', input: 'vae' },
      ],
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
      modelSource: { nodeId: '1', output: 0 },
      modelTargets: [{ nodeId: '15', input: 'model' }],
      defaultStrength: 0.9,
    },
    {
      kind: 'select',
      key: 'maskMode',
      label: 'wf.inpaintDraw.maskMode',
      defaultIndex: 0,
      hint: 'wf.inpaintDraw.maskModeHint',
      options: [
        {
          // Frozen wiring: nothing to rewire, only the unused branch to drop.
          label: 'wf.inpaintDraw.maskModeNoise',
          patches: [],
          bypassNodes: ['14'],
        },
        {
          label: 'wf.inpaintDraw.maskModeConditioning',
          patches: [
            { target: { nodeId: '16', input: 'positive' }, value: ['14', 0] },
            { target: { nodeId: '16', input: 'negative' }, value: ['14', 1] },
            { target: { nodeId: '16', input: 'latent_image' }, value: ['14', 2] },
          ],
          bypassNodes: ['12', '13'],
        },
      ],
    },
    {
      kind: 'select',
      key: 'area',
      label: 'wf.inpaintDraw.area',
      defaultIndex: 0,
      hint: 'wf.inpaintDraw.areaHint',
      options: [
        {
          label: 'wf.inpaintDraw.areaRepaint',
          patches: [{ target: { nodeId: '11', input: 'select' }, value: 1 }],
        },
        {
          label: 'wf.inpaintDraw.areaPreserve',
          patches: [{ target: { nodeId: '11', input: 'select' }, value: 2 }],
        },
      ],
    },
    {
      kind: 'number',
      key: 'grow',
      label: 'wf.inpaintDraw.grow',
      target: { nodeId: '8', input: 'expand' },
      default: 0,
      min: -64,
      max: 64,
      integer: true,
      hint: 'wf.inpaintDraw.growHint',
    },
    {
      kind: 'number',
      key: 'feather',
      label: 'wf.inpaintDraw.feather',
      target: { nodeId: '9', input: 'kernel_size' },
      default: 12,
      min: 0,
      max: 100,
      integer: true,
      hint: 'wf.inpaintDraw.featherHint',
    },
    {
      kind: 'number',
      key: 'denoise',
      label: 'Denoise',
      target: { nodeId: '16', input: 'denoise' },
      default: 1.0,
      min: 0.05,
      max: 1,
      hint: 'wf.inpaintDraw.denoiseHint',
    },
    {
      kind: 'number',
      key: 'steps',
      label: 'Steps',
      target: { nodeId: '16', input: 'steps' },
      default: 20,
      min: 1,
      max: 100,
      integer: true,
    },
    {
      kind: 'number',
      key: 'cfg',
      label: 'CFG',
      target: { nodeId: '16', input: 'cfg' },
      default: 7.0,
      min: 0,
      max: 30,
      hint: 'wf.inpaintDraw.cfgHint',
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
        'normal',
        'simple',
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
      target: { nodeId: '16', input: 'seed' },
    },
  ],
};
