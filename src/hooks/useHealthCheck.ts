/**
 * Periodic health probe:
 * - GET /queue → serveur joignable (online) ;
 * - GET /internal/files/output → output folder available.
 * If /queue answers but the output listing does not, the output folder is
 * unavailable on the server → explicit error banner (ROADMAP §0).
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { createClient } from '../api/client';
import { useConnection } from '../store/connection';
import { useSettings } from '../store/settings';

const HEALTH_INTERVAL_MS = 10000;

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

  useEffect(() => {
    const { setOnline, setOutputAvailable } = useConnection.getState();
    if (health.data) {
      setOnline(true);
      setOutputAvailable(health.data.outputAvailable);
    } else if (health.isError) {
      setOnline(false);
    }
  }, [health.data, health.isError]);
}
