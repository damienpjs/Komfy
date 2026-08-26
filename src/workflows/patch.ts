/**
 * Graph patching: clones the frozen JSON and replaces the targeted node
 * values with the form fields, before POST /prompt.
 */

import i18n from '../i18n';
import type { PromptGraph } from '../api/types';
import { getLoraMaxCount } from '../store/settings';
import { DEFAULT_GUIDE_SIZE } from './types';
import type {
  DimensionsValue,
  FieldValues,
  LoraSelection,
  LorasField,
  ModelSourceField,
  ModelSourceValue,
  PatchTarget,
  PersonsField,
  PersonsValue,
  PersonValue,
  SelectOption,
  WorkflowManifest,
} from './types';

/**
 * Latent node constraint. The VAE downsamples by 8, so pixel dimensions must
 * be multiples of 8. EmptySD3LatentImage advertises step 16 in /object_info,
 * but that is only the widget-increment hint — ComfyUI validates min/max, never
 * step, and Flux/SD3 pad the latent internally then crop back to the requested
 * size, so step-8 values (e.g. 1920×1080) generate at the exact size asked.
 */
export const DIMENSION_STEP = 8;
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
    // Hidden fields (showWhen unmet) are neither shown nor validated — their
    // value is moot (the controlling toggle removes the target node).
    if (field.showWhen && values[field.showWhen.key] !== field.showWhen.equals) {
      continue;
    }
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
    if (field.kind === 'mask' && field.required) {
      if (typeof value !== 'string' || value === '') {
        errors[field.key] = i18n.t('validation.maskRequired');
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
      // allFaces: only persons[0] is patched — the others are dormant, so
      // neither bypass nor the count constrain anything.
      const active: PersonValue[] = v?.allFaces
        ? v.persons.slice(0, 1)
        : v?.persons.filter((p) => !p.bypass) ?? [];
      // Per-character LoRA cap: the global setting (null = no limit).
      const loraCap = getLoraMaxCount();
      if (!v || v.persons.length === 0) {
        errors[field.key] = i18n.t('validation.atLeastOnePerson');
      } else if (active.length === 0) {
        errors[field.key] = i18n.t('validation.allBypassed');
      } else if (
        !v.allFaces &&
        field.maxPersons != null &&
        v.persons.length > field.maxPersons
      ) {
        errors[field.key] = i18n.t('persons.maxPersons', { count: field.maxPersons });
      } else if (active.some((p) => p.prompt.trim() === '')) {
        errors[field.key] = i18n.t('validation.identityRequired');
      } else if (loraCap != null && active.some((p) => p.loras.length > loraCap)) {
        errors[field.key] = i18n.t('validation.maxLorasPerPerson', { count: loraCap });
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
    if (field.kind === 'modelSource') {
      const v = resolveModelSource(field, value);
      if (v.mode === 'checkpoint') {
        if (v.checkpoint.trim() === '')
          errors[field.key] = i18n.t('validation.modelRequired');
      } else if (
        v.unet.trim() === '' ||
        v.clip.trim() === '' ||
        v.clipType.trim() === '' ||
        v.vae.trim() === ''
      ) {
        errors[field.key] = i18n.t('validation.modelRequired');
      }
    }
    if (field.kind === 'loras' && Array.isArray(value)) {
      const cap = getLoraMaxCount();
      if (cap != null && value.length > cap) {
        errors[field.key] = i18n.t('lora.max', { count: cap });
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

/** Live connection at an input, else a fallback [nodeId, output]. */
function connFrom(
  value: unknown,
  fallback: [string, number],
): [string, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'number'
    ? [value[0], value[1]]
    : fallback;
}

/**
 * Inserts the LoRA chain into the graph:
 * MODEL source → lora 1 → … → lora N → every MODEL target.
 * The field's `fixed` LoRAs open the chain, ahead of the user's selection.
 * With nothing to insert at all, the graph stays intact (targets already
 * wired to the source in the frozen JSON).
 */
function insertLoraChain(
  graph: PromptGraph,
  field: LorasField,
  loras: LoraSelection[],
): void {
  // Every consumer gone (an earlier select dropped the branch that used the
  // MODEL — e.g. the upscale "sans diffusion" mode): building the chain would
  // only litter the prompt with loaders feeding nothing.
  if (!field.modelTargets.some((t) => graph[t.nodeId])) return;
  // Upstream = whatever currently feeds the first target. A modelSource field
  // patched earlier may have rewired it (checkpoint vs diffusion loader), so
  // the live connection wins; the field source is the fallback. For every
  // existing workflow the two are equal (source == frozen target value), so
  // this changes nothing there.
  const firstModel = field.modelTargets[0];
  let prevModel = connFrom(
    firstModel ? graph[firstModel.nodeId]?.inputs?.[firstModel.input] : undefined,
    [field.modelSource.nodeId, field.modelSource.output],
  );
  // Namespaced by field.key: a manifest may hold several loras fields (an
  // imported multi-chain graph), each inserting its own chain — a shared
  // `komfy_lora_N` id would collide across them.
  const chain = field.fixed != null ? [...field.fixed, ...loras] : loras;
  chain.forEach((lora, i) => {
    const id = `komfy_lora_${field.key}_${i + 1}`;
    if (graph[id]) throw new Error(`Node id collision: ${id}`);
    graph[id] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: {
        model: prevModel,
        lora_name: lora.name,
        strength_model: lora.strength,
      },
      _meta: { title: `LoRA ${i + 1}: ${lora.name}` },
    };
    prevModel = [id, 0];
  });
  // Consumers an earlier select removed (e.g. UltimateSDUpscale in the upscale
  // "sans diffusion" mode, where LoRAs are meaningless anyway) are skipped: the
  // chain is simply left dangling and pruned with the rest of the dead branch.
  for (const target of field.modelTargets) {
    if (graph[target.nodeId]) applyPatch(graph, target, prevModel);
  }
}

/**
 * Applies one select option to a graph: its patches, then the two kinds of node
 * removal. Exported because match.ts replays the options onto the manifest
 * graph to recognise which variant produced an extracted graph — a select that
 * reshapes the graph cannot be recovered from literal values alone.
 */
export function applySelectOption(
  graph: PromptGraph,
  option: SelectOption,
): void {
  for (const patch of option.patches) {
    // A select may drive a node an earlier select toggled off (e.g. the upscale
    // tile size, whose UltimateSDUpscale is gone in the "sans diffusion"
    // mode): the value is then moot — skip rather than throw.
    if (!graph[patch.target.nodeId]) continue;
    applyPatch(graph, patch.target, patch.value);
  }
  // Mid-chain nodes toggled off: delete and short-circuit (CTRL+B).
  passthroughBypass(graph, option.passthroughNodes ?? []);
  // Optional branch toggled off: drop the sink nodes this option bypasses.
  for (const nodeId of option.bypassNodes ?? []) delete graph[nodeId];
}

/**
 * Bypass = passthrough: for each entry, delete `nodeId` and rewire every input
 * reading `[nodeId, output]` to whatever `graph[nodeId].inputs[input]` holds
 * right now — mirroring ComfyUI's CTRL+B (the node vanishes, its signal flows
 * straight through). The upstream is read live, so it may be a node created
 * earlier at patch time (e.g. a loras-chain tail whose id is only known then);
 * the select field must therefore be ordered after whatever builds it.
 */
function passthroughBypass(
  graph: PromptGraph,
  entries: { nodeId: string; output: number; input: string }[],
): void {
  for (const { nodeId, output, input } of entries) {
    const node = graph[nodeId];
    if (!node) continue;
    const upstream = node.inputs[input];
    for (const consumer of Object.values(graph)) {
      for (const [key, value] of Object.entries(consumer.inputs)) {
        if (Array.isArray(value) && value[0] === nodeId && value[1] === output) {
          consumer.inputs[key] = upstream;
        }
      }
    }
    delete graph[nodeId];
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
 * Inserts one character's pass: identity prompt + LoRA chain →
 * DetailerForEach over `segs`, applied on top of `image`. Returns the
 * detailer's IMAGE output. DetailerForEach parameters taken from a proven
 * FaceDetailer workflow (cfg 1, euler/simple, feather 5…).
 */
function insertPersonPass(
  graph: PromptGraph,
  field: PersonsField,
  person: PersonValue,
  opts: {
    prefix: string;
    segs: [string, number];
    image: [string, number];
    seed: number;
    steps: number;
    title: string;
  },
): [string, number] {
  const { prefix } = opts;
  if (graph[`${prefix}_detailer`]) {
    throw new Error(`Node id collision: ${prefix}_detailer`);
  }

  graph[`${prefix}_prompt`] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: [field.clipSource.nodeId, field.clipSource.output],
      text: person.prompt,
    },
    _meta: { title: `${opts.title} identity` },
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
      _meta: { title: `LoRA ${prefix}.${j + 1}: ${lora.name}` },
    };
    model = [id, 0];
  });

  // Detail level: the crop is regenerated at guide_size; max_size
  // (anti-overflow ceiling) follows at 2× to leave room for elongated crops.
  const guideSize = person.guideSize ?? DEFAULT_GUIDE_SIZE;

  graph[`${prefix}_detailer`] = {
    class_type: 'DetailerForEach',
    inputs: {
      image: opts.image,
      segs: opts.segs,
      model,
      clip: [field.clipSource.nodeId, field.clipSource.output],
      vae: [field.vaeSource.nodeId, field.vaeSource.output],
      guide_size: guideSize,
      guide_size_for: true,
      max_size: guideSize * 2,
      seed: opts.seed,
      steps: opts.steps,
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
    _meta: { title: `${opts.title} FaceSwap` },
  };
  return [`${prefix}_detailer`, 0];
}

/**
 * Inserts the FaceSwap passes and rewires the imageTargets to the last one.
 *  - allFaces: a single pass fed the raw SEGS. DetailerForEach loops over
 *    every seg of the batch (seed + i per face), so any number of faces is
 *    covered by one identity — no filter node, nothing to enumerate.
 *  - otherwise: one pass per character, each behind an ordered SEGS filter
 *    (take_start = face number, ascending x1 = left → right), chained in
 *    series on the image.
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

  if (value.allFaces) {
    previousImage = insertPersonPass(graph, field, value.persons[0], {
      prefix: 'komfy_faces',
      segs: [field.segsSource.nodeId, field.segsSource.output],
      image: previousImage,
      seed: seedBase,
      steps: value.steps,
      title: 'Every face',
    });
  } else {
    value.persons.forEach((person, i) => {
      // Bypass: face i keeps its number but no pass is inserted.
      if (person.bypass) return;
      const prefix = `komfy_person_${i + 1}`;

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

      previousImage = insertPersonPass(graph, field, person, {
        prefix,
        segs: [`${prefix}_face`, 0],
        image: previousImage,
        seed: seedBase + i,
        steps: value.steps,
        title: `Character ${i + 1}`,
      });
    });
  }

  for (const target of field.imageTargets) {
    applyPatch(graph, target, previousImage);
  }
}

/** Coerces a raw form value into a ModelSourceValue, filling field fallbacks. */
export function resolveModelSource(
  field: ModelSourceField,
  value: unknown,
): ModelSourceValue {
  const v = (value ?? {}) as Partial<ModelSourceValue>;
  return {
    mode: v.mode === 'checkpoint' ? 'checkpoint' : 'diffusion',
    checkpoint: v.checkpoint ?? field.defaultCheckpoint,
    unet: v.unet ?? field.defaultUnet,
    clip: v.clip ?? field.defaultClip,
    clipType: v.clipType ?? field.defaultClipType,
    vae: v.vae ?? field.defaultVae,
  };
}

/**
 * Wires the graph to the chosen model source and drops the unused loaders:
 *  - checkpoint mode: CheckpointLoaderSimple feeds MODEL (0) / CLIP (1) /
 *    VAE (2); the separate UNET/CLIP/VAE loaders are removed;
 *  - diffusion mode: the UNET/CLIP/VAE loaders are set and re-wired; the
 *    checkpoint loader is removed.
 * Runs before insertLoraChain (manifest field order), which then follows the
 * MODEL output this leaves on the KSampler input.
 */
function insertModelSource(
  graph: PromptGraph,
  field: ModelSourceField,
  value: ModelSourceValue,
): void {
  const rewire = (targets: PatchTarget[], to: [string, number]) => {
    for (const target of targets) applyPatch(graph, target, to);
  };

  if (value.mode === 'checkpoint') {
    // Splice in the checkpoint loader (kept out of the frozen graph so a
    // dangling node never breaks remix matching, cf. match.tryMatch).
    graph[field.checkpointNodeId] = {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: value.checkpoint },
      _meta: { title: `Checkpoint: ${value.checkpoint}` },
    };
    rewire(field.modelTargets, [field.checkpointNodeId, 0]);
    rewire(field.clipTargets, [field.checkpointNodeId, 1]);
    rewire(field.vaeTargets, [field.checkpointNodeId, 2]);
    // SD1.5/SDXL checkpoints use a 4-channel latent; swap the 16-channel
    // node in place (same width/height/batch_size signature).
    // Image-to-image workflows have no empty latent to swap (cf. the field's
    // latentNodeId doc) — the VAE settles the channel count there.
    const latent =
      field.latentNodeId != null ? graph[field.latentNodeId] : undefined;
    if (latent) latent.class_type = 'EmptyLatentImage';
    delete graph[field.unetNodeId];
    delete graph[field.clipNodeId];
    delete graph[field.vaeNodeId];
  } else {
    const unet = graph[field.unetNodeId];
    if (unet) unet.inputs.unet_name = value.unet;
    const clip = graph[field.clipNodeId];
    if (clip) {
      clip.inputs.clip_name = value.clip;
      clip.inputs.type = value.clipType;
    }
    const vae = graph[field.vaeNodeId];
    if (vae) vae.inputs.vae_name = value.vae;
    // Frozen graph already points here; explicit re-wire is a safe no-op.
    rewire(field.modelTargets, [field.unetNodeId, 0]);
    rewire(field.clipTargets, [field.clipNodeId, 0]);
    rewire(field.vaeTargets, [field.vaeNodeId, 0]);
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
        // Same guard as `number`: a text field may drive a node an earlier
        // select toggled off (e.g. the upscale sigmas, removed with their
        // ManualSigmas when the step-based scheduler is picked).
        if (!graph[field.target.nodeId]) break;
        applyPatch(graph, field.target, String(value ?? field.default));
        break;
      case 'number': {
        const n = parseNumber(value ?? field.default);
        // A number may drive a node an earlier select toggled off (e.g. the
        // distilled-LoRA strengths, removed with their loaders): the value is
        // then moot — skip rather than throw on the missing node.
        if (!graph[field.target.nodeId]) break;
        applyPatch(graph, field.target, n);
        for (const target of field.extraTargets ?? []) {
          applyPatch(graph, target, n);
        }
        break;
      }
      case 'seed':
        // Same guard as `text`/`number`: the sampler this seed drives may have
        // been removed by an earlier select (e.g. the upscale "sans diffusion"
        // mode, which drops UltimateSDUpscale) — the seed is then moot.
        if (!graph[field.target.nodeId]) break;
        applyPatch(
          graph,
          field.target,
          value === 'random' || value == null ? randomSeed() : Number(value),
        );
        break;
      case 'image':
      case 'mask':
        applyPatch(graph, field.target, String(value ?? ''));
        break;
      case 'model':
        // Same guard as `text`/`number`/`seed`: the loader may belong to a
        // branch an earlier select dropped (the upscale "sans diffusion" mode
        // removes the KREA2 loaders outright).
        if (!graph[field.target.nodeId]) break;
        applyPatch(graph, field.target, String(value ?? field.default));
        break;
      case 'modelSource':
        insertModelSource(graph, field, resolveModelSource(field, value));
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
        applySelectOption(
          graph,
          field.options[index] ?? field.options[field.defaultIndex],
        );
        break;
      }
    }
  }

  // Text-result workflow: no SaveImage, nothing to prefix.
  if (manifest.saveNodeId != null) {
    const outputDir = sanitizeOutputDir(
      options?.outputDir ?? DEFAULT_OUTPUT_DIR,
    );
    const withDir = (base: string) =>
      outputDir === '' ? base : `${outputDir}/${base}`;
    applyPatch(
      graph,
      { nodeId: manifest.saveNodeId, input: 'filename_prefix' },
      withDir(manifest.id),
    );
    // Secondary sinks follow the same chosen folder, keeping their own basename
    // (the part after the frozen `komfy/` dir). Skip nodes a select bypassed.
    for (const auxId of manifest.auxSaveNodeIds ?? []) {
      const node = graph[auxId];
      if (!node) continue;
      const frozen = String(node.inputs.filename_prefix ?? manifest.id);
      const slash = frozen.indexOf('/');
      node.inputs.filename_prefix = withDir(
        slash >= 0 ? frozen.slice(slash + 1) : frozen,
      );
    }
  }

  return graph;
}
