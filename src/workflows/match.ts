/**
 * Matches an extracted graph (PNG metadata or /history) against the
 * embedded workflows: parallel structural walk from the output node
 * (class_type fingerprint + wiring, node IDs may differ). Two kinds of
 * dynamic chains are absorbed and restored as form values:
 *  - LoraLoaderModelOnly (loras field);
 *  - per-character SEGS filter + DetailerForEach, or a lone DetailerForEach
 *    on the raw SEGS (persons field, FaceSwap — see PersonsValue.allFaces).
 * On a match → pre-filled form (seed reset to "random", the source image's
 * own seed carried aside as `sourceSeeds` so the form can offer to reuse it).
 */

import type { PromptGraph } from '../api/types';
import { applySelectOption } from './patch';
import type {
  FieldValues,
  LoraSelection,
  ModelSourceField,
  PersonsField,
  PersonValue,
  SelectField,
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

/**
 * Seed the matched image was drawn with, per seed-carrying field key
 * (kind 'seed' and the persons field's shared seed). Empty when the graph
 * wires its seeds instead of holding literals. Kept OUT of the values so a
 * variant stays a variant by default — the form only offers to reuse it.
 */
export type SourceSeeds = Record<string, number>;

export type MatchOutcome =
  | {
      status: 'match';
      manifestId: string;
      values: FieldValues;
      sourceSeeds: SourceSeeds;
    }
  | { status: 'unknown-workflow' };

interface RawPerson extends PersonValue {
  /** Face number (take_start), or null when the pass covers every face. */
  index: number | null;
  denoise: number;
  steps: number;
  /** This pass's seed (numbered mode: base + index — cf. patch.ts). */
  seed?: number;
}

/**
 * Literal seed of an input: a number, or a digits-only string (some custom
 * nodes serialize theirs that way). A connection (seed driven by another
 * node) has no literal to reuse → undefined.
 */
function literalSeed(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
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
   * distinct sources (an imported multi-chain graph) — keying by source keeps
   * each chain on its own field instead of merging them into one list.
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
 * the LoRAs collected along the way (application order). The chain is the one
 * the `loras` field builds at patch time: LoraLoaderModelOnly nodes on the
 * MODEL path. Any other class_type stops the walk and is left to the caller as
 * a plain structural node.
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
    if (node?.class_type !== 'LoraLoaderModelOnly') break;
    state.visited.add(current[0]);
    collected.unshift({
      name: String(node.inputs.lora_name),
      strength: Number(node.inputs.strength_model),
    });
    const next = node.inputs.model;
    if (!isConn(next)) return { conn: current, loras: collected };
    current = next;
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
    seed: literalSeed(detailer.inputs.seed),
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
      const resolved = resolveThroughLoras(extracted, current, state);
      current = resolved.conn;
      if (extracted[current[0]]?.class_type === 'LoraLoaderModelOnly')
        return null; // malformed chain
      // Key by the MODEL source the chain resolves to (its terminal), so a
      // manifest with several loras fields keeps each chain apart.
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

function matchVariant(
  extracted: PromptGraph,
  manifest: WorkflowManifest,
  graph: PromptGraph,
  forced: Map<string, number>,
): { values: FieldValues; sourceSeeds: SourceSeeds } | null {
  // Text-result workflow: no image (hence no PNG to remix).
  if (manifest.saveNodeId == null) return null;
  // Entry point: the output node (same class_type as saveNodeId).
  const saveType = graph[manifest.saveNodeId]?.class_type;
  if (saveType == null) return null;
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
  };
  if (!walk(extracted, graph, sinks[0], manifest.saveNodeId, state)) {
    return null;
  }

  // Nodes a select option deletes when its branch is switched off (patch.ts
  // `bypassNodes`) — absent from the extracted graph of a job that ran with
  // that option. When such a node sits OFF the sink path (a side output, e.g.
  // the LTX i2v last-frame SaveImage), its absence is expected: skip it below
  // instead of failing the whole match.
  const bypassable = new Set<string>();
  for (const f of manifest.fields) {
    if (f.kind === 'select') {
      for (const opt of f.options) {
        for (const id of opt.bypassNodes ?? []) bypassable.add(id);
      }
    }
  }

  // Manifest side outputs (a text echo, a secondary save): unreachable from
  // the save node, paired afterwards with the only remaining extracted node
  // of the same class_type.
  for (const mId of Object.keys(graph)) {
    if (state.map.has(mId)) continue;
    // Checkpoint mode: the UNET/CLIP/VAE loaders are absorbed into the shared
    // CheckpointLoaderSimple, so they have no extracted twin to pair here.
    if (state.checkpoint != null && isModelLoader(mId, modelSourceField)) {
      continue;
    }
    const mType = graph[mId].class_type;
    const candidates = Object.keys(extracted).filter(
      (id) => !state.visited.has(id) && extracted[id].class_type === mType,
    );
    // A bypassed optional side node has no extracted twin — that is the switch
    // being off, not a mismatch.
    if (candidates.length === 0 && bypassable.has(mId)) continue;
    if (candidates.length !== 1) return null;
    if (!walk(extracted, graph, candidates[0], mId, state)) {
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
  const sourceSeeds: SourceSeeds = {};
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
      case 'seed': {
        // Variant = same parameters, new seed (ROADMAP 4b). The image's own
        // seed is kept aside: the form offers it back in one tap.
        values[field.key] = 'random';
        const eId = state.map.get(field.target.nodeId);
        const seed =
          eId != null
            ? literalSeed(extracted[eId]?.inputs[field.target.input])
            : undefined;
        if (seed != null) sourceSeeds[field.key] = seed;
        break;
      }
      case 'image':
      case 'mask': {
        // Both carry a server-side filename; remixing re-uses the mask
        // already sitting in the input folder, editable again in the form.
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
        // Only options identified by their LITERAL patches can be read back
        // from the values: an empty patch list matches anything, and a link
        // patch ([nodeId, slot]) describes a shape, not a value. Options that
        // differ only in shape are settled by the variant that matched.
        const index = field.options.findIndex(
          (option) =>
            option.patches.length > 0 &&
            option.patches.every((patch) => {
              if (Array.isArray(patch.value)) return false;
              const eId = state.map.get(patch.target.nodeId);
              return (
                eId != null &&
                extracted[eId].inputs[patch.target.input] === patch.value
              );
            }),
        );
        values[field.key] =
          index >= 0 ? index : forced.get(field.key) ?? field.defaultIndex;
        break;
      }
      case 'dimensions': {
        const wId = state.map.get(field.widthTarget.nodeId);
        const hId = state.map.get(field.heightTarget.nodeId);
        const w = Number(extracted[wId!]?.inputs[field.widthTarget.input]);
        const h = Number(extracted[hId!]?.inputs[field.heightTarget.input]);
        // > 0: a workflow whose canvas is sized by the graph itself (KREA2
        // edit — dimensions derived from the source image) leaves a 0 on the
        // sizing node. That is a placeholder, not a format: keep the default.
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
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
        // source — the extracted node the manifest source maps to. In
        // checkpoint mode that source (the manifest UNET loader) is absorbed
        // into the shared CheckpointLoaderSimple and therefore never mapped:
        // the chain resolves up to the checkpoint node, which is the key to
        // read. Without this the LoRAs of a checkpoint-rendered image were
        // silently dropped on remix.
        const source =
          state.checkpoint != null &&
          isModelLoader(field.modelSource.nodeId, modelSourceField)
            ? state.checkpoint
            : state.map.get(field.modelSource.nodeId);
        const absorbed = (source && state.loras.get(source)) || [];
        // The field's fixed LoRAs open the chain at launch (cf. patch.ts) and
        // are not part of the selection: drop them back off, but only when the
        // chain really starts with them (an image rendered before they existed
        // keeps every LoRA it carries).
        const fixed = field.fixed ?? [];
        const opensWithFixed = fixed.every(
          (f, i) => absorbed[i]?.name === f.name,
        );
        values[field.key] = opensWithFixed ? absorbed.slice(fixed.length) : absorbed;
        break;
      }
      case 'persons': {
        // Shared seed: patch.ts gives pass i the seed `base + index`, so the
        // base is recovered from any pass (allFaces = a single pass, base as is).
        const first = state.persons[0];
        if (first?.seed != null) {
          sourceSeeds[field.key] = first.seed - (first.index ?? 0);
        }
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
  return { values, sourceSeeds };
}

/**
 * Selects whose options reshape the graph instead of only setting values: a
 * link patch (`[nodeId, slot]`), a bypassed sink, or a passthrough node. Their
 * chosen option is NOT recoverable from the literals — comparing patch values
 * would mean comparing arrays by identity, and an option may carry no patch at
 * all (only removals), which would match anything. So the extracted graph is
 * matched against the shape each option actually produces.
 */
function structuralSelects(manifest: WorkflowManifest): SelectField[] {
  return manifest.fields.filter(
    (f): f is SelectField =>
      f.kind === 'select' &&
      f.options.some(
        (o) =>
          (o.bypassNodes?.length ?? 0) > 0 ||
          (o.passthroughNodes?.length ?? 0) > 0 ||
          o.patches.some((p) => Array.isArray(p.value)),
      ),
  );
}

/** The variant space is a cartesian product — keep it bounded. */
const MAX_VARIANTS = 64;

/**
 * Tries the manifest in each of the shapes its structural selects can produce,
 * default option first so an ambiguous graph resolves to the default.
 */
function tryMatch(
  extracted: PromptGraph,
  manifest: WorkflowManifest,
): { values: FieldValues; sourceSeeds: SourceSeeds } | null {
  const selects = structuralSelects(manifest);
  const total = selects.reduce((n, f) => n * f.options.length, 1);
  // Nothing reshapes the graph (or too many combinations): the frozen graph is
  // the only shape worth trying.
  if (selects.length === 0 || total > MAX_VARIANTS) {
    return matchVariant(extracted, manifest, manifest.graph, new Map());
  }
  // Per field, the default option is tried first, then the others in order.
  const orders = selects.map((f) => [
    f.defaultIndex,
    ...f.options.map((_, i) => i).filter((i) => i !== f.defaultIndex),
  ]);
  for (let combo = 0; combo < total; combo++) {
    const graph: PromptGraph = JSON.parse(JSON.stringify(manifest.graph));
    const forced = new Map<string, number>();
    let rest = combo;
    selects.forEach((field, f) => {
      const index = orders[f][rest % field.options.length];
      rest = Math.floor(rest / field.options.length);
      forced.set(field.key, index);
      applySelectOption(graph, field.options[index]);
    });
    const matched = matchVariant(extracted, manifest, graph, forced);
    if (matched) return matched;
  }
  return null;
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
    const matched = tryMatch(extracted, manifest);
    if (matched) {
      return {
        status: 'match',
        manifestId: manifest.id,
        values: matched.values,
        sourceSeeds: matched.sourceSeeds,
      };
    }
  }
  return { status: 'unknown-workflow' };
}
