/**
 * WAN 2.2 — image-to-video (I2V A14B, dual expert).
 *
 * LoadImage (reference) → WanAnimateToVideo (builds the conditioning + start
 * latent) → two-stage KSamplerAdvanced (high-noise expert first, low-noise
 * expert refines) → VAEDecode → RIFE VFI (frame interpolation, toggleable) →
 * CreateVideo → SaveVideo.
 *
 * Two diffusion experts, each its own GGUF UNet + ModelSamplingSD3 shift:
 *   high  : UnetLoaderGGUF(212) → LoRAs → ModelSamplingSD3(200) → KSampler(198)
 *   low   : UnetLoaderGGUF(211) → LoRAs → ModelSamplingSD3(189) → KSampler(196)
 * A single UMT5-XXL text encoder (CLIPLoader type `wan`) feeds both prompts,
 * and the WAN 2.1 VAE is shared. All class_types, model filenames and enums
 * validated against /object_info on the live server.
 *
 * Distilled setup: 8 steps split 4/4 across the experts, cfg 1.5 (high) / 1
 * (low), euler_ancestral + sgm_uniform (matching the reference distilled
 * graph — euler/beta leaves residual "sparkle" noise). This only works with
 * the lightx2v distillation LoRA loaded on each expert — hence both LoRA
 * fields default to it (editable in the form).
 *
 * NB — video output: the sink is SaveVideo(3), pointed at by `saveNodeId` so
 * the launch flow sets its filename_prefix generically (cf. patch.ts). An
 * optional last-frame branch (ImageFromBatch → SaveImage) is toggled by the
 * `lastFrame` select — useful to chain segments (loop / continuation).
 */

import type { PromptGraph } from '../api/types';
import type { WorkflowManifest } from './types';

/** lightx2v distillation LoRA — required for the 8-step distilled schedule. */
const LIGHTX2V_LORA =
  'Wan/lightx2v_T2V_14B_cfg_step_distill_v2_lora_rank64_bf16.safetensors';

/** Starting negative for WAN video: curbs flicker / morphing / exposure drift. */
const DEFAULT_NEGATIVE =
  'static, still image, frozen frame, jitter, flicker, morphing, warping, ' +
  'distorted face, extra limbs, deformed hands, blurry, low quality, jpeg ' +
  'artifacts, oversaturated, watermark, text, subtitles, shaking, ' +
  'flickering, pulsing light, exposure shift';

