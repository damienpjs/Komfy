/**
 * Shared pieces of the three LTX 2.5 workflows (text → video, image → video,
 * first/last frame → video).
 *
 * All three drive one server node, `KomfyLTX25MLX` (server/komfy-ltx-mlx),
 * which runs the ltx-2-mlx CLI in a separate process: on Apple Silicon the MLX
 * port is about 16× faster than LTX 2.5 on PyTorch MPS. The node unloads
 * ComfyUI's models first, streams the CLI's progress into the queue and writes
 * the .mp4 to the output folder, so history, gallery and remix work as usual.
 *
 * The three graphs differ only by their LoadImage nodes wired into
 * `first_image` / `last_image`, which is also what tells them apart on remix
 * (structural fingerprint, cf. match.ts).
 *
 * Booleans are patched as 1 / 0: ComfyUI casts BOOLEAN inputs with bool(), and
 * SelectOption patches only carry strings and numbers.
 */

import type { PromptNode } from '../api/types';
import type { WorkflowField } from './types';

/** The KomfyLTX25MLX node id in every LTX 2.5 graph. */
export const LTX25_NODE = '1';

/**
 * Negative prompt for the CFG modes (two-stage, HQ, one-stage); the distilled
 * mode has no CFG and ignores it. Built from the Rushes pilot: cuts and
 * teleports were the first failure, then limbs crossing objects.
 */
export const LTX25_NEGATIVE =
  'jump cut, scene change, camera teleport, different location, sudden zoom, blurry, distorted face, deformed hands, limbs passing through objects, extra people, text, watermark, subtitles';

/** Frozen KomfyLTX25MLX node; `images` wires the optional image inputs. */
export function ltx25Node(
  prefix: string,
  images: { first?: string; last?: string } = {},
): PromptNode {
  return {
    class_type: 'KomfyLTX25MLX',
    inputs: {
      model_pack: 'ltx-2.5-mlx-q8',
      prompt: '',
      negative_prompt: LTX25_NEGATIVE,
      mode: 'distilled',
      width: 768,
      height: 576,
      fit_to_image: 1,
      duration: 5,
      frame_rate: 24,
      seed: 0,
      first_strength: 1,
      last_strength: 1,
      lora_name: 'None',
      lora_strength: 1,
      audio: 1,
      low_ram: 0,
      tile_frames: 1,
      save_last_frame: 0,
      filename_prefix: prefix,
      ...(images.first ? { first_image: [images.first, 0] } : {}),
      ...(images.last ? { last_image: [images.last, 0] } : {}),
    },
    _meta: { title: 'LTX 2.5 (MLX) · Komfy' },
  };
}

export function loadImageNode(title: string): PromptNode {
  return {
    class_type: 'LoadImage',
    inputs: { image: '' },
    _meta: { title },
  };
}

const target = (input: string) => ({ nodeId: LTX25_NODE, input });

/** On/Off select patching a BOOLEAN input of the node. */
function toggle(
  key: string,
  input: string,
  defaultOn: boolean,
  extra: { hint?: string; remember?: boolean } = {},
): WorkflowField {
  return {
    kind: 'select',
    key,
    label: `wf.ltx25.${key}`,
    hint: extra.hint,
    remember: extra.remember,
    defaultIndex: defaultOn ? 0 : 1,
    options: [
      { label: 'wf.ltx25.on', patches: [{ target: target(input), value: 1 }] },
      { label: 'wf.ltx25.off', patches: [{ target: target(input), value: 0 }] },
    ],
  };
}

/** Prompt + negative, first in every LTX 2.5 form. */
export function ltx25PromptFields(placeholder: string): WorkflowField[] {
  return [
    {
      kind: 'text',
      key: 'prompt',
      label: 'Prompt',
      target: target('prompt'),
      default: '',
      placeholder,
      hint: 'wf.ltx25.promptHint',
      multiline: true,
      required: true,
    },
    {
      kind: 'text',
      key: 'negative',
      label: 'wf.common.negativePrompt',
      target: target('negative_prompt'),
      default: LTX25_NEGATIVE,
      placeholder: 'wf.common.negativePlaceholder',
      hint: 'wf.ltx25.negativeHint',
      multiline: true,
    },
  ];
}

