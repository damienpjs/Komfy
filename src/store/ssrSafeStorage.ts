/**
 * `expo-router`'s web static rendering runs store code in a Node.js SSR
 * context (no `window`). AsyncStorage's web shim reaches for
 * `window.localStorage` unconditionally there, throwing a ReferenceError
 * that crashes the whole Metro dev server — including the connection any
 * phone (Expo Go, over Tailscale) has open to it.
 *
 * Every persisted store is Expo Go only (iOS/Android): swap in a no-op
 * storage for the SSR case, where persistence has no use anyway.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StateStorage } from 'zustand/middleware';

const noopStorage: StateStorage = {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
};

export function ssrSafeAsyncStorage(): StateStorage {
  return typeof window === 'undefined' ? noopStorage : AsyncStorage;
}
