/**
 * Thick progress bar, readable at arm's length (style guide).
 * Indeterminate mode when fine progress is unavailable (job submitted by
 * another client, or interrupted): looping strip of two-tone diagonals
 * ("barber pole") rather than a frozen bar.
 * `signature`: the same bar on the dark banner surface (job card, live
 * preview), identical in both themes, with the percentage left to the caller.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { radii, signature, spacing, typography } from '../theme/tokens';
import { makeStyles } from '../theme/theme';

/** Width of one diagonal; the two-tone period is 2× (repeating pattern). */
const STRIPE_W = 12;
const PERIOD = STRIPE_W * 2;
/** Diagonal skew. */
const SKEW = '-20deg';
/** Duration of one period's scroll (seamless loop). */
const CYCLE_MS = 650;

interface Props {
  value: number;
  max: number;
  /** No progress info (third-party or interrupted job): animated strip. */
  indeterminate?: boolean;
  /** On the signature surface: its colours, no percentage, given height. */
  signatureHeight?: number;
}

/** Two-tone diagonal strip translated in a loop of exactly one period. */
function IndeterminateStripes({ onSignature }: { onSignature?: boolean }) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const tx = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Translation of -PERIOD then back to 0: the pattern has this period,
    // so the jump is invisible → continuous scroll.
    const anim = Animated.loop(
      Animated.timing(tx, {
        toValue: -PERIOD,
        duration: CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [tx]);

  // The strip covers the track + one period + the skew overhang, to stay
  // full during the whole translation cycle.
  const total = width + PERIOD + STRIPE_W * 2;
  const count = width > 0 ? Math.ceil(total / STRIPE_W) : 0;

  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          styles.stripeRow,
          { width: total, transform: [{ translateX: tx }] },
        ]}
      >
        {Array.from({ length: count }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.stripe,
              i % 2 === 0
                ? onSignature
                  ? styles.sigStripeA
                  : styles.stripeA
                : onSignature
                  ? styles.sigStripeB
                  : styles.stripeB,
            ]}
          />
        ))}
      </Animated.View>
    </View>
  );
}

export function ProgressBar({ value, max, indeterminate, signatureHeight }: Props) {
  const styles = useStyles();
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  if (signatureHeight != null) {
    return (
      <View
        style={[
          styles.track,
          styles.sigTrack,
          { height: signatureHeight, borderRadius: signatureHeight / 2 },
        ]}
        accessibilityRole="progressbar"
        accessibilityValue={indeterminate ? undefined : { min: 0, max: 100, now: pct }}
      >
        {indeterminate ? (
          <IndeterminateStripes onSignature />
        ) : (
          <View style={[styles.fill, styles.sigFill, { width: `${pct}%` }]} />
        )}
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.track}>
        {indeterminate ? (
          <IndeterminateStripes />
        ) : (
          <View style={[styles.fill, { width: `${pct}%` }]} />
        )}
      </View>
      <Text style={styles.pct}>{indeterminate ? '· · ·' : `${pct}%`}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  track: {
    flex: 1,
    height: 14,
    borderRadius: radii.full,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: colors.progress, // the "it's generating" moment: yellow on dark, olive on paper
  },
  stripeRow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // Left overhang: covers the triangle left by the skew.
    left: -STRIPE_W,
    flexDirection: 'row',
  },
  stripe: {
    width: STRIPE_W,
    height: '100%',
    transform: [{ skewX: SKEW }],
  },
  stripeA: {
    backgroundColor: colors.surfacePressed,
  },
  stripeB: {
    backgroundColor: colors.textDisabled,
  },
  sigTrack: {
    flex: 0,
    backgroundColor: signature.track,
  },
  sigFill: {
    backgroundColor: signature.accent,
  },
  sigStripeA: {
    backgroundColor: signature.track,
  },
  sigStripeB: {
    backgroundColor: signature.textMuted,
  },
  pct: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    minWidth: 44,
    textAlign: 'right',
  },
}));
