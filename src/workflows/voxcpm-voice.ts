/**
 * VoxCPM 2: a line said in a cloned voice (KomfyVoxCPM, server/komfy-voxcpm),
 * in French, English and 28 other languages, detected from the text. The
 * node runs VoxCPM2 in its own virtualenv and writes an mp4 (the waveform
 * over the speech), so the clip lands in the gallery like any video, and its
 * audio track feeds the talking-video workflow (ltx25-a2v) or comes back here
 * as a tone clip, through "Use in" (cf. nextStep.ts).
 *
 * The voice comes from the server's models/voices folder (a `model` field:
 * the node's own combo) or from a new sample (LoadAudio, dropped when left
 * empty), which can be saved under a name for the next time.
 *
 * The tone comes from one of two places (the `mode` select):
 *   - an emotion, which the node turns into a short instruction VoxCPM2
 *     reads before the text, plus optional free words;
 *   - a tone clip (its own LoadAudio, removed in emotion mode): VoxCPM2
 *     continues it with the new text. A clip from another speaker is first
 *     converted into the chosen voice (CosyVoice3), or its timbre wins.
 *
 * Measured on the maintainer's voice (2026-11-25 benches, 25 s sample):
 * sarcastic and happy rated best as emotions, sad and whispered weak; with
 * a tone clip every take was rated good or top, sadness included. About 15 s
 * per line on an M3 Max GPU, plus about 35 s when a clip is converted.
 */

import type { PromptGraph } from '../api/types';
import type { WorkflowManifest } from './types';

const TTS = '1';
const SAMPLE = '2';
const TONE = '3';

/**
 * Value the server lists for `engine` once VoxCPM2 is installed: checked
 * against /object_info, so a missing engine shows on the form (and dims the
 * catalogue row) before a launch.
 */
const ENGINE = 'VoxCPM2';

/** First entry of the node's voice list: nothing picked yet. */
export const NO_VOICE = 'None';

const graph: PromptGraph = {
  [TTS]: {
    class_type: 'KomfyVoxCPM',
    inputs: {
      engine: ENGINE,
      voice: NO_VOICE,
      text: '',
      tone_mode: 'emotion',
      emotion: 'neutral',
      style: '',
      tone_from: 'other_voice',
      tone_text: '',
      cfg: 2,
      steps: 10,
      seed: 0,
      filename_prefix: 'komfy/voxcpm-voice',
      voice_audio: [SAMPLE, 0],
      save_voice_as: '',
      tone_audio: [TONE, 0],
    },
    _meta: { title: 'VoxCPM2 voice · Komfy' },
  },
  [SAMPLE]: {
    class_type: 'LoadAudio',
    inputs: { audio: '' },
    _meta: { title: 'New voice sample' },
  },
  [TONE]: {
    class_type: 'LoadAudio',
    inputs: { audio: '' },
    _meta: { title: 'Tone clip' },
  },
};

const target = (input: string) => ({ nodeId: TTS, input });

/** The node's emotions (server/komfy-voxcpm EMOTIONS), in chip order. */
const EMOTIONS = [
  'neutral',
  'happy',
  'angry',
  'sad',
  'sarcastic',
  'surprised',
  'calm',
  'whispered',
] as const;

/** Index of the emotion mode in the `mode` select (fields below show on it). */
const MODE_EMOTION = 0;
const MODE_CLIP = 1;

export const voxcpmVoice: WorkflowManifest = {
  id: 'voxcpm-voice',
  name: 'wf.voice.name',
  description: 'wf.voice.description',
  icon: 'voice',
  output: 'voice',
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
    // Before the tone fields: in emotion mode it removes the tone clip's
    // LoadAudio, and the clip field below then skips its missing node.
    {
      kind: 'select',
      key: 'mode',
      label: 'wf.voice.tone',
      hint: 'wf.voice.toneHint',
      defaultIndex: MODE_EMOTION,
      options: [
        {
          label: 'wf.voice.toneEmotion',
          patches: [{ target: target('tone_mode'), value: 'emotion' }],
          bypassNodes: [TONE],
        },
        {
          label: 'wf.voice.toneClip',
          patches: [{ target: target('tone_mode'), value: 'clip' }],
        },
      ],
    },
    {
      kind: 'select',
      key: 'emotion',
      label: 'wf.voice.emotion',
      hint: 'wf.voice.emotionHint',
      defaultIndex: 0,
      remember: true,
      showWhen: { key: 'mode', equals: MODE_EMOTION },
      options: EMOTIONS.map((emotion) => ({
        label: `wf.voice.emotions.${emotion}`,
        patches: [{ target: target('emotion'), value: emotion }],
      })),
    },
    {
      kind: 'text',
      key: 'style',
      label: 'wf.voice.style',
      hint: 'wf.voice.styleHint',
      placeholder: 'wf.voice.stylePlaceholder',
      target: target('style'),
      default: '',
      showWhen: { key: 'mode', equals: MODE_EMOTION },
    },
    {
      kind: 'audio',
      key: 'tone',
      label: 'wf.voice.clip',
      hint: 'wf.voice.clipHint',
      target: { nodeId: TONE, input: 'audio' },
      required: true,
      omitWhenEmpty: true,
      showWhen: { key: 'mode', equals: MODE_CLIP },
    },
    {
      kind: 'text',
      key: 'toneText',
      label: 'wf.voice.clipText',
      hint: 'wf.voice.clipTextHint',
      placeholder: 'wf.voice.clipTextPlaceholder',
      target: target('tone_text'),
      default: '',
      showWhen: { key: 'mode', equals: MODE_CLIP },
    },
    {
      kind: 'select',
      key: 'toneFrom',
      label: 'wf.voice.clipFrom',
      hint: 'wf.voice.clipFromHint',
      defaultIndex: 0,
      showWhen: { key: 'mode', equals: MODE_CLIP },
      options: [
        {
          label: 'wf.voice.clipFromOther',
          patches: [{ target: target('tone_from'), value: 'other_voice' }],
        },
        {
          label: 'wf.voice.clipFromSame',
          patches: [{ target: target('tone_from'), value: 'same_voice' }],
        },
      ],
    },
    {
      kind: 'number',
      key: 'cfg',
      label: 'wf.voice.cfg',
      hint: 'wf.voice.cfgHint',
      target: target('cfg'),
      default: 2,
      min: 1,
      max: 4,
      advanced: true,
    },
    {
      kind: 'number',
      key: 'steps',
      label: 'wf.voice.steps',
      hint: 'wf.voice.stepsHint',
      target: target('steps'),
      default: 10,
      min: 4,
      max: 30,
      integer: true,
      advanced: true,
    },
    {
      kind: 'seed',
      key: 'seed',
      label: 'Seed',
      hint: 'wf.voice.seedHint',
      target: target('seed'),
      advanced: true,
    },
  ],
};

/** Mode and origin values "Use in → set the tone" opens the form with. */
export const VOXCPM_CLIP_MODE = MODE_CLIP;
export const VOXCPM_SAME_VOICE = 1;
