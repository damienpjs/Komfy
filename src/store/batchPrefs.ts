/** Batch image count, single global memory, persisted (AsyncStorage). */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface BatchPrefsState {
  /** Number of images to generate per launch (shared by all workflows). */
  count: number;
  setCount: (count: number) => void;
}

export const useBatchPrefs = create<BatchPrefsState>()(
  persist(
    (set) => ({
      count: 1,
      setCount: (count) => set({ count }),
    }),
    {
      name: 'komfy-batch-prefs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
