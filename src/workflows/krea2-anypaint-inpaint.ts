/**
 * Krea 2: replace in context (AnyPaint inpainting with a hand-drawn mask).
 *
 * Same job as Draw & Replace, different mechanics. Draw & Replace crops the
 * painted area and regenerates it ALONE (DetailerForEach on Krea 2 Turbo,
 * which is not an inpainting model): at denoise 1 the backdrop inside the
 * crop is redrawn without seeing its surroundings, so a full-body
 * replacement came back inside a visible frame, lit by the character LoRA
 * rather than by the scene. AnyPaint keeps the WHOLE image in the sampler:
 * the unpainted pixels are re-injected at every step (timestep-matched
 * replacement through the token-aligned noise_mask) and the model sees the
 * scene through its 384 px semantic reference, so what it draws in the area
 * inherits the scene's backdrop and light. A band along the area's edge is
 * redrawn to hide the join (boundary_redraw_px).
 *
 * Test render (Nov. 2026): a full-body person swapped inside a rectangle on
 * a studio shot, character LoRA at 1.4, denoise 1. No frame, backdrop
 * continuous, light on the body matching the original, morphology fully
 * replaced. The pixels of the area are NOT shown to the model: Prepare fills
 * them with the median colour before building the reference, so it cannot
 * copy the person it replaces.
 *
 * Graph:
 *  4 LoadImage + 5 LoadImageMask (PNG of the `mask` field) → 6 GrowMask;
 *  7 ImageScaleToTotalPixels: the source at the working budget (Krea 2 is
 *    trained up to ~2 MP; Prepare never resizes), sides on a 16 px grid so
 *    Prepare adds no alignment strip; the mask is resized by Prepare itself;
 *  8 Prepare (no padding: pure inpainting) → 9 Encode → 12 KSampler on the
 *    model patched by 11 (after the LoRA chain, AnyPaint LoRA first) → 13.
 *
 * Restoration ("Source resolution" output, the default), all in the graph,
 * no app-side geometry: 16 crops the decode to the working size (14), 21
 * scales it back to the source size (15). The paste mask is AnyPaint's own
 * keep_mask (8.3: what it preserved, minus the redraw band), pulled in by
 * 24 px (17: one 16 px token, since the noise mask is token-aligned, plus
 * room for the fade), blurred over ~8 px (19, 20: ImageBlur, core, through
 * an image since no core node blurs a mask), then scaled to the source size
 * (22, 23). 24 pastes the ORIGINAL pixels through it. The fade sits entirely
 * inside the preserved area, where the render and the source agree, so no
 * ghost can appear (lesson of krea2-outpaint's first render). The "Working
 * resolution" output drops 14 to 24 and saves the raw decode.
 *
 * Settings from the pack's reference workflow: Turbo, 8 steps, euler/simple,
 * CFG 1, denoise 1 (not exposed: the known-pixel replacement assumes a full
 * schedule), AnyPaint LoRA at 1.0, reference edge 384, VLM reference and K/V
 * cache on.
 *
 * Validated against /object_info of the server (ComfyUI 0.45.5 +
 * custom_nodes.krea2-anypaint): ImageScaleToTotalPixels (resolution_steps),
 * GetImageSize (width, height, batch_size), ImageCrop, CropMask, GrowMask,
 * MaskToImage, ImageBlur (blur_radius ≤ 31, sigma ≤ 10), ImageToMask,
 * ImageScale, ImageCompositeMasked, LoadImageMask; INT inputs fed by links.
 */

import type { PromptGraph } from '../api/types';
import type { WorkflowManifest } from './types';

/** LoRA the workflow is built around: applied first, not user-editable. */
const ANYPAINT_LORA = 'krea2/krea2_anypaint_rank32.safetensors';

