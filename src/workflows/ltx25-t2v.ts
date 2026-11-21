/**
 * LTX 2.5: text → video + audio, through MLX (KomfyLTX25MLX, cf.
 * ltx25-shared.ts). A single node: no image input wired.
 */

import type { PromptGraph } from '../api/types';
import {
  LTX25_NODE,
  ltx25CommonFields,
  ltx25Node,
  ltx25PromptFields,
  ltx25RefFields,
  ltx25RefNodes,
} from './ltx25-shared';
import type { WorkflowManifest } from './types';

const graph: PromptGraph = {
  ...ltx25RefNodes(),
  [LTX25_NODE]: ltx25Node('komfy/ltx25-t2v', {}, true),
};

export const ltx25T2v: WorkflowManifest = {
  id: 'ltx25-t2v',
  name: 'wf.ltx25.t2vName',
  description: 'wf.ltx25.t2vDescription',
  icon: 'film-outline',
  graph,
  saveNodeId: LTX25_NODE,
  fields: [
    ...ltx25PromptFields('wf.ltx25.t2vPlaceholder'),
    ...ltx25RefFields(),
    ...ltx25CommonFields(false),
  ],
};
