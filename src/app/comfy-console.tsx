/**
 * Console: the two live streams in one screen, as two tabs.
 * - ComfyUI: the supervisor's log tail (hooks/useSupervisorLogs), filterable
 *   to warnings or errors, newest at the bottom like a terminal.
 * - WS events: what this app receives on ComfyUI's WebSocket
 *   (useConnection.wsLog), the former debug screen.
 * Reachable from the server card in Settings; `?tab=ws` opens the events
 * (the old /ws-log route redirects here).
 */

import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { deriveSupervisorUrl } from '../api/supervisor';
import { useSupervisorLogs } from '../hooks/useSupervisorLogs';
import { useConnection } from '../store/connection';
import { useSettings } from '../store/settings';
import { useSupervisorStore } from '../store/supervisor';
import { useToast } from '../store/toast';
import { makeStyles, useTheme } from '../theme/theme';
import { MIN_TOUCH_TARGET, radii, signature, spacing, typography } from '../theme/tokens';

type Tab = 'comfy' | 'ws';
type Filter = 'all' | 'warn' | 'error';

const ERROR_RE = /error|traceback|exception|failed|fatal/i;
const WARN_RE = /warn|deprecat|offload|low memory/i;

const levelOf = (line: string): Filter =>
  ERROR_RE.test(line) ? 'error' : WARN_RE.test(line) ? 'warn' : 'all';