/** Restore branch, dropped by the "Working resolution" output. */
const RESTORE_NODES = ['14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24'];

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
    class_type: 'GrowMask',
    inputs: {
      mask: ['5', 0],
      expand: 8,
      tapered_corners: true,
    },
    _meta: { title: 'Grow / shrink the painted area (source px)' },
  },
  '7': {
    class_type: 'ImageScaleToTotalPixels',
    inputs: {
      image: ['4', 0],
      upscale_method: 'lanczos',
      megapixels: 1.0,
      resolution_steps: 16,
    },
    _meta: { title: 'Source at working resolution (sides on a 16 px grid)' },
  },
  '8': {
    class_type: 'Krea2AnyPaintPrepare',
    inputs: {
      source: ['7', 0],
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      reference_max_edge: 384,
      boundary_redraw_px: 32,
      generated_mask: ['6', 0],
    },
    _meta: { title: 'AnyPaint canvas: painted area generated, the rest kept' },
  },
  '9': {
    class_type: 'Krea2AnyPaintEncode',
    inputs: {
      clip: ['2', 0],
      prompt: '',
      vae: ['3', 0],
      semantic_reference: ['8', 0],
      known_image: ['8', 1],
      keep_mask: ['8', 3],
      vlm_reference: true,
    },
    _meta: { title: 'POSITIVE: the complete image + known latent and noise mask' },
  },
  '10': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'NEGATIVE (only used when CFG > 1)' },
  },
  '11': {
    class_type: 'Krea2AnyPaintModelPatch',
    inputs: {
      model: ['1', 0],
      kv_cache: true,
    },
    _meta: { title: 'AnyPaint model patch (after the LoRAs)' },
  },
  '12': {
    class_type: 'KSampler',
    inputs: {
      model: ['11', 0],
      positive: ['9', 0],
      negative: ['10', 0],
      latent_image: ['9', 1],
      seed: 0,
      steps: 8,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1.0,
    },
    _meta: { title: 'Turbo sampler (8 steps, cfg 1, euler)' },
  },
  '13': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['12', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Decode (working resolution)' },
  },
  '14': {
    class_type: 'GetImageSize',
    inputs: {
      image: ['7', 0],
    },
    _meta: { title: 'Restore: working size' },
  },
  '15': {
    class_type: 'GetImageSize',
    inputs: {
      image: ['4', 0],
    },
    _meta: { title: 'Restore: source size' },
  },
  '16': {
    class_type: 'ImageCrop',
    inputs: {
      image: ['13', 0],
      width: ['14', 0],
      height: ['14', 1],
      x: 0,
      y: 0,
    },
    _meta: { title: 'Restore: render cropped to the working size' },
  },
  '17': {
    class_type: 'GrowMask',
    inputs: {
      mask: ['8', 3],
      expand: -24,
      tapered_corners: true,
    },
    _meta: { title: 'Restore: kept area pulled in (one token + fade room)' },
  },
  '18': {
    class_type: 'CropMask',
    inputs: {
      mask: ['17', 0],
      x: 0,
      y: 0,
      width: ['14', 0],
      height: ['14', 1],
    },
    _meta: { title: 'Restore: paste mask cropped to the working size' },
  },
  '19': {
    class_type: 'MaskToImage',
    inputs: {
      mask: ['18', 0],
    },
    _meta: { title: 'Restore: paste mask as an image (to blur and scale it)' },
  },
  '20': {
    class_type: 'ImageBlur',
    inputs: {
      image: ['19', 0],
      blur_radius: 8,
      sigma: 4.0,
    },
    _meta: { title: 'Restore: soft edge on the paste mask' },
  },
  '21': {
    class_type: 'ImageScale',
    inputs: {
      image: ['16', 0],
      upscale_method: 'lanczos',
      width: ['15', 0],
      height: ['15', 1],
      crop: 'disabled',
    },
    _meta: { title: 'Restore: render back to the source size' },
  },
  '22': {
    class_type: 'ImageScale',
    inputs: {
      image: ['20', 0],
      upscale_method: 'bilinear',
      width: ['15', 0],
      height: ['15', 1],
      crop: 'disabled',
    },
    _meta: { title: 'Restore: paste mask at the source size' },
  },
  '23': {
    class_type: 'ImageToMask',
    inputs: {
      image: ['22', 0],
      channel: 'red',
    },
    _meta: { title: 'Restore: paste mask back to a mask' },
  },
  '24': {
    class_type: 'ImageCompositeMasked',
    inputs: {
      destination: ['21', 0],
      source: ['4', 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask: ['23', 0],
    },
    _meta: { title: 'Restore: original pixels pasted back outside the area' },
  },
  '25': {
    class_type: 'SaveImage',
    inputs: {
      images: ['24', 0],
      filename_prefix: 'komfy/krea2-anypaint-inpaint',
    },
    _meta: { title: 'Save Image' },
  },
};

