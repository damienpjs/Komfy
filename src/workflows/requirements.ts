/**
 * Server capability check: does the connected server have the node types
 * (custom nodes) and the model files an embedded workflow needs?
 * Pure functions over the manifest + the /object_info/{NodeName} schemas
 * (fetched by useAvailability); the real response shapes are recorded in
 * docs/api-notes.md.
 */

import type { NodeInfo, NodeInputSpec } from '../api/types';
import type { ModelField, PatchTarget, WorkflowManifest } from './types';

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
    if (field.kind === 'loras') LORAS_CHAIN_TYPES.forEach((t) => types.add(t));
    if (field.kind === 'persons')
      PERSONS_CHAIN_TYPES.forEach((t) => types.add(t));
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
      case 'model':
        add(field.target);
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
  if (!spec || !Array.isArray(spec[0]) || spec[0].length === 0) return null;
  return spec[0];
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
