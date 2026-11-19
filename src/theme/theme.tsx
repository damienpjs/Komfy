/**
 * Runtime theme: resolves the user's preference (Settings ▸ Theme: auto,
 * light, dark) against the system scheme and hands the matching palette to
 * the tree.
 *
 * Styles are written once per module with `makeStyles((colors) => ({...}))`
 * and read in components through the returned hook. Each palette gets its own
 * StyleSheet, built on first use and cached, so a theme switch costs one
 * StyleSheet.create per module and per theme, never one per render.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { useSettings } from '../store/settings';
import { palettes, type Palette, type ThemeName } from './tokens';

export interface Theme {
  name: ThemeName;
  colors: Palette;
}

const ThemeContext = createContext<Theme>({
  name: 'dark',
  colors: palettes.dark,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSettings((s) => s.themePreference);
  const system = useColorScheme();
  const name: ThemeName =
    preference === 'auto' ? (system === 'light' ? 'light' : 'dark') : preference;
  const value = useMemo(() => ({ name, colors: palettes[name] }), [name]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

const THEMES: Record<ThemeName, Theme> = {
  dark: { name: 'dark', colors: palettes.dark },
  light: { name: 'light', colors: palettes.light },
};

/**
 * Current theme name and palette. `forced` pins a palette regardless of the
 * user's choice: media screens (image viewer, live preview, camera) always
 * sit on black, so they always read the dark palette.
 */
export function useTheme(forced?: ThemeName): Theme {
  const theme = useContext(ThemeContext);
  return forced ? THEMES[forced] : theme;
}

/** Pins a palette for a subtree (children of a media screen). */
export function ThemeOverride({
  name,
  children,
}: {
  name: ThemeName;
  children: ReactNode;
}) {
  return (
    <ThemeContext.Provider value={THEMES[name]}>{children}</ThemeContext.Provider>
  );
}

/**
 * Declares a module's styles against the palette. Returns a hook that hands
 * back the StyleSheet of the current theme (or of `forced`, see useTheme).
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: Palette) => T,
): (forced?: ThemeName) => T {
  const cache: Partial<Record<ThemeName, T>> = {};
  return function useStyles(forced?: ThemeName): T {
    const context = useContext(ThemeContext);
    const { name, colors } = forced ? THEMES[forced] : context;
    let styles = cache[name];
    if (!styles) {
      styles = StyleSheet.create(factory(colors));
      cache[name] = styles;
    }
    return styles;
  };
}
