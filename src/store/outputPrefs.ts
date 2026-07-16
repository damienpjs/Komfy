/** Destination folder chosen per workflow, persisted (AsyncStorage). */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface OutputPrefsState {
  /** workflowId → output subfolder (relative, no leading slash). */
  dirs: Record<string, string>;
  setDir: (workflowId: string, dir: string) => void;
}

export const useOutputPrefs = create<OutputPrefsState>()(
  persist(
    (set) => ({
      dirs: {},
      setDir: (workflowId, dir) =>
        set((s) => ({ dirs: { ...s.dirs, [workflowId]: dir } })),
    }),
    {
      name: 'komfy-output-prefs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
