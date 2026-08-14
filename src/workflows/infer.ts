/**
 * Manifest inference for a runtime-imported workflow (API-format graph):
 * detects the patchable fields a human would have declared by hand —
 * prompts, seeds, dimensions, input images, model files, steps/cfg/denoise —
 * and absorbs existing LoraLoaderModelOnly chains into an editable `loras`
 * field (the chain is re-inserted at patch time, so remix keeps working).
 * Pure module: no store, no React Native import (e2e-testable in node).
 */

import type { PromptGraph, PromptNode } from '../api/types';
import type {
  LoraSelection,
  LorasField,
  WorkflowField,
  WorkflowManifest,
} from './types';

/** Parse guard: beyond this a pasted "graph" is unlikely to be one. */
export const MAX_GRAPH_JSON_BYTES = 512 * 1024;

export interface InferredManifest {
  /** Graph rewritten for embedding (LoRA chains removed, re-inserted at patch). */
  graph: PromptGraph;
  fields: WorkflowField[];
  saveNodeId?: string;
  textNodeId?: string;
}

type Conn = [string, number];

function isConn(v: unknown): v is Conn {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'string' &&
    typeof v[1] === 'number'
  );
}

/** Parses and sanity-checks a pasted graph; throws a message key on error. */
export function parseGraph(json: string): PromptGraph {
  if (json.length > MAX_GRAPH_JSON_BYTES) throw new Error('importWf.tooBig');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('importWf.invalid');
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('importWf.invalid');
  }
  const nodes = Object.values(parsed as Record<string, unknown>);
  const looksLikeNode = (n: unknown): n is PromptNode =>
    n != null &&
    typeof n === 'object' &&
    typeof (n as PromptNode).class_type === 'string' &&
    typeof (n as PromptNode).inputs === 'object';
  if (nodes.length === 0 || !nodes.every(looksLikeNode)) {
    // Editor-format exports ({nodes: [...], links: [...]}) land here too.
    throw new Error('importWf.invalid');
  }
  return parsed as PromptGraph;
}

/**
 * Builds a field for one literal input (manifest editor's "add a field"):
 * kind picked from the input name and value type. null = not fieldable
 * (connections, booleans, unknown objects).
 */
export function fieldForInput(
  nodeId: string,
  input: string,
  value: unknown,
  key: string,
): WorkflowField | null {
  const target = { nodeId, input };
  if (typeof value === 'number') {
    if (input === 'seed' || input === 'noise_seed') {
      return { kind: 'seed', key, label: 'Seed', target };
    }
    if (input === 'steps') {
      return {
        kind: 'number',
        key,
        label: 'Steps',
        target,
        default: value,
        min: 1,
        max: 100,
        integer: true,
      };
    }
    if (input === 'cfg') {
      return { kind: 'number', key, label: 'CFG', target, default: value, min: 0, max: 30 };
    }
    if (input === 'denoise') {
      return {
        kind: 'number',
        key,
        label: 'Denoise',
        target,
        default: value,
        min: 0.05,
        max: 1,
      };
    }
    return {
      kind: 'number',
      key,
      label: input,
      target,
      default: value,
      integer: Number.isInteger(value),
    };
  }
  if (typeof value === 'string') {
    if (MODEL_INPUT_LABELS[input] != null) {
      return {
        kind: 'model',
        key,
        label: MODEL_INPUT_LABELS[input],
        target,
        default: value,
      };
    }
    if (input === 'image') {
      return { kind: 'image', key, label: 'wf.common.sourceImage', target };
    }
    return {
      kind: 'text',
      key,
      label: input,
      target,
      default: value,
      multiline: value.length > 40,
    };
  }
  return null;
}

/**
 * LoRA-field candidates of a graph: the distinct sources feeding `model`
 * connection inputs (LoRA chains insert between a MODEL output and its
 * consumers, cf. patch.insertLoraChain). Lets the editor add LoRA support
 * to any imported workflow. Sources that are themselves LoraLoaderModelOnly
 * (frozen chains) are skipped.
 */
export function inferLorasCandidates(graph: PromptGraph): LorasField[] {
  const bySource = new Map<
    string,
    { source: Conn; targets: { nodeId: string; input: string }[] }
  >();
  for (const [nodeId, node] of Object.entries(graph)) {
    const value = node.inputs.model;
    if (!isConn(value)) continue;
    if (graph[value[0]]?.class_type === 'LoraLoaderModelOnly') continue;
    const key = `${value[0]}:${value[1]}`;
    const entry = bySource.get(key) ?? { source: value, targets: [] };
    entry.targets.push({ nodeId, input: 'model' });
    bySource.set(key, entry);
  }
  return [...bySource.values()].map(({ source, targets }, i) => ({
    kind: 'loras',
    key: i === 0 ? 'loras' : `loras_${i + 1}`,
    label: 'LoRAs',
    hint: 'wf.common.lorasHint',
    modelSource: { nodeId: source[0], output: source[1] },
    modelTargets: targets,
    defaultStrength: 0.9,
  }));
}

