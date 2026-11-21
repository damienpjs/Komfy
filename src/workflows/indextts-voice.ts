/**
 * IndexTTS 2.5: a line said in a cloned voice, with a mix of emotions
 * (KomfyIndexTTS, server/komfy-indextts). The node runs IndexTTS in its own
 * virtualenv and writes an mp4 (the waveform over the speech), so the clip
 * lands in the gallery like any video, and its audio track feeds the
 * talking-video workflow (ltx25-a2v) through "Use in" (cf. nextStep.ts).
 *
 * The voice comes from the server's models/voices folder (a `model` field:
 * the node's own combo) or from a new sample (LoadAudio, dropped when left
 * empty), which can be saved under a name for the next time.
 *
 * Measured on the maintainer's voice (2026-11-21, a 25 s sample): the
 * neutral clone sounds like him; an emotion strength of 0.6 or 1.0 drifts
 * away from his timbre, 0.4 or lower keeps it. Hence the 0.4 default.
 */

import type { PromptGraph } from '../api/types';
import type { WorkflowManifest } from './types';

const TTS = '1';
const SAMPLE = '2';

/** First entry of the node's voice list: nothing picked yet. */
export const NO_VOICE = 'None';

const graph: PromptGraph = {
  [TTS]: {
    class_type: 'KomfyIndexTTS',
    inputs: {
      voice: NO_VOICE,
      text: '',
      lang: 'EN',
      emotion_mix: '[0,0,0,0,0,0,0,0]',
      emotion_strength: 0.4,
      speed: 1,
      seed: 0,
      filename_prefix: 'komfy/indextts-voice',
      voice_audio: [SAMPLE, 0],
      save_voice_as: '',
    },
    _meta: { title: 'IndexTTS 2.5 voice · Komfy' },
  },
  [SAMPLE]: {
    class_type: 'LoadAudio',
    inputs: { audio: '' },
    _meta: { title: 'New voice sample' },
  },
};

const target = (input: string) => ({ nodeId: TTS, input });

const LANGUAGES = ['EN', 'ZH', 'JA', 'ES', 'AR'] as const;

export const indexttsVoice: WorkflowManifest = {
  id: 'indextts-voice',
  name: 'wf.voice.name',
  description: 'wf.voice.description',
  icon: 'voice',
  graph,
  saveNodeId: TTS,
  fields: [
    {
      kind: 'text',
      key: 'prompt',
      label: 'wf.voice.line',
      hint: 'wf.voice.lineHint',
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
      hint: 'wf.voice.sampleHint',
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
      hint: 'wf.voice.langHint',
      defaultIndex: 0,
      remember: true,
      options: LANGUAGES.map((code) => ({
        label: `wf.voice.langs.${code}`,
        patches: [{ target: target('lang'), value: code }],
      })),
    },
    {
      kind: 'emotions',
      key: 'emotions',
      label: 'wf.voice.emotions',
      hint: 'wf.voice.emotionsHint',
      target: target('emotion_mix'),
    },
    {
      kind: 'number',
      key: 'strength',
      label: 'wf.voice.strength',
      hint: 'wf.voice.strengthHint',
      target: target('emotion_strength'),
      default: 0.4,
      min: 0,
      max: 1,
    },
    {
      kind: 'number',
      key: 'speed',
      label: 'wf.voice.speed',
      hint: 'wf.voice.speedHint',
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
