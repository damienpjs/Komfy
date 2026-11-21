/**
 * The eight IndexTTS emotions, as the voice workflow mixes them (field kind
 * `emotions`). The value is a list of 8 weights in 0..1, in IndexTTS's own
 * order (server/komfy-indextts EMOTIONS), sent to the node as a JSON string.
 * All zeros = neutral: IndexTTS then takes the emotion from the sample.
 *
 * The server applies what the IndexTTS web UI applied to its sliders: a
 * per-emotion bias, the total capped at 0.8, then the emotion strength
 * scaling the whole mix.
 */

export const EMOTION_KEYS = [
  'happy',
  'angry',
  'sad',
  'afraid',
  'disgusted',
  'melancholic',
  'surprised',
  'calm',
] as const;

export type EmotionKey = (typeof EMOTION_KEYS)[number];

export const EMOTION_COUNT = EMOTION_KEYS.length;

/** Slider step (and the precision a mix is stored with). */
export const EMOTION_STEP = 0.05;

export const NEUTRAL_MIX: readonly number[] = EMOTION_KEYS.map(() => 0);

/** Starting points for the mix, tuned on the maintainer's voice. */
export const EMOTION_PRESETS: { key: string; mix: Partial<Record<EmotionKey, number>> }[] = [
  { key: 'neutral', mix: {} },
  { key: 'amused', mix: { happy: 0.7, surprised: 0.3 } },
  { key: 'exasperated', mix: { angry: 0.5, disgusted: 0.4 } },
  { key: 'sad', mix: { sad: 0.6, melancholic: 0.4 } },
  { key: 'surprised', mix: { surprised: 0.8, happy: 0.2 } },
  { key: 'calm', mix: { calm: 0.8 } },
];

export function presetMix(mix: Partial<Record<EmotionKey, number>>): number[] {
  return EMOTION_KEYS.map((k) => mix[k] ?? 0);
}

function roundStep(v: number): number {
  return Math.round(v / EMOTION_STEP) * EMOTION_STEP;
}

/** A valid mix: 8 finite numbers in 0..1. */
export function isEmotionMix(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === EMOTION_COUNT &&
    value.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
  );
}

/** The node's `emotion_mix` input: the weights on the slider grid, as JSON. */
export function formatMix(mix: number[]): string {
  return JSON.stringify(mix.map((v) => Number(roundStep(v).toFixed(2))));
}

/** A recipe's `emotion_mix` back into a mix (neutral when unreadable). */
export function parseMix(raw: unknown): number[] {
  if (typeof raw !== 'string') return [...NEUTRAL_MIX];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== EMOTION_COUNT) return [...NEUTRAL_MIX];
    return parsed.map((v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
    });
  } catch {
    return [...NEUTRAL_MIX];
  }
}

/** The preset a mix equals, if any (its chip shows as selected). */
export function matchingPreset(mix: number[]): string | undefined {
  return EMOTION_PRESETS.find((p) =>
    presetMix(p.mix).every((v, i) => Math.abs(v - (mix[i] ?? 0)) < EMOTION_STEP / 2),
  )?.key;
}
