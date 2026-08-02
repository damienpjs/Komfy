/**
 * Transient handoff of a prompt picked in the library back to the launch
 * form (prompts screen → workflow/[id]): expo-router can't return a value
 * from a pushed screen, and the form must be *merged into*, not remounted
 * with a `prefill` (which would reset the other fields).
 *
 * Not persisted — it only has to survive a router.back().
 */

import { create } from 'zustand';

interface PromptPickState {
  /** Picked text, null once consumed. */
  text: string | null;
  /** Form field the picker was opened for (echoed from the route param). */
  fieldKey: string | null;
  set: (text: string, fieldKey: string) => void;
  clear: () => void;
}

export const usePromptPick = create<PromptPickState>()((set) => ({
  text: null,
  fieldKey: null,
  set: (text, fieldKey) => set({ text, fieldKey }),
  clear: () => set({ text: null, fieldKey: null }),
}));
