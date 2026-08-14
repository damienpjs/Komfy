/**
 * Server capability check: does the connected server have the node types
 * (custom nodes) and the model files an embedded workflow needs?
 * Pure functions over the manifest + the /object_info/{NodeName} schemas
 * (fetched by useAvailability); the real response shapes are recorded in
 * docs/api-notes.md.
 */

import type { NodeInfo, NodeInputSpec } from '../api/types';
import type {
  ModelField,
  ModelSourceField,
  PatchTarget,
  WorkflowManifest,
} from './types';

/** class_types inserted at patch time by the dynamic fields (cf. patch.ts). */
const LORAS_CHAIN_TYPES = ['LoraLoaderModelOnly'];
const PERSONS_CHAIN_TYPES = [
  'ImpactSEGSOrderedFilter',
  'CLIPTextEncode',
  'LoraLoaderModelOnly',
  'DetailerForEach',
];

/** Every class_type the workflow can put in a POST /prompt graph. */
export function requiredClassTypes(manifest: WorkflowManifest): string[] {
  const types = new Set<string>();
  for (const node of Object.values(manifest.graph)) types.add(node.class_type);
  for (const field of manifest.fields) {
    if (field.kind === 'loras') {
      LORAS_CHAIN_TYPES.forEach((t) => types.add(t));
      // CLIP-wired chain uses LoraLoader (MODEL + CLIP) instead (cf. patch.ts).
      if (field.clipTargets != null) types.add('LoraLoader');
    }
    if (field.kind === 'persons')
      PERSONS_CHAIN_TYPES.forEach((t) => types.add(t));
    // Checkpoint mode splices in a CheckpointLoaderSimple (kept out of the
    // frozen graph) and swaps the 16-channel latent to a 4-channel one.
    if (field.kind === 'modelSource') {
      types.add('CheckpointLoaderSimple');
      types.add('EmptyLatentImage');
    }
  }
  return [...types].sort();
}

/** Union of the class_types required by a set of manifests (deduplicated). */
export function allRequiredClassTypes(
  manifests: WorkflowManifest[],
): string[] {
  const types = new Set<string>();
  for (const manifest of manifests) {
    requiredClassTypes(manifest).forEach((t) => types.add(t));
  }
  return [...types].sort();
}

/**
 * Inputs replaced by the form at launch ("nodeId/input" keys): their frozen
 * defaults must not be validated (e.g. LoadImage.image is '' until the user
 * picks a photo).
 */
function patchedInputKeys(manifest: WorkflowManifest): Set<string> {
  const keys = new Set<string>();
  const add = (t: PatchTarget) => keys.add(`${t.nodeId}/${t.input}`);
  if (manifest.saveNodeId != null) {
    keys.add(`${manifest.saveNodeId}/filename_prefix`);
  }
  for (const field of manifest.fields) {
    switch (field.kind) {
      case 'text':
      case 'seed':
      case 'image':
      case 'mask':
      case 'model':
        add(field.target);
        break;
      case 'modelSource':
        // Loader inputs the field patches at launch — their frozen literals
        // must not be validated. (The checkpoint loader is spliced in at
        // patch time, so it has no frozen literal to exclude.)
        add({ nodeId: field.unetNodeId, input: 'unet_name' });
        add({ nodeId: field.clipNodeId, input: 'clip_name' });
        add({ nodeId: field.clipNodeId, input: 'type' });
        add({ nodeId: field.vaeNodeId, input: 'vae_name' });
        break;
      case 'number':
        add(field.target);
        field.extraTargets?.forEach(add);
        break;
      case 'dimensions':
        add(field.widthTarget);
        add(field.heightTarget);
        break;
      case 'select':
        for (const option of field.options) {
          option.patches.forEach((p) => add(p.target));
        }
        break;
      case 'loras':
        field.modelTargets.forEach(add);
        field.clipTargets?.forEach(add);
        break;
      case 'persons':
        field.imageTargets.forEach(add);
        break;
    }
  }
  return keys;
}

/**
 * Allowed values when the spec is a non-empty enum, null otherwise.
 * Empty enums give no signal (lazily populated lists, cf. api-notes
 * OllamaConnectivityV2.model) and must never flag a value.
 */
function enumValues(spec: NodeInputSpec | undefined): unknown[] | null {
  if (!spec) return null;
  // Classic shape: [[...values], {meta}].
  if (Array.isArray(spec[0])) return spec[0].length > 0 ? spec[0] : null;
  // V3 schema (ComfyUI ≥ 0.29 / frontend 1.4x): ["COMBO", { options: [...] }].
  // Without this a picker on a V3 node stays empty and its select validation
  // fails (cf. docs/api-notes.md — the two enum shapes coexist).
  if (spec[0] === 'COMBO') {
    const options = (spec[1] as { options?: unknown[] } | undefined)?.options;
    return Array.isArray(options) && options.length > 0 ? options : null;
  }
  return null;
}

/**
 * Files offered by a model field: the /object_info enum of its target input
 * — exactly what the server will accept. `filter` narrows to the compatible
 * family; when nothing matches, the full list is offered (better than a
 * dead end). undefined = schemas not loaded / no enum (degraded mode: the
 * form keeps the frozen default).
 */
