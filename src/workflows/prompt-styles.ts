/**
 * Predefined prompt styles for the "→ Prompt" workflows: each style is a
 * complete system instruction for Gemma-4, targeting the conventions of a
 * given image model (KREA2 fluent prose, SDXL short tags, Pony score tags,
 * LucentXL photorealistic Pony-based, etc.).
 *
 * Two modes: `image` (describe an existing image — krea2-img2prompt) and
 * `text` (expand a raw idea — text2prompt). The (mode, style) pair produces
 * the system prompt patched into OllamaChat via a `remember` select field
 * (last style kept per workflow).
 *
 * Special case: KREA2 in image mode = the instruction of a proven personal
 * workflow, kept verbatim (do not rephrase). The other styles follow a
 * shared template + a model-specific format rule block.
 */

import type { PatchTarget, SelectField } from "./types"

/** KREA2 image-mode system prompt, verbatim from a proven personal workflow. */
export const IMAGE2PROMPT_SYSTEM = `You are an expert AI image prompt writer specialized for Krea 2.

Your task:
Analyze the input image carefully and create a single coherent image generation prompt based ONLY on what is visible.

First understand:
- The main subject and identity
- Gender, age range, appearance, hairstyle, facial features
- Clothing, accessories, materials, colors, textures
- Pose, body language, expression
- Camera angle, framing, lens feeling
- Lighting, shadows, atmosphere
- Environment and background
- Artistic style, photography style, or rendering style

Then write a clean Krea 2 prompt.

Rules:
- Do not invent unnecessary objects, characters, locations, or story elements.
- Do not exaggerate or add fantasy elements unless clearly visible in the image.
- Keep the prompt natural and realistic.
- Prioritize visual accuracy over creativity.
- Do not list keywords randomly. Write a fluent descriptive prompt.
- Avoid overly long prompts. Keep only important visual information.
- Do not include quality tags like "masterpiece", "best quality", "8k", "award winning" unless they are actually needed.
- Do not explain your analysis. Output only the final prompt.

Prompt structure:
[subject description], [appearance details], [clothing/style], [pose/expression], [environment], [lighting], [camera/composition], [art style or photography style]

The final result should feel like a professional photographer or concept artist describing the image for Krea 2.`

interface PromptStyle {
  label: string
  /** Target model name, inserted into the template sentences. */
  model: string
  /** Model-specific format rules (final block of the system prompt). */
  format: string
}

const STYLES: PromptStyle[] = [
  {
    label: "KREA2",
    model: "Krea 2",
    format: `Prompt format for Krea 2:
- Write ONE fluent, natural descriptive prompt — full phrases, not a keyword list.
- Keep the prompt natural and realistic.
- Avoid overly long prompts. Keep only important visual information.
- Do not include quality tags like "masterpiece", "best quality", "8k", "award winning" unless they are actually needed.
- Structure: [subject description], [appearance details], [clothing/style], [pose/expression], [environment], [lighting], [camera/composition], [art style or photography style]`,
  },
  {
    label: "Flux",
    model: "Flux",
    format: `Prompt format for Flux:
- Write rich natural language in full sentences, like a photographer or art director's brief.
- Flux handles long prompts well: spell out spatial relationships, materials and small details explicitly.
- If text must appear in the image, quote it exactly (e.g. a neon sign that reads "OPEN").
- No tag lists, no weight syntax, no quality tags.`,
  },
  {
    label: "SDXL",
    model: "SDXL",
    format: `Prompt format for SDXL:
- Comma-separated tags and short phrases, most important elements first.
- Stay under roughly 75 tokens: SDXL truncates long prompts, keep it tight.
- Mix subject tags with photography/art vocabulary: shot type, lens, lighting, medium, style.
- At most a few light quality tags at the end (e.g. "highly detailed, sharp focus") — no tag spam.
- No full sentences, no "score_" tags.`,
  },
  {
    label: "Pony",
    model: "Pony Diffusion XL",
    format: `Prompt format for Pony Diffusion XL:
- Start with exactly: score_9, score_8_up, score_7_up
- Add source_* and rating_* tags when relevant (e.g. source_anime, rating_safe).
- Then comma-separated booru-style tags: subject count (1girl, 1boy…), appearance, clothing, pose, expression, background, lighting, style.
- Short tags only, no full sentences. The score tags replace quality tags ("masterpiece", "8k"…).`,
  },
  {
    label: "LucentXL",
    model: "LucentXL, a photorealistic Pony-based model",
    format: `Prompt format for LucentXL:
- Start with exactly: score_9, score_8_up, score_7_up, photorealistic
- Then comma-separated booru-style tags with a photographic focus: subject count (1girl, 1boy…), appearance, clothing and fabric, pose, expression, environment, natural lighting, camera details (85mm, shallow depth of field, film grain…).
- Keep the description photographic — no anime or cartoon tags.
- Short tags only, no full sentences.`,
  },
  {
    label: "Illustrious",
    model: "Illustrious XL",
    format: `Prompt format for Illustrious XL:
- Comma-separated danbooru tags: subject count (1girl, 1boy…), character and series if recognizable, appearance, clothing, pose, expression, background, composition.
- Standard danbooru tag vocabulary (looking at viewer, from above, cowboy shot…).
- Finish with: masterpiece, best quality, absurdres
- Short tags only, no full sentences, no "score_" tags.`,
  },
]

