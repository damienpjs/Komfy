/**
 * Full-screen live preview of the running job (tap on the CurrentJobCard
 * thumbnail). Reads the execution store directly, so every WS preview frame
 * refreshes the image in real time while it is open. A timeline scrubber
 * lets the user step back through the frames received so far while the job
 * keeps running; the rightmost position snaps back to the live feed. The
 * scrubber is deliberately styled unlike the job ProgressBar (thin steel
 * track + round thumb + film icon + k/n counter + LIVE chip vs the thick
 * yellow bar + %): they answer different questions. Keeps the last frame on
 * screen when the job finishes (with a "done" note) instead of going black;
 * swipe down or ✕ dismisses.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useExecution } from '../store/execution';
import { colors, radii, spacing, typography } from '../theme/tokens';
import type { WsPreview } from '../utils/wsPreview';
import { ProgressBar } from './ProgressBar';

interface Props {
  /** Workflow label of the running entry (hidden once the job is gone). */
  title?: string;
  onClose: () => void;
}

// Same thresholds as the gallery ImageViewer's swipe-down-to-dismiss.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

const SCRUB_TRACK_H = 6;
const SCRUB_THUMB = 18;

/**
 * Timeline of the received frames. `viewIndex` null = live (following the
 * newest frame); any earlier index freezes the image on that frame while
 * the right edge keeps growing with the running job.
 */
function TimelineScrubber({
  count,
  viewIndex,
  onScrub,
}: {
  count: number;
  viewIndex: number | null;
  onScrub: (index: number | null) => void;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);

  const live = viewIndex == null;
  const shownIndex = live ? count - 1 : Math.min(viewIndex, count - 1);
  const fraction = count > 1 ? shownIndex / (count - 1) : 1;

  // Finger x → frame index; the last frame means "back to live" (null).
  const scrubTo = (x: number) => {
    if (width <= 0 || count <= 1) return;
    const idx = Math.round((x / width) * (count - 1));
    const clamped = Math.max(0, Math.min(count - 1, idx));
    onScrub(clamped >= count - 1 ? null : clamped);
  };

  const pan = Gesture.Pan().onUpdate((e) => {
    'worklet';
    runOnJS(scrubTo)(e.x);
  });
  const tap = Gesture.Tap().onEnd((e) => {
    'worklet';
    runOnJS(scrubTo)(e.x);
  });

  return (
    <View style={styles.scrubRow}>
      <Ionicons name="film-outline" size={14} color={colors.textMuted} />
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <View
          style={styles.scrubTrackHit}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          accessibilityRole="adjustable"
          accessibilityLabel={t('job.previewTimeline')}
        >
          <View style={styles.scrubTrack}>
            <View style={[styles.scrubFill, { width: `${fraction * 100}%` }]} />
          </View>
          <View
            style={[
              styles.scrubThumb,
              { left: fraction * Math.max(0, width - SCRUB_THUMB) },
            ]}
          />
        </View>
      </GestureDetector>
      <Text style={styles.scrubCounter}>
        {shownIndex + 1}/{count}
      </Text>
      <Pressable
        onPress={() => onScrub(null)}
        disabled={live}
        hitSlop={10}
        style={({ pressed }) => [
          styles.liveChip,
          !live && styles.liveChipBehind,
          pressed && !live && { backgroundColor: colors.accentPressed },
        ]}
      >
        {live ? (
          <View style={styles.liveDot} />
        ) : (
          <Ionicons name="play-skip-forward" size={10} color={colors.text} />
        )}
        <Text style={[styles.liveText, !live && { color: colors.text }]}>
          {t('job.live')}
        </Text>
      </Pressable>
    </View>
  );
}

