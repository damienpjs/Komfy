/**
 * i18n setup (i18next + react-i18next, JS only — Expo Go compatible).
 * Default language is English; the user's choice lives in the settings
 * store (AsyncStorage) and is re-applied on rehydration in the root layout.
 *
 * Workflow manifests store translation keys (label/hint/description);
 * screens resolve them with t(). Non-React helpers (describeJob,
 * notifications) import the singleton and call i18n.t directly.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import fr from './fr';

export type Lang = 'en' | 'fr';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: 'en',
  fallbackLng: 'en',
  // Language-neutral manifest strings (e.g. "Steps", "1024×1024") are passed
  // to t() as-is and must fall through untouched — never split on ":".
  nsSeparator: false,
  interpolation: { escapeValue: false },
});

export default i18n;
