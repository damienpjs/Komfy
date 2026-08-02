/**
 * Local library of the prompts produced by the text workflows (Image →
 * Prompt & co).
 *
 * 100% local to the phone: persisted in AsyncStorage (app sandbox, like the
 * other stores), never synced to the cloud, never sent back to the ComfyUI
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

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ssrSafeAsyncStorage } from './ssrSafeStorage';

export interface GeneratedPromptEntry {
  id: string;
  /** Date.now() of the recording (recency sort). */
  at: number;
  /**
   * The generated text — null while the job is still running. The entry is
   * created at launch, before any text exists, so that closing the result
   * screen mid-generation cannot lose it; `resolve` fills it in later.
   */
  text: string | null;
  /** Workflow that produced it (provenance tag). */
  workflowId: string;
  /** ComfyUI job it came from — dedupe key, see `record`. */
  promptId: string;
  /**
   * Output node carrying the text, needed to find it in /history after the
   * fact. Absent on entries written before the pending flow existed — those
   * are already resolved, so it is never read for them.
   */
  nodeId?: string;
  /** true = kept outside the recents cap. */
  pinned?: boolean;
}

/** An entry whose text has landed — the only kind that can be reused. */
export type ResolvedPrompt = GeneratedPromptEntry & { text: string };

/** Narrows to an entry whose job has produced its text. */
export function isResolved(e: GeneratedPromptEntry): e is ResolvedPrompt {
  return e.text != null;
}

/** An entry still waiting for its job's text. */
export function isPending(e: GeneratedPromptEntry): boolean {
  return !isResolved(e);
}

/** Number of recent (unpinned) prompts kept — the list is global. */
const MAX_RECENTS = 50;

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Drops the oldest entries beyond MAX_RECENTS. `entries` is ordered
 * most-recent-first, so the survivors are the newest ones. Two kinds never
 * count against the cap: pinned entries (kept on purpose) and pending ones
 * (their text is still on its way — evicting the placeholder would lose it
 * for good; the catch-up forgets them if the job never lands).
 */
function capped(entries: GeneratedPromptEntry[]): GeneratedPromptEntry[] {
  const keep = new Set<string>();
  let kept = 0;
  for (const e of entries) {
    if (e.pinned || isPending(e)) {
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
  /**
   * Upserts a job's entry: creates it (pending, `text: null`, at launch) or
   * fills a pending one in. Never duplicates, never overwrites a text.
   */
  record: (entry: {
    text: string | null;
    workflowId: string;
    promptId: string;
    nodeId: string;
  }) => void;
  /** Fills a pending entry from its job id alone (WS `executed`, catch-up). */
  resolve: (promptId: string, text: string) => void;
  /** Forgets a pending job that will never produce text (failed, wiped). */
  drop: (promptId: string) => void;
  togglePin: (id: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useGeneratedPrompts = create<GeneratedPromptsState>()(
  persist(
    (set) => ({
      entries: [],

      record: ({ text, workflowId, promptId, nodeId }) =>
        set((s) => {
          const existing = s.entries.find((e) => e.promptId === promptId);
          if (existing) {
            // Known job: the launch already filed it as pending, and the
            // result screen polls and re-renders, so this runs repeatedly.
            // Only the pending → resolved transition is a real change; a
            // job's text never changes once known.
            if (text == null || existing.text != null) return s;
            return {
              entries: s.entries.map((e) =>
                e.promptId === promptId ? { ...e, text } : e,
              ),
            };
          }
          return {
            entries: capped([
              { id: makeId(), at: Date.now(), text, workflowId, promptId, nodeId },
              ...s.entries,
            ]),
          };
        }),

      resolve: (promptId, text) =>
        set((s) => {
          const target = s.entries.find((e) => e.promptId === promptId);
          // Unknown job (not one of ours) or already resolved → untouched.
          if (!target || target.text != null) return s;
          return {
            entries: s.entries.map((e) =>
              e.promptId === promptId ? { ...e, text } : e,
            ),
          };
        }),

      drop: (promptId) =>
        set((s) => {
          if (!s.entries.some((e) => e.promptId === promptId)) return s;
          return { entries: s.entries.filter((e) => e.promptId !== promptId) };
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
      storage: createJSONStorage(ssrSafeAsyncStorage),
    },
  ),
);
