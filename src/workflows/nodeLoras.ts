/**
 * LoRA lists carried by a node's own inputs (NodeLorasField, the LTX 2.5
 * MLX node): first LoRA on the single-LoRA inputs, the others as JSON in an
 * optional `extra` input. One place for the writing (patch), the reading
 * (remix) and the values saved before the list existed (presets, remembered
 * choices), so the three agree on the format.
 */

import type { PromptGraph } from '../api/types';
import type { LoraSelection, LorasField, NodeLorasField } from './types';

export function isNodeLoras(field: LorasField): field is NodeLorasField {
  return field.nodeInputs != null;
}

/** LoRA list from untrusted JSON (a graph input, a stored preference). */
export function parseLoraList(raw: unknown): LoraSelection[] {
  let data = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return [];
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(data)) return [];
  const loras: LoraSelection[] = [];
  for (const item of data) {
    if (item == null || typeof item !== 'object') continue;
    const { name, strength } = item as { name?: unknown; strength?: unknown };
    const n = Number(strength);
    if (typeof name !== 'string' || name.trim() === '' || !Number.isFinite(n)) continue;
    loras.push({ name, strength: n });
  }
  return loras;
}

/**
 * Writes the selection into the node. No LoRA leaves the frozen inputs as
 * they are (the `none` value); the `extra` input exists only when there is
 * more than one LoRA.
 */
export function patchNodeLoras(
  graph: PromptGraph,
  field: NodeLorasField,
  loras: LoraSelection[],
): void {
  const { nodeId, name, strength, extra } = field.nodeInputs;
  const node = graph[nodeId];
  if (!node) return;
  delete node.inputs[extra];
  const [first, ...rest] = loras;
  if (!first) return;
  node.inputs[name] = first.name;
  node.inputs[strength] = first.strength;
  if (rest.length > 0) {
    node.inputs[extra] = JSON.stringify(
      rest.map((l) => ({ name: l.name, strength: l.strength })),
    );
  }
}

/** The selection a node ran with (inverse of patchNodeLoras). */
export function readNodeLoras(
  inputs: Record<string, unknown> | undefined,
  field: NodeLorasField,
): LoraSelection[] {
  if (!inputs) return [];
  const { name, strength, extra, none } = field.nodeInputs;
  const loras: LoraSelection[] = [];
  const first = inputs[name];
  if (typeof first === 'string' && first !== '' && first !== none) {
    const n = Number(inputs[strength]);
    loras.push({
      name: first,
      strength: Number.isFinite(n) ? n : field.defaultStrength ?? 1,
    });
  }
  return [...loras, ...parseLoraList(inputs[extra])];
}

/**
 * Selection held by values saved under the single-LoRA keys this field
 * replaced (`legacyKeys`): undefined when there are none, [] for a saved
 * "no LoRA".
 */
export function legacyLoras(
  field: LorasField,
  saved: Record<string, unknown> | undefined,
): LoraSelection[] | undefined {
  if (!saved || !isNodeLoras(field) || !field.legacyKeys) return undefined;
  const name = saved[field.legacyKeys.name];
  if (typeof name !== 'string') return undefined;
  if (name === '' || name === field.nodeInputs.none) return [];
  const n = Number(saved[field.legacyKeys.strength]);
  return [{ name, strength: Number.isFinite(n) ? n : field.defaultStrength ?? 1 }];
}
