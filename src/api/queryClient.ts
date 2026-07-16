/**
 * Shared QueryClient: used by the root provider and by the WS layer to
 * invalidate the queue when a real-time event arrives.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();
