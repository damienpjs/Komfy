/**
 * LTX 2.5: image → video + audio, through MLX (KomfyLTX25MLX, cf.
 * ltx25-shared.ts). The photo anchors frame 0 (`--image PATH 0 STRENGTH`).
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

const graph: PromptGraph = {
  [LTX25_NODE]: ltx25Node('komfy/ltx25-i2v', { first: FIRST }),
  [FIRST]: loadImageNode('First frame'),
};

export const ltx25I2v: WorkflowManifest = {
  id: 'ltx25-i2v',
  name: 'wf.ltx25.i2vName',
  description: 'wf.ltx25.i2vDescription',
  icon: 'videocam-outline',
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
    ...ltx25PromptFields('wf.ltx25.i2vPlaceholder'),
    ...ltx25StrengthFields(false),
    ...ltx25CommonFields(true),
  ],
};
