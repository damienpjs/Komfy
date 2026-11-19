/**
 * Periodic health probe:
 * - GET /queue → serveur joignable (online) ;
 * - GET /internal/files/output → output folder available.
 * If /queue answers but the output listing does not, the output folder is
 * unavailable on the server → explicit error banner (ROADMAP §0).
 * A failed probe keeps its cause (timeout, refused, HTTP) for the offline
 * diagnostic in Activity.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { ComfyApiError, createClient, failureKind } from '../api/client';
import { useConnection } from '../store/connection';
import { useSettings } from '../store/settings';

export const HEALTH_INTERVAL_MS = 10000;

export function useHealthCheck() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const hydrated = useSettings((s) => s.hydrated);

  const health = useQuery({
    queryKey: ['health', serverUrl],
    enabled: hydrated && !!serverUrl,
    refetchInterval: HEALTH_INTERVAL_MS,
    retry: false,
    queryFn: async () => {
      const client = createClient(serverUrl);
      // /queue first: if it fails, the server is unreachable and the
      // output-folder question is moot.
      await client.getQueue();
      let outputAvailable = true;
      try {
        await client.listOutputFiles();
      } catch {
        outputAvailable = false;
      }
      return { outputAvailable };
    },
  });

  // react-query keeps the last successful `data` when a refetch fails, so
  // `data` alone would hold the app "online" forever after one good probe:
  // the latest attempt is the one with the newest timestamp.
  const failedLast = health.errorUpdatedAt > health.dataUpdatedAt;

  useEffect(() => {
    const { setProbe } = useConnection.getState();
    if (failedLast) {
      const error = health.error;
      setProbe({
        online: false,
        failure: {
          kind: failureKind(error),
          status: error instanceof ComfyApiError ? error.status : undefined,
        },
        checkedAt: health.errorUpdatedAt,
      });
    } else if (health.data) {
      setProbe({
        online: true,
        outputAvailable: health.data.outputAvailable,
        failure: null,
        checkedAt: health.dataUpdatedAt,
      });
    }
  }, [failedLast, health.data, health.error, health.dataUpdatedAt, health.errorUpdatedAt]);
}
