/** Registry of the embedded workflows (one file per workflow). */

import { inpaintDraw } from './inpaint-draw';
import { krea2Depth } from './krea2-depth';
import { krea2FaceSwap } from './krea2-faceswap';
import { krea2Image2Prompt } from './krea2-image2prompt';
import { krea2Img2Img } from './krea2-img2img';
import { krea2Img2Prompt } from './krea2-img2prompt';
import { krea2Inpaint } from './krea2-inpaint';
import { krea2Text2Img } from './krea2-text2img';
import { krea2Upscale } from './krea2-upscale';
import { ltxI2v } from './ltx-i2v';
import { text2Prompt } from './text2prompt';
import type { WorkflowManifest } from './types';
import { wan22I2v } from './wan22-i2v';

export const workflows: WorkflowManifest[] = [
  krea2Text2Img,
  krea2Img2Img,
  wan22I2v,
  ltxI2v,
  krea2Upscale,
  krea2Depth,
  krea2Image2Prompt,
  krea2Img2Prompt,
  text2Prompt,
  inpaintDraw,
  krea2Inpaint,
  krea2FaceSwap,
];

export function getWorkflow(id: string): WorkflowManifest | undefined {
  return workflows.find((w) => w.id === id);
}
