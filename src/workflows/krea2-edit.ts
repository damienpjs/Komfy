/**
 * KREA2 Edit — instruction-driven edit of a source image.
 *
 * The source is not repainted through a mask: it is fed to the model as a
 * reference (Krea2EditModelPatch) while the prompt describes the change to
 * make ("her hand rests on the leg, nothing else moves"), grounded on the
 * image itself by Krea2EditGroundedEncode. The sampler then draws the whole
 * output canvas from scratch — hence the separate empty latent (node 8),
 * which defines the OUTPUT format, while the source only has to be fitted
 * into it (`fit_mode: fit`).
 *
 * Two VAEs on purpose, as in the reference graph: qwen_image encodes the
 * source (the model's native latent space), krea2RealVae decodes the result
 * (cleaner skin).
 *
 * The identity-edit LoRA is what makes the edit preserve the subject, so it
 * is not a choice: the `loras` field carries it as a `fixed` entry, always
 * applied at the head of the chain, never shown as removable. The LoRAs the
 * user adds are chained after it (LoraLoaderModelOnly, cf. insertLoraChain).
 *
 * Output canvas — node 14 (ImageResizeKJv2) sizes it from the source image
 * itself, and its `width`/`height` INT outputs drive the empty latent:
 *  - "Source": the source dimensions, floored to a multiple of 16 (the
 *    reference behavior — the output keeps the source frame exactly);
 *  - "1 MP"/"2 MP": the source ASPECT RATIO at that pixel budget, for a
 *    photo too large to generate at native size;
 *  - "Manual": the dimensions typed in the form (the node then only passes
 *    them through — `stretch` keeps width/height as given).
 * Only the node's two INT outputs are used; its resized IMAGE goes nowhere,
 * which is why the cheapest upscale method is enough. The wiring is the SAME
 * in every mode (no rewire, no bypass), so a render remixes back whichever
 * mode produced it.
 */

import type { PromptGraph } from '../api/types';
import type { SelectOption, WorkflowManifest } from './types';

/** LoRA the edit is built around — applied first, not user-editable. */
const IDENTITY_LORA = 'krea2/krea2_identity_edit_v1_2.safetensors';

const graph: PromptGraph = {
  '1': {
    class_type: 'UNETLoader',
    inputs: {
      unet_name: 'krea2_turbo_bf16.safetensors',
      weight_dtype: 'default',
    },
    _meta: { title: 'Load Krea 2 Turbo (diffusion model)' },
  },
  '3': {
    class_type: 'CLIPLoader',
    inputs: {
      clip_name: 'qwen3vl_4b_fp8_scaled.safetensors',
      type: 'krea2',
    },
    _meta: { title: 'Load Qwen3-VL text encoder (type: krea2)' },
  },
  '4': {
    class_type: 'VAELoader',
    inputs: {
      vae_name: 'qwen_image_vae.safetensors',
    },
    _meta: { title: 'VAE ENCODE — qwen_image (source)' },
  },
  '5': {
    class_type: 'VAELoader',
    inputs: {
      vae_name: 'krea2RealVae_bf16.safetensors',
    },
    _meta: { title: 'VAE DECODE — Krea 2 Real (clean skin)' },
  },
  '6': {
    class_type: 'LoadImage',
    inputs: {
      image: '',
    },
    _meta: { title: 'Source image (the one being edited)' },
  },
  '7': {
    class_type: 'VAEEncode',
    inputs: {
      pixels: ['6', 0],
      vae: ['4', 0],
    },
    _meta: { title: 'VAE Encode (source → latent)' },
  },
  '14': {
    class_type: 'ImageResizeKJv2',
    inputs: {
      image: ['6', 0],
      // Frozen values = the default canvas mode ("Source"): keep the source
      // dimensions (width/height 0), floored to a multiple of 16.
      width: 0,
      height: 0,
      upscale_method: 'nearest-exact',
      keep_proportion: 'resize',
      pad_color: '0, 0, 0',
      crop_position: 'center',
      divisible_by: 16,
    },
    _meta: { title: 'Output canvas size, computed from the source' },
  },
  '8': {
    class_type: 'EmptySD3LatentImage',
    inputs: {
      width: ['14', 1],
      height: ['14', 2],
      batch_size: 1,
    },
    _meta: { title: 'OUTPUT CANVAS (16-ch latent)' },
  },
  '9': {
    class_type: 'Krea2EditModelPatch',
    inputs: {
      model: ['1', 0],
      source_latent: ['7', 0],
      vae: ['4', 0],
      source_image: ['6', 0],
      // Same latent as KSampler.latent_image: lets the node encode the source
      // before sampling starts instead of pulling the VAE in mid-run.
      target_latent: ['8', 0],
      ref_boost: 1,
      ref_boost_a: 1,
      fit_mode: 'fit',
    },
    _meta: { title: 'Krea2 Edit (source patch)' },
  },
  '10': {
    class_type: 'Krea2EditGroundedEncode',
    inputs: {
      clip: ['3', 0],
      image: ['6', 0],
      prompt: '',
      grounding_px: 768,
      system_prompt: '',
    },
    _meta: { title: 'POSITIVE — edit instruction' },
  },
  '11': {
    class_type: 'Krea2EditGroundedEncode',
    inputs: {
      clip: ['3', 0],
      image: ['6', 0],
      prompt: '',
      grounding_px: 768,
      system_prompt: '',
    },
    _meta: { title: 'NEGATIVE — only used when CFG > 1' },
  },
  '12': {
    class_type: 'KSampler',
    inputs: {
      model: ['9', 0],
      positive: ['10', 0],
      negative: ['11', 0],
      latent_image: ['8', 0],
      seed: 0,
      steps: 10,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1.0,
    },
    _meta: { title: 'Turbo sampler (10 steps, cfg 1)' },
  },
  '13': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['12', 0],
      vae: ['5', 0],
    },
    _meta: { title: 'VAE Decode' },
  },
  '24': {
    class_type: 'SaveImage',
    inputs: {
      images: ['13', 0],
      filename_prefix: 'komfy/krea2-edit',
    },
    _meta: { title: 'Save Image' },
  },
};

