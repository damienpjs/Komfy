/** Registry of the embedded workflows (one file per workflow). */

import { indexttsVoice } from './indextts-voice';
import { inpaintDraw } from './inpaint-draw';
import { krea2AnypaintInpaint } from './krea2-anypaint-inpaint';
import { krea2Depth } from './krea2-depth';
import { krea2DetectReplace } from './krea2-detect-replace';
import { krea2DrawReplace } from './krea2-draw-replace';
import { krea2Edit } from './krea2-edit';
import { krea2Img2Img } from './krea2-img2img';
import { krea2Img2Prompt } from './krea2-img2prompt';
import { krea2Outpaint } from './krea2-outpaint';
import { krea2Text2Img } from './krea2-text2img';
import { krea2Upscale } from './krea2-upscale';
import { ltx25A2v } from './ltx25-a2v';
import { ltx25Flf } from './ltx25-flf';
import { ltx25I2v } from './ltx25-i2v';
import { ltx25T2v } from './ltx25-t2v';
import { ltx25Upscale } from './ltx25-upscale';
import { text2Prompt } from './text2prompt';
import { xttsVoice } from './xtts-voice';
import type { WorkflowManifest } from './types';

export const workflows: WorkflowManifest[] = [
  krea2Text2Img,
  krea2Img2Img,
  krea2Edit,
  ltx25T2v,
  ltx25I2v,
  ltx25A2v,
  ltx25Flf,
  indexttsVoice,
  xttsVoice,
  ltx25Upscale,
  krea2Upscale,
  krea2Depth,
  krea2Img2Prompt,
  text2Prompt,
  inpaintDraw,
  krea2DetectReplace,
  krea2DrawReplace,
  krea2AnypaintInpaint,
  krea2Outpaint,
];

export function getWorkflow(id: string): WorkflowManifest | undefined {
  return workflows.find((w) => w.id === id);
}
