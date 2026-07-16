/**
 * Per-workflow server availability: fetches the /object_info/{NodeName}
 * schema of every class_type required by the embedded workflows (small
 * per-node responses — the full /object_info weighs several MB, cf.
 * api-notes) and derives each workflow's availability.
 *
 * Degraded mode: while loading or when the server is unreachable the hook
 * returns undefined and nothing gets flagged — POST /prompt stays the
 * final judge.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { createClient } from '../api/client';
import type { NodeInfo } from '../api/types';
import { useSettings } from '../store/settings';
import { workflows } from '../workflows';
import {
  allRequiredClassTypes,
  checkAvailability,
  type WorkflowAvailability,
} from '../workflows/requirements';

export function useAvailability():
  | Record<string, WorkflowAvailability>
  | undefined {
  const serverUrl = useSettings((s) => s.serverUrl);
  const hydrated = useSettings((s) => s.hydrated);

  const { data } = useQuery({
    queryKey: ['nodeInfo', serverUrl],
    enabled: hydrated && !!serverUrl,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, NodeInfo | null>> => {
      const client = createClient(serverUrl);
      const entries = await Promise.all(
        allRequiredClassTypes(workflows).map(async (classType) => {
          const res = await client.getNodeInfo(classType);
          // {} = type unknown to the server (missing custom node).
          return [classType, res[classType] ?? null] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });

  return useMemo(() => {
    if (!data) return undefined;
    return Object.fromEntries(
      workflows.map((w) => [w.id, checkAvailability(w, data)]),
    );
  }, [data]);
}
