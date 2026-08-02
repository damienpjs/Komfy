/** Listing of the installed LoRAs (GET /models/loras), short cache. */

import { useQuery } from '@tanstack/react-query';
import { createClient } from '../api/client';
import { useSettings } from '../store/settings';

export function useLoras() {
  const serverUrl = useSettings((s) => s.serverUrl);
  const hydrated = useSettings((s) => s.hydrated);

  return useQuery({
    queryKey: ['loras', serverUrl],
    enabled: hydrated && !!serverUrl,
    staleTime: 60_000,
    queryFn: () => createClient(serverUrl).listLoras(),
  });
}
