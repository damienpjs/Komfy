/**
 * Route of a variant: the workflow screen prefilled with the values matched
 * from an image or a queued job. Seeds travel in their own `seeds` param —
 * they are NOT form values (the seed field stays on "random"), only the
 * offer to reuse the source seed.
 */

import type { Href } from 'expo-router';
import type { SourceSeeds } from '../workflows/match';
import type { FieldValues } from '../workflows/types';

export function remixHref(
  manifestId: string,
  values: FieldValues,
  sourceSeeds?: SourceSeeds,
): Href {
  const params = [`prefill=${encodeURIComponent(JSON.stringify(values))}`];
  if (sourceSeeds && Object.keys(sourceSeeds).length > 0) {
    params.push(`seeds=${encodeURIComponent(JSON.stringify(sourceSeeds))}`);
  }
  return `/workflow/${manifestId}?${params.join('&')}` as Href;
}
