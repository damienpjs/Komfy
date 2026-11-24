/**
 * Picker options for every photo uploaded to ComfyUI's input folder.
 *
 * iPhone photos are HEIC, stored as a grid of tiles (56 tiles of 640×896 on
 * a 48 MP shot). ComfyUI's LoadImage reads images through PyAV first, which
 * returns the first tile only: a workflow fed a HEIC silently works on one
 * corner of the photo, while the phone (which decodes the whole grid) shows
 * the full picture. Seen on ComfyUI 0.34 with PyAV 18.1.
 *
 * So uploads ask the iOS picker for the "compatible" representation: the
 * system transcodes HEIC to JPEG and expo-image-picker saves it as `.jpg`.
 * The default "current" mode copies the HEIC file as is when quality is 1.
 * The option is iOS only; `isHeif` (utils/media) catches whatever still
 * comes through, such as an Android HEIF or a HEIC already on the server,
 * so it is refused instead of rendering one corner.
 */

import * as ImagePicker from 'expo-image-picker';

export const PICK_FOR_UPLOAD: ImagePicker.ImagePickerOptions = {
  mediaTypes: 'images',
  quality: 1,
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

let lastStamp = 0;

/**
 * Server name for a file picked on the phone: its own name plus a stamp,
 * so that no upload ever reuses a name.
 *
 * iOS hands out the same name to many pictures (a dozen frames saved from
 * one clip all came back as IMG_2051.png). The server then numbers them
 * `IMG_2051 (1).png`, `(2)`… and, once some are deleted, gives those numbers
 * to new pictures. A form value has no version, and expo-image caches
 * previews on disk by URL: a reused name showed the old picture, a keyframe
 * preview mixing with another. With a stamp, a URL only ever meets one file.
 *
 * Trade-off: the same photo picked twice is stored twice (the server only
 * merges identical files under one name).
 */
export function uploadName(
  asset: { fileName?: string | null; uri: string },
  prefix: string,
  fallbackExt: string,
): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  const stamp = lastStamp.toString(36);
  const base = (asset.fileName ?? '').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base).trim();
  const uriExt = /\.([a-z0-9]{2,5})$/i.exec(asset.uri)?.[1];
  const ext = (dot > 0 ? base.slice(dot + 1) : uriExt ?? fallbackExt).toLowerCase();
  return `${stem !== '' && !stem.startsWith('.') ? stem : prefix}_${stamp}.${ext}`;
}