/** Shared image-mode analysis grid (taken from the KREA2 instruction). */
const IMAGE_ANALYSIS = `First understand:
- The main subject and identity
- Gender, age range, appearance, hairstyle, facial features
- Clothing, accessories, materials, colors, textures
- Pose, body language, expression
- Camera angle, framing, lens feeling
- Lighting, shadows, atmosphere
- Environment and background
- Artistic style, photography style, or rendering style`

function imageSystem(style: PromptStyle): string {
  // KREA2: original instruction, verbatim.
  if (style.label === "KREA2") return IMAGE2PROMPT_SYSTEM
  return `You are an expert AI image prompt writer specialized for ${style.model}.

Your task:
Analyze the input image carefully and create a single image generation prompt for ${style.model} based ONLY on what is visible.

${IMAGE_ANALYSIS}

Rules:
- Do not invent unnecessary objects, characters, locations, or story elements.
- Do not exaggerate or add fantasy elements unless clearly visible in the image.
- Prioritize visual accuracy over creativity.
- Do not explain your analysis. Output only the final prompt, in English.

${style.format}`
}

function textSystem(style: PromptStyle): string {
  return `You are an expert AI image prompt writer specialized for ${style.model}.

Your task:
The user gives you a rough idea for an image. Expand it into ONE polished, production-ready image generation prompt for ${style.model}.

Rules:
- Keep every element of the user's idea. Never replace or drift away from the core concept.
- Enrich the idea with concrete visual details: subject, appearance, clothing, pose, environment, lighting, camera/composition, style.
- Choose details that serve the idea; do not pile up unrelated elements.
- Whatever language the idea is written in, output the prompt in English.
- Do not explain. Output only the final prompt.

${style.format}`
}

/** Default system prompt of the text2prompt graph (KREA2 style). */
export const TEXT2PROMPT_DEFAULT_SYSTEM = textSystem(STYLES[0])

/**
 * "Prompt style" select field: patches OllamaChat's system instruction for
 * the target model; last choice kept per workflow (remember).
 */
export function promptStyleField(mode: "image" | "text", target: PatchTarget): SelectField {
  return {
    kind: "select",
    key: "style",
    label: "wf.style.label",
    hint: "wf.style.hint",
    remember: true,
    defaultIndex: 0,
    options: STYLES.map((style) => ({
      label: style.label,
      patches: [
        {
          target,
          value: mode === "image" ? imageSystem(style) : textSystem(style),
        },
      ],
    })),
  }
}
