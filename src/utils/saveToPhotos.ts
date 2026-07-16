/**
 * Downloads a /view image to the phone's photo library.
 * Shared by the full-screen viewer and the gallery context menu.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import i18n from '../i18n';

export async function saveImageToPhotos(
  url: string,
  filename: string,
): Promise<void> {
  const perm = await MediaLibrary.requestPermissionsAsync(true); // write only
  if (!perm.granted) {
    throw new Error(i18n.t('saveToPhotos.denied'));
  }
  const dest = FileSystem.cacheDirectory + filename.replace(/[^\w.-]/g, '_');
  const download = await FileSystem.downloadAsync(url, dest);
  if (download.status !== 200) {
    throw new Error(i18n.t('saveToPhotos.httpError', { status: download.status }));
  }
  await MediaLibrary.saveToLibraryAsync(download.uri);
}
