/**
 * Settings, top of the screen: remote ComfyUI power through the supervisor,
 * on the banner surface (same in both themes). Status and its hint, the
 * console, the attention mode used for the next start, then the actions for
 * the current state: Turn on, or Restart and Turn off. The supervisor
 * address and token live in the Connection group (SupervisorPairing).
 */

import { Link, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { SupervisorError } from '../api/supervisor';
import { useSupervisor, type PowerState } from '../hooks/useSupervisor';
import { useToast } from '../store/toast';
import { makeStyles, ThemeOverride } from '../theme/theme';
import { MIN_TOUCH_TARGET, radii, signature, spacing, typography } from '../theme/tokens';
import { AttentionModePicker } from './AttentionModePicker';
import { DotGrid } from './DotGrid';

const DOT: Record<PowerState, string> = {
  on: signature.success,
  off: signature.warningText,
  starting: signature.accent,
  unreachable: signature.dangerText,
  loading: signature.textMuted,
  unconfigured: signature.textMuted,
};

export function ServerPowerCard({ pendingCount = 0 }: { pendingCount?: number }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { state, hasToken, start, stop, restart } = useSupervisor();
  const showToast = useToast((s) => s.show);
  const [busy, setBusy] = useState(false);

  const statusLabel: Record<PowerState, string> = {
    on: t('supervisor.on'),
    off: t('supervisor.off'),
    starting: t('supervisor.starting'),
    unreachable: t('supervisor.unreachable'),
    loading: t('supervisor.checking'),
    unconfigured: t('supervisor.title'),
  };

  // Token-missing takes priority when the machine answers.
  let hint = '';
  if (state === 'unconfigured') hint = t('supervisor.notConfigured');
  else if (state === 'unreachable') hint = t('supervisor.unreachableHint');
  else if ((state === 'off' || state === 'on') && !hasToken) hint = t('supervisor.needsToken');
  else if (state === 'off') hint = t('supervisor.offHint');
  else if (state === 'on') hint = t('supervisor.onHint');

  const run = async (action: () => Promise<void>, failTitle: string) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      if (e instanceof SupervisorError && e.status === 409) {
        showToast(t('supervisor.alreadyRunning'));
      } else if (e instanceof SupervisorError && e.status === 404) {
        Alert.alert(failTitle, t('queue.restartTooOld'));
      } else {
        Alert.alert(failTitle, e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const onTurnOn = () => run(() => start(), t('supervisor.startFailed'));

  const onRestart = () => {
    const body =
      pendingCount > 0
        ? `${t('supervisor.restartBody')} ${t('queue.restartSplitLost', { count: pendingCount })}`
        : t('supervisor.restartBody');
    Alert.alert(t('supervisor.restartTitle'), body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('queue.restart'),
        style: 'destructive',
        onPress: () => run(() => restart(), t('queue.restartFailed')),
      },
    ]);
  };

  const onTurnOff = () => {
    Alert.alert(t('supervisor.turnOffTitle'), t('supervisor.turnOffBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('supervisor.turnOff'),
        style: 'destructive',
        onPress: () => run(() => stop(), t('supervisor.stopFailed')),
      },
    ]);
  };

  const canControl = hasToken && !busy;
  const showMode = hasToken && (state === 'on' || state === 'off' || state === 'starting');

  return (
    <ThemeOverride name="dark">
      <View style={styles.card}>
        <DotGrid color={signature.dot} spacing={14} />
        <View style={styles.head}>
          <View style={[styles.dot, { backgroundColor: DOT[state] }]} />
          <View style={styles.headTexts}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{statusLabel[state]}</Text>
              {(state === 'starting' || busy) && (
                <ActivityIndicator size="small" color={signature.textMuted} />
              )}
            </View>
            {hint !== '' && <Text style={styles.hint}>{hint}</Text>}
          </View>
          {/* Always there: the WS events tab works without a supervisor, and
              the ComfyUI tab says what is missing when there is none. */}
          <Link href={'/comfy-console' as Href} asChild>
            <Pressable accessibilityRole="link" style={styles.consoleLink}>
              <Text style={styles.consoleText}>{t('supervisor.console')}</Text>
              <Svg width={14} height={14} viewBox="0 0 24 24">
                <Path d="M9 6l6 6-6 6" stroke={signature.accent} strokeWidth={2.4} fill="none" strokeLinecap="round" />
              </Svg>
            </Pressable>
          </Link>
        </View>

        {showMode && <AttentionModePicker />}

        {state === 'off' && (
          <Pressable
            accessibilityRole="button"
            disabled={!canControl}
            onPress={onTurnOn}
            style={({ pressed }) => [
              styles.btn,
              styles.turnOn,
              !canControl && styles.disabled,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path d="M12 3v8M6.5 7a7.5 7.5 0 1 0 11 0" stroke={signature.bg} strokeWidth={2.2} fill="none" strokeLinecap="round" />
            </Svg>
            <Text style={styles.turnOnText}>{t('supervisor.turnOn')}</Text>
          </Pressable>
        )}

        {(state === 'on' || state === 'starting') && (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={!canControl || state === 'starting'}
              onPress={onRestart}
              style={({ pressed }) => [
                styles.btn,
                styles.ghost,
                (!canControl || state === 'starting') && styles.disabled,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" stroke={signature.text} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
              <Text style={styles.ghostText}>{t('queue.restart')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!canControl || state === 'starting'}
              onPress={onTurnOff}
              style={({ pressed }) => [
                styles.btn,
                styles.stop,
                (!canControl || state === 'starting') && styles.disabled,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Rect x={6} y={6} width={12} height={12} rx={2.5} fill={signature.dangerText} />
              </Svg>
              <Text style={styles.stopText}>{t('supervisor.turnOff')}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ThemeOverride>
  );
}

const useStyles = makeStyles(() => ({
  card: {
    overflow: 'hidden',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg + 4,
    backgroundColor: signature.bg,
    borderWidth: 1,
    borderColor: signature.border,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 2,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  headTexts: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    color: signature.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 16,
    lineHeight: 21,
  },
  hint: {
    color: signature.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  consoleLink: {
    minHeight: MIN_TOUCH_TARGET,
    marginTop: -10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  consoleText: {
    color: signature.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  btn: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md + 2,
  },
  turnOn: {
    backgroundColor: signature.accent,
  },
  turnOnText: {
    color: signature.bg,
    fontFamily: typography.uiBold,
    fontSize: 15,
  },
  ghost: {
    backgroundColor: signature.chip,
    borderWidth: 1,
    borderColor: signature.chipBorder,
  },
  ghostText: {
    color: signature.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  stop: {
    backgroundColor: signature.dangerFill,
  },
  stopText: {
    color: signature.dangerText,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  disabled: {
    opacity: 0.45,
  },
}));
