/**
 * Graph patching: clones the frozen JSON and replaces the targeted node
 * values with the form fields, before POST /prompt.
 */

import i18n from '../i18n';
import type { PromptGraph } from '../api/types';
import { DEFAULT_GUIDE_SIZE } from './types';
import type {
  DimensionsValue,
  FieldValues,
  LoraSelection,
  LorasField,
  PatchTarget,
  PersonsField,
  PersonsValue,
  WorkflowManifest,
} from './types';

/** Latent node constraints (EmptySD3LatentImage: step 16, cf. object_info). */
export const DIMENSION_STEP = 16;
export const DIMENSION_MIN = 256;
export const DIMENSION_MAX = 4096;

/** Effective dimensions (inversion applied) of a dimensions field value. */
export function effectiveDimensions(v: DimensionsValue): {
  width: number;
  height: number;
} {
  return v.inverted
    ? { width: v.height, height: v.width }
    : { width: v.width, height: v.height };
}

/**
 * 31-bit seed — well within the KSampler range, and under the 2^31 max of
 * OllamaOptionsV2 (the most restrictive of the embedded seeded nodes).
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

/**
 * Parses a number tolerating the decimal comma: the iOS keyboard in the FR
 * locale only offers "," as a separator, while `Number()` requires ".".
 */
export function parseNumber(value: unknown): number {
  if (typeof value === 'string') return Number(value.replace(',', '.'));
  return Number(value);
}

function applyPatch(
  graph: PromptGraph,
  target: PatchTarget,
  value: string | number | [string, number],
): void {
  const node = graph[target.nodeId];
  if (!node) throw new Error(`Node ${target.nodeId} missing from the graph`);
  node.inputs[target.input] = value;
}

/** Validation errors by field.key; empty object = valid form. */
export function validate(
  manifest: WorkflowManifest,
  values: FieldValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of manifest.fields) {
    const value = values[field.key];
    if (field.kind === 'text' && field.required) {
      if (typeof value !== 'string' || value.trim() === '') {
        errors[field.key] = i18n.t('validation.required');
      }
    }
    if (field.kind === 'image' && field.required) {
      if (typeof value !== 'string' || value === '') {
        errors[field.key] = i18n.t('validation.imageRequired');
      }
    }
    if (field.kind === 'dimensions') {
      const v = value as DimensionsValue | undefined;
      const dims = [v?.width, v?.height];
      if (dims.some((d) => d == null || !Number.isInteger(d))) {
        errors[field.key] = i18n.t('validation.integerDims');
      } else if (dims.some((d) => (d as number) < DIMENSION_MIN || (d as number) > DIMENSION_MAX)) {
        errors[field.key] = i18n.t('validation.dimRange', { min: DIMENSION_MIN, max: DIMENSION_MAX });
      } else if (dims.some((d) => (d as number) % DIMENSION_STEP !== 0)) {
        errors[field.key] = i18n.t('validation.dimStep', { step: DIMENSION_STEP });
      }
    }
    if (field.kind === 'persons') {
      const v = value as PersonsValue | undefined;
      const active = v?.persons.filter((p) => !p.bypass) ?? [];
      if (!v || v.persons.length === 0) {
        errors[field.key] = i18n.t('validation.atLeastOnePerson');
      } else if (active.length === 0) {
        errors[field.key] = i18n.t('validation.allBypassed');
      } else if (v.persons.length > field.maxPersons) {
        errors[field.key] = i18n.t('persons.maxPersons', { count: field.maxPersons });
      } else if (active.some((p) => p.prompt.trim() === '')) {
        errors[field.key] = i18n.t('validation.identityRequired');
      } else if (active.some((p) => p.loras.length > field.maxLorasPerPerson)) {
        errors[field.key] = i18n.t('validation.maxLorasPerPerson', { count: field.maxLorasPerPerson });
      } else if (
        active.some(
          (p) =>
            !Number.isFinite(p.denoise) || p.denoise < 0.05 || p.denoise > 1,
        )
      ) {
        errors[field.key] = i18n.t('validation.denoiseRange');
      } else if (!Number.isInteger(v.steps) || v.steps < 1 || v.steps > 30) {
        errors[field.key] = i18n.t('validation.stepsRange');
      }
    }
    if (field.kind === 'loras' && Array.isArray(value)) {
      if (field.maxCount != null && value.length > field.maxCount) {
        errors[field.key] = i18n.t('lora.max', { count: field.maxCount });
      } else if (value.some((l) => !Number.isFinite(l.strength))) {
        errors[field.key] = i18n.t('validation.invalidStrength');
      }
    }
    if (field.kind === 'number') {
      const n = parseNumber(value ?? field.default);
      if (!Number.isFinite(n)) errors[field.key] = i18n.t('validation.invalidNumber');
      else if (field.integer && !Number.isInteger(n))
        errors[field.key] = i18n.t('validation.integerExpected');
      else if (field.min != null && n < field.min)
        errors[field.key] = i18n.t('validation.min', { min: field.min });
      else if (field.max != null && n > field.max)
        errors[field.key] = i18n.t('validation.max', { max: field.max });
    }
  }
  return errors;
}

