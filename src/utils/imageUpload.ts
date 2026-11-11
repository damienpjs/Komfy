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
