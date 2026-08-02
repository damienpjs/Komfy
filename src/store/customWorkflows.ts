/**
 * Runtime-imported workflows (Workflows screen → Import, or gallery →
 * "Import as workflow"): full serializable manifests (graph + fields are
 * plain data, labels are literals passing through t() untouched), persisted
 * in AsyncStorage. Merged with the embedded ones by workflows/registry.ts.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ssrSafeAsyncStorage } from './ssrSafeStorage';
import type { WorkflowManifest } from '../workflows/types';

interface CustomWorkflowsState {
  manifests: WorkflowManifest[];
  hydrated: boolean;
  add: (manifest: WorkflowManifest) => void;
  /** Replaces the manifest with the same id (manifest editor). */
  update: (manifest: WorkflowManifest) => void;
  remove: (id: string) => void;
}

export const useCustomWorkflows = create<CustomWorkflowsState>()(
  persist(
    (set) => ({
      manifests: [],
      hydrated: false,
      add: (manifest) =>
        set((s) => ({ manifests: [...s.manifests, manifest] })),
      update: (manifest) =>
        set((s) => ({
          manifests: s.manifests.map((m) =>
            m.id === manifest.id ? manifest : m,
          ),
        })),
      remove: (id) =>
        set((s) => ({ manifests: s.manifests.filter((m) => m.id !== id) })),
    }),
    {
      name: 'komfy-custom-workflows',
      version: 1,
      storage: createJSONStorage(ssrSafeAsyncStorage),
      partialize: ({ manifests }) => ({ manifests }),
      onRehydrateStorage: () => () => {
        useCustomWorkflows.setState({ hydrated: true });
      },
    },
  ),
);

/** Unique custom id from a user-chosen name ('custom-' + slug + counter). */
export function makeCustomId(name: string, taken: string[]): string {
  const slug =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'workflow';
  let id = `custom-${slug}`;
  for (let n = 2; taken.includes(id); n++) id = `custom-${slug}-${n}`;
  return id;
}
