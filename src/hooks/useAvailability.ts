/**
 * Node schemas of the connected server + per-workflow availability.
 *
 * useNodeInfo fetches the /object_info/{NodeName} schema of every class_type
 * required by the workflows — embedded AND runtime-imported (the class-type
 * list is part of the query key: importing a workflow fetches the missing
 * schemas). Small per-node responses — the full /object_info weighs several
 * MB, cf. api-notes. Consumers: useAvailability (missing nodes/models
 * badge) and the model fields (installed-file enums via modelFieldOptions).
 *
 * Degraded mode: while loading or when the server is unreachable both hooks
 * return undefined and nothing gets flagged — POST /prompt stays the final
 * judge.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { createClient } from '../api/client';
import type { NodeInfo } from '../api/types';
import { useSettings } from '../store/settings';
import { useWorkflows } from '../workflows/registry';
import {
  allRequiredClassTypes,
  checkAvailability,
  type WorkflowAvailability,
} from '../workflows/requirements';

export function useNodeInfo(): Record<string, NodeInfo | null> | undefined {
  const serverUrl = useSettings((s) => s.serverUrl);
  const hydrated = useSettings((s) => s.hydrated);
  const workflows = useWorkflows();
  const classTypes = useMemo(
    () => allRequiredClassTypes(workflows),
    [workflows],
  );

  const { data } = useQuery({
    queryKey: ['nodeInfo', serverUrl, classTypes],
    enabled: hydrated && !!serverUrl,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, NodeInfo | null>> => {
      const client = createClient(serverUrl);
      const entries = await Promise.all(
        classTypes.map(async (classType) => {
          const res = await client.getNodeInfo(classType);
          // {} = type unknown to the server (missing custom node).
          return [classType, res[classType] ?? null] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });

  return data;
}

export function useAvailability():
  | Record<string, WorkflowAvailability>
  | undefined {
  const workflows = useWorkflows();
  const nodeInfo = useNodeInfo();

  return useMemo(() => {
    if (!nodeInfo) return undefined;
    return Object.fromEntries(
      workflows.map((w) => [w.id, checkAvailability(w, nodeInfo)]),
    );
  }, [workflows, nodeInfo]);
}
