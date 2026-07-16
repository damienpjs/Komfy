/**
 * Remembered choices of the fields marked `remember` in the manifests,
 * persisted per workflow and re-applied as the initial value next launch:
 * select fields keep the option index (e.g. face/head detection of the
 * multi FaceSwap), model fields keep the file name (indexes would drift
 * with the server's installed-file lists).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface FieldPrefsState {
  /** workflowId → field.key → index de l'option choisie (select fields). */
  selections: Record<string, Record<string, number>>;
  /** workflowId → field.key → valeur choisie (model fields). */
  values: Record<string, Record<string, string>>;
  setSelection: (workflowId: string, key: string, index: number) => void;
  setValue: (workflowId: string, key: string, value: string) => void;
}

export const useFieldPrefs = create<FieldPrefsState>()(
  persist(
    (set) => ({
      selections: {},
      values: {},
      setSelection: (workflowId, key, index) =>
        set((s) => ({
          selections: {
            ...s.selections,
            [workflowId]: { ...s.selections[workflowId], [key]: index },
          },
        })),
      setValue: (workflowId, key, value) =>
        set((s) => ({
          values: {
            ...s.values,
            [workflowId]: { ...s.values[workflowId], [key]: value },
          },
        })),
    }),
    {
      name: 'komfy-field-prefs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
