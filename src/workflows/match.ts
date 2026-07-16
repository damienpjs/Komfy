/**
 * Matches an extracted graph (PNG metadata or /history) against the
 * embedded workflows: parallel structural walk from the output node
 * (class_type fingerprint + wiring, node IDs may differ). Two kinds of
 * dynamic chains are absorbed and restored as form values:
 *  - LoraLoaderModelOnly (loras field);
 *  - per-character SEGS filter + DetailerForEach (persons field,
 *    multi FaceSwap).
 * On a match → pre-filled form (seed reset to "random").
 */

import type { PromptGraph } from '../api/types';
import { workflows } from './index';
import type {
  FieldValues,
  LoraSelection,
  PersonsField,
  PersonValue,
  WorkflowManifest,
} from './types';

type Conn = [string, number];

function isConn(v: unknown): v is Conn {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'string' &&
    typeof v[1] === 'number'
  );
}

export type MatchOutcome =
  | { status: 'match'; manifestId: string; values: FieldValues }
  | { status: 'unknown-workflow' };

interface RawPerson extends PersonValue {
  index: number;
  denoise: number;
  steps: number;
}

interface WalkState {
  /** manifest node id → extracted node id. */
  map: Map<string, string>;
  /** LoRAs of the chains absorbed at root level (loras field). */
  loras: LoraSelection[];
  /** Absorbed characters (persons field, multi FaceSwap). */
  persons: RawPerson[];
  /** Visited extracted-graph nodes (whole structure = covered). */
  visited: Set<string>;
  /** Persons field config of the tested manifest, if any. */
  personsField?: PersonsField;
}

/** Maps a shared manifest↔extracted node (fails on conflict). */
function mapShared(
  state: WalkState,
  manifestId: string,
  extractedId: string,
): boolean {
  const known = state.map.get(manifestId);
  if (known != null) return known === extractedId;
  state.map.set(manifestId, extractedId);
  state.visited.add(extractedId);
  return true;
}

/** Absorbs a LoraLoaderModelOnly chain; LoRAs collected into `into`. */
function resolveThroughLoras(
  graph: PromptGraph,
  conn: Conn,
  state: WalkState,
  into: LoraSelection[],
): Conn {
  let current = conn;
  const collected: LoraSelection[] = [];
  while (graph[current[0]]?.class_type === 'LoraLoaderModelOnly') {
    const node = graph[current[0]];
    state.visited.add(current[0]);
    collected.unshift({
      name: String(node.inputs.lora_name),
      strength: Number(node.inputs.strength_model),
    });
    const next = node.inputs.model;
    if (!isConn(next)) return current;
    current = next;
  }
  if (collected.length) into.unshift(...collected);
  return current;
}

/**
 * Absorbs a character pass (DetailerForEach + SEGS filter + prompt +
 * LoRAs) and checks that its shared nodes (model/clip/vae/segs/negative)
 * indeed point at the manifest sources. Returns the upstream image
 * connection, or null when the shape does not match.
 */
