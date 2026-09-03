/**
 * KREA2 — Detect & Replace.
 * Base graph: LoadImage + detection of all zones with a picked Ultralytics
 * detector (default `face_yolov8m`, bbox family — robust and stable with
 * multiple faces, ascending x1 sort = numbered left to right). Any detector
 * installed on the server (bbox/*.pt or segm/*.pt) can be picked instead —
 * hands, whole persons, or whatever the user drops in the ultralytics
 * folder; the `detector` field offers the server's live list. At patch time,
 * the `zones` field inserts the replacement passes, in one of two modes:
 *  - one identity per zone: for each character, the pass
 *    ImpactSEGSOrderedFilter(take_start = zone number) → DetailerForEach
 *    wired in series on the image — each zone with its identity prompt
 *    and its LoRA chain (max 4, like the other workflows);
 *  - same identity for every zone: a single DetailerForEach fed the raw
 *    SEGS, which it iterates over natively (however many zones there are).
 * Nodes and parameters validated against /object_info; DetailerForEach
 * settings taken from a proven FaceDetailer workflow.
 *
 * Modified area: the detector only finds the zone, but the noise mask is
 * the **dilated** bounding box (BboxDetectorSEGS `dilation`). Raising the
 * dilation grows the regenerated area from the detected zone. It is a
 * rectangle (not a silhouette) — segm detectors feed the same bbox node
 * (their SEGM_DETECTOR output is unused), so detection quality follows the
 * chosen model, not a silhouette mask.
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
    class_type: 'LoadImage',
    inputs: {
      image: '',
    },
    _meta: { title: 'Source image (zones to replace)' },
  },
  '5': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['2', 0],
      text: '',
    },
    _meta: { title: 'Shared negative prompt (unused at cfg 1)' },
  },
  '6': {
    class_type: 'UltralyticsDetectorProvider',
    inputs: {
      model_name: 'bbox/face_yolov8m.pt',
    },
    _meta: { title: 'Detector (bbox/segm) — enumerates + orders' },
  },
  '7': {
    class_type: 'BboxDetectorSEGS',
    inputs: {
      bbox_detector: ['6', 0],
      image: ['4', 0],
      threshold: 0.5,
      // Zone dilation = size of the regenerated area.
      // Raise to cover more of the surroundings (driven by the field).
      dilation: 80,
      crop_factor: 3.0,
      drop_size: 10,
      labels: 'all',
    },
    _meta: { title: 'Zone detection (SEGS bbox, dilatable mask)' },
  },
  // SaveImage.images is rewired at patch time to the last DetailerForEach.
  '8': {
    class_type: 'SaveImage',
    inputs: {
      images: ['4', 0],
      filename_prefix: 'komfy/krea2-detect-replace',
    },
    _meta: { title: 'Save Image' },
  },
};

export const krea2DetectReplace: WorkflowManifest = {
  // Frozen persistence key (fieldPrefs/outputPrefs/promptHistory/batchPrefs
  // are keyed by it) — kept as-is across the rename so past preferences and
  // prompt history survive.
  id: 'krea2-faceswap',
  name: 'wf.detectReplace.name',
  description: 'wf.detectReplace.description',
  icon: 'scan-outline',
  graph,
  saveNodeId: '8',
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.common.sourceImage',
      target: { nodeId: '4', input: 'image' },
      required: true,
    },
    {
      kind: 'model',
      key: 'detector',
      label: 'wf.detectReplace.detector',
      hint: 'wf.detectReplace.detectorHint',
      target: { nodeId: '6', input: 'model_name' },
      default: 'bbox/face_yolov8m.pt',
      remember: true,
    },
    {
      kind: 'number',
      key: 'dilation',
      label: 'wf.detectReplace.dilation',
      target: { nodeId: '7', input: 'dilation' },
      default: 80,
      min: 0,
      max: 400,
      integer: true,
      hint: 'wf.detectReplace.dilationHint',
    },
    {
      kind: 'number',
      key: 'threshold',
      label: 'wf.common.threshold',
      target: { nodeId: '7', input: 'threshold' },
      default: 0.5,
      min: 0.05,
      max: 1,
      hint: 'wf.detectReplace.thresholdHint',
    },
    {
      kind: 'number',
      key: 'crop_factor',
      label: 'wf.detectReplace.cropFactor',
      target: { nodeId: '7', input: 'crop_factor' },
      default: 3.0,
      min: 1,
      max: 10,
      hint: 'wf.detectReplace.cropFactorHint',
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
      kind: 'zones',
      key: 'zones',
      label: 'wf.detectReplace.zones',
      hint: 'wf.detectReplace.zonesHint',
      imageSource: { nodeId: '4', output: 0 },
      segsSource: { nodeId: '7', output: 0 },
      modelSource: { nodeId: '1', output: 0 },
      clipSource: { nodeId: '2', output: 0 },
      vaeSource: { nodeId: '3', output: 0 },
      negativeSource: { nodeId: '5', output: 0 },
      imageTargets: [{ nodeId: '8', input: 'images' }],
      defaultStrength: 0.9,
      defaultDenoise: 0.45,
      defaultSteps: 8,
    },
  ],
};
