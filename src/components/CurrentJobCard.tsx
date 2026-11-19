/**
 * "Running job" card, on the banner surface (same in both themes): live
 * preview thumbnail, workflow, node and step, the percentage large enough
 * to read at arm's length, time left and elapsed, a thick bar, then "Job
 * details" and "Interrupt" (always through the confirmation sheet).
 * Fine-grained progress (%) only exists when the job was queued by Komfy
 * (WS routing by sid); otherwise indeterminate bar + local elapsed time.
 */

import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import type { QueueEntry } from '../api/types';
import { formatClock, formatEta, useJobProgress } from '../hooks/useJobProgress';
import { jobInfo } from '../hooks/useQueue';
import { useExecution } from '../store/execution';
import { useSettings } from '../store/settings';
import { makeStyles } from '../theme/theme';
import { radii, signature, spacing, typography } from '../theme/tokens';
import { iconOf } from '../workflows/catalog';
import { DotGrid } from './DotGrid';
import { InterruptSheet } from './InterruptSheet';
import { ProgressBar } from './ProgressBar';
import { WorkflowIcon } from './WorkflowIcon';

interface Props {
  entry: QueueEntry;
  /** Jobs waiting behind this one (the sheet says they continue). */
  pendingCount: number;
  onInterrupt: () => void;
  interrupting: boolean;
  /** "Job details" → the job's parameters. */
  onPress: (entry: QueueEntry) => void;
  /** Tap on the preview thumbnail → full-screen live preview. */
  onPressPreview: () => void;
}

const THUMB = 108;

export function CurrentJobCard({
  entry,
  pendingCount,
  onInterrupt,
  interrupting,
  onPress,
  onPressPreview,
}: Props) {
  const styles = useStyles();
  const [, promptId, graph] = entry;
  const { t } = useTranslation();
  const exec = useExecution();
  const previewsEnabled = useSettings((s) => s.previewsEnabled);
  const progress = useJobProgress(promptId);
  const { isOurs, fine, percent } = progress;
  const info = jobInfo(promptId, graph);
  const [confirming, setConfirming] = useState(false);

  const clock = formatClock(progress.elapsedMs);
  const elapsed = t('job.elapsed', { time: clock });
  const etaText =
    progress.etaSec != null ? t('job.etaRemaining', { eta: formatEta(progress.etaSec) }) : null;
  const step = fine ? t('job.stepOf', { value: progress.value, max: progress.max }) : null;
  // The node's type ("KSampler") says more than its id in the graph.
  const nodeName =
    progress.node != null ? (graph[progress.node]?.class_type ?? progress.node) : null;
  const meta =
    nodeName != null
      ? [
          nodeName,
          fine ? t('job.stepShort', { value: progress.value, max: progress.max }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : isOurs
        ? ''
        : t('job.noLiveProgress');
  const preview = previewsEnabled && isOurs ? exec.preview : null;

  return (
    <View style={styles.card}>
      <DotGrid color={signature.dot} spacing={14} />
      <View style={styles.top}>
        {preview ? (
          <Pressable
            onPress={onPressPreview}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('job.expandPreview')}
            style={({ pressed }) => [styles.thumb, pressed && { opacity: 0.85 }]}
          >
            <Image
              source={{ uri: preview.dataUri }}
              style={styles.thumbImage}
              contentFit="cover"
              transition={80}
            />
            <Text style={styles.liveTag}>{t('job.liveTag')}</Text>
            <View style={styles.expand}>
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Path
                  d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"
                  stroke={signature.text}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </Svg>
            </View>
          </Pressable>
        ) : (
          <View style={[styles.thumb, styles.thumbIcon]}>
            <WorkflowIcon
              name={info.manifestId ? iconOf(info.manifestId) : 'graph'}
              color={signature.accent}
              knockout={signature.chip}
              size={44}
            />
          </View>
        )}

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {info.title}
          </Text>
          {meta !== '' && (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          )}
          <View style={styles.figures}>
            <Text style={styles.big} accessibilityLiveRegion="polite">
              {percent != null ? `${percent} %` : clock}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {percent != null
                ? [etaText, elapsed].filter(Boolean).join(' · ')
                : t('job.elapsedLabel')}
            </Text>
          </View>
        </View>
      </View>

      <ProgressBar
        value={progress.value}
        max={progress.max}
        indeterminate={!fine}
        signatureHeight={10}
      />

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onPress(entry)}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Rect x={2.5} y={5} width={9} height={7} rx={2} stroke={signature.text} strokeWidth={1.8} fill="none" />
            <Rect x={12.5} y={12} width={9} height={7} rx={2} stroke={signature.text} strokeWidth={1.8} fill="none" />
            <Path d="M11.5 8.5c3 0 1 7 1 7" stroke={signature.text} strokeWidth={1.8} fill="none" strokeLinecap="round" />
          </Svg>
          <Text style={styles.btnText}>{t('job.details')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: interrupting, busy: interrupting }}
          disabled={interrupting}
          onPress={() => setConfirming(true)}
          style={({ pressed }) => [
            styles.btn,
            styles.stop,
            pressed && styles.stopPressed,
            interrupting && { opacity: 0.5 },
          ]}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Rect x={6} y={6} width={12} height={12} rx={2.5} fill={signature.dangerText} />
          </Svg>
          <Text style={[styles.btnText, styles.stopText]}>
            {interrupting ? t('job.interrupting') : t('job.interrupt')}
          </Text>
        </Pressable>
      </View>

      <InterruptSheet
        visible={confirming}
        title={info.title}
        manifestId={info.manifestId}
        progress={
          percent != null
            ? [step, `${percent} %`, etaText].filter(Boolean).join(' · ')
            : elapsed
        }
        pendingCount={pendingCount}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onInterrupt();
        }}
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  card: {
    overflow: 'hidden',
    gap: spacing.md - 2,
    padding: spacing.md,
    borderRadius: radii.lg + 4,
    backgroundColor: signature.bg,
    borderWidth: 1,
    borderColor: signature.border,
  },
  top: {
    flexDirection: 'row',
    gap: spacing.md - 4,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: signature.chip,
  },
  thumbIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: signature.chipBorder,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  liveTag: {
    position: 'absolute',
    left: 6,
    top: 6,
    overflow: 'hidden',
    paddingHorizontal: 5,
    borderRadius: 4,
    backgroundColor: signature.accent,
    color: signature.bg,
    fontFamily: typography.uiBold,
    fontSize: 10,
    lineHeight: 16,
  },
  expand: {
    position: 'absolute',
    right: 6,
    bottom: 6,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    color: signature.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 16,
    lineHeight: 21,
  },
  meta: {
    color: signature.textMuted,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  figures: {
    marginTop: 'auto',
    gap: 2,
  },
  big: {
    color: signature.text,
    fontFamily: typography.uiBold,
    fontSize: 28,
    lineHeight: 32,
  },
  sub: {
    color: signature.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
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
    backgroundColor: signature.chip,
    borderWidth: 1,
    borderColor: signature.chipBorder,
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnText: {
    color: signature.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  stop: {
    backgroundColor: signature.dangerFill,
    borderColor: signature.dangerFill,
  },
  stopPressed: {
    opacity: 0.8,
  },
  stopText: {
    color: signature.dangerText,
  },
}));
