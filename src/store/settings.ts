/**
 * Persisted settings (AsyncStorage): server URL, stable client_id, language.
 * There is NO default server URL: the address is mandatory and must be set by
 * the user (first-launch wizard, then editable in Settings). An empty URL is a
 * valid state — the WS and health probe no-op until one is provided. The
 * constant below is only an on-screen example for the input placeholder, never
 * a fallback value.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import i18n, { type Lang } from '../i18n';
import { ssrSafeAsyncStorage } from './ssrSafeStorage';

/** Placeholder example only (greyed-out hint in the URL field), NOT a default. */
export const SERVER_URL_PLACEHOLDER = 'http://100.x.y.z:8188';

function makeClientId(): string {
  return `komfy-${Math.random().toString(36).slice(2, 10)}`;
}

interface SettingsState {
  serverUrl: string;
  /**
   * Komfy supervisor URL (remote ComfyUI on/off + live console). Blank = derive
   * it from serverUrl (same host, port +1). Filled by the pairing QR or by hand.
   */
  supervisorUrl: string;
  /** Supervisor auth token (from `npm run pair`). Blank = power controls off. */
  supervisorToken: string;
  /** Stable identifier sent to /prompt and /ws to correlate events. */
  clientId: string;
  /** Sampler previews during generation (binary WS frames). */
  previewsEnabled: boolean;
  /**
   * Global cap on the number of LoRAs per field — applies to every workflow
   * type (the regular LoRAs field and the Detect & Replace's per-zone chain
   * alike). null = no limit.
   */
  loraMaxCount: number | null;
  /** UI language — English by default, the user's choice is persisted. */
  language: Lang;
  /** true once the store has been rehydrated from AsyncStorage. */
  hydrated: boolean;
  setServerUrl: (url: string) => void;
  setSupervisorUrl: (url: string) => void;
  setSupervisorToken: (token: string) => void;
  setPreviewsEnabled: (enabled: boolean) => void;
  setLoraMaxCount: (count: number | null) => void;
  setLanguage: (language: Lang) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      serverUrl: '',
      supervisorUrl: '',
      supervisorToken: '',
      clientId: makeClientId(),
      previewsEnabled: true,
      loraMaxCount: 4,
      language: 'en',
      hydrated: false,
      setServerUrl: (url) => set({ serverUrl: url.trim().replace(/\/+$/, '') }),
      setSupervisorUrl: (url) =>
        set({ supervisorUrl: url.trim().replace(/\/+$/, '') }),
      setSupervisorToken: (token) => set({ supervisorToken: token.trim() }),
      setPreviewsEnabled: (previewsEnabled) => set({ previewsEnabled }),
      setLoraMaxCount: (loraMaxCount) => set({ loraMaxCount }),
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
      },
    }),
    {
      name: 'komfy-settings',
      storage: createJSONStorage(ssrSafeAsyncStorage),
      partialize: ({
        serverUrl,
        supervisorUrl,
        supervisorToken,
        clientId,
        previewsEnabled,
        loraMaxCount,
        language,
      }) => ({
        serverUrl,
        supervisorUrl,
        supervisorToken,
        clientId,
        previewsEnabled,
        loraMaxCount,
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

/**
 * Global LoRA cap for non-React callers (e.g. patch-time validation).
 * null = no limit.
 */
export function getLoraMaxCount(): number | null {
  return useSettings.getState().loraMaxCount;
}
