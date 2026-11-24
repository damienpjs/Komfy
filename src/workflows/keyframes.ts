/**
 * Keyframes timeline logic (cf. KeyframesField): the clip's frame count,
 * where a new keyframe goes, what blocks a launch, and the JSON the
 * KomfyLTX25MLX node reads. Mirrors server/komfy-ltx-mlx/keyframes.py: same
 * minimum gap, same frame grid.
 */

import type {
  FieldValues,
  KeyframeValue,
  KeyframesField,
  KeyframesValue,
  WorkflowManifest,
} from './types';

/**
 * Frames between two pictures of the timeline. The VAE packs 8 frames into
 * one latent frame: closer than that, two pictures would fight over it.
 */
export const KEYFRAME_MIN_GAP = 8;

export const DEFAULT_KEY_STRENGTH = 1;

let nextId = 0;

/** A fresh form-only keyframe id. */
export function newKeyId(): string {
  nextId += 1;
  return `k${Date.now().toString(36)}-${nextId}`;
}

export function emptyKeyframes(): KeyframesValue {
  return { opening: '', keys: [], source: null };
}

/** Python's round() (half to even), which the server's frame grid uses. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/**
 * Frames of a render of `duration` s at `fps` (8k + 1, at least 9), as the
 * node computes them. null when the duration is left to the model (0).
 */
export function clipFrames(duration: number, fps: number): number | null {
  if (!(duration > 0) || !(fps > 0)) return null;
  const k = Math.max(1, roundHalfEven((duration * fps) / 8));
  return 8 * k + 1;
}

/** Duration (s, 3 decimals) that renders exactly `frames` frames at `fps`. */
export function durationFor(frames: number, fps: number): number {
  return Math.round(((frames - 1) / fps) * 1000) / 1000;
}

/** "2.00 s" for a frame at `fps`. */
export function frameSeconds(frame: number, fps: number): string {
  return `${(frame / fps).toFixed(2)} s`;
}

export function sortKeys(keys: KeyframeValue[]): KeyframeValue[] {
  return [...keys].sort((a, b) => a.frame - b.frame);
}

/** Last frame of the clip: where the last image sits. */
function endFrame(frames: number): number {
  return frames - 1;
}

/**
 * Frames keyframe `index` (in a sorted list) may be dragged or stepped to:
 * the stretch between its neighbours, KEYFRAME_MIN_GAP away from each. A
 * keyframe wedged closer than that (placed by a lookup, or the clip got
 * shorter) may still move anywhere strictly between them, so it can always
 * be pulled out; it never crosses a neighbour, which keeps the order.
 */
export function moveRange(
  keys: KeyframeValue[],
  index: number,
  frames: number,
): { min: number; max: number } {
  const prev = index === 0 ? 0 : keys[index - 1].frame;
  const next = index === keys.length - 1 ? endFrame(frames) : keys[index + 1].frame;
  const min = prev + KEYFRAME_MIN_GAP;
  const max = next - KEYFRAME_MIN_GAP;
  if (min <= max) return { min, max };
  return { min: Math.min(prev + 1, next - 1), max: Math.max(prev + 1, next - 1) };
}

/**
 * Frame for a keyframe added without a source clip to match against: the
 * middle of the widest stretch, snapped to a whole latent frame. null when no
 * stretch has room for one more picture.
 */
export function freeFrame(keys: KeyframeValue[], frames: number): number | null {
  const anchors = [0, ...sortKeys(keys).map((k) => k.frame), endFrame(frames)];
  let best: { from: number; to: number } | null = null;
  for (let i = 1; i < anchors.length; i++) {
    const from = anchors[i - 1];
    const to = anchors[i];
    if (to - from >= 2 * KEYFRAME_MIN_GAP && (!best || to - from > best.to - best.from)) {
      best = { from, to };
    }
  }
  if (!best) return null;
  const mid = Math.round((best.from + best.to) / 2 / 8) * 8;
  return Math.min(
    best.to - KEYFRAME_MIN_GAP,
    Math.max(best.from + KEYFRAME_MIN_GAP, mid),
  );
}

