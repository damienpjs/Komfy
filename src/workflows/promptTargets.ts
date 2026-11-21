/**
 * Workflows a saved or generated prompt can be sent to: every manifest with a
 * `prompt` field, in Create catalogue order (named the way Create names
 * them, with the mode for a family member), then the imported ones.
 */

import type { WorkflowIconKey } from '../components/WorkflowIcon';
import { CATALOG, entryOf } from './catalog';
import { allWorkflows, getAnyWorkflow } from './registry';
import type { WorkflowManifest } from './types';

export interface PromptTarget {
  manifestId: string;
  /** i18n key (catalogue entry) or the imported workflow's own name. */
  name: string;
  /** i18n key of the family mode, when the entry has several. */
  mode?: string;
  icon: WorkflowIconKey;
}

const hasPrompt = (m: WorkflowManifest | undefined) =>
  !!m?.fields.some((f) => f.key === 'prompt');

export function promptTargets(): PromptTarget[] {
  const targets: PromptTarget[] = [];
  for (const section of CATALOG) {
    for (const entry of section.entries) {
      const family = entry.members.length > 1;
      for (const member of entry.members) {
        if (!hasPrompt(getAnyWorkflow(member.manifestId))) continue;
        targets.push({
          manifestId: member.manifestId,
          name: entry.name,
          mode: family ? member.mode : undefined,
          icon: member.icon,
        });
      }
    }
  }
  for (const manifest of allWorkflows()) {
    if (entryOf(manifest.id) || !hasPrompt(manifest)) continue;
    targets.push({ manifestId: manifest.id, name: manifest.name, icon: 'graph' });
  }
  return targets;
}
