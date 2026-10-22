/**
 * LTX 2.5: first frame + last frame → video + audio, through MLX
 * (KomfyLTX25MLX, cf. ltx25-shared.ts): `--image FIRST 0 S --image LAST last S`.
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
  graph,
  saveNodeId: LTX25_NODE,
  fields: [
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
