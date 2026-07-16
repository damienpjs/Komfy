/**
 * Remembered choices of the select fields marked `remember` in the
 * manifests (e.g. face/head detection of the multi FaceSwap), persisted per
 * workflow. The option index is applied as the initial value next launch.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface FieldPrefsState {
  /** workflowId → field.key → index de l'option choisie. */
  selections: Record<string, Record<string, number>>;
  setSelection: (workflowId: string, key: string, index: number) => void;
}

export const useFieldPrefs = create<FieldPrefsState>()(
  persist(
    (set) => ({
      selections: {},
      setSelection: (workflowId, key, index) =>
        set((s) => ({
          selections: {
            ...s.selections,
            [workflowId]: { ...s.selections[workflowId], [key]: index },
          },
        })),
    }),
    {
      name: 'komfy-field-prefs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
