/**
 * Text → Prompt (text result, no image produced).
 * The user types a raw idea; Gemma-4 (local Ollama) expands it into a full
 * prompt following the chosen model's conventions ("Prompt style" select:
 * KREA2, Flux, SDXL, Pony, LucentXL, Illustrious).
 *
 * Same mechanics as krea2-img2prompt: OllamaChat without the `images` input
 * (optional on the node), OllamaOptionsV2 with `enable_seed` to redraw a
 * variant (and bust the ComfyUI cache — without a seed, OllamaChat has no
 * IS_CHANGED), ShowText as the text output (textNodeId); the result screen
 * lets you copy the prompt or send it to the t2i.
 */

import type { PromptGraph } from '../api/types';
import { promptStyleField, TEXT2PROMPT_DEFAULT_SYSTEM } from './prompt-styles';
import type { WorkflowManifest } from './types';

const graph: PromptGraph = {
  '1': {
    class_type: 'OllamaConnectivityV2',
    inputs: {
      url: 'http://127.0.0.1:11434',
      model: 'gemma4-vision:latest',
      keep_alive: 0,
      keep_alive_unit: 'minutes',
    },
    _meta: { title: 'Local Ollama (Gemma-4, unloaded after the call)' },
  },
  '2': {
    class_type: 'OllamaOptionsV2',
    inputs: {
      enable_mirostat: false,
      mirostat: 0,
      enable_mirostat_eta: false,
      mirostat_eta: 0.1,
      enable_mirostat_tau: false,
      mirostat_tau: 5.0,
      enable_num_ctx: false,
      num_ctx: 2048,
      enable_repeat_last_n: false,
      repeat_last_n: 64,
      enable_repeat_penalty: false,
      repeat_penalty: 1.1,
      enable_temperature: false,
      temperature: 0.8,
      enable_seed: true,
      seed: 0,
      enable_stop: false,
      stop: '',
      enable_tfs_z: false,
      tfs_z: 1,
      enable_num_predict: false,
      num_predict: -1,
      enable_top_k: false,
      top_k: 40,
      enable_top_p: false,
      top_p: 0.9,
      enable_min_p: false,
      min_p: 0.0,
      debug: false,
    },
    _meta: { title: 'Ollama options (seed enabled)' },
  },
  '3': {
    class_type: 'OllamaChat',
    inputs: {
      connectivity: ['1', 0],
      options: ['2', 0],
      system: TEXT2PROMPT_DEFAULT_SYSTEM,
      prompt: '',
      think: false,
      format: 'text',
    },
    _meta: { title: 'Gemma-4 expands the idea → prompt' },
  },
  '4': {
    class_type: 'ShowText|pysssss',
    inputs: {
      text: ['3', 0],
    },
    _meta: { title: 'Generated prompt' },
  },
};

export const text2Prompt: WorkflowManifest = {
  id: 'text2prompt',
  name: 'wf.t2p.name',
  description: 'wf.t2p.description',
  icon: 'sparkles-outline',
  graph,
  textNodeId: '4',
  fields: [
    {
      kind: 'text',
      key: 'idee',
      label: 'wf.t2p.idea',
      target: { nodeId: '3', input: 'prompt' },
      default: '',
      placeholder: 'wf.t2p.ideaPlaceholder',
      multiline: true,
      required: true,
      hint: 'wf.common.needsOllama',
    },
    promptStyleField('text', { nodeId: '3', input: 'system' }),
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '2', input: 'seed' },
      hint: 'wf.t2p.seedHint',
    },
  ],
};
