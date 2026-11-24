/**
 * LTX 2.5: keyframes → video + audio, through MLX (KomfyLTX25MLX, cf.
 * ltx25-shared.ts): `--image FIRST 0 S --image LAST last S`, plus one
 * `--image KEY FRAME S guide` per keyframe pinned in between and optional
 * per-stretch prompts (the `keyframes` JSON input, cf. KeyframesField and
 * server/komfy-ltx-mlx/keyframes.py). Without keyframes the graph is the
 * first/last frame graph it has always been: same id, presets, remix.
 *
 * The use case: a first/last shot whose motion is right but whose faces
 * drift is rebuilt with the same recipe and seed, its frames retouched
 * (faces swapped back) and pinned on the frames they were grabbed from.
 *
 * The end anchor is what holds the set in place over a whole segment (Rushes
 * pilot: without it the HQ mode cut away at frame 2 and reinvented the
 * scene). It holds the set, not a person's identity. The last frame comes out
 * corrupted with an end anchor: keep frames 2 to N-2 when editing, and the
 * "save last frame" option already takes frame N-2.
 */

import type { PromptGraph } from '../api/types';
import {
  LTX25_NODE,
  loadImageNode,
  ltx25CommonFields,
  ltx25Node,
  ltx25PromptFields,
  ltx25StrengthFields,
} from './ltx25-shared';
import type { WorkflowManifest } from './types';

/** Pictures in between: each costs one more latent frame of tokens. */
const MAX_KEYFRAMES = 12;

const FIRST = '2';
const LAST = '3';

const graph: PromptGraph = {
  [LTX25_NODE]: ltx25Node('komfy/ltx25-flf', { first: FIRST, last: LAST }),
  [FIRST]: loadImageNode('First frame'),
  [LAST]: loadImageNode('Last frame'),
};

export const ltx25Flf: WorkflowManifest = {
  id: 'ltx25-flf',
  name: 'wf.ltx25.flfName',
  description: 'wf.ltx25.flfDescription',
  icon: 'swap-horizontal-outline',
  output: 'video',
  graph,
  saveNodeId: LTX25_NODE,
  fields: [
    {
      // Draws the two image fields and their strengths below at its ends.
      kind: 'keyframes',
      key: 'keyframes',
      label: 'wf.ltx25.timeline',
      hint: 'wf.ltx25.timelineHint',
      target: { nodeId: LTX25_NODE, input: 'keyframes' },
      ends: {
        first: 'image',
        last: 'lastImage',
        firstStrength: 'firstStrength',
        lastStrength: 'lastStrength',
      },
      durationKey: 'duration',
      fpsKey: 'fps',
      tileFramesKey: 'tileFrames',
      maxKeys: MAX_KEYFRAMES,
    },
    {
      kind: 'image',
      key: 'image',
      label: 'wf.ltx25.firstImage',
      target: { nodeId: FIRST, input: 'image' },
      required: true,
    },
    {
      kind: 'image',
      key: 'lastImage',
      label: 'wf.ltx25.lastImage',
      hint: 'wf.ltx25.lastImageHint',
      target: { nodeId: LAST, input: 'image' },
      required: true,
    },
    ...ltx25PromptFields('wf.ltx25.flfPlaceholder'),
    ...ltx25StrengthFields(true),
    ...ltx25CommonFields(true),
  ],
};
