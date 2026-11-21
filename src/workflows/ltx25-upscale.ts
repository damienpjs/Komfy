/**
 * LTX 2.5: x2 video upscale, through MLX (KomfyLTX25UpscaleMLX,
 * server/komfy-ltx-mlx). The clip comes from the gallery (a LoadVideo fed
 * an annotated `[output]` path: no upload), the node runs `ltx-2-mlx
 * ic-lora --single-stage` with the Pixel-Spatial-Upscaler x2 IC-LoRA, the
 * source as video conditioning and an optional identity LoRA, then muxes the
 * source's audio back. Size, frame count and frame rate follow the source.
 *
 * Validated on 2026-11-21 on a talking take: motion and mouth kept frame for
 * frame, so the lip sync carries over; identity LoRA 1.0 a clear gain over
 * none, 1.2 to 1.5 marginal (the maintainer keeps 1.5). About 38 min for
 * 4.4 s from 512×768: the final, expensive step of the pipeline, run on the
 * chosen take only.
 */

import type { PromptGraph } from '../api/types';
import type { WorkflowField, WorkflowManifest } from './types';

const NODE = '1';
const SOURCE = '2';

const graph: PromptGraph = {
  [NODE]: {
    class_type: 'KomfyLTX25UpscaleMLX',
    inputs: {
      model_pack: 'ltx-2.5-mlx-q8',
      video: [SOURCE, 0],
      prompt: '',
      lora_name: 'None',
      lora_strength: 1.5,
      seed: 0,
      low_ram: 0,
      filename_prefix: 'komfy/ltx25-upscale',
    },
    _meta: { title: 'LTX 2.5 video upscale x2 (MLX) · Komfy' },
  },
  [SOURCE]: {
    class_type: 'LoadVideo',
    inputs: { file: '' },
    _meta: { title: 'Source video' },
  },
};

const target = (input: string) => ({ nodeId: NODE, input });

const fields: WorkflowField[] = [
  {
    kind: 'video',
    key: 'video',
    label: 'wf.ltxUpscale.video',
    hint: 'wf.ltxUpscale.videoHint',
    target: { nodeId: SOURCE, input: 'file' },
    required: true,
    upscaleEstimate: true,
  },
  {
    kind: 'text',
    key: 'prompt',
    label: 'Prompt',
    target: target('prompt'),
    default: '',
    placeholder: 'wf.ltxUpscale.promptPlaceholder',
    hint: 'wf.ltxUpscale.promptHint',
    multiline: true,
    required: true,
  },
  {
    kind: 'model',
    key: 'lora',
    label: 'wf.ltxUpscale.lora',
    hint: 'wf.ltxUpscale.loraHint',
    target: target('lora_name'),
    default: 'None',
    filter: 'ltx|^None$',
    remember: true,
  },
  {
    kind: 'number',
    key: 'loraStrength',
    label: 'wf.ltx25.loraStrength',
    hint: 'wf.ltxUpscale.loraStrengthHint',
    target: target('lora_strength'),
    default: 1.5,
    min: -2,
    max: 2,
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
    advanced: true,
  },
  {
    kind: 'select',
    key: 'lowRam',
    label: 'wf.ltx25.lowRam',
    hint: 'wf.ltx25.lowRamHint',
    remember: true,
    advanced: true,
    defaultIndex: 1,
    options: [
      { label: 'wf.ltx25.on', patches: [{ target: target('low_ram'), value: 1 }] },
      { label: 'wf.ltx25.off', patches: [{ target: target('low_ram'), value: 0 }] },
    ],
  },
  {
    kind: 'seed',
    key: 'seed',
    label: 'Seed',
    target: target('seed'),
  },
];

export const ltx25Upscale: WorkflowManifest = {
  id: 'ltx25-upscale',
  name: 'wf.ltxUpscale.name',
  description: 'wf.ltxUpscale.description',
  icon: 'expand-outline',
  graph,
  saveNodeId: NODE,
  fields,
};