function absorbDetailer(
  extracted: PromptGraph,
  manifest: PromptGraph,
  detailerId: string,
  state: WalkState,
): Conn | null {
  const field = state.personsField!;
  const detailer = extracted[detailerId];
  state.visited.add(detailerId);

  const checkShared = (
    sourceNodeId: string,
    conn: unknown,
  ): boolean => {
    if (!isConn(conn)) return false;
    const eNode = extracted[conn[0]];
    if (!eNode || eNode.class_type !== manifest[sourceNodeId]?.class_type)
      return false;
    return mapShared(state, sourceNodeId, conn[0]);
  };

  // SEGS filter of the targeted face.
  const segsConn = detailer.inputs.segs;
  if (!isConn(segsConn)) return null;
  const filter = extracted[segsConn[0]];
  if (filter?.class_type !== 'ImpactSEGSOrderedFilter') return null;
  state.visited.add(segsConn[0]);
  const index = Number(filter.inputs.take_start);
  if (!Number.isInteger(index)) return null;

  // Upstream of the filter: the shared BboxDetectorSEGS (+ its detector).
  if (!checkShared(field.segsSource.nodeId, filter.inputs.segs)) return null;
  const manifestBbox = manifest[field.segsSource.nodeId];
  const extractedBboxId = state.map.get(field.segsSource.nodeId)!;
  const detectorConn = manifestBbox.inputs.bbox_detector;
  if (isConn(detectorConn)) {
    if (
      !checkShared(
        detectorConn[0],
        extracted[extractedBboxId].inputs.bbox_detector,
      )
    )
      return null;
  }

  // Identity prompt.
  const posConn = detailer.inputs.positive;
  if (!isConn(posConn)) return null;
  const promptNode = extracted[posConn[0]];
  if (promptNode?.class_type !== 'CLIPTextEncode') return null;
  state.visited.add(posConn[0]);
  if (!checkShared(field.clipSource.nodeId, promptNode.inputs.clip))
    return null;

  // Shared negative (+ its clip).
  if (!checkShared(field.negativeSource.nodeId, detailer.inputs.negative))
    return null;
  const extractedNegId = state.map.get(field.negativeSource.nodeId)!;
  if (
    !checkShared(field.clipSource.nodeId, extracted[extractedNegId].inputs.clip)
  )
    return null;

  // Model: the character's LoRA chain then the shared source.
  const loras: LoraSelection[] = [];
  const modelConn = isConn(detailer.inputs.model)
    ? resolveThroughLoras(extracted, detailer.inputs.model, state, loras)
    : null;
  if (!modelConn || !checkShared(field.modelSource.nodeId, modelConn))
    return null;

  if (!checkShared(field.clipSource.nodeId, detailer.inputs.clip)) return null;
  if (!checkShared(field.vaeSource.nodeId, detailer.inputs.vae)) return null;

  const guideSize = Number(detailer.inputs.guide_size);
  state.persons.push({
    index,
    prompt: String(promptNode.inputs.text ?? ''),
    loras,
    denoise: Number(detailer.inputs.denoise),
    steps: Number(detailer.inputs.steps),
    guideSize: Number.isFinite(guideSize) ? guideSize : undefined,
  });

  const imageConn = detailer.inputs.image;
  return isConn(imageConn) ? imageConn : null;
}

/**
 * Resolves an extracted-graph connection by absorbing the dynamic chains
 * (root LoRAs, character passes). null = incompatible shape.
 */
function resolveConnection(
  extracted: PromptGraph,
  manifest: PromptGraph,
  conn: Conn,
  state: WalkState,
): Conn | null {
  let current = conn;
  for (;;) {
    const node = extracted[current[0]];
    if (!node) return current;
    if (node.class_type === 'LoraLoaderModelOnly') {
      current = resolveThroughLoras(extracted, current, state, state.loras);
      if (extracted[current[0]]?.class_type === 'LoraLoaderModelOnly')
        return null; // malformed chain
    } else if (
      node.class_type === 'DetailerForEach' &&
      state.personsField != null
    ) {
      const next = absorbDetailer(extracted, manifest, current[0], state);
      if (!next) return null;
      current = next;
    } else {
      return current;
    }
  }
}

/** Parallel DFS; true when the subgraphs are structurally identical. */
function walk(
  extracted: PromptGraph,
  manifest: PromptGraph,
  eId: string,
  mId: string,
  state: WalkState,
): boolean {
  const known = state.map.get(mId);
  if (known != null) return known === eId;

  const eNode = extracted[eId];
  const mNode = manifest[mId];
  if (!eNode || !mNode || eNode.class_type !== mNode.class_type) return false;

  state.map.set(mId, eId);
  state.visited.add(eId);

  for (const [key, mVal] of Object.entries(mNode.inputs)) {
    if (!isConn(mVal)) continue; // literal: patchable, not compared
    const eVal = eNode.inputs[key];
    if (!isConn(eVal)) return false;
    const eResolved = resolveConnection(extracted, manifest, eVal, state);
    if (!eResolved || eResolved[1] !== mVal[1]) return false;
    if (!walk(extracted, manifest, eResolved[0], mVal[0], state)) return false;
  }
  return true;
}

