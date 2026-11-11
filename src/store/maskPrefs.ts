/** Mask editor preferences, persisted (AsyncStorage): the brush colour. */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { MaskBrushColorId } from '../theme/tokens';
import { ssrSafeAsyncStorage } from './ssrSafeStorage';

interface MaskPrefsState {
  brushColor: MaskBrushColorId;
  setBrushColor: (id: MaskBrushColorId) => void;
}

export const useMaskPrefs = create<MaskPrefsState>()(
  persist(
    (set) => ({
      brushColor: 'coral',
      setBrushColor: (brushColor) => set({ brushColor }),
    }),
    {
      name: 'komfy-mask-prefs',
      storage: createJSONStorage(ssrSafeAsyncStorage),
    },
  ),
);
