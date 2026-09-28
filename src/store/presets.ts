/**
 * Named presets of form settings, per workflow.
 *
 * Saved explicitly by the user (nothing is recorded on launch). 100% local
 * to the phone: persisted in AsyncStorage (app sandbox, like the other
 * stores), never synced to the cloud, never sent to the ComfyUI server.
 * A preset belongs to one workflow id and is only offered on that workflow.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ssrSafeAsyncStorage } from './ssrSafeStorage';
import type { FieldValues } from '../workflows/types';

export interface Preset {
  id: string;
  name: string;
  /** Date.now() of the last save (creation or overwrite). */
  savedAt: number;
  values: FieldValues;
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Names compare trimmed and case-insensitive: "Portrait" = "portrait ". */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

interface PresetsState {
  /** workflowId → presets (unordered; the bar sorts them by name). */
  byWorkflow: Record<string, Preset[]>;
  /**
   * Saves under `name`: a preset of the same name in this workflow is
   * overwritten (the caller confirms first), otherwise a new one is added.
   */
  save: (workflowId: string, name: string, values: FieldValues) => void;
  /** Replaces the values of an existing preset, keeping its name. */
  overwrite: (workflowId: string, id: string, values: FieldValues) => void;
  rename: (workflowId: string, id: string, name: string) => void;
  remove: (workflowId: string, id: string) => void;
  /** Drops every preset of a workflow (custom workflow deleted). */
  clear: (workflowId: string) => void;
}

export const usePresets = create<PresetsState>()(
  persist(
    (set) => ({
      byWorkflow: {},

      save: (workflowId, name, values) =>
        set((s) => {
          const prev = s.byWorkflow[workflowId] ?? [];
          const trimmed = name.trim();
          const existing = prev.find((p) => sameName(p.name, trimmed));
          const next = existing
            ? prev.map((p) =>
                p.id === existing.id
                  ? { ...p, name: trimmed, values, savedAt: Date.now() }
                  : p,
              )
            : [
                ...prev,
                { id: makeId(), name: trimmed, values, savedAt: Date.now() },
              ];
          return { byWorkflow: { ...s.byWorkflow, [workflowId]: next } };
        }),

      overwrite: (workflowId, id, values) =>
        set((s) => ({
          byWorkflow: {
            ...s.byWorkflow,
            [workflowId]: (s.byWorkflow[workflowId] ?? []).map((p) =>
              p.id === id ? { ...p, values, savedAt: Date.now() } : p,
            ),
          },
        })),

      rename: (workflowId, id, name) =>
        set((s) => ({
          byWorkflow: {
            ...s.byWorkflow,
            [workflowId]: (s.byWorkflow[workflowId] ?? []).map((p) =>
              p.id === id ? { ...p, name: name.trim() } : p,
            ),
          },
        })),

      remove: (workflowId, id) =>
        set((s) => ({
          byWorkflow: {
            ...s.byWorkflow,
            [workflowId]: (s.byWorkflow[workflowId] ?? []).filter(
              (p) => p.id !== id,
            ),
          },
        })),

      clear: (workflowId) =>
        set((s) => {
          const { [workflowId]: _dropped, ...rest } = s.byWorkflow;
          return { byWorkflow: rest };
        }),
    }),
    {
      name: 'komfy-presets',
      version: 1,
      storage: createJSONStorage(ssrSafeAsyncStorage),
      // The automatic launch history this store replaces: its entries are
      // not presets the user chose, so they are dropped rather than migrated.
      onRehydrateStorage: () => () => {
        if (typeof window !== 'undefined') {
          AsyncStorage.removeItem('komfy-prompt-history').catch(() => {});
        }
      },
    },
  ),
);
