/**
 * Best-effort extraction of a job's parameters from its API graph, for the
 * detail view (prompt, seed, LoRAs…). Generic: also works on workflows the
 * app does not know (desktop pipelines), unlike the strict matching of
 * src/workflows/match.ts.
 *
 * Heuristics validated against 18 real graphs from the server (2026-07-14):
 *  - scalars (seed, steps, cfg…) can be connections to a parameter node
 *    ("Input Parameters (Image Saver)", "easy int") — follow the connection
 *    down to a candidate literal;
 *  - some custom nodes serialize numbers as strings ("8", "1.0");
 *  - a prompt's text can live under `string`/`value`/`populated_text`
 *    (String Literal, PrimitiveStringMultiline, Impact wildcards);
 *  - detailer-only workflows (detect & replace) have no KSampler: the
 *    sampling node is the one carrying steps+cfg+seed (DetailerForEach);
 *  - a negative wired to ConditioningZeroOut = no negative (following it
 *    would climb back to the positive prompt).
 */

import type { PromptGraph, PromptNode } from '../api/types';

export interface JobLora {
  name: string;
  strength: number;
}

export interface JobSummary {
  model?: string;
  positive?: string;
  negative?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  width?: number;
  height?: number;
  loras: JobLora[];
  nodeCount: number;
}

type Conn = [string, number];

function isConn(v: unknown): v is Conn {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';
}

/** Literal inputs likely to carry a prompt text. */
const TEXT_KEYS = ['text', 'string', 'value', 'populated_text', 'wildcard_text'];

/**
 * Follows connections up to a node carrying a text input (prompt). `prefer`
 * ('positive'|'negative') is the conditioning role sought: a passthrough node
 * that re-emits both conditionings on separate outputs (e.g. WanAnimateToVideo:
 * positive on 0, negative on 1) is entered by node id only — the output slot is
 * lost — so without this the negative would resolve to the first input scanned
 * (positive) and both prompts would read alike. Following the same-named input
 * first keeps them distinct; the blind scan remains the fallback.
 */
function resolveText(
  graph: PromptGraph,
  conn: unknown,
  prefer?: string,
  depth = 0,
): string | undefined {
  if (!isConn(conn) || depth > 6) return undefined;
  const node = graph[conn[0]];
  if (!node) return undefined;
  for (const key of TEXT_KEYS) {
    if (typeof node.inputs[key] === 'string') return node.inputs[key] as string;
  }
  if (prefer != null && isConn(node.inputs[prefer])) {
    const found = resolveText(graph, node.inputs[prefer], prefer, depth + 1);
    if (found != null) return found;
  }
  for (const value of Object.values(node.inputs)) {
    const found = resolveText(graph, value, prefer, depth + 1);
    if (found != null) return found;
  }
  return undefined;
}

/** Literal number, including string-serialized ("8", "1.0"). */
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Resolves a scalar input: direct literal, otherwise follows the connection
 * to the source node and looks for a literal under one of the candidate keys.
 */
function resolveScalar<T>(
  graph: PromptGraph,
  value: unknown,
  keys: string[],
  cast: (v: unknown) => T | undefined,
  depth = 0,
): T | undefined {
  if (!isConn(value)) return cast(value);
  if (depth > 3) return undefined;
  const node = graph[value[0]];
  if (!node) return undefined;
  for (const key of keys) {
    const got = node.inputs[key];
    if (got != null && !isConn(got)) {
      const casted = cast(got);
      if (casted != null) return casted;
    }
  }
  for (const key of keys) {
    const got = node.inputs[key];
    if (isConn(got)) {
      const found = resolveScalar(graph, got, keys, cast, depth + 1);
      if (found != null) return found;
    }
  }
  return undefined;
}

export function describeJob(graph: PromptGraph): JobSummary {
  const summary: JobSummary = { loras: [], nodeCount: Object.keys(graph).length };
  const nodes = Object.values(graph) as PromptNode[];

  // Sampling node: KSampler & co, otherwise any node carrying
  // steps + cfg + seed (DetailerForEach in the detect & replace workflows).
  const sampler =
    nodes.find((n) => n.class_type.includes('KSampler')) ??
    nodes.find(
      (n) =>
        'steps' in n.inputs &&
        'cfg' in n.inputs &&
        ('seed' in n.inputs || 'noise_seed' in n.inputs),
    );
  if (sampler) {
    summary.seed = resolveScalar(
      graph,
      sampler.inputs.seed ?? sampler.inputs.noise_seed,
      ['seed', 'noise_seed', 'value'],
      asNumber,
    );
    summary.steps = resolveScalar(graph, sampler.inputs.steps, ['steps', 'value'], asNumber);
    summary.cfg = resolveScalar(graph, sampler.inputs.cfg, ['cfg', 'value'], asNumber);
    summary.sampler = resolveScalar(
      graph,
      sampler.inputs.sampler_name,
      ['sampler_name', 'sampler'],
      asString,
    );
    summary.scheduler = resolveScalar(
      graph,
      sampler.inputs.scheduler,
      ['scheduler'],
      asString,
    );
    summary.positive = resolveText(graph, sampler.inputs.positive, 'positive');
    const neg = sampler.inputs.negative;
    // Cancelled negative (ConditioningZeroOut): do not climb to the positive.
    if (!(isConn(neg) && graph[neg[0]]?.class_type === 'ConditioningZeroOut')) {
      summary.negative = resolveText(graph, neg, 'negative');
    }
    // Dimensions: latent wired to the sampler, otherwise any latent node.
    if (isConn(sampler.inputs.latent_image)) {
      const latent = graph[sampler.inputs.latent_image[0]];
      summary.width = resolveScalar(graph, latent?.inputs.width, ['width'], asNumber);
      summary.height = resolveScalar(graph, latent?.inputs.height, ['height'], asNumber);
    }
  }
  if (summary.width == null) {
    const latent = nodes.find((n) => asNumber(n.inputs.width) != null && asNumber(n.inputs.height) != null && n.class_type.toLowerCase().includes('latent'));
    summary.width = asNumber(latent?.inputs.width);
    summary.height = asNumber(latent?.inputs.height);
  }
  // A canvas the graph sizes itself (KREA2 edit: dimensions derived from the
  // source image) leaves a 0 placeholder on the sizing node — the real format
  // is only known server-side, so show nothing rather than "0 × 0".
  if ((summary.width ?? 0) <= 0 || (summary.height ?? 0) <= 0) {
    summary.width = undefined;
    summary.height = undefined;
  }

  for (const node of nodes) {
    // Model: any node carrying a literal unet_name / ckpt_name (covers
    // custom variants like "UNet loader with Name (Image Saver)").
    summary.model ??= asString(node.inputs.unet_name) ?? asString(node.inputs.ckpt_name);
    // Core LoRA loaders.
    if (
      (node.class_type === 'LoraLoaderModelOnly' || node.class_type === 'LoraLoader') &&
      typeof node.inputs.lora_name === 'string'
    ) {
      summary.loras.push({
        name: node.inputs.lora_name,
        strength: asNumber(node.inputs.strength_model) ?? 1,
      });
    }
    // Power Lora Loader (rgthree): inputs lora_N = {on, lora, strength}.
    if (node.class_type.startsWith('Power Lora Loader')) {
      for (const value of Object.values(node.inputs)) {
        if (
          value != null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          typeof (value as { lora?: unknown }).lora === 'string' &&
          (value as { on?: unknown }).on !== false
        ) {
          const v = value as { lora: string; strength?: number };
          summary.loras.push({ name: v.lora, strength: asNumber(v.strength) ?? 1 });
        }
      }
    }
  }

  return summary;
}
