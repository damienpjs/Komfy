/**
 * Media-type helpers shared by the gallery, viewer and pickers. Komfy shows
 * both still images and the video outputs (image-to-video, etc.) that live
 * next to them in the output/input roots.
 */

/** Still-image extensions rendered by expo-image. */
export const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

/** Video extensions played by expo-video (ComfyUI VHS/Wan outputs). */
export const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)$/i;

/** Anything the gallery is willing to surface (image OR video). */
export const MEDIA_RE = /\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v|mkv)$/i;

/** true when the path points at a playable video rather than a still image. */
export function isVideoPath(path: string): boolean {
  return VIDEO_RE.test(path);
}

const HEIF_EXT = /\.(heic|heif)$/i;
const HEIF_MIME = /^image\/hei[cf]/i;

/**
 * true for a HEIC/HEIF file name, URI or MIME type. ComfyUI reads such a
 * photo as its first tile only, so uploads and launches refuse it (cf.
 * utils/imageUpload).
 */
export function isHeif(name: string, mimeType?: string | null): boolean {
  return HEIF_EXT.test(name) || (mimeType != null && HEIF_MIME.test(mimeType));
}