export const krea2AnypaintInpaint: WorkflowManifest = {
  id: 'krea2-anypaint-inpaint',
  name: 'wf.anypaintInpaint.name',
  description: 'wf.anypaintInpaint.description',
  icon: 'color-fill-outline',
  graph,
  saveNodeId: '25',
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
      label: 'wf.anypaintInpaint.mask',
      target: { nodeId: '5', input: 'image' },
      sourceKey: 'image',
      required: true,
      hint: 'wf.anypaintInpaint.maskHint',
    },
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '9', input: 'prompt' },
      default: '',
      placeholder: 'wf.anypaintInpaint.promptPlaceholder',
      hint: 'wf.anypaintInpaint.promptHint',
      multiline: true,
      required: true,
    },
    {
      kind: 'loras',
      key: 'loras',
      label: 'LoRAs',
      hint: 'wf.anypaintInpaint.lorasHint',
      fixed: [{ name: ANYPAINT_LORA, strength: 1 }],
      modelSource: { nodeId: '1', output: 0 },
      modelTargets: [{ nodeId: '11', input: 'model' }],
      defaultStrength: 0.8,
    },
    {
      kind: 'number',
      key: 'grow',
      label: 'wf.drawReplace.grow',
      target: { nodeId: '6', input: 'expand' },
      default: 8,
      min: -64,
      max: 64,
      integer: true,
      hint: 'wf.drawReplace.growHint',
    },
    {
      kind: 'select',
      key: 'budget',
      label: 'wf.anypaintInpaint.budget',
      hint: 'wf.anypaintInpaint.budgetHint',
      defaultIndex: 0,
      options: [1, 1.5, 2].map((mp) => ({
        label: `${mp} MP`,
        patches: [{ target: { nodeId: '7', input: 'megapixels' }, value: mp }],
      })),
    },
    {
      kind: 'select',
      key: 'output',
      label: 'wf.outpaint.output',
      hint: 'wf.anypaintInpaint.outputHint',
      defaultIndex: 0,
      options: [
        {
          // Frozen wiring: the restore branch feeds the save node.
          label: 'wf.outpaint.outputSource',
          patches: [],
        },
        {
          label: 'wf.outpaint.outputWorking',
          patches: [{ target: { nodeId: '25', input: 'images' }, value: ['13', 0] }],
          bypassNodes: RESTORE_NODES,
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
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '12', input: 'seed' },
    },
    // Advanced: tuned for Turbo by the adapter's author, folded by default.
    {
      kind: 'number',
      key: 'seam',
      label: 'wf.outpaint.seam',
      hint: 'wf.anypaintInpaint.seamHint',
      target: { nodeId: '8', input: 'boundary_redraw_px' },
      default: 32,
      min: 0,
      max: 128,
      integer: true,
      advanced: true,
    },
    {
      kind: 'number',
      key: 'steps',
      label: 'Steps',
      target: { nodeId: '12', input: 'steps' },
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
      target: { nodeId: '12', input: 'cfg' },
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
      hint: 'wf.anypaintInpaint.samplerHint',
      target: { nodeId: '12', input: 'sampler_name' },
      default: 'euler',
      remember: true,
      advanced: true,
    },
    {
      kind: 'model',
      key: 'scheduler',
      label: 'Scheduler',
      target: { nodeId: '12', input: 'scheduler' },
      default: 'simple',
      remember: true,
      advanced: true,
    },
  ],
};