export function LivePreviewViewer({ title, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const exec = useExecution();

  // The store clears `preview` when the job ends: retain the last frame so
  // the viewer shows it under the "finished" note instead of a black screen.
  // The component is remounted on every open, so no stale frame across jobs.
  const lastFrameRef = useRef<WsPreview | null>(null);
  if (exec.preview) lastFrameRef.current = exec.preview;
  const running = exec.promptId != null;

  const history = exec.previewHistory;
  const [viewIndex, setViewIndex] = useState<number | null>(null);

  // The history can shrink under the scrub position (purged when the next
  // job starts): snap back to live rather than pointing past the end.
  useEffect(() => {
    if (viewIndex != null && viewIndex >= history.length) setViewIndex(null);
  }, [history.length, viewIndex]);

  // No cache: closing the viewer on a finished job purges the timeline.
  // A still-running job keeps it, so reopening mid-job shows the full one.
  useEffect(
    () => () => {
      const s = useExecution.getState();
      if (s.promptId == null) s.clearPreviewHistory();
    },
    [],
  );

  const scrubbed =
    viewIndex != null && viewIndex < history.length ? history[viewIndex] : null;
  const frame = scrubbed ?? exec.preview ?? lastFrameRef.current;

  // Measured height (not Dimensions.get: unreliable on a Modal's first
  // layout) — used as the swipe-down exit target.
  const [height, setHeight] = useState(0);

  const ty = useSharedValue(0);
  const dismissPan = Gesture.Pan()
    .activeOffsetY([-15, 15])
    .onUpdate((e) => {
      'worklet';
      // Upward drag: damped follow, springs back (nothing above to open).
      ty.value = e.translationY < 0 ? e.translationY / 3 : e.translationY;
    })
    .onEnd((e) => {
      'worklet';
      if (
        e.translationY > 0 &&
        (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY)
      ) {
        ty.value = withTiming(height || 800, { duration: 180 }, () =>
          runOnJS(onClose)(),
        );
      } else {
        ty.value = withTiming(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => {
    const progress =
      ty.value > 0 && height > 0 ? Math.min(ty.value / (height * 0.6), 1) : 0;
    return {
      opacity: 1 - progress * 0.75,
      transform: [{ translateY: ty.value }],
    };
  });

  const nodeLabel = exec.preview?.displayNodeId ?? exec.preview?.nodeId ?? exec.node;

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      // Same as ImageViewer: a native Modal ignores the app's orientation
      // config, so declare every orientation and let onLayout remeasure.
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape',
        'landscape-left',
        'landscape-right',
      ]}
      onRequestClose={onClose}
    >
      {/* RNGH gestures require their own root INSIDE a RN Modal. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View
          style={styles.container}
          onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        >
          <GestureDetector gesture={dismissPan}>
            <Animated.View style={[styles.imageWrap, animatedStyle]}>
              {frame ? (
                <Image
                  source={{ uri: frame.dataUri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  transition={80}
                />
              ) : (
                <View style={styles.waitingBox}>
                  <ActivityIndicator color={colors.brand} size="large" />
                  <Text style={styles.waitingText}>
                    {t('job.livePreviewWaiting')}
                  </Text>
                </View>
              )}
            </Animated.View>
          </GestureDetector>

          <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
            {title != null && (
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
            )}
          </View>

          <View
            style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.md }]}
          >
            {history.length > 0 && (
              <TimelineScrubber
                count={history.length}
                viewIndex={viewIndex}
                onScrub={setViewIndex}
              />
            )}
            {running ? (
              <>
                <ProgressBar
                  value={exec.value}
                  max={exec.max}
                  indeterminate={exec.max === 0}
                />
                {nodeLabel != null && (
                  <Text style={styles.nodeText} numberOfLines={1}>
                    {t('job.node', { node: nodeLabel })}
                  </Text>
                )}
              </>
            ) : (
              <View style={styles.finishedRow}>
                <Ionicons
                  name="checkmark-circle"
                  size={22}
                  color={colors.success}
                />
                <View style={styles.finishedCol}>
                  <Text style={styles.finishedTitle}>
                    {t('job.livePreviewFinished')}
                  </Text>
                  <Text style={styles.finishedHint}>
                    {t('job.livePreviewFinishedHint')}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  imageWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  waitingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  waitingText: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(6, 4, 9, 0.75)',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    backgroundColor: 'rgba(6, 4, 9, 0.75)',
    gap: spacing.sm,
  },
  nodeText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  finishedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  finishedCol: {
    flex: 1,
    gap: 2,
  },
  finishedTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  finishedHint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  scrubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scrubTrackHit: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  scrubTrack: {
    height: SCRUB_TRACK_H,
    borderRadius: radii.full,
    backgroundColor: colors.surfacePressed,
    overflow: 'hidden',
  },
  scrubFill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: colors.accent,
  },
  scrubThumb: {
    position: 'absolute',
    width: SCRUB_THUMB,
    height: SCRUB_THUMB,
    borderRadius: SCRUB_THUMB / 2,
    backgroundColor: colors.text,
    borderWidth: 2,
    borderColor: colors.bg,
  },
  scrubCounter: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    minWidth: 52,
    textAlign: 'right',
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  liveChipBehind: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  liveText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
});
