/**
 * "Running job" card: workflow label, progress, current node, elapsed time,
 * Interrupt button (with confirmation).
 * Fine-grained progress (%) only exists when the job was queued by Komfy
 * (WS routing by sid); otherwise indeterminate bar + local elapsed time.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { QueueEntry } from '../api/types';
import { useExecution } from '../store/execution';
import { useSettings } from '../store/settings';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import { describeGraph } from '../hooks/useQueue';
import { ProgressBar } from './ProgressBar';

interface Props {
  entry: QueueEntry;
  onInterrupt: () => void;
  interrupting: boolean;
  /** Tap on the card (outside the Interrupt button) → job detail. */
  onPress: (entry: QueueEntry) => void;
  /** Tap on the preview thumbnail → full-screen live preview. */
  onPressPreview: () => void;
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatEta(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function CurrentJobCard({
  entry,
  onInterrupt,
  interrupting,
  onPress,
  onPressPreview,
}: Props) {
  const [, promptId, graph] = entry;
  const { t } = useTranslation();
  const exec = useExecution();
  const previewsEnabled = useSettings((s) => s.previewsEnabled);
  const isOurs = exec.promptId === promptId;

  // Elapsed time: WS timestamp when the job is ours, else since the first
  // time the app saw this prompt_id (lower-bound approximation).
  const firstSeenRef = useRef<{ id: string; at: number }>({
    id: promptId,
    at: Date.now(),
  });
  if (firstSeenRef.current.id !== promptId) {
    firstSeenRef.current = { id: promptId, at: Date.now() };
  }
  const since = isOurs && exec.startedAt ? exec.startedAt : firstSeenRef.current.at;

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ETA: average rate (steps/s) since the first measured step of the current
  // node, extrapolated to the remaining steps. Only for our jobs (fine
  // progress); resets on every node change or sampler reset.
  const etaRef = useRef<{ key: string; at: number; value: number } | null>(null);
  let eta: number | null = null;
  if (isOurs && exec.max > 0 && exec.value > 0) {
    const key = `${promptId}:${exec.node}`;
    const anchor = etaRef.current;
    if (!anchor || anchor.key !== key || exec.value < anchor.value) {
      etaRef.current = { key, at: now, value: exec.value };
    } else if (exec.value > anchor.value && now > anchor.at) {
      const rate = (exec.value - anchor.value) / ((now - anchor.at) / 1000);
      if (rate > 0) eta = (exec.max - exec.value) / rate;
    }
  } else if (isOurs && exec.value === 0) {
    etaRef.current = null;
  }

  const confirmInterrupt = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(t('job.interruptTitle'), t('job.interruptBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('job.interrupt'), style: 'destructive', onPress: onInterrupt },
    ]);
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && { backgroundColor: colors.surfacePressed },
      ]}
      onPress={() => onPress(entry)}
    >
      <View style={styles.headerRow}>
        <View style={styles.liveDot} />
        <Text style={styles.title} numberOfLines={1}>
          {describeGraph(graph)}
        </Text>
        <View style={styles.timeCol}>
          <Text style={styles.elapsed}>{formatElapsed(now - since)}</Text>
          {eta != null && (
            <Text style={styles.eta}>
              {t('job.etaRemaining', { eta: formatEta(eta) })}
            </Text>
          )}
        </View>
      </View>

      <ProgressBar
        value={isOurs ? exec.value : 0}
        max={isOurs ? exec.max : 0}
        indeterminate={!isOurs || exec.max === 0}
      />

      {previewsEnabled && isOurs && exec.preview && (
        <View style={styles.previewWrap}>
          <Pressable
            onPress={onPressPreview}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('job.expandPreview')}
            style={({ pressed }) => pressed && { opacity: 0.8 }}
          >
            <Image
              source={{ uri: exec.preview.dataUri }}
              style={styles.previewImage}
              contentFit="contain"
              transition={80}
            />
            <View style={styles.expandBadge}>
              <Ionicons name="expand-outline" size={16} color={colors.text} />
            </View>
          </Pressable>
          <Text style={styles.previewLabel}>
            {(exec.preview.displayNodeId ?? exec.preview.nodeId)
              ? t('job.previewNode', {
                  node: exec.preview.displayNodeId ?? exec.preview.nodeId,
                })
              : t('job.preview')}
          </Text>
        </View>
      )}

      <View style={styles.metaRow}>
        <Text style={styles.meta} numberOfLines={1}>
          {isOurs && exec.node != null
            ? t('job.node', { node: exec.node })
            : t('job.external')}
        </Text>
        <Text style={styles.promptId} numberOfLines={1}>
          {promptId.slice(0, 8)}
        </Text>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.interruptBtn,
          pressed && { opacity: 0.7 },
          interrupting && { opacity: 0.4 },
        ]}
        onPress={confirmInterrupt}
        disabled={interrupting}
      >
        <Text style={styles.interruptText}>
          {interrupting ? t('job.interrupting') : t('job.interrupt')}
        </Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  timeCol: {
    alignItems: 'flex-end',
    gap: 1,
  },
  elapsed: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  eta: {
    color: colors.accent,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  previewWrap: {
    gap: spacing.xs,
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: radii.md,
    backgroundColor: colors.bg,
  },
  previewLabel: {
    color: colors.textDisabled,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    textAlign: 'right',
  },
  expandBadge: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(6, 4, 9, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  meta: {
    flexShrink: 1,
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  promptId: {
    color: colors.textDisabled,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  interruptBtn: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  interruptText: {
    color: colors.danger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
