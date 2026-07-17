/**
 * Transient handoff of a graph to the import screen (gallery → "Import as
 * workflow"): route params are unfit for a full API graph. Not persisted.
 */

import { create } from 'zustand';
import type { PromptGraph } from '../api/types';

interface ImportDraftState {
  graph: PromptGraph | null;
  /** Source hint used as the default workflow name (e.g. the PNG filename). */
  sourceName: string | null;
  set: (graph: PromptGraph, sourceName?: string) => void;
  clear: () => void;
}

export const useImportDraft = create<ImportDraftState>()((set) => ({
  graph: null,
  sourceName: null,
  set: (graph, sourceName) => set({ graph, sourceName: sourceName ?? null }),
  clear: () => set({ graph: null, sourceName: null }),
}));