/** Anchor strengths: first (i2v, flf) and last (flf). */
export function ltx25StrengthFields(withLast: boolean): WorkflowField[] {
  const fields: WorkflowField[] = [
    {
      kind: 'number',
      key: 'firstStrength',
      label: 'wf.ltx25.firstStrength',
      target: target('first_strength'),
      default: 1,
      min: 0,
      max: 1,
      hint: 'wf.ltx25.firstStrengthHint',
    },
  ];
  if (withLast) {
    fields.push({
      kind: 'number',
      key: 'lastStrength',
      label: 'wf.ltx25.lastStrength',
      target: target('last_strength'),
      default: 1,
      min: 0,
      max: 1,
      hint: 'wf.ltx25.lastStrengthHint',
    });
  }
  return fields;
}

/**
 * Everything after the prompt and the images: format, duration, quality
 * mode, model pack, LoRA, memory levers, seed. `withImage` adds the
 * fit-to-image toggle (i2v, flf).
 */
export function ltx25CommonFields(withImage: boolean): WorkflowField[] {
  return [
    {
      kind: 'dimensions',
      key: 'format',
      label: 'wf.common.dimensions',
      hint: withImage ? 'wf.ltx25.formatImageHint' : 'wf.ltx25.formatHint',
      widthTarget: target('width'),
      heightTarget: target('height'),
      // Landscape presets, every side a multiple of 64 (stage 1 runs at half
      // resolution, whose sides must stay multiples of 32).
      options: [
        { width: 704, height: 384 },
        { width: 768, height: 448 },
        { width: 768, height: 576 },
        { width: 1024, height: 576 },
        { width: 1280, height: 704 },
      ],
      default: { width: 768, height: 576 },
    },
    ...(withImage
      ? [toggle('fitToImage', 'fit_to_image', true, { hint: 'wf.ltx25.fitToImageHint' })]
      : []),
    {
      kind: 'number',
      key: 'duration',
      label: 'wf.ltx25.duration',
      target: target('duration'),
      default: 5,
      min: 0,
      max: 20,
      hint: 'wf.ltx25.durationHint',
    },
    {
      kind: 'number',
      key: 'fps',
      label: 'FPS',
      target: target('frame_rate'),
      default: 24,
      min: 8,
      max: 50,
      integer: true,
      hint: 'wf.ltx25.fpsHint',
    },
    {
      kind: 'select',
      key: 'mode',
      label: 'wf.ltx25.mode',
      hint: 'wf.ltx25.modeHint',
      defaultIndex: 0,
      remember: true,
      options: [
        { label: 'wf.ltx25.modeDistilled', patches: [{ target: target('mode'), value: 'distilled' }] },
        { label: 'wf.ltx25.modeTwoStage', patches: [{ target: target('mode'), value: 'two_stage' }] },
        { label: 'wf.ltx25.modeHq', patches: [{ target: target('mode'), value: 'two_stages_hq' }] },
        { label: 'wf.ltx25.modeOneStage', patches: [{ target: target('mode'), value: 'one_stage' }] },
      ],
    },
    {
      kind: 'model',
      key: 'pack',
      label: 'wf.ltx25.pack',
      hint: 'wf.ltx25.packHint',
      target: target('model_pack'),
      default: 'ltx-2.5-mlx-q8',
      filter: 'ltx-2\\.5',
      remember: true,
    },
    {
      kind: 'model',
      key: 'lora',
      label: 'wf.ltx25.lora',
      hint: 'wf.ltx25.loraHint',
      target: target('lora_name'),
      default: 'None',
      filter: 'ltx|^None$',
      remember: true,
    },
    {
      kind: 'number',
      key: 'loraStrength',
      label: 'wf.ltx25.loraStrength',
      target: target('lora_strength'),
      default: 1,
      min: -2,
      max: 2,
    },
    toggle('audio', 'audio', true, { remember: true }),
    toggle('lowRam', 'low_ram', false, { hint: 'wf.ltx25.lowRamHint', remember: true }),
    {
      kind: 'number',
      key: 'tileFrames',
      label: 'wf.ltx25.tileFrames',
      target: target('tile_frames'),
      default: 1,
      min: 1,
      max: 8,
      integer: true,
      hint: 'wf.ltx25.tileFramesHint',
    },
    toggle('lastFrame', 'save_last_frame', false, { hint: 'wf.ltx25.lastFrameHint', remember: true }),
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: target('seed'),
    },
  ];
}
