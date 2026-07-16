/**
 * Local "job finished" notification (Sprint 5).
 * Only emitted when the app is not in the foreground — in the foreground,
 * the Queue and the toast are enough. Accepted limitation (ROADMAP): iOS
 * closes the WebSocket ~30 s after backgrounding, so the notification only
 * covers the recent background; remote push is out of the MVP scope.
 */

import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import i18n from './i18n';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensureNotificationSetup(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('jobs', {
      name: 'Jobs ComfyUI',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (!current.granted && current.canAskAgain) {
    await Notifications.requestPermissionsAsync();
  }
}

async function notify(title: string, body: string): Promise<void> {
  if (AppState.currentState === 'active') return;
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null, // immediate
    });
  } catch {
    // Permission denied or unavailable: silent, it is only a convenience.
  }
}

export function notifyJobDone(filenames: string[]): Promise<void> {
  return notify(
    i18n.t('notif.doneTitle'),
    filenames.length ? filenames.join(', ') : i18n.t('notif.doneBody'),
  );
}

export function notifyJobFailed(nodeType: string, message: string): Promise<void> {
  return notify(
    i18n.t('notif.failedTitle'),
    `${nodeType} — ${message.slice(0, 120)}`,
  );
}