function tryMatch(
  extracted: PromptGraph,
  manifest: WorkflowManifest,
): FieldValues | null {
  // Text-result workflow: no image (hence no PNG to remix).
  if (manifest.saveNodeId == null) return null;
  // Entry point: the output node (same class_type as saveNodeId).
  const saveType = manifest.graph[manifest.saveNodeId].class_type;
  const sinks = Object.keys(extracted).filter(
    (id) => extracted[id].class_type === saveType,
  );
  if (sinks.length !== 1) return null;

  const personsField = manifest.fields.find(
    (f): f is PersonsField => f.kind === 'persons',
  );
  const state: WalkState = {
    map: new Map(),
    loras: [],
    persons: [],
    visited: new Set(),
    personsField,
  };
  if (!walk(extracted, manifest.graph, sinks[0], manifest.saveNodeId, state)) {
    return null;
  }

  // Manifest side outputs (e.g. the image2prompt ShowText): unreachable
  // from the save node, paired afterwards with the only remaining extracted
  // node of the same class_type.
  for (const mId of Object.keys(manifest.graph)) {
    if (state.map.has(mId)) continue;
    const mType = manifest.graph[mId].class_type;
    const candidates = Object.keys(extracted).filter(
      (id) => !state.visited.has(id) && extracted[id].class_type === mType,
    );
    if (candidates.length !== 1) return null;
    if (!walk(extracted, manifest.graph, candidates[0], mId, state)) {
      return null;
    }
  }

  // Whole structure covered: no unknown extra nodes.
  if (state.visited.size !== Object.keys(extracted).length) return null;

  // Persons field: unique and plausible face indexes (holes are possible —
  // bypassed faces, no pass generated for them).
  if (personsField) {
    if (state.persons.length === 0) return null;
    state.persons.sort((a, b) => a.index - b.index);
    const indexes = new Set(state.persons.map((p) => p.index));
    if (
      indexes.size !== state.persons.length ||
      state.persons.some((p) => p.index < 0) ||
      state.persons[state.persons.length - 1].index >= personsField.maxPersons
    ) {
      return null;
    }
  }

  const values: FieldValues = {};
  for (const field of manifest.fields) {
    switch (field.kind) {
      case 'text': {
        const eId = state.map.get(field.target.nodeId);
        values[field.key] = String(extracted[eId!].inputs[field.target.input]);
        break;
      }
      case 'number': {
        const eId = state.map.get(field.target.nodeId);
        values[field.key] = Number(extracted[eId!].inputs[field.target.input]);
        break;
      }
      case 'seed':
        // Variant = same parameters, new seed (ROADMAP 4b).
        values[field.key] = 'random';
        break;
      case 'image': {
        const eId = state.map.get(field.target.nodeId);
        const v = extracted[eId!]?.inputs[field.target.input];
        values[field.key] = typeof v === 'string' ? v : '';
        break;
      }
      case 'select': {
        const index = field.options.findIndex((option) =>
          option.patches.every((patch) => {
            const eId = state.map.get(patch.target.nodeId);
            return (
              eId != null &&
              extracted[eId].inputs[patch.target.input] === patch.value
            );
          }),
        );
        values[field.key] = index >= 0 ? index : field.defaultIndex;
        break;
      }
      case 'dimensions': {
        const wId = state.map.get(field.widthTarget.nodeId);
        const hId = state.map.get(field.heightTarget.nodeId);
        const w = Number(extracted[wId!]?.inputs[field.widthTarget.input]);
        const h = Number(extracted[hId!]?.inputs[field.heightTarget.input]);
        if (Number.isFinite(w) && Number.isFinite(h)) {
          // Matching landscape preset (straight or inverted), else custom.
          const straight = field.options.some(
            (o) => o.width === w && o.height === h,
          );
          const inverted =
            !straight &&
            field.options.some((o) => o.width === h && o.height === w);
          values[field.key] = {
            width: inverted ? h : w,
            height: inverted ? w : h,
            inverted,
            custom: !straight && !inverted,
          };
        } else {
          values[field.key] = {
            ...field.default,
            inverted: false,
            custom: false,
          };
        }
        break;
      }
      case 'loras':
        values[field.key] = state.loras;
        break;
      case 'persons': {
        // Rebuilds the full list: numbers missing from the passes were
        // bypassed faces.
        const count = state.persons[state.persons.length - 1].index + 1;
        const persons: PersonValue[] = Array.from({ length: count }, (_, i) => {
          const raw = state.persons.find((p) => p.index === i);
          return raw
            ? {
                prompt: raw.prompt,
                loras: raw.loras,
                denoise: raw.denoise,
                guideSize: raw.guideSize,
                bypass: false,
              }
            : {
                prompt: '',
                loras: [],
                denoise: field.defaultDenoise,
                bypass: true,
              };
        });
        values[field.key] = {
          persons,
          steps: state.persons[0].steps,
          seed: 'random', // variant = new seed
        };
        break;
      }
    }
  }
  return values;
}

export function matchGraph(extracted: PromptGraph): MatchOutcome {
  for (const manifest of workflows) {
    const values = tryMatch(extracted, manifest);
    if (values) return { status: 'match', manifestId: manifest.id, values };
  }
  return { status: 'unknown-workflow' };
}
