/**
 * Strokes behind each uploaded mask, keyed by its server-side filename,
 * persisted (AsyncStorage).
 *
 * ComfyUI only ever sees the rasterized PNG. Keeping the strokes on the
 * phone is what lets a remix, or simply coming back to the form, reopen the
 * editor on the drawing itself instead of a blank canvas over a mask that
 * already exists.
 *
 * Points are rounded to 1e-4 of the image (under half a pixel at 4096 px)
 * to keep the JSON small, and only the most recent masks are kept.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { MaskStroke } from '../utils/maskRaster';
import { ssrSafeAsyncStorage } from './ssrSafeStorage';

/** Masks remembered; the oldest are forgotten first. */
const MAX_MASKS = 40;
/**
 * Points kept across all masks. Everything lives in one AsyncStorage entry,
 * and Android caps an entry at about 2 MB (a compacted point is ~24 bytes):
 * 40k points stay near 1 MB however the masks were drawn.
 */
const MAX_POINTS = 40_000;

interface Entry {
  strokes: MaskStroke[];
  savedAt: number;
}

interface MaskStrokesState {
  /** Server-side mask filename → the strokes it was rasterized from. */
  byMask: Record<string, Entry>;
  save: (maskName: string, strokes: MaskStroke[]) => void;
}

const round = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

function countPoints(strokes: MaskStroke[]): number {
  return strokes.reduce((n, s) => n + s.points.length, 0);
}

function compact(strokes: MaskStroke[]): MaskStroke[] {
  return strokes.map((s) => ({
    points: s.points.map((p) => ({ x: round(p.x, 4), y: round(p.y, 4) })),
    radius: round(s.radius, 5),
    erase: s.erase,
  }));
}

export const useMaskStrokes = create<MaskStrokesState>()(
  persist(
    (set) => ({
      byMask: {},
      save: (maskName, strokes) =>
        set((s) => {
          const all: Record<string, Entry> = {
            ...s.byMask,
            [maskName]: { strokes: compact(strokes), savedAt: Date.now() },
          };
          // Newest first, within both budgets. An older mask that no longer
          // fits is forgotten (its PNG stays on the server; only reopening it
          // falls back to a new drawing).
          const byMask: Record<string, Entry> = {};
          let points = 0;
          for (const name of Object.keys(all).sort(
            (a, b) => all[b].savedAt - all[a].savedAt,
          )) {
            if (Object.keys(byMask).length >= MAX_MASKS) break;
            const size = countPoints(all[name].strokes);
            // The mask just saved stays whenever it fits the budget on its
            // own (it is the one most likely to be reopened): older ones
            // make room for it. One larger than the whole budget is skipped
            // like any other, so the entry never outgrows Android's cap.
            const keep =
              name === maskName
                ? size <= MAX_POINTS
                : points + size <= MAX_POINTS;
            if (!keep) continue;
            byMask[name] = all[name];
            points += size;
          }
          return { byMask };
        }),
    }),
    {
      name: 'komfy-mask-strokes',
      storage: createJSONStorage(ssrSafeAsyncStorage),
    },
  ),
);
