/**
 * Create catalogue memory, persisted (AsyncStorage): the workflows launched
 * most recently (the "Recent" row) and, per family, the mode last used, so a
 * family entry reopens where the user left it.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ssrSafeAsyncStorage } from './ssrSafeStorage';

const RECENT_MAX = 6;

interface CatalogPrefsState {
  /** Manifest ids, most recent first. */
  recent: string[];
  /** Family entry key → manifest id of the last mode used. */
  lastMember: Record<string, string>;
  markLaunched: (manifestId: string) => void;
  setLastMember: (entryKey: string, manifestId: string) => void;
}

export const useCatalogPrefs = create<CatalogPrefsState>()(
  persist(
    (set) => ({
      recent: [],
      lastMember: {},
      markLaunched: (manifestId) =>
        set((s) => ({
          recent: [manifestId, ...s.recent.filter((id) => id !== manifestId)].slice(
            0,
            RECENT_MAX,
          ),
        })),
      setLastMember: (entryKey, manifestId) =>
        set((s) => ({ lastMember: { ...s.lastMember, [entryKey]: manifestId } })),
    }),
    {
      name: 'komfy-catalog-prefs',
      storage: createJSONStorage(ssrSafeAsyncStorage),
    },
  ),
);
