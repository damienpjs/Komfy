/**
 * Komfy style guide tokens.
 *
 * Two palettes with the same keys, picked at runtime by the ThemeProvider
 * (src/theme/theme.tsx): a charcoal dark one and a paper light one, both laid
 * over the banner's dot grid. The yellow of the logo's K (#e7f950) is the
 * signature: launch CTA, progress, active tab. It is only ever a fill or used
 * on dark grounds; on paper, links and selection use the olive `accent`.
 * No hardcoded styles in screens: everything goes through these tokens.
 */

export type ThemeName = 'dark' | 'light';

const dark = {
  // Grounds
  bg: '#141719',
  bgElevated: '#191c1f', // headers, tab bar, sheets
  surface: '#1c2023', // cards, list groups
  surfacePressed: '#252a2e',
  field: '#252a2e', // text inputs, segmented tracks
  border: '#2b3135',
  dot: '#272c30', // the banner's dot grid
  overlay: 'rgba(0, 0, 0, 0.6)', // backdrop behind a centred dialog

  // Ink
  text: '#eef1f3',
  textMuted: '#aab2b8',
  textDisabled: '#8f989e', // still 4.9:1 on `field`

  // Interactive text, icons, selection (yellow on charcoal)
  accent: '#e7f950',
  onAccent: '#141719', // text on an `accent` fill (badges)
  accentStrong: '#e7f950',
  accentSoft: '#2b3017', // selected chip / tile fill
  // Filled buttons: an ink slab, never the signature yellow
  strong: '#eef1f3',
  onStrong: '#141719',
  accentPressed: '#c9d0d4', // pressed `strong` fill

  // Signature yellow (fills only)
  brand: '#e7f950',
  brandPressed: '#cbdc3f',
  onBrand: '#15181b',
  progress: '#e7f950',

  // States
  success: '#86d3a7',
  danger: '#f39189',
  dangerPressed: '#d97b74',
  dangerSoft: '#33201e',
  warning: '#ebb551',
  warningSoft: '#30271a',

  // Native controls
  switchThumb: '#ffffff',
  // Active tab: a yellow pill on charcoal, a charcoal pill on paper
  tabPill: '#e7f950',
  onTabPill: '#141719',
} as const;

export type Palette = { readonly [K in keyof typeof dark]: string };

const light: Palette = {
  bg: '#f3f3ef',
  bgElevated: '#fbfbf8',
  surface: '#ffffff',
  surfacePressed: '#ebebe5',
  field: '#ebebe5',
  border: '#e1e1da',
  dot: '#cdcec7',
  overlay: 'rgba(0, 0, 0, 0.45)',

  text: '#15181b',
  textMuted: '#4f565b',
  textDisabled: '#62696e',

  accent: '#556000',
  onAccent: '#ffffff',
  accentStrong: '#556000',
  accentSoft: '#f1f7c2',
  strong: '#15181b',
  onStrong: '#f3f3ef',
  accentPressed: '#2c3034',

  brand: '#e7f950',
  brandPressed: '#d4e43f',
  onBrand: '#15181b',
  progress: '#556000',

  success: '#17683c',
  danger: '#b3322a',
  dangerPressed: '#962920',
  dangerSoft: '#fae8e5',
  warning: '#8a5200',
  warningSoft: '#faf0d9',

  switchThumb: '#ffffff',
  tabPill: '#181b1e',
  onTabPill: '#e7f950',
};

export const palettes: Record<ThemeName, Palette> = { dark, light };

/**
 * The signature surface: a piece of the banner (charcoal + dot grid), the
 * same in both themes. Launch bar, running job, mini player, server card.
 */
export const signature = {
  bg: '#181b1e',
  dot: '#31373c',
  border: '#2e3439',
  text: '#eef1f3',
  textMuted: '#aab2b8',
  chip: '#22262a',
  chipBorder: '#393f45',
  track: '#323840',
} as const;

/** Dot grid geometry, shared by every DotGrid. */
export const dotGrid = { spacing: 18, radius: 1.1 } as const;

/**
 * Brush colours of the mask editor (the overlay only: the uploaded mask is
 * always grayscale). Bright and saturated so they read over any photo at
 * the overlay's partial opacity; the first is the default. Theme-independent:
 * the editor works over the image, not over the UI ground.
 */
export const maskBrushColors = [
  { id: 'coral', hex: '#f39189' },
  { id: 'yellow', hex: '#e7f950' },
  { id: 'mint', hex: '#86d3a7' },
  { id: 'cyan', hex: '#5cc8e6' },
  { id: 'magenta', hex: '#e070c8' },
] as const;

export type MaskBrushColorId = (typeof maskBrushColors)[number]['id'];

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16, // node-style cards
  full: 999,
} as const;

export const typography = {
  // Families loaded via expo-font in app/_layout.tsx.
  // RN Android ignores fontWeight on custom fonts: one family per weight.
  ui: 'Inter_400Regular',
  uiMedium: 'Inter_500Medium',
  uiSemiBold: 'Inter_600SemiBold',
  uiBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_400Regular', // seeds, noms de fichiers, IDs de prompt
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 28,
    /** Navigation bar title, the iOS native size. */
    headerTitle: 17,
  },
} as const;

/** Minimum touch target (pt), destructive actions included. */
export const MIN_TOUCH_TARGET = 44;
