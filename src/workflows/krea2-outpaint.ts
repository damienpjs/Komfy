/**
 * Krea 2: outpainting (canvas expansion on any side).
 *
 * Built on Krea 2 AnyPaint (LoRA yijunwang2/krea2-anypaint + the native nodes
 * of alexw5702-afk/krea2-anypaint, the repo its model card links). Of the
 * community approaches surveyed (Nov. 2026), it is the one trained for this
 * exact job on Krea 2 Turbo:
 *  - the registered-outpaint LoRA (same author) grows one axis per pass and
 *    needs a second pass for an interior box; AnyPaint pads any side at once;
 *  - the Identity Edit LoRA (already used by krea2-edit) lists outpainting as
 *    unreliable on its own model card, and regenerates the whole frame;
 *  - LanPaint (training-free) warns about degraded results on distilled
 *    models, which Krea 2 Turbo is.
 *
 * How AnyPaint works: Prepare places the source on the expanded canvas
 * without resizing it (padding filled with the source's median colour) and
 * builds a 384 px "semantic reference" of the whole canvas. Encode feeds that
 * reference to Qwen3-VL and to the model's reference attention, and returns
 * the known image as a latent with a token-aligned noise_mask: KSampler then
 * restores the known tokens at every step (timestep-matched replacement), so
 * the source is preserved while the model draws the rest. A 32 px band along
 * the seam is left to the model to blend (boundary_redraw_px).
 *
 * Reference settings (the pack's krea2_anypaint_workflow.json and model card):
 * Turbo, 8 steps, euler/simple, CFG 1, denoise 1, LoRA at 1.0, reference max
 * edge 384, VLM reference and K/V cache on. Euler is not a detail: the
 * krea2edit changelog notes that SDE samplers disrupt the reference channel
 * and ruin outpaint coherence.
 *
 * Resolution. Prepare never resizes, so a 12 MP photo plus its expansion would
 * be sampled far above Krea 2's trained range (≤ 2 MP). Node 5 scales the
 * source down first, to a canvas budget picked in the form (1 MP by default);
 * the outpaint field computes the exact sizes (cf. outpaint.planOutpaint).
 *
 * Restoration ("Source resolution" output, the default): the generated canvas
 * is scaled back to source + paddings (node 12) and the ORIGINAL pixels are
 * pasted over it (15). The paste mask (13, 17, 14, 18) covers the source
 * except a strip along each grown side: the redraw band plus one 16 px token,
 * where the model may draw across the source edge, then fades in over 16
 * working pixels (cf. outpaint.restoreGeometry). The first test render showed
 * why: with the fade inside the band, a shed the model drew across the seam
 * came back as a half-transparent ghost. Beyond the band the source returns
 * pixel-identical. The "Working resolution" output drops the branch and saves
 * the raw decode. ImagePadForOutpaint is deliberately not used for the mask:
 * its feather is a per-pixel Python loop, tens of seconds on a 12 MP photo;
 * FeatherMask ramps whole rows and columns.
 *
 * The AnyPaint LoRA is the reason the workflow works at all, so it is a
 * `fixed` entry of the loras field (inserted at patch time ahead of the
 * user's LoRAs, never offered as removable), like the identity-edit LoRA of
 * krea2-edit.
 *
 * class_types and inputs read from the node pack source (nodes.py, commit
 * 675be5a) and the server's ComfyUI 0.34 (SolidMask, FeatherMask, MaskComposite, ImageScale,
 * ImageCompositeMasked); validated against /object_info after install.
 */

import type { PromptGraph } from '../api/types';
import type { WorkflowManifest } from './types';

/** LoRA the workflow is built around: applied first, not user-editable. */
const ANYPAINT_LORA = 'krea2/krea2_anypaint_rank32.safetensors';