export type KeyProblem = 'noImage' | 'pastEnd' | 'tooClose';

/**
 * What is wrong with each keyframe (sorted order), null when it is fine:
 * the timeline paints those markers, validation refuses the launch.
 */
export function keyProblems(keys: KeyframeValue[], frames: number): (KeyProblem | null)[] {
  const sorted = sortKeys(keys);
  const end = endFrame(frames);
  return sorted.map((key, i) => {
    if (key.frame > end) return 'pastEnd';
    const prev = i === 0 ? 0 : sorted[i - 1].frame;
    const next = i === sorted.length - 1 ? end : sorted[i + 1].frame;
    if (key.frame - prev < KEYFRAME_MIN_GAP || next - key.frame < KEYFRAME_MIN_GAP) {
      return 'tooClose';
    }
    if (key.image === '') return 'noImage';
    return null;
  });
}

/** True when a stretch carries its own prompt (the node then needs tiles = 1). */
export function hasStretchPrompts(v: KeyframesValue): boolean {
  return v.keys.length > 0 && (v.opening.trim() !== '' || v.keys.some((k) => k.prompt.trim() !== ''));
}

/**
 * The node's `keyframes` input, or null when there are no keyframes: the
 * input then stays out of the graph, which keeps a plain first/last render
 * byte for byte what it was (and runnable on a server without the input).
 */
export function serializeKeyframes(v: KeyframesValue | undefined): string | null {
  if (!v || v.keys.length === 0) return null;
  return JSON.stringify({
    opening: v.opening.trim(),
    keys: sortKeys(v.keys).map((k) => ({
      image: k.image,
      frame: Math.round(k.frame),
      strength: k.strength,
      prompt: k.prompt.trim(),
    })),
    ...(v.source ? { source: v.source } : {}),
  });
}

/**
 * A keyframes value read back from a render's graph (remix). Tolerant: the
 * metadata comes from a file, so anything malformed is dropped, never thrown.
 */
export function parseKeyframes(raw: unknown): KeyframesValue {
  const value = emptyKeyframes();
  if (typeof raw !== 'string' || raw.trim() === '') return value;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return value;
  }
  if (data == null || typeof data !== 'object') return value;
  const obj = data as Record<string, unknown>;
  if (typeof obj.opening === 'string') value.opening = obj.opening;
  if (typeof obj.source === 'string' && obj.source !== '') value.source = obj.source;
  if (Array.isArray(obj.keys)) {
    for (const item of obj.keys.slice(0, 64)) {
      if (item == null || typeof item !== 'object') continue;
      const k = item as Record<string, unknown>;
      if (typeof k.image !== 'string' || !Number.isInteger(k.frame)) continue;
      const strength = Number(k.strength);
      value.keys.push({
        id: newKeyId(),
        image: k.image,
        frame: k.frame as number,
        strength: Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : DEFAULT_KEY_STRENGTH,
        prompt: typeof k.prompt === 'string' ? k.prompt : '',
      });
    }
  }
  value.keys = sortKeys(value.keys);
  return value;
}

/**
 * Remix of a clip into a workflow with a keyframes timeline: the clip itself
 * becomes the timeline's source when the render named none (a first/last
 * shot being rebuilt with keyframes, the use case the timeline is for).
 */
export function adoptSourceClip(
  manifest: WorkflowManifest | undefined,
  values: FieldValues,
  clipPath: string,
): FieldValues {
  if (!manifest) return values;
  const next = { ...values };
  for (const field of manifest.fields) {
    if (field.kind !== 'keyframes') continue;
    const current = (next[field.key] as KeyframesValue | undefined) ?? emptyKeyframes();
    if (!current.source) next[field.key] = { ...current, source: clipPath };
  }
  return next;
}

/** Field keys a keyframes field draws inside its timeline. */
export function ownedKeys(field: KeyframesField): string[] {
  return [field.ends.first, field.ends.last, field.ends.firstStrength, field.ends.lastStrength];
}
