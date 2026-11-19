/**
 * Server status chip, in the header of every screen (headerRight on stacks,
 * the tab header on tabs): a real button with its own slot, so a title can
 * never run under it. Shows the connection state, or the running job's
 * progress ring and percentage when Komfy follows the sampler. Tap → Activity.
 *
 * `compact` (stack headers): the dot or the ring alone, no label.
 */

import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useRunningJob } from '../hooks/useRunningJob';
import { useConnection } from '../store/connection';
import { makeStyles, useTheme } from '../theme/theme';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';

const RING = 16;
const RING_STROKE = 3;

export function ServerChip({ compact = false }: { compact?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const online = useConnection((s) => s.online);
  const wsConnected = useConnection((s) => s.wsConnected);
  const { job } = useRunningJob();

  let dotColor: string = colors.textDisabled;
  let label = '…';
  if (online === false) {
    dotColor = colors.danger;
    label = t('status.offline');
  } else if (online === true) {
    dotColor = wsConnected ? colors.success : colors.warning;
    label = wsConnected ? t('status.connected') : t('status.ws');
  }

  const fraction = online === true ? (job?.fraction ?? null) : null;
  const percent = fraction != null ? Math.round(fraction * 100) : null;
  const a11y =
    percent != null
      ? t('shell.chipJobA11y', { percent })
      : t('shell.chipA11y', { status: label });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      onPress={() => router.navigate('/activity' as Href)}
      style={[styles.target, compact && styles.targetCompact]}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.chip,
            compact && styles.chipCompact,
            pressed && { backgroundColor: colors.surfacePressed },
          ]}
        >
          {percent != null ? (
            <Ring fraction={fraction ?? 0} color={colors.progress} track={colors.field} />
          ) : (
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
          )}
          {!compact && (
            <Text style={styles.label} numberOfLines={1}>
              {percent != null ? `${percent} %` : label}
            </Text>
          )}
        </View>
      )}
    </Pressable>
  );
}

function Ring({
  fraction,
  color,
  track,
}: {
  fraction: number;
  color: string;
  track: string;
}) {
  const r = (RING - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={r}
        stroke={track}
        strokeWidth={RING_STROKE}
        fill="none"
      />
      <Circle
        cx={RING / 2}
        cy={RING / 2}
        r={r}
        stroke={color}
        strokeWidth={RING_STROKE}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference * fraction} ${circumference}`}
        transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
      />
    </Svg>
  );
}

const useStyles = makeStyles((colors) => ({
  target: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The bar item capsule is shorter than 44 pt: a 36 pt box plus the 6 pt
  // hitSlop keeps the 44 pt target without pushing the dot off-centre.
  targetCompact: {
    minHeight: 36,
    minWidth: 36,
  },
  chip: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingLeft: 10,
    paddingRight: spacing.sm + 4,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  // Stack headers: iOS already wraps bar items in a capsule, so the compact
  // chip is the dot (or ring) alone, centred in its touch target.
  chipCompact: {
    width: 28,
    height: 28,
    paddingLeft: 0,
    paddingRight: 0,
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 13,
  },
}));
