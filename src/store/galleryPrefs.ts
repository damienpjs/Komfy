/** Gallery grid density, single global memory, persisted (AsyncStorage). */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ssrSafeAsyncStorage } from './ssrSafeStorage';

/** Choices offered by the picker and the pinch gesture, densest last. */
export const GALLERY_COLUMN_CHOICES = [2, 3, 4, 5, 6] as const;
export const DEFAULT_GALLERY_COLUMNS = 3;

const MIN = GALLERY_COLUMN_CHOICES[0];
const MAX = GALLERY_COLUMN_CHOICES[GALLERY_COLUMN_CHOICES.length - 1];

interface GalleryPrefsState {
  /**
   * Thumbnails per row with the device held upright. A wider window (landscape,
   * iPad landscape) scales it up so the thumbnails keep the same size.
   */
  columns: number;
  setColumns: (columns: number) => void;
}

export const useGalleryPrefs = create<GalleryPrefsState>()(
  persist(
    (set) => ({
      columns: DEFAULT_GALLERY_COLUMNS,
      setColumns: (columns) =>
        set({ columns: Math.min(MAX, Math.max(MIN, Math.round(columns))) }),
    }),
    {
      name: 'komfy-gallery-prefs',
      storage: createJSONStorage(ssrSafeAsyncStorage),
    },
  ),
);

/**
 * Columns actually laid out for a window: the upright choice, scaled by how
 * much wider the window is than its short side (1 in portrait).
 */
export function effectiveColumns(
  chosen: number,
  windowWidth: number,
  windowHeight: number,
): number {
  const shortSide = Math.max(1, Math.min(windowWidth, windowHeight));
  return Math.max(chosen, Math.round((chosen * windowWidth) / shortSide));
}