/**
 * One canvas mode. `keep_proportion` + the width/height pair drive
 * ImageResizeKJv2 (cf. the header): `resize` with 0/0 keeps the source size,
 * `total_pixels` treats width×height as a pixel budget to spread over the
 * source aspect ratio, `stretch` passes the given dimensions through — the
 * manual case, where the values come from the `format` field patched just
 * before (hence its position ahead of this select in `fields`).
 */
const canvasOption = (
  label: string,
  keep: string,
  size: { width: number; height: number } | null,
  divisibleBy: number,
): SelectOption => ({
  label,
  patches: [
    { target: { nodeId: '14', input: 'keep_proportion' }, value: keep },
    { target: { nodeId: '14', input: 'divisible_by' }, value: divisibleBy },
    ...(size
      ? [
          { target: { nodeId: '14', input: 'width' }, value: size.width },
          { target: { nodeId: '14', input: 'height' }, value: size.height },
        ]
      : []),
  ],
});

export const krea2Edit: WorkflowManifest = {
  id: 'krea2-edit',
  name: 'wf.edit.name',
  description: 'wf.edit.description',
  icon: 'sparkles-outline',
  graph,
  saveNodeId: '24',
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
      target: { nodeId: '10', input: 'prompt' },
      default: '',
      placeholder: 'wf.edit.promptPlaceholder',
      hint: 'wf.edit.promptHint',
      multiline: true,
      required: true,
    },
    {
      kind: 'text',
      key: 'negative',
      label: 'wf.common.negativePrompt',
      target: { nodeId: '11', input: 'prompt' },
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
      hint: 'wf.edit.lorasHint',
      // The identity-edit LoRA opens the chain on every launch and is not
      // offered in the form (cf. LorasField.fixed).
      fixed: [{ name: IDENTITY_LORA, strength: 1 }],
      modelSource: { nodeId: '1', output: 0 },
      modelTargets: [{ nodeId: '9', input: 'model' }],
      defaultStrength: 0.4,
    },
    {
      kind: 'number',
      key: 'refBoost',
      label: 'wf.edit.refBoost',
      target: { nodeId: '9', input: 'ref_boost' },
      default: 1.0,
      min: 0,
      max: 5,
      hint: 'wf.edit.refBoostHint',
    },
    // Manual canvas: patched BEFORE the `canvas` select, which overrides
    // width/height with its own budget in every automatic mode.
    {
      kind: 'dimensions',
      key: 'format',
      label: 'wf.common.dimensions',
      hint: 'wf.edit.formatHint',
      showWhen: { key: 'canvas', equals: 3 },
      widthTarget: { nodeId: '14', input: 'width' },
      heightTarget: { nodeId: '14', input: 'height' },
      // Landscape presets ("Invert" for portrait).
      options: [
        { width: 1024, height: 1024 },
        { width: 1216, height: 832 },
        { width: 1344, height: 896 },
        { width: 1536, height: 1024 },
      ],
      default: { width: 1024, height: 1024 },
    },
    {
      kind: 'select',
      key: 'canvas',
      label: 'wf.edit.canvas',
      defaultIndex: 0,
      hint: 'wf.edit.canvasHint',
      options: [
        canvasOption('wf.edit.canvasSource', 'resize', { width: 0, height: 0 }, 16),
        // Pixel budget spread over the source ratio: 1024² = 1 MP, 1448² ≈ 2 MP.
        canvasOption('1 MP', 'total_pixels', { width: 1024, height: 1024 }, 16),
        canvasOption('2 MP', 'total_pixels', { width: 1448, height: 1448 }, 16),
        // Manual: no width/height patch — the `format` field above set them.
        canvasOption('wf.edit.canvasManual', 'stretch', null, 1),
      ],
    },
    {
      kind: 'number',
      key: 'steps',
      label: 'Steps',
      target: { nodeId: '12', input: 'steps' },
      default: 10,
      min: 1,
      max: 60,
      integer: true,
      hint: 'wf.common.turboStepsHint',
    },
    {
      kind: 'number',
      key: 'cfg',
      label: 'CFG',
      target: { nodeId: '12', input: 'cfg' },
      default: 1.0,
      min: 0,
      max: 20,
      hint: 'wf.common.cfgHint',
    },
    // Sampler & scheduler: server-driven pickers over the KSampler enums
    // (same trick as the t2i — no hardcoded list in the repo).
    {
      kind: 'model',
      key: 'sampler',
      label: 'Sampler',
      hint: 'wf.common.samplerHint',
      target: { nodeId: '12', input: 'sampler_name' },
      default: 'euler',
      remember: true,
    },
    {
      kind: 'model',
      key: 'scheduler',
      label: 'Scheduler',
      target: { nodeId: '12', input: 'scheduler' },
      default: 'simple',
      remember: true,
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '12', input: 'seed' },
    },
  ],
};
