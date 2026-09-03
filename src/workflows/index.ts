/** Registry of the embedded workflows (one file per workflow). */

import { inpaintDraw } from './inpaint-draw';
import { krea2Depth } from './krea2-depth';
import { krea2DetectReplace } from './krea2-detect-replace';
import { krea2Edit } from './krea2-edit';
import { krea2Img2Img } from './krea2-img2img';
import { krea2Img2Prompt } from './krea2-img2prompt';
import { krea2Text2Img } from './krea2-text2img';
import { krea2Upscale } from './krea2-upscale';
import { ltxI2v } from './ltx-i2v';
import { text2Prompt } from './text2prompt';
import type { WorkflowManifest } from './types';

export const workflows: WorkflowManifest[] = [
  krea2Text2Img,
  krea2Img2Img,
  krea2Edit,
  ltxI2v,
  krea2Upscale,
  krea2Depth,
  krea2Img2Prompt,
  text2Prompt,
  inpaintDraw,
  krea2DetectReplace,
];

export function getWorkflow(id: string): WorkflowManifest | undefined {
  return workflows.find((w) => w.id === id);
}
