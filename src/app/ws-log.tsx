/**
 * Former WS event log: now the "WS events" tab of the console. Kept as a
 * redirect so an old link or deep link still lands somewhere useful.
 */

import { Redirect, type Href } from 'expo-router';

export default function WsLogRedirect() {
  return <Redirect href={'/comfy-console?tab=ws' as Href} />;
}
