/**
 * Minimal global toast (launch confirmation, short errors). A toast may carry
 * one action (e.g. "View" after a launch): it then stays a little longer, so
 * the action can be reached.
 */

import { create } from 'zustand';

const TOAST_MS = 3000;
const TOAST_ACTION_MS = 5000;

export interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastState {
  message: string | null;
  kind: 'success' | 'error';
  action: ToastAction | null;
  show: (message: string, kind?: 'success' | 'error', action?: ToastAction) => void;
  hide: () => void;
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: 'success',
  action: null,
  show: (message, kind = 'success', action) => {
    if (hideTimer) clearTimeout(hideTimer);
    set({ message, kind, action: action ?? null });
    hideTimer = setTimeout(
      () => set({ message: null, action: null }),
      action ? TOAST_ACTION_MS : TOAST_MS,
    );
  },
  hide: () => {
    if (hideTimer) clearTimeout(hideTimer);
    set({ message: null, action: null });
  },
}));
