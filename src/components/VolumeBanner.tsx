/**
 * Persistent "output folder unavailable on the server" banner.
 * Shown everywhere when the server answers but the output listing fails.
 * Re-checking is automatic (useHealthCheck's periodic probe).
 */

import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useConnection } from '../store/connection';
import { colors, radii, spacing, typography } from '../theme/tokens';

export function VolumeBanner() {
  const { t } = useTranslation();
  const online = useConnection((s) => s.online);
  const outputAvailable = useConnection((s) => s.outputAvailable);

  if (online !== true || outputAvailable !== false) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.title}>{t('volume.title')}</Text>
      <Text style={styles.detail}>{t('volume.detail')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#3a2d10', // darkened warning background, derived from colors.warning
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radii.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
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
