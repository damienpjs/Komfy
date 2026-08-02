/**
 * Local history of form settings, per workflow.
 *
 * 100% local to the phone: persisted in AsyncStorage (app sandbox, like
 * the other stores), never synced to the cloud, never sent to the ComfyUI
 * server, never committed. Two categories per workflow:
 *   - "recents": the last N distinct launches (capped);
 *   - "pinned": kept indefinitely (marked by the user).
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ssrSafeAsyncStorage } from './ssrSafeStorage';
import type { FieldValues } from '../workflows/types';

export interface PromptHistoryEntry {
  id: string;
  /** Date.now() of the last use (recency sort). */
  at: number;
  /** Readable label derived from the values (usually a truncated prompt). */
  label: string;
  values: FieldValues;
  /** true = kept outside the recents cap. */
  pinned?: boolean;
}

/** Number of recent (unpinned) settings kept per workflow. */
const MAX_RECENTS = 15;

/** Two value sets are "identical" when they serialize the same. */
function sameValues(a: FieldValues, b: FieldValues): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface PromptHistoryState {
  /** workflowId → entries, ordered from most recent to oldest. */
  byWorkflow: Record<string, PromptHistoryEntry[]>;
  /** Records a launch (dedupes, moves to the top, caps). */
  record: (workflowId: string, values: FieldValues, label: string) => void;
  togglePin: (workflowId: string, id: string) => void;
  remove: (workflowId: string, id: string) => void;
  clear: (workflowId: string) => void;
}

export const usePromptHistory = create<PromptHistoryState>()(
  persist(
    (set) => ({
      byWorkflow: {},

      record: (workflowId, values, label) =>
        set((s) => {
          const prev = s.byWorkflow[workflowId] ?? [];
          const existing = prev.find((e) => sameValues(e.values, values));
          let next: PromptHistoryEntry[];
          if (existing) {
            // Already known: move it to the top and keep its pin.
            next = [
              { ...existing, at: Date.now(), label },
              ...prev.filter((e) => e.id !== existing.id),
            ];
          } else {
            next = [
              { id: makeId(), at: Date.now(), label, values },
              ...prev,
            ];
          }
          // Cap: only unpinned entries beyond MAX_RECENTS are dropped
          // (pinned ones are always kept). Recency order is preserved.
          const keep = new Set<string>();
          for (const e of next) if (e.pinned) keep.add(e.id);
          let kept = 0;
          for (const e of next) {
            if (e.pinned) continue;
            if (kept < MAX_RECENTS) {
              keep.add(e.id);
              kept++;
            }
          }
          next = next.filter((e) => keep.has(e.id));
          return { byWorkflow: { ...s.byWorkflow, [workflowId]: next } };
        }),

      togglePin: (workflowId, id) =>
        set((s) => ({
          byWorkflow: {
            ...s.byWorkflow,
            [workflowId]: (s.byWorkflow[workflowId] ?? []).map((e) =>
              e.id === id ? { ...e, pinned: !e.pinned } : e,
            ),
          },
        })),

      remove: (workflowId, id) =>
        set((s) => ({
          byWorkflow: {
            ...s.byWorkflow,
            [workflowId]: (s.byWorkflow[workflowId] ?? []).filter(
              (e) => e.id !== id,
            ),
          },
        })),

      clear: (workflowId) =>
        set((s) => ({
          byWorkflow: { ...s.byWorkflow, [workflowId]: [] },
        })),
    }),
    {
      name: 'komfy-prompt-history',
      storage: createJSONStorage(ssrSafeAsyncStorage),
    },
  ),
);
