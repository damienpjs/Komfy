/**
 * Downloads a /view file (image OR video) to the phone's photo library.
 * MediaLibrary picks the asset type from the file extension, so the same
 * path works for a .png and an .mp4. Shared by the full-screen viewer and
 * the gallery context menu.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import i18n from '../i18n';

/**
 * Downloads `url` into the app cache, hands it to the photo library, then
 * deletes the cache copy (the library keeps its own). `onHttpError` turns a
 * non-200 response (whose body sits in the downloaded file) into the error
 * to throw.
 */
async function downloadToPhotos(
  url: string,
  filename: string,
  onHttpError: (status: number, body: string) => Error,
): Promise<void> {
  const perm = await MediaLibrary.requestPermissionsAsync(true); // write only
  if (!perm.granted) {
    throw new Error(i18n.t('saveToPhotos.denied'));
  }
  const dest = FileSystem.cacheDirectory + filename.replace(/[^\w.-]/g, '_');
  try {
    const download = await FileSystem.downloadAsync(url, dest);
    if (download.status !== 200) {
      const body = await FileSystem.readAsStringAsync(download.uri).catch(() => '');
      throw onHttpError(download.status, body);
    }
    await MediaLibrary.saveToLibraryAsync(download.uri);
  } finally {
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => {});
  }
}

export async function saveImageToPhotos(
  url: string,
  filename: string,
): Promise<void> {
  await downloadToPhotos(
    url,
    filename,
    (status) => new Error(i18n.t('saveToPhotos.httpError', { status })),
  );
}

/**
 * Saves one video frame (komfy-listing /komfy/frame PNG, see
 * ComfyClient.frameUrl) to the photo library. A 404 means the server runs
 * an extension older than the route; other refusals carry `{error}`.
 */
export async function saveFrameToPhotos(
  url: string,
  filename: string,
): Promise<void> {
  await downloadToPhotos(url, filename, (status, body) => {
    if (status === 404) return new Error(i18n.t('saveToPhotos.frameNeedsExt'));
    let detail = '';
    try {
      detail = String(JSON.parse(body).error ?? '');
    } catch {
      // not JSON: keep the generic message
    }
    return new Error(
      detail
        ? i18n.t('saveToPhotos.frameFailed', { message: detail })
        : i18n.t('saveToPhotos.httpError', { status }),
    );
  });
}
