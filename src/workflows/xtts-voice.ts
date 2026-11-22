/**
 * XTTS v2: a line said in a cloned voice, in 17 languages, French first
 * (KomfyXTTS, server/komfy-xtts). The second mode of "Generate a voice",
 * next to IndexTTS (indextts-voice): no emotion mixer, French instead.
 * Same output as IndexTTS (an mp4, the waveform over the speech), same
 * voices (the server's models/voices folder), so the clip feeds the
 * talking-video workflow the same way (cf. nextStep.ts).
 *
 * The graph's `engine` literal is checked against the node's own list, which
 * the server fills only when the XTTS virtualenv and weights are found: a
 * missing or half-done install shows on the form before a launch.
 *
 * Measured on the maintainer's voice (2026-11-22, the 25 s sample, CPU of
 * an M3 Max): about 20 s to load, then roughly real time; a 25 s sample
 * clones better than a longer phone recording, which added silence or
 * mumbling after the line.
 */

import type { PromptGraph } from '../api/types';
import { NO_VOICE } from './indextts-voice';
import type { WorkflowManifest } from './types';

const TTS = '1';
const SAMPLE = '2';

/** Value the server lists for `engine` once XTTS is installed. */
const ENGINE = 'XTTS-v2';

const graph: PromptGraph = {
  [TTS]: {
    class_type: 'KomfyXTTS',
    inputs: {
      engine: ENGINE,
      voice: NO_VOICE,
      text: '',
      language: 'fr',
      temperature: 0.75,
      speed: 1,
      seed: 0,
      filename_prefix: 'komfy/xtts-voice',
      voice_audio: [SAMPLE, 0],
      save_voice_as: '',
    },
    _meta: { title: 'XTTS v2 voice · Komfy' },
  },
  [SAMPLE]: {
    class_type: 'LoadAudio',
    inputs: { audio: '' },
    _meta: { title: 'New voice sample' },
  },
};

const target = (input: string) => ({ nodeId: TTS, input });

/** XTTS v2's languages (its config.json), French first. */
const LANGUAGES = [
  'fr', 'en', 'es', 'de', 'it', 'pt', 'pl', 'tr', 'ru',
  'nl', 'cs', 'ar', 'zh-cn', 'hu', 'ko', 'ja', 'hi',
] as const;

export const xttsVoice: WorkflowManifest = {
  id: 'xtts-voice',
  name: 'wf.xtts.name',
  description: 'wf.xtts.description',
  icon: 'voice',
  output: 'voice',
  graph,
  saveNodeId: TTS,
  fields: [
    {
      kind: 'text',
      key: 'prompt',
      label: 'wf.voice.line',
      hint: 'wf.xtts.lineHint',
      placeholder: 'wf.voice.linePlaceholder',
      target: target('text'),
      default: '',
      multiline: true,
      required: true,
    },
    {
      kind: 'model',
      key: 'voice',
      label: 'wf.voice.voice',
      hint: 'wf.voice.voiceHint',
      target: target('voice'),
      default: NO_VOICE,
      remember: true,
    },
    {
      kind: 'audio',
      key: 'sample',
      label: 'wf.voice.sample',
      hint: 'wf.xtts.sampleHint',
      target: { nodeId: SAMPLE, input: 'audio' },
      omitWhenEmpty: true,
    },
    {
      kind: 'text',
      key: 'saveAs',
      label: 'wf.voice.saveAs',
      hint: 'wf.voice.saveAsHint',
      placeholder: 'wf.voice.saveAsPlaceholder',
      target: target('save_voice_as'),
      default: '',
      showWhen: { key: 'sample', filled: true },
    },
    {
      kind: 'select',
      key: 'lang',
      label: 'wf.voice.lang',
      hint: 'wf.xtts.langHint',
      defaultIndex: 0,
      remember: true,
      options: LANGUAGES.map((code) => ({
        label: `wf.xtts.langs.${code}`,
        patches: [{ target: target('language'), value: code }],
      })),
    },
    {
      kind: 'number',
      key: 'temperature',
      label: 'wf.xtts.temperature',
      hint: 'wf.xtts.temperatureHint',
      target: target('temperature'),
      default: 0.75,
      min: 0.1,
      max: 1,
      advanced: true,
    },
    {
      kind: 'number',
      key: 'speed',
      label: 'wf.voice.speed',
      hint: 'wf.xtts.speedHint',
      target: target('speed'),
      default: 1,
      min: 0.5,
      max: 2,
      advanced: true,
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      target: target('seed'),
    },
  ],
};
