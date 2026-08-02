/**
 * Live ComfyUI console — streams the supervisor's log tail (hooks/
 * useSupervisorLogs) into an inverted FlatList (newest at the bottom, sticks
 * there like a terminal). Reachable from the Server power card in Settings;
 * hidden from the tab bar. Sibling of the WS event log (app/ws-log.tsx).
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { deriveSupervisorUrl } from '../api/supervisor';
import { useSupervisorLogs } from '../hooks/useSupervisorLogs';
import { useSettings } from '../store/settings';
import { useSupervisorStore } from '../store/supervisor';
import { colors, spacing, typography } from '../theme/tokens';

const ERROR_RE = /error|traceback|exception|failed|fatal/i;

export default function ComfyConsoleScreen() {
  const { t } = useTranslation();
  useSupervisorLogs(); // open the WS while this screen is mounted

  const logs = useSupervisorStore((s) => s.logs);
  const connected = useSupervisorStore((s) => s.logsConnected);
  const clearLogs = useSupervisorStore((s) => s.clearLogs);

  const serverUrl = useSettings((s) => s.serverUrl);
  const supervisorUrl = useSettings((s) => s.supervisorUrl);
  const token = useSettings((s) => s.supervisorToken);
  const configured = !!(supervisorUrl || deriveSupervisorUrl(serverUrl)) && !!token;

  // Inverted list wants newest first; the store keeps oldest→newest.
  const data = useMemo(() => logs.slice().reverse(), [logs]);

  const emptyText = !configured
    ? t('console.needsConfig')
    : connected
      ? t('console.empty')
      : t('console.connecting');

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarLeft}>
          <View
            style={[
              styles.dot,
              { backgroundColor: connected ? colors.success : colors.textDisabled },
            ]}
          />
          <Text style={styles.count}>
            {t('console.lines', { count: logs.length })}
          </Text>
        </View>
        <Pressable
          onPress={clearLogs}
          style={({ pressed }) => pressed && { opacity: 0.7 }}
        >
          <Text style={styles.clear}>{t('console.clear')}</Text>
        </Pressable>
      </View>

      <FlatList
        data={data}
        inverted={data.length > 0}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={data.length === 0 && styles.emptyWrap}
        ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
        renderItem={({ item }) => (
          <Text
            style={[styles.line, ERROR_RE.test(item.line) && styles.errorLine]}
          >
            {item.line || ' '}
          </Text>
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
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  line: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    paddingVertical: 1,
  },
  errorLine: {
    color: colors.danger,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  empty: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
});
