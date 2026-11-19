/**
 * The Create catalogue: how the embedded workflows are grouped and named on
 * screen. A UI layer only: manifests, ids, presets, remix and field prefs all
 * stay per manifest. A family gathers several manifests behind one entry
 * (Repaint a zone, Video, Write a prompt); the launch form of each member
 * shows a mode switch to its siblings.
 */

import { isWorkflowIconKey, type WorkflowIconKey } from '../components/WorkflowIcon';
import { getAnyWorkflow } from './registry';

export interface FamilyMember {
  manifestId: string;
  /** i18n key of the mode label shown in the switch. */
  mode: string;
  /** Optional engine variant within a mode (Video ▸ Image: LTX 2.5 / 2.3). */
  engine?: string;
  icon: WorkflowIconKey;
}

export interface CatalogEntry {
  key: string;
  /** i18n keys. */
  name: string;
  description: string;
  icon: WorkflowIconKey;
  /** Model family tag, shown as is (not translated). */
  engine: string;
  /** First member = default. A single-member entry is a plain workflow. */
  members: FamilyMember[];
}

export interface CatalogSection {
  key: string;
  title: string;
  entries: CatalogEntry[];
}

const single = (
  key: string,
  manifestId: string,
  icon: WorkflowIconKey,
  engine: string,
): CatalogEntry => ({
  key,
  name: `catalog.entries.${key}.name`,
  description: `catalog.entries.${key}.description`,
  icon,
  engine,
  members: [{ manifestId, mode: `catalog.entries.${key}.name`, icon }],
});

export const CATALOG: CatalogSection[] = [
  {
    key: 'image',
    title: 'catalog.sections.image',
    entries: [
      single('create', 'krea2-text2img', 't2i', 'KREA 2'),
      single('transform', 'krea2-img2img', 'i2i', 'KREA 2'),
      single('edit', 'krea2-edit', 'edit', 'KREA 2'),
      single('depth', 'krea2-depth', 'depth', 'KREA 2'),
    ],
  },
  {
    key: 'zones',
    title: 'catalog.sections.zones',
    entries: [
      {
        key: 'repaint',
        name: 'catalog.entries.repaint.name',
        description: 'catalog.entries.repaint.description',
        icon: 'repaint',
        engine: 'KREA 2',
        members: [
          { manifestId: 'krea2-anypaint-inpaint', mode: 'catalog.modes.context', icon: 'context' },
          { manifestId: 'krea2-draw-replace', mode: 'catalog.modes.crop', icon: 'drawReplace' },
          { manifestId: 'inpaint-draw', mode: 'catalog.modes.inpaint', icon: 'inpaint' },
        ],
      },
      single('detect', 'krea2-faceswap', 'detect', 'KREA 2'),
    ],
  },
  {
    key: 'frame',
    title: 'catalog.sections.frame',
    entries: [
      single('outpaint', 'krea2-outpaint', 'outpaint', 'KREA 2'),
      single('upscale', 'krea2-upscale', 'upscale', 'KREA 2'),
    ],
  },
  {
    key: 'video',
    title: 'catalog.sections.video',
    entries: [
      {
        key: 'video',
        name: 'catalog.entries.video.name',
        description: 'catalog.entries.video.description',
        icon: 'video',
        engine: 'LTX 2.5',
        members: [
          { manifestId: 'ltx25-t2v', mode: 'catalog.modes.fromText', icon: 't2v' },
          { manifestId: 'ltx25-i2v', mode: 'catalog.modes.fromImage', engine: 'LTX 2.5', icon: 'i2v' },
          { manifestId: 'ltx-i2v', mode: 'catalog.modes.fromImage', engine: 'LTX 2.3', icon: 'i2v' },
          { manifestId: 'ltx25-flf', mode: 'catalog.modes.firstLast', icon: 'flf' },
        ],
      },
    ],
  },
  {
    key: 'text',
    title: 'catalog.sections.text',
    entries: [
      {
        key: 'prompt',
        name: 'catalog.entries.prompt.name',
        description: 'catalog.entries.prompt.description',
        icon: 'prompt',
        engine: 'GEMMA 4',
        members: [
          { manifestId: 'text2prompt', mode: 'catalog.modes.fromIdea', icon: 'idea2prompt' },
          { manifestId: 'krea2-img2prompt', mode: 'catalog.modes.fromImage', icon: 'img2prompt' },
        ],
      },
    ],
  },
];

const ENTRIES = CATALOG.flatMap((s) => s.entries);

/** The catalogue entry a manifest belongs to (undefined: imported workflow). */
export function entryOf(manifestId: string): CatalogEntry | undefined {
  return ENTRIES.find((e) => e.members.some((m) => m.manifestId === manifestId));
}

/** Entry holding several manifests: the form shows a mode switch. */
export function isFamily(entry: CatalogEntry): boolean {
  return entry.members.length > 1;
}

/** Icon of a manifest; imported workflows get the node-graph icon. */
export function iconOf(manifestId: string): WorkflowIconKey {
  const entry = entryOf(manifestId);
  const member = entry?.members.find((m) => m.manifestId === manifestId);
  if (member) return member.icon;
  // Imported workflow: the icon picked at import, if it is one of ours.
  const icon = getAnyWorkflow(manifestId)?.icon;
  return icon && isWorkflowIconKey(icon) ? icon : 'graph';
}

/**
 * Field kinds whose value carries over when switching between members of a
 * family: what the user brought (photo, painted zone, text). Model-specific
 * settings (sampler, LoRAs, seed…) stay with each member.
 */
export const CARRIED_KINDS = new Set(['image', 'mask', 'text']);
