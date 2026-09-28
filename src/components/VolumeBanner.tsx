/**
 * Persistent "output folder unavailable on the server" banner.
 * Shown everywhere when the server answers but the output listing fails.
 * Re-checking is automatic (useHealthCheck's periodic probe).
 *
 * Mounted above the navigators, it takes over the status bar area: the
 * headers below it must then drop their own top inset (see
 * useVolumeBannerVisible), otherwise the status bar gap is counted twice.
 */

import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnection } from '../store/connection';
import { colors, spacing, typography } from '../theme/tokens';

/** True while the banner is on screen (it then owns the top safe area). */
export function useVolumeBannerVisible() {
  return useConnection((s) => s.online === true && s.outputAvailable === false);
}

export function VolumeBanner() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const visible = useVolumeBannerVisible();

  if (!visible) return null;

  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { paddingTop: insets.top + spacing.xs }]}
    >
      <Text style={styles.title}>{t('volume.title')}</Text>
      <Text style={styles.detail}>{t('volume.detail')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#3a2d10', // darkened warning background, derived from colors.warning
    borderBottomColor: colors.warning,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  title: {
    color: colors.warning,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  detail: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
});
