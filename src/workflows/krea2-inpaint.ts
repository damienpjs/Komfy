/**
 * KREA2 — Inpaint on an auto-detected area.
 * LoadImage → detection (selectable) → SegsToCombinedMask → GaussianBlurMask →
 * SetLatentNoiseMask → KSampler: only the masked area receives noise, the
 * rest of the image is preserved pixel-perfect.
 *
 * Two ImpactSwitch nodes drive the graph via a literal `select` value (lazy:
 * only the chosen branch is evaluated). Rewiring connections in the patch
 * would have broken remix matching, which compares connections structurally
 * (cf. match.ts) — a literal value stays recoverable by the select:
 *  - switch 20 "detection": BboxDetectorSEGS chain (rectangle mask, bbox
 *    models) or SegmDetectorSEGS (precise silhouette, segm models —
 *    head+hair, person). With a bbox model the provider's SEGM output is a
 *    NO_SEGM_DETECTOR placebo but the segm branch never runs.
 *  - switch 12 "area": direct mask (inpaint) or inverted (preserve).
 *
 * Detectors = models present in the server's models/ultralytics/ folder
 * (UltralyticsDetectorProvider's `bbox/…` / `segm/…` name format).
 * Threshold and dilation are applied to both chains (extraTargets).
 *
 * Between each detection and its SegsToCombinedMask sits an
 * ImpactSEGSOrderedFilter (nodes 21/22, ascending x1 = left → right, same as
 * the FaceSwap): by default it keeps every segment (take_count 100), so all
 * detections are inpainted at once; switching `segments` to "single" drops
 * take_count to 1 and the `skip` field (take_start) selects which one — skip
 * N to reach segment N+1. take_start/take_count are literals, patched on both
 * filters (extraTargets / select patches), so remix matching is unaffected.
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
    class_type: 'LoadImage',
    inputs: {
      image: '',
    },
    _meta: { title: 'Image source' },
  },
  '5': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'Positive prompt (content of the inpainted area)' },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'Negative prompt (unused at cfg 1)' },
  },
  '7': {
    class_type: 'UltralyticsDetectorProvider',
    inputs: {
      model_name: 'bbox/face_yolov8m.pt',
    },
    _meta: { title: 'Bbox detector (selectable)' },
  },
  '8': {
    class_type: 'BboxDetectorSEGS',
    inputs: {
      bbox_detector: ['7', 0],
      image: ['4', 0],
      threshold: 0.5,
      dilation: 10,
      crop_factor: 3.0,
      drop_size: 10,
      labels: 'all',
    },
    _meta: { title: 'Area detection (SEGS)' },
  },
  '21': {
    class_type: 'ImpactSEGSOrderedFilter',
    inputs: {
      segs: ['8', 0],
      target: 'x1',
      order: false, // ascending x1 → segments numbered left to right
      // take_start = segments skipped (field), take_count = how many kept:
      // 100 ("all") or 1 (isolate one). Slice [start:start+count], cf. Impact.
      take_start: 0,
      take_count: 100,
    },
    _meta: { title: 'Segment selection (bbox branch)' },
  },
  '9': {
    class_type: 'SegsToCombinedMask',
    inputs: {
      segs: ['21', 0],
    },
    _meta: { title: 'SEGS bbox → combined mask' },
  },
  '18': {
    class_type: 'SegmDetectorSEGS',
    inputs: {
      segm_detector: ['7', 1],
      image: ['4', 0],
      threshold: 0.5,
      dilation: 10,
      crop_factor: 3.0,
      drop_size: 10,
      labels: 'all',
    },
    _meta: { title: 'Area detection (SEGS, silhouette)' },
  },
  '22': {
    class_type: 'ImpactSEGSOrderedFilter',
    inputs: {
      segs: ['18', 0],
      target: 'x1',
      order: false, // ascending x1 → segments numbered left to right
      take_start: 0,
      take_count: 100,
    },
    _meta: { title: 'Segment selection (segm branch)' },
  },
  '19': {
    class_type: 'SegsToCombinedMask',
    inputs: {
      segs: ['22', 0],
    },
    _meta: { title: 'SEGS segm → combined mask' },
  },
  '20': {
    class_type: 'ImpactSwitch',
    inputs: {
      select: 1,
      sel_mode: false,
      input1: ['9', 0],
      input2: ['19', 0],
    },
    _meta: { title: 'Detection: 1 = rectangle (bbox) · 2 = silhouette (segm)' },
  },
  '10': {
    class_type: 'ImpactGaussianBlurMask',
    inputs: {
      mask: ['20', 0],
      kernel_size: 10,
      sigma: 10.0,
    },
    _meta: { title: 'Softened mask edges' },
  },
  '11': {
    class_type: 'InvertMask',
    inputs: {
      mask: ['10', 0],
    },
    _meta: { title: 'Inverted mask (preserve mode)' },
  },
  '12': {
    class_type: 'ImpactSwitch',
    inputs: {
      select: 1,
      sel_mode: false,
      input1: ['10', 0],
      input2: ['11', 0],
    },
    _meta: { title: 'Area: 1 = inpaint · 2 = preserve' },
  },
  '13': {
    class_type: 'VAEEncode',
    inputs: {
      pixels: ['4', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Encode (image → latent)' },
  },
  '14': {
    class_type: 'SetLatentNoiseMask',
    inputs: {
      samples: ['13', 0],
      mask: ['12', 0],
    },
    _meta: { title: 'Noise limited to the mask' },
  },
  '15': {
    class_type: 'KSampler',
    inputs: {
      model: ['1', 0],
      positive: ['5', 0],
      negative: ['6', 0],
      latent_image: ['14', 0],
      seed: 0,
      steps: 8,
      cfg: 1.0,
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 0.85,
    },
    _meta: { title: 'Turbo sampler (inpaint)' },
  },
  '16': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['15', 0],
      vae: ['3', 0],
    },
    _meta: { title: 'VAE Decode' },
  },
  '17': {
    class_type: 'SaveImage',
    inputs: {
      images: ['16', 0],
      filename_prefix: 'komfy/krea2-inpaint',
    },
    _meta: { title: 'Save Image' },
  },
};

/** A segm model switches detection to the silhouette chain (switch 20). */
const detectorOption = (label: string, model: string): SelectOption => ({
  label,
  patches: [
    { target: { nodeId: '7', input: 'model_name' }, value: model },
    {
      target: { nodeId: '20', input: 'select' },
      value: model.startsWith('segm/') ? 2 : 1,
    },
  ],
});

