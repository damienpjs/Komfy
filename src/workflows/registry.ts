/**
 * Unified workflow registry: embedded manifests + runtime-imported ones
 * (customWorkflows store). Only this module bridges the pure workflow
 * modules and the store — index.ts/match.ts/infer.ts stay importable
 * outside React Native (e2e scripts).
 */

import { useMemo } from 'react';
import { useCustomWorkflows } from '../store/customWorkflows';
import { workflows as embedded } from './index';
import type { WorkflowManifest } from './types';

/** Snapshot (non-reactive): match, navigation handlers, hooks' callbacks. */
export function allWorkflows(): WorkflowManifest[] {
  return [...embedded, ...useCustomWorkflows.getState().manifests];
}

export function getAnyWorkflow(id: string): WorkflowManifest | undefined {
  return allWorkflows().find((w) => w.id === id);
}

export function isCustomWorkflow(id: string): boolean {
  return useCustomWorkflows.getState().manifests.some((m) => m.id === id);
}

/** Reactive list for the screens (re-renders on import/removal). */
export function useWorkflows(): WorkflowManifest[] {
  const customs = useCustomWorkflows((s) => s.manifests);
  return useMemo(() => [...embedded, ...customs], [customs]);
}