/**
 * Recognizes an exported manifest (edit screen → "copy JSON": share between
 * phones). Light structural validation — patch/validate stay the runtime
 * judges. null = not a manifest (probably a bare graph).
 */
export function parseManifest(parsed: unknown): WorkflowManifest | null {
  if (parsed == null || typeof parsed !== 'object') return null;
  const m = parsed as Partial<WorkflowManifest>;
  if (
    typeof m.name !== 'string' ||
    m.graph == null ||
    typeof m.graph !== 'object' ||
    !Array.isArray(m.fields) ||
    !m.fields.every(
      (f) =>
        f != null &&
        typeof f === 'object' &&
        typeof f.kind === 'string' &&
        typeof f.key === 'string',
    )
  ) {
    return null;
  }
  const nodes = Object.values(m.graph);
  const looksLikeNode = (n: unknown): n is PromptNode =>
    n != null &&
    typeof n === 'object' &&
    typeof (n as PromptNode).class_type === 'string';
  if (nodes.length === 0 || !nodes.every(looksLikeNode)) return null;
  return m as WorkflowManifest;
}

/** Model-file inputs recognized on loader nodes → field label (i18n or literal). */
const MODEL_INPUT_LABELS: Record<string, string> = {
  ckpt_name: 'wf.common.model',
  unet_name: 'wf.common.model',
  clip_name: 'CLIP',
  vae_name: 'VAE',
  model_name: 'Detector',
  lora_name: 'LoRA',
  control_net_name: 'ControlNet',
  upscale_model_name: 'Upscaler',
  style_model_name: 'Style model',
};

/** Display order of the inferred fields (form top → bottom). */
const KIND_RANK: Record<WorkflowField['kind'], number> = {
  image: 0,
  // Same rank as the image it is painted over, and never inferred either: an
  // imported LoadImageMask has no way to say which picture it masks.
  mask: 0,
  text: 1,
  model: 2,
  // Never inferred from an imported graph (embedded workflows only), but the
  // map must cover every kind — ranked next to the plain model field.
  modelSource: 2,
  dimensions: 3,
  loras: 4,
  select: 5,
  number: 6,
  persons: 7,
  seed: 8,
};

/** Landscape presets offered alongside the graph's own dimensions. */
const DIMENSION_PRESETS: { width: number; height: number }[] = [
  { width: 1024, height: 1024 },
  { width: 1216, height: 832 },
  { width: 1344, height: 896 },
  { width: 1536, height: 1024 },
  { width: 1920, height: 1080 },
];

/**
 * Absorbs the clean LoraLoaderModelOnly chains: each chain becomes a
 * `loras` field (its selection pre-filled via `default`), the chain nodes
 * are removed and their consumers rewired to the chain's source. A chain
 * with branches (a middle node consumed twice) is left frozen in the graph.
 */
function absorbLoraChains(graph: PromptGraph, fields: WorkflowField[]): void {
  const isLora = (id: string) =>
    graph[id]?.class_type === 'LoraLoaderModelOnly';

  /** All [nodeId, inputName] consuming a given node's output 0. */
  const consumersOf = (id: string): { nodeId: string; input: string }[] => {
    const out: { nodeId: string; input: string }[] = [];
    for (const [nodeId, node] of Object.entries(graph)) {
      for (const [input, value] of Object.entries(node.inputs)) {
        if (isConn(value) && value[0] === id && value[1] === 0) {
          out.push({ nodeId, input });
        }
      }
    }
    return out;
  };

  // Chain tails: lora nodes with at least one non-lora consumer.
  const tails = Object.keys(graph).filter(
    (id) => isLora(id) && consumersOf(id).some((c) => !isLora(c.nodeId)),
  );

  let fieldIndex = 0;
  for (const tail of tails) {
    // Walk up, collecting the chain (tail → head).
    const chain: string[] = [];
    let current: string = tail;
    let source: Conn | null = null;
    while (isLora(current)) {
      chain.push(current);
      const model = graph[current].inputs.model;
      if (!isConn(model)) {
        source = null;
        break;
      }
      if (!isLora(model[0])) {
        source = model;
        break;
      }
      current = model[0];
    }
    if (!source) continue; // malformed chain: left frozen
    // Clean chain: every node above the tail feeds exactly its successor.
    const clean = chain.every(
      (id) =>
        id === tail ||
        consumersOf(id).every((c) => chain.includes(c.nodeId)),
    );
    if (!clean) continue;

    const selection: LoraSelection[] = chain
      .slice()
      .reverse() // head → tail = application order
      .map((id) => ({
        name: String(graph[id].inputs.lora_name),
        strength: Number(graph[id].inputs.strength_model),
      }));
    const targets = consumersOf(tail).filter((c) => !chain.includes(c.nodeId));

    // Rewire the consumers to the source, then drop the chain nodes.
    for (const target of targets) {
      graph[target.nodeId].inputs[target.input] = source;
    }
    for (const id of chain) delete graph[id];

    fieldIndex++;
    const field: LorasField = {
      kind: 'loras',
      key: fieldIndex === 1 ? 'loras' : `loras_${fieldIndex}`,
      label: 'LoRAs',
      hint: 'wf.common.lorasHint',
      modelSource: { nodeId: source[0], output: source[1] },
      modelTargets: targets.map((c) => ({ nodeId: c.nodeId, input: c.input })),
      defaultStrength: 0.9,
      default: selection,
    };
    fields.push(field);
  }
}

