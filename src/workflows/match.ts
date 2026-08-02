/**
 * Matches an extracted graph (PNG metadata or /history) against the
 * embedded workflows: parallel structural walk from the output node
 * (class_type fingerprint + wiring, node IDs may differ). Two kinds of
 * dynamic chains are absorbed and restored as form values:
 *  - LoraLoaderModelOnly (loras field);
 *  - per-character SEGS filter + DetailerForEach, or a lone DetailerForEach
 *    on the raw SEGS (persons field, FaceSwap — see PersonsValue.allFaces).
 * On a match → pre-filled form (seed reset to "random").
 */

import type { PromptGraph } from '../api/types';
import type {
  FieldValues,
  LoraSelection,
  ModelSourceField,
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
  /** Face number (take_start), or null when the pass covers every face. */
  index: number | null;
  denoise: number;
  steps: number;
}

/**
 * Remix guard: face numbers come from the `take_start` of an untrusted PNG,
 * and the numbered mode rebuilds `maxIndex + 1` cards (holes = bypassed
 * faces). Without a bound, an absurd take_start would expand into a huge
 * card list. Only used when the field itself declares no cap.
 */
const MAX_REMIXABLE_FACES = 64;

interface WalkState {
  /** manifest node id → extracted node id. */
  map: Map<string, string>;
  /**
   * Root-level LoRA chains, keyed by the extracted node the chain resolves up
   * to (its MODEL source). A manifest may hold several loras fields fed by
   * distinct sources (WAN dual-expert i2v: high/low) — keying by source keeps
   * each expert's LoRAs on its own field instead of merging them into one list.
   */
  loras: Map<string, LoraSelection[]>;
  /** Absorbed characters (persons field, FaceSwap). */
  persons: RawPerson[];
  /** Visited extracted-graph nodes (whole structure = covered). */
  visited: Set<string>;
  /** Persons field config of the tested manifest, if any. */
  personsField?: PersonsField;
  /** modelSource field config of the tested manifest, if any. */
  modelSourceField?: ModelSourceField;
  /**
   * True when the tested manifest has a loras field wiring the CLIP (WAN i2v):
   * only then is LoraLoader (MODEL + CLIP) absorbed as a dynamic chain — every
   * other manifest keeps LoraLoader as a plain structural node, unchanged.
   */
  absorbClipLoras: boolean;
  /**
   * Extracted CheckpointLoaderSimple absorbed in checkpoint mode: it stands
   * in for the frozen graph's separate UNET/CLIP/VAE loaders. Set = the
   * remixed image was created with a checkpoint model source.
   */
  checkpoint?: string;
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

/**
 * Absorbs a LoRA chain, returning the upstream connection it resolves to plus
 * the LoRAs collected along the way (application order). Handles
 * LoraLoaderModelOnly (MODEL only) and — when the manifest wires the CLIP
 * (state.absorbClipLoras) — LoraLoader (MODEL + CLIP). A LoraLoader is entered
 * by output slot: slot 0 walks up `.model`, slot 1 walks up `.clip`, so a chain
 * shared between the model and the text encoder (WAN i2v) is followed on either
 * path. LoRAs are collected only on the MODEL output (slot 0) — the CLIP
 * traversal of the same chain must not count them twice.
 */
function resolveThroughLoras(
  graph: PromptGraph,
  conn: Conn,
  state: WalkState,
): { conn: Conn; loras: LoraSelection[] } {
  let current = conn;
  const collected: LoraSelection[] = [];
  for (;;) {
    const node = graph[current[0]];
    const type = node?.class_type;
    if (type === 'LoraLoaderModelOnly') {
      state.visited.add(current[0]);
      collected.unshift({
        name: String(node.inputs.lora_name),
        strength: Number(node.inputs.strength_model),
      });
      const next = node.inputs.model;
      if (!isConn(next)) return { conn: current, loras: collected };
      current = next;
    } else if (state.absorbClipLoras && type === 'LoraLoader') {
      state.visited.add(current[0]);
      if (current[1] === 0) {
        collected.unshift({
          name: String(node.inputs.lora_name),
          strength: Number(node.inputs.strength_model),
        });
      }
      const next = current[1] === 1 ? node.inputs.clip : node.inputs.model;
      if (!isConn(next)) return { conn: current, loras: collected };
      current = next;
    } else {
      break;
    }
  }
  return { conn: current, loras: collected };
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

  // SEGS: either the filter of the targeted face (numbered mode), or the
  // detection itself (allFaces — DetailerForEach iterates the whole batch).
  const segsConn = detailer.inputs.segs;
  if (!isConn(segsConn)) return null;
  const segsNode = extracted[segsConn[0]];
  let index: number | null;
  if (segsNode?.class_type === 'ImpactSEGSOrderedFilter') {
    state.visited.add(segsConn[0]);
    index = Number(segsNode.inputs.take_start);
    if (!Number.isInteger(index)) return null;
    if (!checkShared(field.segsSource.nodeId, segsNode.inputs.segs)) return null;
  } else if (
    segsNode?.class_type === manifest[field.segsSource.nodeId]?.class_type
  ) {
    index = null;
    if (!checkShared(field.segsSource.nodeId, segsConn)) return null;
  } else {
    return null;
  }

  // Upstream: the shared BboxDetectorSEGS (+ its detector).
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
  let loras: LoraSelection[] = [];
  let modelConn: Conn | null = null;
  if (isConn(detailer.inputs.model)) {
    const resolved = resolveThroughLoras(extracted, detailer.inputs.model, state);
    modelConn = resolved.conn;
    loras = resolved.loras;
  }
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
    const isLora =
      node.class_type === 'LoraLoaderModelOnly' ||
      (state.absorbClipLoras && node.class_type === 'LoraLoader');
    if (isLora) {
      const resolved = resolveThroughLoras(extracted, current, state);
      current = resolved.conn;
      const stillLora = extracted[current[0]]?.class_type;
      if (
        stillLora === 'LoraLoaderModelOnly' ||
        (state.absorbClipLoras && stillLora === 'LoraLoader')
      )
        return null; // malformed chain
      // Key by the MODEL source the chain resolves to (its terminal), so a
      // manifest with several loras fields (per-expert) keeps each chain apart.
      // Overwrite, not append: a source feeding several targets resolves the
      // same complete chain each time — accumulating would double it.
      if (resolved.loras.length) state.loras.set(current[0], resolved.loras);
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

/** True when the manifest node is one of the modelSource UNET/CLIP/VAE loaders. */
function isModelLoader(mId: string, field?: ModelSourceField): boolean {
  return (
    field != null &&
    (mId === field.unetNodeId ||
      mId === field.clipNodeId ||
      mId === field.vaeNodeId)
  );
}

/**
 * Checkpoint model source: a single CheckpointLoaderSimple (outputs MODEL 0 /
 * CLIP 1 / VAE 2) stands in for the frozen graph's separate UNET/CLIP/VAE
 * loaders. When the manifest connection targets one of those loaders and the
 * extracted side is that shared checkpoint at the matching output, absorb it
 * (record the node, skip the normal recursion). Returns false in diffusion
 * mode → the walk compares the individual loaders as usual.
 */
function absorbCheckpoint(
  mConn: Conn,
  eConn: Conn,
  extracted: PromptGraph,
  state: WalkState,
): boolean {
  const field = state.modelSourceField;
  if (!field) return false;
  const role =
    mConn[0] === field.unetNodeId
      ? 0
      : mConn[0] === field.clipNodeId
        ? 1
        : mConn[0] === field.vaeNodeId
          ? 2
          : -1;
  if (role < 0) return false;
  if (extracted[eConn[0]]?.class_type !== 'CheckpointLoaderSimple') return false;
  if (eConn[1] !== role) return false;
  if (state.checkpoint && state.checkpoint !== eConn[0]) return false; // one loader
  state.checkpoint = eConn[0];
  state.visited.add(eConn[0]);
  return true;
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
  if (!eNode || !mNode) return false;
  if (eNode.class_type !== mNode.class_type) {
    // Checkpoint model source: the frozen 16-ch EmptySD3LatentImage is
    // swapped in place for a 4-ch EmptyLatentImage (same w/h/batch inputs).
    const latentSwap =
      state.checkpoint != null &&
      mId === state.modelSourceField?.latentNodeId &&
      mNode.class_type === 'EmptySD3LatentImage' &&
      eNode.class_type === 'EmptyLatentImage';
    if (!latentSwap) return false;
  }

  state.map.set(mId, eId);
  state.visited.add(eId);

  for (const [key, mVal] of Object.entries(mNode.inputs)) {
    if (!isConn(mVal)) continue; // literal: patchable, not compared
    const eVal = eNode.inputs[key];
    if (!isConn(eVal)) return false;
    const eResolved = resolveConnection(extracted, manifest, eVal, state);
    if (!eResolved) return false;
    // A checkpoint stands in for the UNET/CLIP/VAE loaders (absorbed, not
    // recursed into); its outputs are ordered MODEL/CLIP/VAE, not [_, 0].
    if (absorbCheckpoint(mVal, eResolved, extracted, state)) continue;
    if (eResolved[1] !== mVal[1]) return false;
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
  const modelSourceField = manifest.fields.find(
    (f): f is ModelSourceField => f.kind === 'modelSource',
  );
  const state: WalkState = {
    map: new Map(),
    loras: new Map(),
    persons: [],
    visited: new Set(),
    personsField,
    modelSourceField,
    absorbClipLoras: manifest.fields.some(
      (f) => f.kind === 'loras' && f.clipTargets != null,
    ),
  };
  if (!walk(extracted, manifest.graph, sinks[0], manifest.saveNodeId, state)) {
    return null;
  }

  // Nodes a select option deletes when its branch is switched off (patch.ts
  // `bypassNodes`) — absent from the extracted graph of a job that ran with
  // that option. When such a node sits OFF the sink path (a side output, e.g.
  // the WAN i2v last-frame SaveImage), its absence is expected: skip it below
  // instead of failing the whole match.
  const bypassable = new Set<string>();
  for (const f of manifest.fields) {
    if (f.kind === 'select') {
      for (const opt of f.options) {
        for (const id of opt.bypassNodes ?? []) bypassable.add(id);
      }
    }
  }

  // Manifest side outputs (e.g. the image2prompt ShowText): unreachable
  // from the save node, paired afterwards with the only remaining extracted
  // node of the same class_type.
  for (const mId of Object.keys(manifest.graph)) {
    if (state.map.has(mId)) continue;
    // Checkpoint mode: the UNET/CLIP/VAE loaders are absorbed into the shared
    // CheckpointLoaderSimple, so they have no extracted twin to pair here.
    if (state.checkpoint != null && isModelLoader(mId, modelSourceField)) {
      continue;
    }
    const mType = manifest.graph[mId].class_type;
    const candidates = Object.keys(extracted).filter(
      (id) => !state.visited.has(id) && extracted[id].class_type === mType,
    );
    // A bypassed optional side node has no extracted twin — that is the switch
    // being off, not a mismatch.
    if (candidates.length === 0 && bypassable.has(mId)) continue;
    if (candidates.length !== 1) return null;
    if (!walk(extracted, manifest.graph, candidates[0], mId, state)) {
      return null;
    }
  }

  // Whole structure covered: no unknown extra nodes.
  if (state.visited.size !== Object.keys(extracted).length) return null;

  // Persons field: either a single all-faces pass, or unique and plausible
  // face numbers (holes are possible — bypassed faces generate no pass).
  const allFaces = state.persons.some((p) => p.index == null);
  if (personsField) {
    if (state.persons.length === 0) return null;
    if (allFaces) {
      // An all-faces pass consumes every face: it cannot coexist with
      // numbered ones (nothing in Komfy emits such a graph).
      if (state.persons.length !== 1) return null;
    } else {
      state.persons.sort((a, b) => a.index! - b.index!);
      const indexes = new Set(state.persons.map((p) => p.index));
      if (
        indexes.size !== state.persons.length ||
        state.persons.some((p) => p.index! < 0) ||
        state.persons[state.persons.length - 1].index! >=
          (personsField.maxPersons ?? MAX_REMIXABLE_FACES)
      ) {
        return null;
      }
    }
  }

  const values: FieldValues = {};
  for (const field of manifest.fields) {
    switch (field.kind) {
      case 'text': {
        const eId = state.map.get(field.target.nodeId);
        // Unmapped (e.g. a dangling shared-negative node) or a wired input
        // (not a literal string) → keep the default rather than crash.
        const v = eId != null ? extracted[eId]?.inputs[field.target.input] : undefined;
        values[field.key] = typeof v === 'string' ? v : field.default;
        break;
      }
      case 'number': {
        const eId = state.map.get(field.target.nodeId);
        const v = eId != null ? extracted[eId]?.inputs[field.target.input] : undefined;
        const n = Number(v);
        values[field.key] = Number.isFinite(n) ? n : field.default;
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
      case 'model': {
        const eId = state.map.get(field.target.nodeId);
        const v = extracted[eId!]?.inputs[field.target.input];
        values[field.key] = typeof v === 'string' ? v : field.default;
        break;
      }
      case 'modelSource': {
        // Mirrors insertModelSource: checkpoint mode = the absorbed
        // CheckpointLoaderSimple; diffusion = the mapped UNET/CLIP/VAE loaders.
        if (state.checkpoint != null) {
          const ck = extracted[state.checkpoint]?.inputs.ckpt_name;
          values[field.key] = {
            mode: 'checkpoint',
            checkpoint: typeof ck === 'string' ? ck : field.defaultCheckpoint,
            unet: field.defaultUnet,
            clip: field.defaultClip,
            clipType: field.defaultClipType,
            vae: field.defaultVae,
          };
        } else {
          const unet = extracted[state.map.get(field.unetNodeId)!]?.inputs;
          const clip = extracted[state.map.get(field.clipNodeId)!]?.inputs;
          const vae = extracted[state.map.get(field.vaeNodeId)!]?.inputs;
          values[field.key] = {
            mode: 'diffusion',
            checkpoint: field.defaultCheckpoint,
            unet:
              typeof unet?.unet_name === 'string' ? unet.unet_name : field.defaultUnet,
            clip:
              typeof clip?.clip_name === 'string' ? clip.clip_name : field.defaultClip,
            clipType:
              typeof clip?.type === 'string' ? clip.type : field.defaultClipType,
            vae: typeof vae?.vae_name === 'string' ? vae.vae_name : field.defaultVae,
          };
        }
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
      case 'loras': {
        // Each field takes only the LoRAs on the chain feeding its own MODEL
        // source — the extracted node the manifest source maps to.
        const source = state.map.get(field.modelSource.nodeId);
        values[field.key] = (source && state.loras.get(source)) || [];
        break;
      }
      case 'persons': {
        if (allFaces) {
          const raw = state.persons[0];
          values[field.key] = {
            persons: [
              {
                prompt: raw.prompt,
                loras: raw.loras,
                denoise: raw.denoise,
                guideSize: raw.guideSize,
              },
            ],
            allFaces: true,
            steps: raw.steps,
            seed: 'random', // variant = new seed
          };
          break;
        }
        // Rebuilds the full list: numbers missing from the passes were
        // bypassed faces.
        const count = state.persons[state.persons.length - 1].index! + 1;
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

/**
 * Candidates come from the caller (workflows/registry.allWorkflows(): the
 * embedded manifests + the runtime-imported ones) — this module stays free
 * of any store import.
 */
export function matchGraph(
  extracted: PromptGraph,
  candidates: WorkflowManifest[],
): MatchOutcome {
  for (const manifest of candidates) {
    const values = tryMatch(extracted, manifest);
    if (values) return { status: 'match', manifestId: manifest.id, values };
  }
  return { status: 'unknown-workflow' };
}
