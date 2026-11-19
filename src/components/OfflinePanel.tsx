/**
 * Offline diagnostic, in place of a dead-end error page: the machine
 * (supervisor), ComfyUI and the output folder, each with what the probe got
 * back, then the likely cause and what to do. A timeout on both ports means
 * the packets never reach the machine (on iOS, usually a stuck Tailscale
 * tunnel); a machine that answers with ComfyUI down gets a "Turn on" button.
 * The rest of the app stays usable: prompts are listed as an offline task.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { FailureKind } from '../api/client';
import { SupervisorError } from '../api/supervisor';
import { HEALTH_INTERVAL_MS } from '../hooks/useHealthCheck';
import { useSupervisor } from '../hooks/useSupervisor';
import { useConnection } from '../store/connection';
import { useSettings } from '../store/settings';
import { useToast } from '../store/toast';
import { makeStyles, useTheme } from '../theme/theme';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { AttentionModePicker } from './AttentionModePicker';

type Status = 'ok' | 'ko' | 'na';

/** Port of a URL, or the scheme default the app uses. */
function portOf(url: string, fallback: number): number {
  const m = url.match(/^[a-z]+:\/\/[^/:]+:(\d+)/i);
  return m ? Number(m[1]) : fallback;
}

export function OfflinePanel() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const showToast = useToast((s) => s.show);
  const serverUrl = useSettings((s) => s.serverUrl);
  const failure = useConnection((s) => s.failure);
  const checkedAt = useConnection((s) => s.checkedAt);
  const supervisor = useSupervisor();
  const [busy, setBusy] = useState(false);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const comfyPort = portOf(serverUrl, 8188);
  const supervisorPort = portOf(supervisor.effectiveUrl, comfyPort + 1);
  const sup = supervisor.state;

  const result = (kind: FailureKind | null | undefined, timeoutS: number, status?: number) =>
    kind === 'timeout'
      ? t('diag.resTimeout', { s: timeoutS })
      : kind === 'http'
        ? t('diag.resHttp', { status: status ?? '?' })
        : kind === 'network'
          ? t('diag.resRefused')
          : '…';

  const rows: { title: string; sub: string; res: string; status: Status }[] = [
    sup === 'unconfigured'
      ? { title: t('diag.machine'), sub: t('diag.machineNone'), res: '', status: 'na' }
      : {
          title: t('diag.machine'),
          sub: t('diag.machineSub', { port: supervisorPort }),
          res:
            sup === 'unreachable'
              ? result(supervisor.failure, 6)
              : sup === 'loading'
                ? '…'
                : t('diag.resOk'),
          status: sup === 'unreachable' ? 'ko' : sup === 'loading' ? 'na' : 'ok',
        },
    {
      title: t('diag.comfy'),
      sub: t('diag.comfySub', { port: comfyPort }),
      res:
        sup === 'starting'
          ? t('diag.resStarting')
          : sup === 'off'
            ? t('diag.resOff')
            : result(failure?.kind, 8, failure?.status),
      status: 'ko',
    },
    { title: t('diag.output'), sub: t('diag.outputSub'), res: t('diag.resUntested'), status: 'na' },
  ];

  // Most specific explanation first.
  let advice: { title: string; body: string; steps?: string[] } | null = null;
  if (sup === 'off' || sup === 'starting') {
    advice = {
      title: t('diag.comfyOffTitle'),
      body: supervisor.hasToken ? t('diag.comfyOffBody') : t('diag.comfyOffNoToken'),
    };
  } else if (
    failure?.kind === 'timeout' &&
    sup === 'unreachable' &&
    supervisor.failure === 'timeout'
  ) {
    advice = {
      title: t('diag.tunnelTitle'),
      body: t('diag.tunnelBody'),
      steps: [t('diag.tunnelStep1'), t('diag.tunnelStep2')],
    };
  } else if (failure?.kind === 'timeout') {
    advice = { title: t('diag.timeoutTitle'), body: t('diag.timeoutBody') };
  } else if (failure?.kind === 'network') {
    advice = {
      title: t('diag.refusedTitle', { port: comfyPort }),
      body: t('diag.refusedBody'),
    };
  } else if (failure?.kind === 'http') {
    advice = {
      title: t('diag.httpTitle'),
      body: t('diag.httpBody', { status: failure.status ?? '?' }),
    };
  }

  const retry = () => {
    queryClient.invalidateQueries({ queryKey: ['health'] });
    supervisor.refetch();
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      await supervisor.start();
    } catch (e) {
      if (e instanceof SupervisorError && e.status === 409) {
        showToast(t('supervisor.alreadyRunning'));
      } else {
        Alert.alert(t('supervisor.startFailed'), e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const statusIcon = (status: Status) => (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={12}
        r={9}
        fill="none"
        strokeWidth={2}
        stroke={
          status === 'ok' ? colors.success : status === 'ko' ? colors.danger : colors.textDisabled
        }
      />
      {status === 'ok' && (
        <Path d="M8 12.5l2.7 2.7L16 9.8" stroke={colors.success} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {status === 'ko' && (
        <Path d="M9 9l6 6M15 9l-6 6" stroke={colors.danger} strokeWidth={2} strokeLinecap="round" />
      )}
      {status === 'na' && (
        <Path d="M8.5 12h7" stroke={colors.textDisabled} strokeWidth={2} strokeLinecap="round" />
      )}
    </Svg>
  );

  const ago = checkedAt != null ? Math.max(0, Math.round((now - checkedAt) / 1000)) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headTexts}>
        <Text style={styles.title} accessibilityRole="header">
          {t('queue.offlineTitle')}
        </Text>
        <Text style={styles.hint}>
          {ago != null
            ? t('diag.checked', { ago, every: HEALTH_INTERVAL_MS / 1000 })
            : t('diag.checking')}
        </Text>
      </View>

      <View style={styles.group}>
        {rows.map((row, i) => (
          <View key={row.title} style={[styles.row, i > 0 && styles.rowSeparated]}>
            {statusIcon(row.status)}
            <View style={styles.rowTexts}>
              <Text style={styles.rowTitle}>{row.title}</Text>
              <Text style={styles.rowSub}>{row.sub}</Text>
            </View>
            <Text
              style={[
                styles.res,
                row.status === 'ko' && { color: colors.danger },
                row.status === 'na' && { color: colors.textMuted },
              ]}
            >
              {row.res}
            </Text>
          </View>
        ))}
      </View>

      {advice && (
        <View style={styles.advice} accessibilityRole="summary">
          <Text style={styles.adviceTitle}>{advice.title}</Text>
          <Text style={styles.adviceBody}>{advice.body}</Text>
          {advice.steps?.map((step, i) => (
            <Text key={step} style={styles.adviceBody}>
              <Text style={styles.adviceStepNo}>{i + 1}. </Text>
              {step}
            </Text>
          ))}
        </View>
      )}

      {sup === 'off' && supervisor.hasToken && (
        <View style={styles.turnOn}>
          <AttentionModePicker />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('diag.turnOnA11y')}
            disabled={busy}
            onPress={turnOn}
            style={({ pressed }) => [styles.btn, styles.btnStrong, pressed && { opacity: 0.85 }]}
          >
            {busy && <ActivityIndicator size="small" color={colors.onStrong} />}
            <Text style={styles.btnStrongText}>{t('diag.turnOnA11y')}</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={({ pressed }) => [
          styles.btn,
          sup === 'off' && supervisor.hasToken ? styles.btnOutline : styles.btnStrong,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path
            d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"
            stroke={sup === 'off' && supervisor.hasToken ? colors.text : colors.onStrong}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Text
          style={
            sup === 'off' && supervisor.hasToken ? styles.btnOutlineText : styles.btnStrongText
          }
        >
          {t('common.retry')}
        </Text>
      </Pressable>

      <Text style={styles.section}>{t('diag.offlineSection')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/prompts' as Href)}
        style={({ pressed }) => [styles.group, styles.row, pressed && styles.rowPressed]}
      >
        <Svg width={20} height={20} viewBox="0 0 24 24">
          <Path
            d="M6 4h12v16l-6-4-6 4z"
            stroke={colors.accent}
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
          />
        </Svg>
        <View style={styles.rowTexts}>
          <Text style={styles.rowTitle}>{t('diag.prompts')}</Text>
          <Text style={styles.rowSub}>{t('diag.promptsSub')}</Text>
        </View>
        <Svg width={16} height={16} viewBox="0 0 24 24">
          <Path d="M9 6l6 6-6 6" stroke={colors.textMuted} strokeWidth={2} fill="none" strokeLinecap="round" />
        </Svg>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    gap: spacing.md - 2,
  },
  headTexts: {
    gap: 2,
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  group: {
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    minHeight: 60,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md - 2,
  },
  rowSeparated: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfacePressed,
  },
  rowTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  rowSub: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
  },
  res: {
    color: colors.success,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  advice: {
    gap: spacing.sm,
    padding: spacing.md - 2,
    borderRadius: radii.lg,
    backgroundColor: colors.warningSoft,
  },
  adviceTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  adviceBody: {
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: 14,
    lineHeight: 20,
  },
  adviceStepNo: {
    fontFamily: typography.uiSemiBold,
  },
  turnOn: {
    gap: spacing.sm + 2,
  },
  btn: {
    minHeight: MIN_TOUCH_TARGET + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md + 2,
  },
  btnStrong: {
    backgroundColor: colors.strong,
  },
  btnStrongText: {
    color: colors.onStrong,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnOutlineText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  section: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
}));
