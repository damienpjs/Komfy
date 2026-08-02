/** Minimal global toast (launch confirmation, short errors). */

import { create } from 'zustand';

const TOAST_MS = 3000;

interface ToastState {
  message: string | null;
  kind: 'success' | 'error';
  show: (message: string, kind?: 'success' | 'error') => void;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: 'success',
  show: (message, kind = 'success') => {
    if (hideTimer) clearTimeout(hideTimer);
    set({ message, kind });
    hideTimer = setTimeout(() => set({ message: null }), TOAST_MS);
  },
}));
