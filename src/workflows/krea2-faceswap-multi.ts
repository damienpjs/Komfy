/**
 * KREA2 — multi-character FaceSwap.
 * Base graph: LoadImage + detection of all faces with the `face_yolov8m`
 * bbox detector (robust and stable with multiple faces, ascending x1 sort =
 * numbered left to right). At patch time, the `persons` field inserts, for
 * each character, the pass
 *   ImpactSEGSOrderedFilter(take_start = face number) → DetailerForEach
 * wired in series on the image — each character with its identity prompt
 * and its LoRA chain (max 4, like the other workflows).
 * Nodes and parameters validated against /object_info; DetailerForEach
 * settings taken from a proven FaceDetailer workflow.
 *
 * Modified area: the detector only finds the face, but the noise mask is
 * the **dilated** bounding box (BboxDetectorSEGS `dilation`). Raising the
 * dilation grows the regenerated area from the face → covers the forehead,
 * hair, chin. It is a rectangle (not a silhouette), but detection stays
 * face_yolov8's: reliable on 3+ faces, where the head/hair segm detector
 * missed/merged the 3rd. The `crop_factor` must stay large enough to
 * contain the dilated area (otherwise it gets cropped); DetailerForEach
 * regenerates inside the crop and applies noise on the dilated mask only.
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
    _meta: { title: 'Source image (faces to replace)' },
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
    _meta: { title: 'Face bbox detector (yolov8m) — enumerates + orders' },
  },
  '7': {
    class_type: 'BboxDetectorSEGS',
    inputs: {
      bbox_detector: ['6', 0],
      image: ['4', 0],
      threshold: 0.5,
      // Face-box dilation = size of the regenerated area.
      // Raise to cover forehead/hair/chin (driven by the field).
      dilation: 80,
      crop_factor: 3.0,
      drop_size: 10,
      labels: 'all',
    },
    _meta: { title: 'Face detection (SEGS bbox, dilatable mask)' },
  },
  // SaveImage.images is rewired at patch time to the last DetailerForEach.
  '8': {
    class_type: 'SaveImage',
    inputs: {
      images: ['4', 0],
      filename_prefix: 'komfy/krea2-faceswap-multi',
    },
    _meta: { title: 'Save Image' },
  },
};

export const krea2FaceSwapMulti: WorkflowManifest = {
  id: 'krea2-faceswap-multi',
  name: 'wf.faceswap.name',
  description: 'wf.faceswap.description',
  icon: 'people-outline',
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
      kind: 'number',
      key: 'dilation',
      label: 'wf.faceswap.dilation',
      target: { nodeId: '7', input: 'dilation' },
      default: 80,
      min: 0,
      max: 400,
      integer: true,
      hint: 'wf.faceswap.dilationHint',
    },
    {
      kind: 'number',
      key: 'threshold',
      label: 'wf.common.threshold',
      target: { nodeId: '7', input: 'threshold' },
      default: 0.5,
      min: 0.05,
      max: 1,
      hint: 'wf.faceswap.thresholdHint',
    },
    {
      kind: 'number',
      key: 'crop_factor',
      label: 'wf.faceswap.cropFactor',
      target: { nodeId: '7', input: 'crop_factor' },
      default: 3.0,
      min: 1,
      max: 10,
      hint: 'wf.faceswap.cropFactorHint',
    },
    {
      kind: 'persons',
      key: 'persons',
      label: 'wf.faceswap.persons',
      hint: 'wf.faceswap.personsHint',
      imageSource: { nodeId: '4', output: 0 },
      segsSource: { nodeId: '7', output: 0 },
      modelSource: { nodeId: '1', output: 0 },
      clipSource: { nodeId: '2', output: 0 },
      vaeSource: { nodeId: '3', output: 0 },
      negativeSource: { nodeId: '5', output: 0 },
      imageTargets: [{ nodeId: '8', input: 'images' }],
      maxPersons: 4,
      maxLorasPerPerson: 4,
      defaultStrength: 0.9,
      defaultDenoise: 0.45,
      defaultSteps: 8,
    },
  ],
};
