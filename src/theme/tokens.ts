/**
 * Komfy — style guide tokens.
 * Charte sobre : base graphite quasi-noir neutre (sans dominante violette), accent
 * discreet slate/steel, a touch of yellow (#e2e34f) reserved for signature
 * moments (Launch CTA, progress, active tab). No hardcoded styles in screens:
 * tout passe par ces tokens.
 */

export const colors = {
  // Backgrounds — neutral black, no violet tint
  bg: '#07090a',
  bgElevated: '#0d1012',
  surface: '#14181b', // node-style cards, neutral graphite
  surfacePressed: '#1c2124',
  border: '#272d31',

  // Texte (neutres, sans dominante)
  text: '#edf0f2',
  textMuted: '#98a2a8',
  textDisabled: '#5c6469',

  // Everyday accent — sober slate/steel (icons, links, active states, buttons)
  accent: '#3d5163',
  accentPressed: '#2f3f4d',

  // Signature yellow — reserved (main CTA, progress, active tab)
  brand: '#e2e34f',
  brandPressed: '#c9ca41',
  onBrand: '#0d1012', // text / icon sitting on the yellow

  success: '#7fcea1', // pastel mint green — connected / OK
  danger: '#e08b84', // corail pastel — interrompre / vider / supprimer
  dangerPressed: '#d0756d', // pressed coral (destructive button background)
  warning: '#d29922', // output folder unavailable on the server
} as const;

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
  },
} as const;

/** Cible tactile minimale (pt) — actions destructives incluses. */
export const MIN_TOUCH_TARGET = 44;
