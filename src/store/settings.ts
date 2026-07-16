/**
 * Persisted settings (AsyncStorage): server URL, stable client_id, language.
 * The default URL is a local placeholder: set the Mac's Tailscale IP in
 * Settings (a single URL for home and 4G/5G alike, no "direct LAN" mode).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import i18n, { type Lang } from '../i18n';

export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8188';

function makeClientId(): string {
  return `komfy-${Math.random().toString(36).slice(2, 10)}`;
}

interface SettingsState {
  serverUrl: string;
  /** Stable identifier sent to /prompt and /ws to correlate events. */
  clientId: string;
  /** Sampler previews during generation (binary WS frames). */
  previewsEnabled: boolean;
  /** UI language — English by default, the user's choice is persisted. */
  language: Lang;
  /** true once the store has been rehydrated from AsyncStorage. */
  hydrated: boolean;
  setServerUrl: (url: string) => void;
  setPreviewsEnabled: (enabled: boolean) => void;
  setLanguage: (language: Lang) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      serverUrl: DEFAULT_SERVER_URL,
      clientId: makeClientId(),
      previewsEnabled: true,
      language: 'en',
      hydrated: false,
      setServerUrl: (url) => set({ serverUrl: url.trim().replace(/\/+$/, '') }),
      setPreviewsEnabled: (previewsEnabled) => set({ previewsEnabled }),
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
      },
    }),
    {
      name: 'komfy-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ serverUrl, clientId, previewsEnabled, language }) => ({
        serverUrl,
        clientId,
        previewsEnabled,
        language,
      }),
      onRehydrateStorage: () => () => {
        const { language } = useSettings.getState();
        if (language !== i18n.language) i18n.changeLanguage(language);
        useSettings.setState({ hydrated: true });
      },
    },
  ),
);