const graph: PromptGraph = {
  // --- Reference image ------------------------------------------------------
  '2': {
    class_type: 'LoadImage',
    inputs: { image: '' },
    _meta: { title: 'Reference image' },
  },
  // --- Shared encoders ------------------------------------------------------
  '182': {
    class_type: 'VAELoader',
    inputs: { vae_name: 'Wan2.1_VAE.safetensors' },
    _meta: { title: 'Load WAN 2.1 VAE' },
  },
  '184': {
    class_type: 'CLIPLoader',
    inputs: { clip_name: 'umt5_xxl_fp16.safetensors', type: 'wan' },
    _meta: { title: 'Load UMT5-XXL text encoder (type: wan)' },
  },
  // --- Experts: diffusion models (GGUF) -------------------------------------
  '212': {
    class_type: 'UnetLoaderGGUF',
    inputs: { unet_name: 'Wan2.2-I2V-A14B-HighNoise-Q6_K.gguf' },
    _meta: { title: 'High-noise expert (GGUF)' },
  },
  '211': {
    class_type: 'UnetLoaderGGUF',
    inputs: { unet_name: 'Wan2.2-I2V-A14B-LowNoise-Q6_K.gguf' },
    _meta: { title: 'Low-noise expert (GGUF)' },
  },
  '200': {
    class_type: 'ModelSamplingSD3',
    inputs: { model: ['212', 0], shift: 6 },
    _meta: { title: 'Model sampling — high (shift)' },
  },
  '189': {
    class_type: 'ModelSamplingSD3',
    inputs: { model: ['211', 0], shift: 6 },
    _meta: { title: 'Model sampling — low (shift)' },
  },
  // --- Prompts --------------------------------------------------------------
  '205': {
    class_type: 'CLIPTextEncode',
    inputs: { clip: ['184', 0], text: '' },
    _meta: { title: 'Positive prompt (motion)' },
  },
  '201': {
    class_type: 'CLIPTextEncode',
    inputs: { clip: ['184', 0], text: DEFAULT_NEGATIVE },
    _meta: { title: 'Negative prompt' },
  },
  // --- Conditioning + start latent ------------------------------------------
  '202': {
    class_type: 'WanAnimateToVideo',
    inputs: {
      positive: ['205', 0],
      negative: ['201', 0],
      vae: ['182', 0],
      reference_image: ['2', 0],
      width: 640,
      height: 960,
      length: 97,
      batch_size: 1,
      continue_motion_max_frames: 5,
      video_frame_offset: 0,
    },
    _meta: { title: 'WAN animate → video' },
  },
  // --- Two-stage sampling: high expert (0→4), then low expert (4→end) -------
  '198': {
    class_type: 'KSamplerAdvanced',
    inputs: {
      model: ['200', 0],
      positive: ['202', 0],
      negative: ['202', 1],
      latent_image: ['202', 2],
      add_noise: 'enable',
      noise_seed: 0,
      steps: 8,
      cfg: 1.5,
      sampler_name: 'euler_ancestral',
      scheduler: 'sgm_uniform',
      start_at_step: 0,
      end_at_step: 4,
      return_with_leftover_noise: 'enable',
    },
    _meta: { title: 'KSampler — high expert (0→4)' },
  },
  '196': {
    class_type: 'KSamplerAdvanced',
    inputs: {
      model: ['189', 0],
      positive: ['202', 0],
      negative: ['202', 1],
      latent_image: ['198', 0],
      add_noise: 'enable',
      noise_seed: 196909743390284,
      steps: 8,
      cfg: 1,
      sampler_name: 'euler_ancestral',
      scheduler: 'sgm_uniform',
      start_at_step: 4,
      end_at_step: 10000,
      return_with_leftover_noise: 'disable',
    },
    _meta: { title: 'KSampler — low expert (4→end)' },
  },
  // --- Decode + video sink --------------------------------------------------
  '193': {
    class_type: 'VAEDecode',
    inputs: { samples: ['196', 0], vae: ['182', 0] },
    _meta: { title: 'VAE Decode' },
  },
  // RIFE frame interpolation (ComfyUI-Frame-Interpolation): inserts in-between
  // frames for smoother motion. Sits between the decode and CreateVideo, so
  // the video plays the interpolated stream. Toggled by the `interpolation`
  // field (Off bypasses it and rewires CreateVideo back to the raw decode).
  '191': {
    class_type: 'RIFE VFI',
    inputs: {
      frames: ['193', 0],
      ckpt_name: 'rife49.pth',
      clear_cache_after_n_frames: 10,
      multiplier: 2,
      fast_mode: true,
      ensemble: true,
      scale_factor: 1,
      dtype: 'float32',
      torch_compile: false,
      batch_size: 1,
    },
    _meta: { title: 'RIFE frame interpolation' },
  },
  '187': {
    class_type: 'CreateVideo',
    inputs: { images: ['191', 0], fps: 24, bit_depth: 8 },
    _meta: { title: 'Create video' },
  },
  '3': {
    class_type: 'SaveVideo',
    inputs: {
      video: ['187', 0],
      filename_prefix: 'komfy/wan22-i2v',
      format: 'auto',
      codec: 'auto',
    },
    _meta: { title: 'Save video' },
  },
  // --- Optional last-frame branch (toggled by the `lastFrame` field) --------
  '185': {
    class_type: 'ImageFromBatch',
    inputs: { image: ['193', 0], batch_index: 999, length: 1 },
    _meta: { title: 'Last frame' },
  },
  '213': {
    class_type: 'SaveImage',
    inputs: { images: ['185', 0], filename_prefix: 'komfy/wan22-i2v-last' },
    _meta: { title: 'Save last frame' },
  },
};

