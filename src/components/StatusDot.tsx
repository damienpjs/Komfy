/**
 * Online / offline indicator: single dot rendered as an overlay by AppShell
 * (outside the native headers → strictly identical on every view, without
 * the iOS "glass" capsule). Green = server + WS OK · orange = server OK but
 * WS closed · red = unreachable · grey = not probed yet.
 */

import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { useConnection } from '../store/connection';
import { colors, spacing, typography } from '../theme/tokens';

export function StatusDot() {
  const { t } = useTranslation();
  const online = useConnection((s) => s.online);
  const wsConnected = useConnection((s) => s.wsConnected);

  let color: string = colors.textDisabled;
  let label = '…';
  if (online === false) {
    color = colors.danger;
    label = t('status.offline');
  } else if (online === true) {
    color = wsConnected ? colors.success : colors.warning;
    label = wsConnected ? t('status.connected') : t('status.ws');
  }

  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
});
