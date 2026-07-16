/** Registry of the embedded workflows (one file per workflow). */

import { krea2FaceSwapMulti } from './krea2-faceswap-multi';
import { krea2Image2Prompt } from './krea2-image2prompt';
import { krea2Img2Img } from './krea2-img2img';
import { krea2Img2Prompt } from './krea2-img2prompt';
import { krea2Inpaint } from './krea2-inpaint';
import { krea2Text2Img } from './krea2-text2img';
import { text2Prompt } from './text2prompt';
import type { WorkflowManifest } from './types';

export const workflows: WorkflowManifest[] = [
  krea2Text2Img,
  krea2Img2Img,
  krea2Image2Prompt,
  krea2Img2Prompt,
  text2Prompt,
  krea2Inpaint,
  krea2FaceSwapMulti,
];

export function getWorkflow(id: string): WorkflowManifest | undefined {
  return workflows.find((w) => w.id === id);
}