export const wan22I2v: WorkflowManifest = {
  id: 'wan22-i2v',
  name: 'wf.i2v.name',
  description: 'wf.i2v.description',
  icon: 'film-outline',
  graph,
  // SaveVideo node — its filename_prefix is set at launch like any sink.
  saveNodeId: '3',
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.common.sourceImage',
      target: { nodeId: '2', input: 'image' },
      required: true,
    },
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: { nodeId: '205', input: 'text' },
      default: '',
      placeholder: 'wf.i2v.promptPlaceholder',
      multiline: true,
      required: true,
    },
    {
      kind: 'text',
      key: 'negative',
      label: 'wf.common.negativePrompt',
      target: { nodeId: '201', input: 'text' },
      default: DEFAULT_NEGATIVE,
      placeholder: 'wf.common.negativePlaceholder',
      multiline: true,
    },
    {
      kind: 'dimensions',
      key: 'format',
      label: 'wf.common.dimensions',
      widthTarget: { nodeId: '202', input: 'width' },
      heightTarget: { nodeId: '202', input: 'height' },
      // Portrait presets ("Invert" for landscape). The reference image is
      // resized to this format, so match it to the photo's orientation.
      options: [
        { width: 480, height: 832 },
        { width: 640, height: 960 },
        { width: 720, height: 1280 },
      ],
      default: { width: 640, height: 960 },
    },
    {
      kind: 'number',
      key: 'length',
      label: 'Frames',
      target: { nodeId: '202', input: 'length' },
      default: 97,
      min: 5,
      max: 121,
      integer: true,
      hint: 'wf.i2v.lengthHint',
    },
    {
      kind: 'number',
      key: 'fps',
      label: 'FPS',
      target: { nodeId: '187', input: 'fps' },
      default: 24,
      min: 1,
      max: 60,
      integer: true,
      hint: 'wf.i2v.fpsHint',
    },
    // RIFE frame interpolation. "Off" removes node 191 and rewires CreateVideo
    // (187) straight to the raw decode (193); ×N keeps 191 and sets its
    // multiplier. Active by default (×2) — the video plays interpolated frames,
    // so raise FPS to match if you want to keep real-time speed.
    {
      kind: 'select',
      key: 'interpolation',
      label: 'wf.i2v.interpolation',
      hint: 'wf.i2v.interpolationHint',
      defaultIndex: 1,
      remember: true,
      options: [
        {
          label: 'wf.i2v.interpOff',
          patches: [{ target: { nodeId: '187', input: 'images' }, value: ['193', 0] }],
          bypassNodes: ['191'],
        },
        { label: 'wf.i2v.interpX2', patches: [{ target: { nodeId: '191', input: 'multiplier' }, value: 2 }] },
        { label: 'wf.i2v.interpX3', patches: [{ target: { nodeId: '191', input: 'multiplier' }, value: 3 }] },
        { label: 'wf.i2v.interpX4', patches: [{ target: { nodeId: '191', input: 'multiplier' }, value: 4 }] },
      ],
    },
    // Experts: each diffusion model is picked from its GGUF loader's live enum
    // (server-driven, cf. requirements.modelFieldOptions). The high/low filter
    // narrows the list; it falls back to the full list when nothing matches.
    {
      kind: 'model',
      key: 'highModel',
      label: 'wf.i2v.highExpert',
      hint: 'wf.i2v.expertHint',
      target: { nodeId: '212', input: 'unet_name' },
      default: 'Wan2.2-I2V-A14B-HighNoise-Q6_K.gguf',
      filter: 'high',
      remember: true,
    },
    {
      kind: 'model',
      key: 'lowModel',
      label: 'wf.i2v.lowExpert',
      hint: 'wf.i2v.expertHint',
      target: { nodeId: '211', input: 'unet_name' },
      default: 'Wan2.2-I2V-A14B-LowNoise-Q6_K.gguf',
      filter: 'low',
      remember: true,
    },
    {
      kind: 'model',
      key: 'clip',
      label: 'wf.i2v.clip',
      hint: 'wf.i2v.clipHint',
      target: { nodeId: '184', input: 'clip_name' },
      default: 'umt5_xxl_fp16.safetensors',
      filter: 'umt5|t5',
      remember: true,
    },
    // Per-expert LoRAs (model-only chain). Defaulted to the lightx2v distill
    // LoRA the 8-step schedule needs; add your own on top in the form.
    {
      kind: 'loras',
      key: 'lorasHigh',
      label: 'wf.i2v.lorasHigh',
      hint: 'wf.common.lorasHint',
      modelSource: { nodeId: '212', output: 0 },
      modelTargets: [{ nodeId: '200', input: 'model' }],
      defaultStrength: 1,
      default: [{ name: LIGHTX2V_LORA, strength: 1 }],
    },
    {
      kind: 'loras',
      key: 'lorasLow',
      label: 'wf.i2v.lorasLow',
      hint: 'wf.common.lorasHint',
      modelSource: { nodeId: '211', output: 0 },
      modelTargets: [{ nodeId: '189', input: 'model' }],
      // The low expert's LoRAs also patch the shared CLIP, so both prompts read
      // a loraised text encoder (LoraLoader, MODEL + CLIP) — mirroring the
      // reference rgthree stack whose CLIP output (204→[204,1]) fed both
      // encoders. A raw CLIP leaves residual "sparkle" noise in the distilled
      // 8-step render, since lightx2v expects the modified conditioning.
      clipSource: { nodeId: '184', output: 0 },
      clipTargets: [
        { nodeId: '205', input: 'clip' },
        { nodeId: '201', input: 'clip' },
      ],
      defaultStrength: 1,
      default: [{ name: LIGHTX2V_LORA, strength: 1 }],
    },
    // Shift applied to both experts' ModelSamplingSD3.
    {
      kind: 'number',
      key: 'shift',
      label: 'Shift',
      target: { nodeId: '200', input: 'shift' },
      extraTargets: [{ nodeId: '189', input: 'shift' }],
      default: 6,
      min: 0,
      max: 20,
      hint: 'wf.i2v.shiftHint',
    },
    // Optional last-frame image (off by default): saves the video's final
    // frame as a still, to chain segments (loop / continuation workflows).
    {
      kind: 'select',
      key: 'lastFrame',
      label: 'wf.i2v.lastFrame',
      hint: 'wf.i2v.lastFrameHint',
      defaultIndex: 0,
      remember: true,
      options: [
        { label: 'wf.i2v.lastFrameOff', patches: [], bypassNodes: ['185', '213'] },
        { label: 'wf.i2v.lastFrameOn', patches: [] },
      ],
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '198', input: 'noise_seed' },
    },
  ],
};