/** Generic prompt of the pack's reference workflow. */
const DEFAULT_PROMPT =
  'a complete coherent image, consistent lighting, perspective, and detail';

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
    class_type: 'ImageScale',
    inputs: {
      image: ['4', 0],
      upscale_method: 'lanczos',
      width: 1024,
      height: 1024,
      crop: 'disabled',
    },
    _meta: { title: 'Source at working resolution (computed by the app)' },
  },
  '6': {
    class_type: 'Krea2AnyPaintPrepare',
    inputs: {
      source: ['5', 0],
      left: 0,
      top: 0,
      right: 512,
      bottom: 0,
      reference_max_edge: 384,
      boundary_redraw_px: 32,
    },
    _meta: { title: 'AnyPaint canvas: paddings at working resolution' },
  },
  '7': {
    class_type: 'Krea2AnyPaintEncode',
    inputs: {
      clip: ['2', 0],
      prompt: DEFAULT_PROMPT,
      vae: ['3', 0],
      semantic_reference: ['6', 0],
      known_image: ['6', 1],
      keep_mask: ['6', 3],
      vlm_reference: true,
    },
    _meta: { title: 'POSITIVE: the complete image + known latent and noise mask' },
  },
  '8': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'NEGATIVE (only used when CFG > 1)' },
  },
  '9': {
    class_type: 'Krea2AnyPaintModelPatch',
    inputs: {
      model: ['1', 0],
      kv_cache: true,
    },
    _meta: { title: 'AnyPaint model patch (after the LoRAs)' },
  },
  '10': {
    class_type: 'KSampler',
    inputs: {
      model: ['9', 0],
      positive: ['7', 0],
      negative: ['8', 0],
      latent_image: ['7', 1],
      seed: 0,
      steps: 8,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1.0,
    },
    _meta: { title: 'Turbo sampler (8 steps, cfg 1, euler)' },
  },
  '11': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['10', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Decode (generated canvas)' },
  },
  '12': {
    class_type: 'ImageScale',
    inputs: {
      image: ['11', 0],
      upscale_method: 'lanczos',
      width: 1536,
      height: 1024,
      crop: 'disabled',
    },
    _meta: { title: 'Restore: canvas back to source scale' },
  },
  '13': {
    class_type: 'SolidMask',
    inputs: {
      value: 0.0,
      width: 1024,
      height: 1024,
    },
    _meta: { title: 'Restore: empty mask at the source size' },
  },
  '17': {
    class_type: 'SolidMask',
    inputs: {
      value: 1.0,
      width: 960,
      height: 1024,
    },
    _meta: { title: 'Restore: pasted area (source minus the redraw band)' },
  },
  '14': {
    class_type: 'FeatherMask',
    inputs: {
      mask: ['17', 0],
      left: 0,
      top: 0,
      right: 20,
      bottom: 0,
    },
    _meta: { title: 'Restore: fade-in on the grown sides' },
  },
  '18': {
    class_type: 'MaskComposite',
    inputs: {
      destination: ['13', 0],
      source: ['14', 0],
      x: 0,
      y: 0,
      operation: 'add',
    },
    _meta: { title: 'Restore: pasted area placed on the source mask' },
  },
  '15': {
    class_type: 'ImageCompositeMasked',
    inputs: {
      destination: ['12', 0],
      source: ['4', 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask: ['18', 0],
    },
    _meta: { title: 'Restore: original pixels pasted back' },
  },
  '16': {
    class_type: 'SaveImage',
    inputs: {
      images: ['15', 0],
      filename_prefix: 'komfy/krea2-outpaint',
    },
    _meta: { title: 'Save Image' },
  },
};

export const krea2Outpaint: WorkflowManifest = {
  id: 'krea2-outpaint',
  name: 'wf.outpaint.name',
  description: 'wf.outpaint.description',
  icon: 'expand-outline',
  graph,
  saveNodeId: '16',
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.common.sourceImage',
      target: { nodeId: '4', input: 'image' },
      required: true,
    },
    // Patched BEFORE the outpaint field, which reads the band width back
    // from node 6 to size the seam feather (rendered last: advanced).
    {
      kind: 'number',
      key: 'seam',
      label: 'wf.outpaint.seam',
      hint: 'wf.outpaint.seamHint',
      target: { nodeId: '6', input: 'boundary_redraw_px' },
      default: 32,
      min: 0,
      max: 128,
      integer: true,
      advanced: true,
    },
    {
      kind: 'outpaint',
      key: 'expand',
      label: 'wf.outpaint.expand',
      hint: 'wf.outpaint.expandHint',
      sourceKey: 'image',
      nodes: {
        scale: '5',
        prepare: '6',
        upscale: '12',
        mask: '13',
        pasteMask: '17',
        feather: '14',
        placeMask: '18',
        composite: '15',
      },
      budgets: [1, 1.5, 2],
      defaultBudget: 1,
    },
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '7', input: 'prompt' },
      default: DEFAULT_PROMPT,
      placeholder: 'wf.outpaint.promptPlaceholder',
      hint: 'wf.outpaint.promptHint',
      multiline: true,
      required: true,
    },
    {
      kind: 'select',
      key: 'output',
      label: 'wf.outpaint.output',
      hint: 'wf.outpaint.outputHint',
      defaultIndex: 0,
      options: [
        {
          // Frozen wiring: the restore branch feeds the save node.
          label: 'wf.outpaint.outputSource',
          patches: [],
        },
        {
          label: 'wf.outpaint.outputWorking',
          patches: [{ target: { nodeId: '16', input: 'images' }, value: ['11', 0] }],
          bypassNodes: ['12', '13', '14', '15', '17', '18'],
        },
      ],
    },
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
      hint: 'wf.outpaint.lorasHint',
      fixed: [{ name: ANYPAINT_LORA, strength: 1 }],
      modelSource: { nodeId: '1', output: 0 },
      modelTargets: [{ nodeId: '9', input: 'model' }],
      defaultStrength: 0.8,
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '10', input: 'seed' },
    },
    // Advanced: tuned for Turbo by the adapter's author, folded by default.
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
      advanced: true,
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
      advanced: true,
    },
    {
      kind: 'model',
      key: 'sampler',
      label: 'Sampler',
      hint: 'wf.outpaint.samplerHint',
      target: { nodeId: '10', input: 'sampler_name' },
      default: 'euler',
      remember: true,
      advanced: true,
    },
    {
      kind: 'model',
      key: 'scheduler',
      label: 'Scheduler',
      target: { nodeId: '10', input: 'scheduler' },
      default: 'simple',
      remember: true,
      advanced: true,
    },
  ],
};