function clock(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const WS_COLORS: Record<string, string> = {
  execution_error: signature.dangerText,
  execution_success: signature.success,
  executed: signature.success,
  progress: signature.accent,
  progress_state: signature.accent,
};

export default function ConsoleScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const showToast = useToast((s) => s.show);
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'ws' ? 'ws' : 'comfy');
  const [filter, setFilter] = useState<Filter>('all');
  useSupervisorLogs(); // keep the log WS open while the console is on screen

  const logs = useSupervisorStore((s) => s.logs);
  const logsConnected = useSupervisorStore((s) => s.logsConnected);
  const clearLogs = useSupervisorStore((s) => s.clearLogs);
  const wsLog = useConnection((s) => s.wsLog);
  const wsConnected = useConnection((s) => s.wsConnected);
  const clearWsLog = useConnection((s) => s.clearWsLog);

  const serverUrl = useSettings((s) => s.serverUrl);
  const supervisorUrl = useSettings((s) => s.supervisorUrl);
  const token = useSettings((s) => s.supervisorToken);
  const configured = !!(supervisorUrl || deriveSupervisorUrl(serverUrl)) && !!token;

  const counts = useMemo(() => {
    let warn = 0;
    let error = 0;
    for (const l of logs) {
      const level = levelOf(l.line);
      if (level === 'warn') warn += 1;
      else if (level === 'error') error += 1;
    }
    return { warn, error };
  }, [logs]);

  // Inverted list wants newest first; the store keeps oldest → newest.
  const shownLogs = useMemo(
    () =>
      logs
        .filter((l) => filter === 'all' || levelOf(l.line) === filter)
        .reverse(),
    [logs, filter],
  );

  const connected = tab === 'comfy' ? logsConnected : wsConnected;

  const copyVisible = async () => {
    const text =
      tab === 'comfy'
        ? shownLogs
            .slice()
            .reverse()
            .map((l) => `${clock(l.at)} ${l.line}`)
            .join('\n')
        : wsLog.map((e) => `${clock(e.at)} ${e.type} ${e.summary}`).join('\n');
    if (!text) return;
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(t('console.copied'));
  };

  const clear = () => (tab === 'comfy' ? clearLogs() : clearWsLog());

  const iconBtn = (label: string, onPress: () => void, d: React.ReactNode) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
    >
      <Svg width={20} height={20} viewBox="0 0 24 24">
        {d}
      </Svg>
    </Pressable>
  );

  const stroke = { stroke: colors.accent, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const };

  return (
    <View style={styles.container}>
      <View style={styles.segment} accessibilityRole="tablist">
        {(['comfy', 'ws'] as Tab[]).map((key) => {
          const on = tab === key;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setTab(key)}
              style={[styles.segmentBtn, on && styles.segmentBtnOn]}
            >
              <Text style={[styles.segmentText, on && styles.segmentTextOn]}>
                {key === 'comfy' ? t('console.tabComfy') : t('console.tabWs')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.toolbar}>
        {tab === 'comfy' ? (
          (
            [
              ['all', t('console.filterAll')],
              ['warn', t('console.filterWarn', { count: counts.warn })],
              ['error', t('console.filterError', { count: counts.error })],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === key }}
              onPress={() => setFilter(key)}
              style={[styles.chip, filter === key && styles.chipOn]}
            >
              <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>
                {label}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.count}>{t('wsLog.events', { count: wsLog.length })}</Text>
        )}
        <View style={styles.spacer} />
        <View style={[styles.dot, { backgroundColor: connected ? colors.success : colors.textDisabled }]} />
        {iconBtn(
          t('console.copy'),
          copyVisible,
          <>
            <Rect x={8} y={8} width={12} height={12} rx={2.5} {...stroke} />
            <Path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" {...stroke} />
          </>,
        )}
        {iconBtn(
          t('console.clear'),
          clear,
          <Path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" {...stroke} strokeLinejoin="round" />,
        )}
      </View>

      <View style={styles.term}>
        {tab === 'comfy' ? (
          <FlatList
            data={shownLogs}
            inverted={shownLogs.length > 0}
            keyExtractor={(e) => String(e.id)}
            contentContainerStyle={[styles.termContent, shownLogs.length === 0 && styles.emptyWrap]}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {!configured
                  ? t('console.needsConfig')
                  : logsConnected
                    ? t('console.empty')
                    : t('console.connecting')}
              </Text>
            }
            renderItem={({ item }) => {
              const level = levelOf(item.line);
              return (
                <Text style={styles.line} selectable>
                  <Text style={styles.time}>{clock(item.at)} </Text>
                  <Text
                    style={
                      level === 'error'
                        ? styles.lineError
                        : level === 'warn'
                          ? styles.lineWarn
                          : undefined
                    }
                  >
                    {item.line || ' '}
                  </Text>
                </Text>
              );
            }}
          />
        ) : (
          <FlatList
            data={wsLog}
            keyExtractor={(e) => String(e.id)}
            contentContainerStyle={[styles.termContent, wsLog.length === 0 && styles.emptyWrap]}
            ListEmptyComponent={<Text style={styles.empty}>{t('wsLog.empty')}</Text>}
            renderItem={({ item }) => (
              <View style={styles.wsRow}>
                <Text style={styles.time}>{clock(item.at)}</Text>
                <Text style={[styles.wsType, { color: WS_COLORS[item.type] ?? signature.textMuted }]}>
                  {item.type}
                </Text>
                <Text style={styles.wsSummary} numberOfLines={1}>
                  {item.summary}
                </Text>
              </View>
            )}
          />
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  segment: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: radii.md,
    backgroundColor: colors.field,
  },
  segmentBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md - 3,
  },
  segmentBtnOn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: 14,
  },
  segmentTextOn: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md - 4,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: {
    borderColor: colors.strong,
    backgroundColor: colors.strong,
  },
  chipText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: 13,
  },
  chipTextOn: {
    color: colors.onStrong,
    fontFamily: typography.uiSemiBold,
  },
  count: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
  },
  spacer: {
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  iconBtn: {
    width: 40,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The terminal reads the same in both themes: the banner surface.
  term: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radii.lg,
    backgroundColor: signature.bg,
    borderWidth: 1,
    borderColor: signature.border,
  },
  termContent: {
    padding: spacing.sm + 4,
  },
  line: {
    color: signature.text,
    fontFamily: typography.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  time: {
    color: signature.textMuted,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  lineWarn: {
    color: signature.warningText,
  },
  lineError: {
    color: signature.dangerText,
  },
  wsRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingVertical: 3,
  },
  wsType: {
    width: 128,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  wsSummary: {
    flexShrink: 1,
    color: signature.textMuted,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  emptyWrap: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  empty: {
    color: signature.textMuted,
    fontFamily: typography.ui,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
}));