// Enums checked against /object_info/KSampler (same curation as img2img).
const samplerOption = (name: string): SelectOption => ({
  label: name,
  patches: [{ target: { nodeId: '15', input: 'sampler_name' }, value: name }],
});
const schedulerOption = (name: string): SelectOption => ({
  label: name,
  patches: [{ target: { nodeId: '15', input: 'scheduler' }, value: name }],
});

export const krea2Inpaint: WorkflowManifest = {
  id: 'krea2-inpaint',
  name: 'wf.inpaint.name',
  description: 'wf.inpaint.description',
  icon: 'scan-outline',
  graph,
  saveNodeId: '17',
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.common.sourceImage',
      target: { nodeId: '4', input: 'image' },
      required: true,
    },
    {
      kind: 'select',
      key: 'detector',
      label: 'wf.inpaint.detector',
      defaultIndex: 0,
      options: [
        detectorOption('wf.inpaint.detFace', 'bbox/face_yolov8m.pt'),
        detectorOption('wf.inpaint.detHead', 'segm/Anzhc_HeadHair_seg_y8m.pt'),
        detectorOption('wf.inpaint.detHands', 'bbox/hand_yolov8s.pt'),
        detectorOption('wf.inpaint.detPerson', 'segm/person_yolov8m-seg.pt'),
        detectorOption('wf.inpaint.detFeet', 'bbox/foot_yolov8x_v2.pt'),
      ],
      hint: 'wf.inpaint.detectorHint',
    },
    {
      kind: 'select',
      key: 'segments',
      label: 'wf.inpaint.segments',
      defaultIndex: 0,
      options: [
        {
          label: 'wf.inpaint.segmentsAll',
          patches: [
            { target: { nodeId: '21', input: 'take_count' }, value: 100 },
            { target: { nodeId: '22', input: 'take_count' }, value: 100 },
          ],
        },
        {
          label: 'wf.inpaint.segmentsSingle',
          patches: [
            { target: { nodeId: '21', input: 'take_count' }, value: 1 },
            { target: { nodeId: '22', input: 'take_count' }, value: 1 },
          ],
        },
      ],
      hint: 'wf.inpaint.segmentsHint',
    },
    {
      kind: 'number',
      key: 'skip',
      label: 'wf.inpaint.skip',
      target: { nodeId: '21', input: 'take_start' },
      extraTargets: [{ nodeId: '22', input: 'take_start' }],
      default: 0,
      min: 0,
      max: 63,
      integer: true,
      hint: 'wf.inpaint.skipHint',
    },
    {
      kind: 'select',
      key: 'mode',
      label: 'wf.inpaint.mode',
      defaultIndex: 0,
      options: [
        {
          label: 'wf.inpaint.modeInpaint',
          patches: [{ target: { nodeId: '12', input: 'select' }, value: 1 }],
        },
        {
          label: 'wf.inpaint.modePreserve',
          patches: [{ target: { nodeId: '12', input: 'select' }, value: 2 }],
        },
      ],
      hint: 'wf.inpaint.modeHint',
    },
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '5', input: 'text' },
      default: '',
      placeholder: 'wf.inpaint.promptPlaceholder',
      multiline: true,
      required: true,
    },
    {
      kind: 'text',
      key: 'negative',
      label: 'wf.common.negativePrompt',
      target: { nodeId: '6', input: 'text' },
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
      modelTargets: [{ nodeId: '15', input: 'model' }],
      defaultStrength: 0.9,
    },
    {
      kind: 'number',
      key: 'threshold',
      label: 'wf.common.threshold',
      target: { nodeId: '8', input: 'threshold' },
      extraTargets: [{ nodeId: '18', input: 'threshold' }],
      default: 0.5,
      min: 0.05,
      max: 1,
      hint: 'wf.inpaint.thresholdHint',
    },
    {
      kind: 'number',
      key: 'dilation',
      label: 'wf.inpaint.dilation',
      target: { nodeId: '8', input: 'dilation' },
      extraTargets: [{ nodeId: '18', input: 'dilation' }],
      default: 10,
      min: -512,
      max: 512,
      integer: true,
      hint: 'wf.inpaint.dilationHint',
    },
    {
      kind: 'number',
      key: 'feather',
      label: 'wf.inpaint.feather',
      target: { nodeId: '10', input: 'kernel_size' },
      default: 10,
      min: 0,
      max: 100,
      integer: true,
      hint: 'wf.inpaint.featherHint',
    },
    {
      kind: 'number',
      key: 'denoise',
      label: 'Denoise',
      target: { nodeId: '15', input: 'denoise' },
      default: 0.85,
      min: 0.05,
      max: 1,
      hint: 'wf.inpaint.denoiseHint',
    },
    {
      kind: 'number',
      key: 'steps',
      label: 'Steps',
      target: { nodeId: '15', input: 'steps' },
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
      target: { nodeId: '15', input: 'seed' },
    },
  ],
};
