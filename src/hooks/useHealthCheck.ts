/**
 * Periodic health probe:
 * - GET /queue → serveur joignable (online) ;
 * - GET /internal/files/output → "ComfyUI" volume mounted.
 * If /queue answers but the output listing does not, it is the "iCloud
 * volume not mounted on the Mac" case → explicit error banner (ROADMAP §0).
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
      // question du volume ne se pose pas.
      await client.getQueue();
      let volumeMounted = true;
      try {
        await client.listOutputFiles();
      } catch {
        volumeMounted = false;
      }
      return { volumeMounted };
    },
  });

  useEffect(() => {
    const { setOnline, setVolumeMounted } = useConnection.getState();
    if (health.data) {
      setOnline(true);
      setVolumeMounted(health.data.volumeMounted);
    } else if (health.isError) {
      setOnline(false);
    }
  }, [health.data, health.isError]);
}
