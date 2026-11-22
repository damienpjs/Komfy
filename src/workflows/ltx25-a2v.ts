/**
 * LTX 2.5: image + voice → talking video, through MLX (KomfyLTX25MLX with a
 * `voice` input, cf. ltx25-shared.ts). The node runs `ltx-2-mlx a2v
 * --distilled`: the voice drives the lips, its length (plus the silence asked
 * after it) sets the clip's, and a character LoRA is fused in (a2v_lora.py)
 * so the face is the character's while the voice stays the one recorded.
 *
 * An optional last image turns it into first/last frame with a voice (end
 * anchor `--image LAST last S`, dropped at launch when empty). Measured on
 * 2026-11-22: the lips keep following the voice as long as the prompt
 * describes the last image's pose and does not ask for a closed mouth. The
 * end anchor held on a 105-frame clip; on 137 and 153 frames (voice plus
 * silence) the motion drifted and the last image showed up only at the end.
 *
 * Validated end to end on 2026-11-21 (identity LoRA at 1.0, a phone
 * recording normalized to about -18 dB, 512×768, about 2.5 min for 4.4 s):
 * the cheap draft of the pipeline. Iterate here on the gesture and the
 * framing, then upscale the chosen take with ltx25-upscale.
 */

import type { PromptGraph } from '../api/types';
import {
  LTX25_NODE,
  loadAudioNode,
  loadImageNode,
  ltx25CommonFields,
  ltx25Node,
  ltx25PromptFields,
  ltx25StrengthFields,
  toggle,
} from './ltx25-shared';
import type { WorkflowManifest } from './types';

const FIRST = '2';
const VOICE = '3';
const LAST = '4';

/** Longest voice the node accepts (VOICE_MAX_SECONDS on the server). */
const VOICE_MAX_SECONDS = 20;

const graph: PromptGraph = {
  [LTX25_NODE]: ltx25Node('komfy/ltx25-a2v', { first: FIRST, last: LAST, voice: VOICE }),
  [FIRST]: loadImageNode('First frame'),
  [VOICE]: loadAudioNode('Voice'),
  [LAST]: loadImageNode('Last frame'),
};

export const ltx25A2v: WorkflowManifest = {
  id: 'ltx25-a2v',
  name: 'wf.ltx25.a2vName',
  description: 'wf.ltx25.a2vDescription',
  icon: 'videocam-outline',
  output: 'video',
  graph,
  saveNodeId: LTX25_NODE,
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.common.sourceImage',
      target: { nodeId: FIRST, input: 'image' },
      required: true,
    },
    {
      kind: 'audio',
      key: 'voice',
      label: 'wf.ltx25.voice',
      hint: 'wf.ltx25.voiceHint',
      target: { nodeId: VOICE, input: 'audio' },
      required: true,
      maxSeconds: VOICE_MAX_SECONDS,
    },
    {
      kind: 'image',
      key: 'lastImage',
      label: 'wf.ltx25.lastImage',
      hint: 'wf.ltx25.a2vLastImageHint',
      target: { nodeId: LAST, input: 'image' },
      omitWhenEmpty: true,
    },
    ...ltx25PromptFields('wf.ltx25.a2vPlaceholder'),
    toggle('lipSync', 'lip_sync_hint', true, { hint: 'wf.ltx25.lipSyncHint', remember: true }),
    {
      kind: 'number',
      key: 'silenceAfter',
      label: 'wf.ltx25.silenceAfter',
      hint: 'wf.ltx25.silenceAfterHint',
      target: { nodeId: LTX25_NODE, input: 'silence_after' },
      default: 0,
      min: 0,
      max: 10,
    },
    ...ltx25StrengthFields(true, 'lastImage'),
    ...ltx25CommonFields(true, true),
  ],
};
