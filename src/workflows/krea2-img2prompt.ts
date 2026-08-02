/**
 * Image → Prompt (text result, no image produced).
 * LoadImage → OllamaChat (local Gemma-4) → ShowText: the generated prompt
 * surfaces in /history (the ShowText node's ui.text) and the app shows it
 * on the result screen (`textNodeId`), from which it can be copied or sent
 * to the t2i. The "Prompt style" select (prompt-styles) patches the system
 * instruction for the target model — default KREA2 (verbatim from a proven
 * personal workflow).
 *
 * An OllamaOptionsV2 with `enable_seed` provides a seed: redrawing the seed
 * gives a new description (and busts the ComfyUI cache — without a seed,
 * OllamaChat has no IS_CHANGED and re-running would return the same text).
 * All OllamaOptionsV2 inputs are required in API format → defaults taken
 * from /object_info, only enable_seed/seed are active.
 */

import type { PromptGraph } from '../api/types';
import { IMAGE2PROMPT_SYSTEM, promptStyleField } from './prompt-styles';
import type { WorkflowManifest } from './types';

const graph: PromptGraph = {
  '1': {
    class_type: 'LoadImage',
    inputs: {
      image: '',
    },
    _meta: { title: 'Image to describe' },
  },
  '2': {
    class_type: 'OllamaConnectivityV2',
    inputs: {
      url: 'http://127.0.0.1:11434',
      model: 'gemma4-vision:latest',
      keep_alive: 0,
      keep_alive_unit: 'minutes',
    },
    _meta: { title: 'Local Ollama (Gemma-4, unloaded after the call)' },
  },
  '3': {
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
  '4': {
    class_type: 'OllamaChat',
    inputs: {
      connectivity: ['2', 0],
      options: ['3', 0],
      images: ['1', 0],
      system: IMAGE2PROMPT_SYSTEM,
      prompt: '',
      think: false,
      format: 'text',
    },
    _meta: { title: 'Gemma-4 describes the image → KREA2 prompt' },
  },
  '5': {
    class_type: 'ShowText|pysssss',
    inputs: {
      text: ['4', 0],
    },
    _meta: { title: 'Generated prompt' },
  },
};

export const krea2Img2Prompt: WorkflowManifest = {
  id: 'krea2-img2prompt',
  name: 'wf.i2p.name',
  description: 'wf.i2p.description',
  icon: 'document-text-outline',
  graph,
  textNodeId: '5',
  fields: [
    {
      kind: 'image',
      key: 'image',
      label: 'wf.i2p.image',
      target: { nodeId: '1', input: 'image' },
      required: true,
      hint: 'wf.common.needsOllama',
    },
    promptStyleField('image', { nodeId: '4', input: 'system' }),
    {
      kind: 'text',
      key: 'consigne',
      label: 'wf.i2p.instruction',
      target: { nodeId: '4', input: 'prompt' },
      default: '',
      placeholder: 'wf.i2p.instructionPlaceholder',
      multiline: true,
      hint: 'wf.i2p.instructionHint',
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: { nodeId: '3', input: 'seed' },
      hint: 'wf.i2p.seedHint',
    },
  ],
};
