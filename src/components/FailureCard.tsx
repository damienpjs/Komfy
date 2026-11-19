/**
 * Last failed job, in the Activity feed: which job and node, the raw
 * message, and for a failure the app recognises, what to do about it. Out of
 * memory is the frequent one on the reference machine: split attention is
 * the fix, so the card offers the restart when the supervisor can do it.
 */

import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { SupervisorError } from '../api/supervisor';
import { knownJobTitle } from '../hooks/useQueue';
import { useSupervisor } from '../hooks/useSupervisor';
import type { ExecutionError } from '../store/execution';
import { useToast } from '../store/toast';
import { makeStyles, useTheme } from '../theme/theme';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';

const OUT_OF_MEMORY = /out of memory|OutOfMemory|\bOOM\b/i;

interface Props {
  error: ExecutionError;
  pendingCount: number;
  onDismiss: () => void;
}

export function FailureCard({ error, pendingCount, onDismiss }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const supervisor = useSupervisor();
  const showToast = useToast((s) => s.show);
  const [restarting, setRestarting] = useState(false);

  const title = knownJobTitle(error.promptId);
  const outOfMemory = OUT_OF_MEMORY.test(error.message);
  const canRestart = outOfMemory && supervisor.hasToken && supervisor.state === 'on';

  const restartInSplit = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const body =
      pendingCount > 0
        ? `${t('queue.restartSplitBody')} ${t('queue.restartSplitLost', { count: pendingCount })}`
        : t('queue.restartSplitBody');
    Alert.alert(t('queue.restartSplitTitle'), body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('queue.restart'),
        style: 'destructive',
        onPress: async () => {
          setRestarting(true);
          try {
            await supervisor.restart('split');
            showToast(t('queue.restarting'));
            onDismiss();
          } catch (e) {
            Alert.alert(
              t('queue.restartFailed'),
              e instanceof SupervisorError && e.status === 404
                ? t('queue.restartTooOld')
                : e instanceof Error
                  ? e.message
                  : String(e),
            );
          } finally {
            setRestarting(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.card} accessibilityRole="alert">
      <View style={styles.head}>
        <Svg width={18} height={18} viewBox="0 0 24 24" style={styles.icon}>
          <Circle cx={12} cy={12} r={8.5} stroke={colors.danger} strokeWidth={2} fill="none" />
          <Path
            d="M12 7.5v5.5M12 16.5v.01"
            stroke={colors.danger}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
        <View style={styles.texts}>
          <Text style={styles.title}>
            {title
              ? t('queue.failedTitleJob', { title, node: error.nodeType })
              : t('queue.failedTitle', { node: error.nodeType })}
          </Text>
          <Text style={styles.message} numberOfLines={3} selectable>
            {error.message}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('queue.dismissError')}
          onPress={onDismiss}
          style={({ pressed }) => [styles.dismiss, pressed && { opacity: 0.6 }]}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Path
              d="M6 6l12 12M18 6L6 18"
              stroke={colors.textMuted}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>
      </View>

      {outOfMemory && <Text style={styles.hint}>{t('queue.oomHint')}</Text>}

      {canRestart && (
        <Pressable
          accessibilityRole="button"
          disabled={restarting}
          onPress={restartInSplit}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          {restarting && <ActivityIndicator size="small" color={colors.text} />}
          <Text style={styles.actionText}>{t('queue.switchSplit')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: spacing.sm + 2,
    padding: spacing.md - 2,
    borderRadius: radii.lg,
    backgroundColor: colors.dangerSoft,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm + 2,
  },
  icon: {
    marginTop: 1,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  message: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: 12,
    lineHeight: 17,
  },
  dismiss: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    margin: -spacing.sm - 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    paddingLeft: 28,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: 14,
    lineHeight: 20,
  },
  action: {
    marginLeft: 28,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.text,
  },
  actionPressed: {
    backgroundColor: colors.surfacePressed,
  },
  actionText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
}));