/**
 * Inserts the LoraLoaderModelOnly chain into the graph:
 * MODEL source → lora 1 → … → lora N → every MODEL target.
 * With no LoRA selected, the graph stays intact (targets already wired to
 * the source in the frozen JSON).
 */
function insertLoraChain(
  graph: PromptGraph,
  field: LorasField,
  loras: LoraSelection[],
): void {
  let previous: [string, number] = [
    field.modelSource.nodeId,
    field.modelSource.output,
  ];
  loras.forEach((lora, i) => {
    const id = `komfy_lora_${i + 1}`;
    if (graph[id]) throw new Error(`Node id collision: ${id}`);
    graph[id] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: previous,
        lora_name: lora.name,
        strength_model: lora.strength,
      },
      _meta: { title: `LoRA ${i + 1}: ${lora.name}` },
    };
    previous = [id, 0];
  });
  for (const target of field.modelTargets) {
    applyPatch(graph, target, previous);
  }
}

/** Default destination folder under output/. */
export const DEFAULT_OUTPUT_DIR = 'komfy';

/**
 * Cleans a user-chosen output subfolder: normalized separators, no
 * leading/trailing slash, `.`/`..` segments and control characters
 * rejected. ComfyUI refuses to write outside output/ anyway (verified,
 * cf. api-notes §execution_error) — this just avoids the launch error.
 */