export function modelFieldOptions(
  manifest: WorkflowManifest,
  field: ModelField,
  nodeInfo: Record<string, NodeInfo | null> | undefined,
): string[] | undefined {
  const node = manifest.graph[field.target.nodeId];
  const info = node ? nodeInfo?.[node.class_type] : undefined;
  const spec =
    info?.input?.required?.[field.target.input] ??
    info?.input?.optional?.[field.target.input];
  const allowed = enumValues(spec);
  if (!allowed) return undefined;
  const files = allowed.filter((v): v is string => typeof v === 'string');
  if (!field.filter) return files;
  try {
    const re = new RegExp(field.filter, 'i');
    const matching = files.filter((f) => re.test(f));
    return matching.length > 0 ? matching : files;
  } catch {
    return files;
  }
}

/** Enum of a class_type's input, filtered to the string files. */
function enumFilesByType(
  classType: string,
  input: string,
  nodeInfo: Record<string, NodeInfo | null> | undefined,
): string[] | undefined {
  const info = nodeInfo?.[classType];
  const spec =
    info?.input?.required?.[input] ?? info?.input?.optional?.[input];
  const allowed = enumValues(spec);
  if (!allowed) return undefined;
  return allowed.filter((v): v is string => typeof v === 'string');
}

/** Enum of a graph node's input, filtered to the string files. */
function enumFilesOf(
  manifest: WorkflowManifest,
  nodeId: string,
  input: string,
  nodeInfo: Record<string, NodeInfo | null> | undefined,
): string[] | undefined {
  const node = manifest.graph[nodeId];
  if (!node) return undefined;
  return enumFilesByType(node.class_type, input, nodeInfo);
}

/** Lists offered by a modelSource field, each from its loader's live enum. */
export interface ModelSourceOptions {
  checkpoints: string[] | undefined;
  diffusionModels: string[] | undefined;
  clipTypes: string[] | undefined;
  clips: string[] | undefined;
  vaes: string[] | undefined;
}

export function modelSourceOptions(
  manifest: WorkflowManifest,
  field: ModelSourceField,
  nodeInfo: Record<string, NodeInfo | null> | undefined,
): ModelSourceOptions {
  return {
    // The checkpoint loader is spliced in at patch time (not in the graph),
    // so its enum is read straight from the node type.
    checkpoints: enumFilesByType('CheckpointLoaderSimple', 'ckpt_name', nodeInfo),
    diffusionModels: enumFilesOf(manifest, field.unetNodeId, 'unet_name', nodeInfo),
    clipTypes: enumFilesOf(manifest, field.clipNodeId, 'type', nodeInfo),
    clips: enumFilesOf(manifest, field.clipNodeId, 'clip_name', nodeInfo),
    vaes: enumFilesOf(manifest, field.vaeNodeId, 'vae_name', nodeInfo),
  };
}

/** A literal value rejected by the server's enum (typically a model file). */
export interface MissingValue {
  nodeId: string;
  input: string;
  value: string;
}

export interface WorkflowAvailability {
  ok: boolean;
  /** class_types absent from the server (custom nodes to install). */
  missingNodes: string[];
  /** Enum values absent from the server (models, detectors, enum types…). */
  missingValues: MissingValue[];
}

/**
 * Availability of one workflow given the fetched schemas.
 * `nodeInfo`: class_type → schema, null = unknown to the server. Types
 * absent from the map (not fetched) are not flagged — degraded mode stays
 * permissive, POST /prompt remains the final judge.
 */
export function checkAvailability(
  manifest: WorkflowManifest,
  nodeInfo: Record<string, NodeInfo | null>,
): WorkflowAvailability {
  const missingNodes = requiredClassTypes(manifest).filter(
    (t) => nodeInfo[t] === null,
  );

  const missingValues: MissingValue[] = [];
  const checkValue = (
    classType: string,
    nodeId: string,
    input: string,
    value: unknown,
  ) => {
    // Only string literals live in enums (model files, samplers, modes).
    if (typeof value !== 'string') return;
    const info = nodeInfo[classType];
    if (!info) return; // missing/unfetched type: already reported or unknown
    const spec = info.input?.required?.[input] ?? info.input?.optional?.[input];
    const allowed = enumValues(spec);
    if (allowed && !allowed.includes(value)) {
      missingValues.push({ nodeId, input, value });
    }
  };

  // Frozen graph literals (form-patched inputs excluded: replaced at launch).
  const patched = patchedInputKeys(manifest);
  for (const [nodeId, node] of Object.entries(manifest.graph)) {
    for (const [input, value] of Object.entries(node.inputs)) {
      if (patched.has(`${nodeId}/${input}`)) continue;
      checkValue(node.class_type, nodeId, input, value);
    }
  }

  // Select options: every choice offered must exist server-side (e.g. the
  // inpaint detector models).
  for (const field of manifest.fields) {
    if (field.kind !== 'select') continue;
    for (const option of field.options) {
      for (const patch of option.patches) {
        const node = manifest.graph[patch.target.nodeId];
        if (!node) continue;
        checkValue(
          node.class_type,
          patch.target.nodeId,
          patch.target.input,
          patch.value,
        );
      }
    }
  }

  return {
    ok: missingNodes.length === 0 && missingValues.length === 0,
    missingNodes,
    missingValues,
  };
}
