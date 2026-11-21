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
 * The text-to-video graph also carries three optional character-reference
 * photos (LoadImage 11-13 → ref_1..ref_3): with at least one, the node
 * switches to the Ingredients IC-LoRA (ltx-2-mlx ic-lora); an empty one is
 * dropped at launch (`omitWhenEmpty`), so with none the render is unchanged.
 * Image to video and first/last frame do not get them: measured, the clip
 * leaves the start image after frame 0 and films the reference sheet.
 *
 * Booleans are patched as 1 / 0: ComfyUI casts BOOLEAN inputs with bool(), and
 * SelectOption patches only carry strings and numbers.
 */

import type { PromptNode } from '../api/types';
import type { WorkflowField } from './types';

/** The KomfyLTX25MLX node id in every LTX 2.5 graph. */
export const LTX25_NODE = '1';

/** LoadImage nodes of the optional character references (ref_1..ref_3). */
export const LTX25_REF_NODES = ['11', '12', '13'] as const;

/** Ingredients IC-LoRA for 2.5, relative to models/loras. */
const INGREDIENTS_LORA = 'ltx/ic-lora/ltx-2.5-22b-ic-lora-ingredients-0.9.safetensors';

/**
 * Frozen KomfyLTX25MLX node; `images` wires the optional image inputs and
 * the voice (a LoadAudio: talking video), `refs` the character references
 * (text to video only).
 */
export function ltx25Node(
  prefix: string,
  images: { first?: string; last?: string; voice?: string } = {},
  refs = false,
): PromptNode {
  return {
    class_type: 'KomfyLTX25MLX',
    inputs: {
      model_pack: 'ltx-2.5-mlx-q8',
      prompt: '',
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
      ...(images.voice
        ? { voice: [images.voice, 0], voice_normalize: 1, lip_sync_hint: 1 }
        : {}),
      ...(refs
        ? {
            ref_1: [LTX25_REF_NODES[0], 0],
            ref_2: [LTX25_REF_NODES[1], 0],
            ref_3: [LTX25_REF_NODES[2], 0],
            ingredients_lora: INGREDIENTS_LORA,
            ingredients_strength: 1,
            reference_strength: 1,
          }
        : {}),
    },
    _meta: { title: 'LTX 2.5 (MLX) · Komfy' },
  };
}

export function loadAudioNode(title: string): PromptNode {
  return {
    class_type: 'LoadAudio',
    inputs: { audio: '' },
    _meta: { title },
  };
}

export function loadImageNode(title: string): PromptNode {
  return {
    class_type: 'LoadImage',
    inputs: { image: '' },
    _meta: { title },
  };
}

/** The three reference LoadImage nodes, to spread into the text-to-video graph. */
export function ltx25RefNodes(): Record<string, PromptNode> {
  return Object.fromEntries(
    LTX25_REF_NODES.map((id, i) => [id, loadImageNode(`Reference ${i + 1}`)]),
  );
}

const target = (input: string) => ({ nodeId: LTX25_NODE, input });

/**
 * Optional character references: up to three photos, each offered once the
 * previous one is filled, plus the two strengths (advanced).
 */
export function ltx25RefFields(): WorkflowField[] {
  const photos: WorkflowField[] = LTX25_REF_NODES.map((nodeId, i) => ({
    kind: 'image',
    key: `ref${i + 1}`,
    label: `wf.ltxRefs.ref${i + 1}`,
    hint: i === 0 ? 'wf.ltxRefs.hint' : undefined,
    target: { nodeId, input: 'image' },
    omitWhenEmpty: true,
    showWhen: i === 0 ? undefined : { key: `ref${i}`, filled: true },
  }));
  return [
    ...photos,
    {
      kind: 'number',
      key: 'refsLora',
      label: 'wf.ltxRefs.lora',
      hint: 'wf.ltxRefs.loraHint',
      target: target('ingredients_strength'),
      default: 1,
      min: 0,
      max: 2,
      advanced: true,
    },
    {
      kind: 'number',
      key: 'refsGuide',
      label: 'wf.ltxRefs.guide',
      hint: 'wf.ltxRefs.guideHint',
      target: target('reference_strength'),
      default: 1,
      min: 0,
      max: 1,
      advanced: true,
    },
  ];
}

/** On/Off select patching a BOOLEAN input of the node. */
export function toggle(
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

/** The prompt, first in every LTX 2.5 form (no negative: the distilled mode has no CFG). */
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

const VOICE_OMITS = new Set(['duration', 'audio', 'tileFrames']);

/**
 * Everything after the prompt and the images: format, duration, model pack,
 * LoRA, memory levers, seed. There is no quality picker: every render uses
 * the distilled mode, the only one that keeps a character LoRA speaking in
 * its own voice (the CFG modes gave voice-over and mannered gestures), and
 * the final quality comes from the x2 video upscale (ltx25-upscale).
 * `withImage` adds the fit-to-image toggle (i2v, flf, a2v); `voice` drops
 * what a voice decides (a2v).
 */
export function ltx25CommonFields(withImage: boolean, voice = false): WorkflowField[] {
  const fields: WorkflowField[] = [
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
  // With a voice the clip length follows the voice, the soundtrack is the
  // voice itself, and a2v has no temporal tiles.
  return voice ? fields.filter((f) => !VOICE_OMITS.has(f.key)) : fields;
}
