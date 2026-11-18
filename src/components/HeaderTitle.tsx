import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Stack header title that never runs under the status dot.
 *
 * StatusDot is an overlay drawn by AppShell on top of the native headers,
 * so the navigation bar does not know it is there: iOS lays a long title
 * (a workflow name such as "Remplacer en contexte (Krea 2)") across the
 * whole bar and it ends up under "connecté". The title is centred, so its
 * width is capped symmetrically: each side keeps the dot's room (right
 * margin, dot, gap, the widest label "hors ligne") plus a small gap. A title
 * that still does not fit shrinks to 80 % before being truncated.
 */

/** Right margin + dot + gap + widest status label + breathing room, in pt. */
const SIDE_RESERVE = spacing.md + 10 + spacing.xs + 66 + spacing.sm;

export function HeaderTitle({
  children,
  tintColor,
}: {
  children: string;
  tintColor?: string;
}) {
  const { width } = useWindowDimensions();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
      style={[
        styles.title,
        { color: tintColor ?? colors.text, maxWidth: width - 2 * SIDE_RESERVE },
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.headerTitle,
  },
});