export function sanitizeOutputDir(dir: string): string {
  return dir
    .replace(/\\/g, '/')
    .replace(/[\u0000-\u001f:]/g, '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .join('/');
}

/**
 * Inserts the multi FaceSwap character passes: for each character i,
 *   SEGS filter (ascending x1, take_start=i) + identity prompt + LoRA
 *   chain → DetailerForEach
 * wired in series on the image; the last detailer's output is rewired to
 * the imageTargets. DetailerForEach parameters taken from a proven
 * FaceDetailer workflow (cfg 1, euler/simple, feather 5…).
 */
function insertPersonsChain(
  graph: PromptGraph,
  field: PersonsField,
  value: PersonsValue,
): void {
  const seedBase =
    value.seed === 'random' || value.seed == null
      ? randomSeed()
      : Number(value.seed);

  let previousImage: [string, number] = [
    field.imageSource.nodeId,
    field.imageSource.output,
  ];

  value.persons.forEach((person, i) => {
    // Bypass: face i keeps its number but no pass is inserted.
    if (person.bypass) return;
    const prefix = `komfy_person_${i + 1}`;
    if (graph[`${prefix}_detailer`]) {
      throw new Error(`Node id collision: ${prefix}_detailer`);
    }

    graph[`${prefix}_face`] = {
      class_type: 'ImpactSEGSOrderedFilter',
      inputs: {
        segs: [field.segsSource.nodeId, field.segsSource.output],
        target: 'x1',
        order: false, // ascending → faces numbered left to right
        take_start: i,
        take_count: 1,
      },
      _meta: { title: `Face #${i + 1} (left → right)` },
    };

    graph[`${prefix}_prompt`] = {
      class_type: 'CLIPTextEncode',
      inputs: {
        clip: [field.clipSource.nodeId, field.clipSource.output],
        text: person.prompt,
      },
      _meta: { title: `Character ${i + 1} identity` },
    };

    // Character-specific LoRA chain.
    let model: [string, number] = [
      field.modelSource.nodeId,
      field.modelSource.output,
    ];
    person.loras.forEach((lora, j) => {
      const id = `${prefix}_lora_${j + 1}`;
      graph[id] = {
        class_type: 'LoraLoaderModelOnly',
        inputs: {
          model,
          lora_name: lora.name,
          strength_model: lora.strength,
        },
        _meta: { title: `LoRA p${i + 1}.${j + 1}: ${lora.name}` },
      };
      model = [id, 0];
    });

    // Detail level: the crop is regenerated at guide_size; max_size
    // (anti-overflow ceiling) follows at 2× to leave room for elongated crops.
    const guideSize = person.guideSize ?? DEFAULT_GUIDE_SIZE;

    graph[`${prefix}_detailer`] = {
      class_type: 'DetailerForEach',
      inputs: {
        image: previousImage,
        segs: [`${prefix}_face`, 0],
        model,
        clip: [field.clipSource.nodeId, field.clipSource.output],
        vae: [field.vaeSource.nodeId, field.vaeSource.output],
        guide_size: guideSize,
        guide_size_for: true,
        max_size: guideSize * 2,
        seed: seedBase + i,
        steps: value.steps,
        cfg: 1.0,
        sampler_name: 'euler',
        scheduler: 'simple',
        positive: [`${prefix}_prompt`, 0],
        negative: [field.negativeSource.nodeId, field.negativeSource.output],
        denoise: person.denoise,
        feather: 5,
        noise_mask: true,
        force_inpaint: true,
        wildcard: '',
        cycle: 1,
        inpaint_model: false,
        noise_mask_feather: 20,
      },
      _meta: { title: `Character ${i + 1} FaceSwap` },
    };
    previousImage = [`${prefix}_detailer`, 0];
  });

  for (const target of field.imageTargets) {
    applyPatch(graph, target, previousImage);
  }
}

export function patchGraph(
  manifest: WorkflowManifest,
  values: FieldValues,
  options?: { outputDir?: string },
): PromptGraph {
  const graph: PromptGraph = JSON.parse(JSON.stringify(manifest.graph));

  for (const field of manifest.fields) {
    const value = values[field.key];
    switch (field.kind) {
      case 'text':
        applyPatch(graph, field.target, String(value ?? field.default));
        break;
      case 'number': {
        const n = parseNumber(value ?? field.default);
        applyPatch(graph, field.target, n);
        for (const target of field.extraTargets ?? []) {
          applyPatch(graph, target, n);
        }
        break;
      }
      case 'seed':
        applyPatch(
          graph,
          field.target,
          value === 'random' || value == null ? randomSeed() : Number(value),
        );
        break;
      case 'image':
        applyPatch(graph, field.target, String(value ?? ''));
        break;
      case 'model':
        applyPatch(graph, field.target, String(value ?? field.default));
        break;
      case 'dimensions': {
        const v = (value as DimensionsValue | undefined) ?? {
          ...field.default,
          inverted: false,
          custom: false,
        };
        const dims = effectiveDimensions(v);
        applyPatch(graph, field.widthTarget, dims.width);
        applyPatch(graph, field.heightTarget, dims.height);
        break;
      }
      case 'loras':
        insertLoraChain(graph, field, Array.isArray(value) ? value : []);
        break;
      case 'persons':
        insertPersonsChain(graph, field, value as PersonsValue);
        break;
      case 'select': {
        const index =
          typeof value === 'number' ? value : field.defaultIndex;
        const option = field.options[index] ?? field.options[field.defaultIndex];
        for (const patch of option.patches) {
          applyPatch(graph, patch.target, patch.value);
        }
        break;
      }
    }
  }

  // Text-result workflow: no SaveImage, nothing to prefix.
  if (manifest.saveNodeId != null) {
    const outputDir = sanitizeOutputDir(
      options?.outputDir ?? DEFAULT_OUTPUT_DIR,
    );
    applyPatch(
      graph,
      { nodeId: manifest.saveNodeId, input: 'filename_prefix' },
      outputDir === '' ? manifest.id : `${outputDir}/${manifest.id}`,
    );
  }

  return graph;
}
