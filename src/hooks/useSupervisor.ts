/**
 * Drives the three-state "Server power" UI from the supervisor's GET /health:
 *   unreachable (machine off / network) · off (ComfyUI down) · on (running).
 * Also exposes start()/stop(). The ComfyUI health probe (useHealthCheck) is
 * unchanged and independent — this only talks to the supervisor.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { createSupervisor, deriveSupervisorUrl } from '../api/supervisor';
import { useSettings } from '../store/settings';

export type PowerState =
  | 'unconfigured' // no supervisor URL resolvable yet
  | 'loading' // first probe in flight
  | 'unreachable' // supervisor did not answer (machine off / Tailscale down)
  | 'off' // reachable, ComfyUI down → can turn on
  | 'starting' // ComfyUI booting
  | 'on'; // ComfyUI up → can turn off

export function useSupervisor() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const supervisorUrl = useSettings((s) => s.supervisorUrl);
  const token = useSettings((s) => s.supervisorToken);
  const hydrated = useSettings((s) => s.hydrated);

  const effectiveUrl = supervisorUrl || deriveSupervisorUrl(serverUrl);
  const client = useMemo(
    () => (effectiveUrl ? createSupervisor(effectiveUrl, token) : null),
    [effectiveUrl, token],
  );

  const query = useQuery({
    queryKey: ['supervisorHealth', effectiveUrl],
    enabled: hydrated && !!effectiveUrl,
    // Poll faster while ComfyUI is booting so "starting" flips to "on" quickly.
    refetchInterval: (q) => (q.state.data?.comfy === 'starting' ? 2000 : 8000),
    retry: false,
    queryFn: () => client!.health(),
  });

  // react-query keeps the last successful `data` on a background refetch error,
  // so `isError` alone never fires once a probe has succeeded. Compare the
  // update timestamps to know whether the *latest* attempt failed → the machine
  // just went unreachable (the core signal of this feature).
  const lastAttemptFailed = query.errorUpdatedAt > query.dataUpdatedAt;

  let state: PowerState;
  if (!effectiveUrl) state = 'unconfigured';
  else if (lastAttemptFailed) state = 'unreachable';
  else if (query.data)
    state =
      query.data.comfy === 'up'
        ? 'on'
        : query.data.comfy === 'starting'
          ? 'starting'
          : 'off';
  else state = 'loading';

  return {
    state,
    hasToken: !!token,
    effectiveUrl,
    pid: query.data?.pid ?? null,
    /** Throws SupervisorError (e.g. 409 already running) — caller handles. */
    start: async () => {
      await client!.start();
      query.refetch();
    },
    stop: async () => {
      await client!.stop();
      query.refetch();
    },
    refetch: query.refetch,
  };
}
