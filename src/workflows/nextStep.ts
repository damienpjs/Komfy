/**
 * "Use in…" from the viewer: the next step of the video pipeline for a
 * gallery item, prefilled. A still goes to the LTX image modes (animate,
 * make it talk, first frame), a clip to the x2 video upscale with its
 * prompt, identity LoRA and seed taken from its recipe, and a generated
 * voice (IndexTTS) to the talking video as its voice.
 *
 * The item travels as a loader value, not as a file: an output is passed
 * annotated (`sub/x.mp4 [output]`, cf. utils/annotated), which LoadImage and
 * LoadVideo resolve in the output folder. Nothing is downloaded to the
 * phone or uploaded again.
 */

import type { PromptGraph } from '../api/types';
import type { GalleryImage } from '../hooks/useGallery';
import { inputRef, outputRef } from '../utils/annotated';
import type { SourceSeeds } from './match';
import type { FieldValues } from './types';

export interface UseInTarget {
  manifestId: string;
  /** i18n key of the action label. */
  label: string;
  values: FieldValues;
  /** Source seed, offered back by the form (not applied). */
  seeds?: SourceSeeds;
}

/** Loader value of a gallery item (output annotated, input as is). */
export function mediaRef(image: GalleryImage): string {
  return image.root === 'output'
    ? outputRef(image.subfolder, image.filename)
    : inputRef(image.subfolder, image.filename);
}

/** Node classes whose recipe gives the upscale its prompt, LoRA and seed. */
const LTX_NODES = new Set(['KomfyLTX25MLX', 'KomfyLTX25UpscaleMLX']);

/** A generated voice (an mp4 of the speech): it becomes a talking video. */
const VOICE_NODE = 'KomfyIndexTTS';

export function nextStepTargets(image: GalleryImage, recipe: PromptGraph | null): UseInTarget[] {
  const ref = mediaRef(image);
  if (!image.isVideo) {
    return [
      { manifestId: 'ltx25-i2v', label: 'viewer.useAnimate', values: { image: ref } },
      { manifestId: 'ltx25-a2v', label: 'viewer.useTalk', values: { image: ref } },
      { manifestId: 'ltx25-flf', label: 'viewer.useFirstFrame', values: { image: ref } },
    ];
  }
  // A voice clip: LoadAudio reads the mp4's audio track as the voice.
  if (recipe && Object.values(recipe).some((n) => n.class_type === VOICE_NODE)) {
    return [{ manifestId: 'ltx25-a2v', label: 'viewer.useVoice', values: { voice: ref } }];
  }
  const values: FieldValues = { video: ref };
  const seeds: SourceSeeds = {};
  const node = recipe
    ? Object.values(recipe).find((n) => LTX_NODES.has(n.class_type))
    : undefined;
  if (node) {
    const { prompt, lora_name: lora, seed } = node.inputs;
    if (typeof prompt === 'string' && prompt.trim() !== '') values.prompt = prompt;
    if (typeof lora === 'string' && lora !== 'None') values.lora = lora;
    if (typeof seed === 'number') seeds.seed = seed;
  }
  return [{ manifestId: 'ltx25-upscale', label: 'viewer.useUpscale', values, seeds }];
}