/**
 * Infers a launchable manifest from an API-format graph. The returned graph
 * is a rewritten clone — always embed it, not the input.
 */
export function inferManifest(rawGraph: PromptGraph): InferredManifest {
  const graph: PromptGraph = JSON.parse(JSON.stringify(rawGraph));
  const fields: WorkflowField[] = [];

  absorbLoraChains(graph, fields);

  // Key uniqueness across all heuristics (several prompts, seeds…).
  const used = new Set(fields.map((f) => f.key));
  const uniqueKey = (base: string): string => {
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    used.add(key);
    return key;
  };

  /** Consumers of a node's outputs: input names, to tell positive/negative. */
  const consumerInputNames = (id: string): string[] => {
    const names: string[] = [];
    for (const node of Object.values(graph)) {
      for (const [input, value] of Object.entries(node.inputs)) {
        if (isConn(value) && value[0] === id) names.push(input);
      }
    }
    return names;
  };

  let saveNodeId: string | undefined;
  let textNodeId: string | undefined;

  for (const [nodeId, node] of Object.entries(graph)) {
    if (node.class_type === 'SaveImage' && saveNodeId == null) {
      saveNodeId = nodeId;
    }
    if (node.class_type === 'ShowText|pysssss' && textNodeId == null) {
      textNodeId = nodeId;
    }

    if (
      node.class_type === 'CLIPTextEncode' &&
      typeof node.inputs.text === 'string'
    ) {
      const negative = consumerInputNames(nodeId).includes('negative');
      fields.push({
        kind: 'text',
        key: uniqueKey(negative ? 'negative' : 'prompt'),
        label: negative ? 'wf.common.negativePrompt' : 'Prompt',
        target: { nodeId, input: 'text' },
        default: node.inputs.text,
        multiline: true,
        required: !negative && node.inputs.text === '',
      });
      continue;
    }

    if (
      node.class_type === 'LoadImage' &&
      typeof node.inputs.image === 'string'
    ) {
      fields.push({
        kind: 'image',
        key: uniqueKey('image'),
        label: 'wf.common.sourceImage',
        target: { nodeId, input: 'image' },
        required: true,
      });
      continue;
    }

    // Empty*LatentImage with literal dimensions → dimensions field.
    if (
      /^Empty.*LatentImage$/.test(node.class_type) &&
      typeof node.inputs.width === 'number' &&
      typeof node.inputs.height === 'number'
    ) {
      const current = { width: node.inputs.width, height: node.inputs.height };
      const options = DIMENSION_PRESETS.some(
        (o) => o.width === current.width && o.height === current.height,
      )
        ? DIMENSION_PRESETS
        : [current, ...DIMENSION_PRESETS];
      fields.push({
        kind: 'dimensions',
        key: uniqueKey('format'),
        label: 'wf.common.dimensions',
        widthTarget: { nodeId, input: 'width' },
        heightTarget: { nodeId, input: 'height' },
        options,
        default: current,
      });
    }

    for (const [input, value] of Object.entries(node.inputs)) {
      // Model files: offered from the server's installed list (no filter —
      // the family is unknown; remember off to keep the recipe faithful).
      if (typeof value === 'string' && MODEL_INPUT_LABELS[input] != null) {
        fields.push({
          kind: 'model',
          key: uniqueKey(input.replace(/_name$/, '')),
          label: MODEL_INPUT_LABELS[input],
          target: { nodeId, input },
          default: value,
        });
      }

      if (typeof value !== 'number') continue;
      if (input === 'seed' || input === 'noise_seed') {
        fields.push({
          kind: 'seed',
          key: uniqueKey('seed'),
          label: 'Seed',
          target: { nodeId, input },
        });
      } else if (input === 'steps') {
        fields.push({
          kind: 'number',
          key: uniqueKey('steps'),
          label: 'Steps',
          target: { nodeId, input },
          default: value,
          min: 1,
          max: 100,
          integer: true,
        });
      } else if (input === 'cfg') {
        fields.push({
          kind: 'number',
          key: uniqueKey('cfg'),
          label: 'CFG',
          target: { nodeId, input },
          default: value,
          min: 0,
          max: 30,
        });
      } else if (input === 'denoise') {
        fields.push({
          kind: 'number',
          key: uniqueKey('denoise'),
          label: 'Denoise',
          target: { nodeId, input },
          default: value,
          min: 0.05,
          max: 1,
        });
      }
    }
  }

  fields.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);

  return {
    graph,
    fields,
    saveNodeId,
    // A save node wins: textNodeId switches the whole launch screen to the
    // text-result flow (no batch/destination), cf. WorkflowManifest.
    textNodeId: saveNodeId == null ? textNodeId : undefined,
  };
}
