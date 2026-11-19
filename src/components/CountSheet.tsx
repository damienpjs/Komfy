/**
 * Image count, opened from the launch bar: the usual grids as chips plus a
 * stepper whose held press accelerates (±1, then ±2, ±5, ±10). Each job of
 * a batch draws its own seed (or seed + i when the seed is fixed).
 */

import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { makeStyles, useTheme } from '../theme/theme';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';

export const BATCH_PRESETS = [1, 2, 4, 9, 16, 25];
export const BATCH_MAX = 100;

interface Props {
  visible: boolean;
  count: number;
  /** Receives the clamped count. */
  onChange: (count: number) => void;
  onClose: () => void;
}

export function CountSheet({ visible, count, onChange, onClose }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const latest = useRef(count);
  latest.current = count;

  const clamp = (n: number) => Math.max(1, Math.min(BATCH_MAX, Math.round(n)));

  // Held +/-: the step grows with the hold time.
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = () => {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdTimer.current = null;
  };
  const startHold = (dir: 1 | -1) => {
    stopHold();
    const start = Date.now();
    const stepFor = (ms: number) => (ms < 1500 ? 1 : ms < 3000 ? 2 : ms < 5000 ? 5 : 10);
    onChange(clamp(latest.current + dir));
    holdTimer.current = setInterval(() => {
      const next = clamp(latest.current + dir * stepFor(Date.now() - start));
      onChange(next);
      if (next <= 1 || next >= BATCH_MAX) stopHold();
    }, 140);
  };
  useEffect(() => stopHold, []);

  const stepIcon = (d: string) => (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Path d={d} stroke={colors.text} strokeWidth={2} strokeLinecap="round" fill="none" />
    </Svg>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <Text style={styles.title}>{t('launch.imageCount')}</Text>
          <Pressable onPress={onClose} style={styles.done} accessibilityRole="button">
            <Text style={styles.doneText}>{t('common.done')}</Text>
          </Pressable>
        </View>

        <View style={styles.stepper}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('launch.countLess')}
            disabled={count <= 1}
            onPressIn={() => startHold(-1)}
            onPressOut={stopHold}
            style={[styles.stepBtn, count <= 1 && styles.disabled]}
          >
            {stepIcon('M6 12h12')}
          </Pressable>
          <Text style={styles.value} accessibilityLiveRegion="polite">
            ×{count}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('launch.countMore')}
            disabled={count >= BATCH_MAX}
            onPressIn={() => startHold(1)}
            onPressOut={stopHold}
            style={[styles.stepBtn, count >= BATCH_MAX && styles.disabled]}
          >
            {stepIcon('M12 6v12M6 12h12')}
          </Pressable>
        </View>

        <View style={styles.chips}>
          {BATCH_PRESETS.map((preset) => {
            const on = preset === count;
            return (
              <Pressable
                key={preset}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => {
                  Haptics.selectionAsync();
                  onChange(preset);
                }}
                style={[styles.chip, on && styles.chipOn]}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{preset}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.hintBox}>
          <Text style={styles.hint}>
            {count > 1 ? t('launch.distinctSeedsHint') : t('launch.singleImageHint')}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  grab: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginTop: spacing.sm,
    backgroundColor: colors.border,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.lg,
  },
  done: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  doneText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.md,
    backgroundColor: colors.field,
  },
  stepBtn: {
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.35,
  },
  value: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: 24,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.md,
  },
  chipTextOn: {
    color: colors.accent,
  },
  hintBox: {
    // Two lines reserved: the sheet does not jump when the hint changes.
    minHeight: 36,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
  },
}));
