/**
 * Real-time WebSocket event log (debug tool, Sprint 1).
 * Reachable from Settings; hidden from the tab bar (href: null).
 */

import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useConnection } from '../store/connection';
import { colors, spacing, typography } from '../theme/tokens';

const EVENT_COLORS: Record<string, string> = {
  execution_error: colors.danger,
  execution_success: colors.success,
  progress: colors.accent,
  progress_state: colors.accent,
  executed: colors.success,
};

function formatTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function WsLogScreen() {
  const { t } = useTranslation();
  const wsLog = useConnection((s) => s.wsLog);
  const clearWsLog = useConnection((s) => s.clearWsLog);

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text style={styles.count}>
          {t('wsLog.events', { count: wsLog.length })}
        </Text>
        <Pressable
          onPress={clearWsLog}
          style={({ pressed }) => pressed && { opacity: 0.7 }}
        >
          <Text style={styles.clear}>{t('wsLog.clear')}</Text>
        </Pressable>
      </View>
      <FlatList
        data={wsLog}
        keyExtractor={(e) => String(e.id)}
        ListEmptyComponent={
          <Text style={styles.empty}>{t('wsLog.empty')}</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.time}>{formatTime(item.at)}</Text>
            <Text
              style={[
                styles.type,
                { color: EVENT_COLORS[item.type] ?? colors.textMuted },
              ]}
            >
              {item.type}
            </Text>
            <Text style={styles.summary} numberOfLines={1}>
              {item.summary}
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.md,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  count: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  clear: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  empty: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  time: {
    color: colors.textDisabled,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  type: {
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    width: 130,
  },
  summary: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    flexShrink: 1,
  },
});
