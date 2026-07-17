/**
 * Local library of the prompts produced by the text workflows (Image →
 * Prompt & co).
 *
 * 100% local to the phone: persisted in AsyncStorage (app sandbox, like the
 * other stores), never synced to iCloud, never sent back to the ComfyUI
 * server, never committed.
 *
 * Mirrors promptHistory — recents cap + pinning — but keeps the *output*
 * (the generated text) where promptHistory keeps the form *inputs*. The
 * text otherwise only lives in the server's /history (wiped on restart) and
 * on a result screen that is navigated to with `replace`: recording it is
 * what makes it survive leaving that screen.
 *
 * The list is global (not keyed by workflow): a generated prompt is
 * reusable by any text2img, so the source workflow is a tag, not a bucket.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface GeneratedPromptEntry {
  id: string;
  /** Date.now() of the recording (recency sort). */
  at: number;
  /** The generated text itself. */
  text: string;
  /** Workflow that produced it (provenance tag). */
  workflowId: string;
  /** ComfyUI job it came from — dedupe key, see `record`. */
  promptId: string;
  /** true = kept outside the recents cap. */
  pinned?: boolean;
}

/** Number of recent (unpinned) prompts kept — the list is global. */
const MAX_RECENTS = 50;

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Drops the unpinned entries beyond MAX_RECENTS. `entries` is ordered
 * most-recent-first, so the survivors are the newest ones; pinned entries
 * are always kept and never count against the cap.
 */
function capped(entries: GeneratedPromptEntry[]): GeneratedPromptEntry[] {
  const keep = new Set<string>();
  let kept = 0;
  for (const e of entries) {
    if (e.pinned) {
      keep.add(e.id);
      continue;
    }
    if (kept < MAX_RECENTS) {
      keep.add(e.id);
      kept++;
    }
  }
  return entries.filter((e) => keep.has(e.id));
}

interface GeneratedPromptsState {
  /** Entries, ordered from most recent to oldest. */
  entries: GeneratedPromptEntry[];
  /** Records a generated prompt. No-op if its job is already recorded. */
  record: (entry: {
    text: string;
    workflowId: string;
    promptId: string;
  }) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useGeneratedPrompts = create<GeneratedPromptsState>()(
  persist(
    (set) => ({
      entries: [],

      record: ({ text, workflowId, promptId }) =>
        set((s) => {
          // The result screen polls and re-renders, so `record` is called
          // repeatedly for one job. A job's text never changes → keep the
          // first recording and return the state untouched (no re-render).
          if (s.entries.some((e) => e.promptId === promptId)) return s;
          return {
            entries: capped([
              { id: makeId(), at: Date.now(), text, workflowId, promptId },
              ...s.entries,
            ]),
          };
        }),

      togglePin: (id) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === id ? { ...e, pinned: !e.pinned } : e,
          ),
        })),

      remove: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      clear: () => set({ entries: [] }),
    }),
    {
      name: 'komfy-generated-prompts',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
