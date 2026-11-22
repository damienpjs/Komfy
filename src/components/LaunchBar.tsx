/**
 * Launch bar, pinned under the form (a piece of the banner, same in both
 * themes): run count (in images, videos or takes, cf. manifest.output) and
 * destination as two chips, the yellow Launch CTA,
 * and above them the checks run before sending (a missing field to reach,
 * a setting known to exhaust memory). Nothing to scroll down to any more.
 */

import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { makeStyles } from '../theme/theme';
import { radii, signature, spacing, typography } from '../theme/tokens';
import type { OutputKind } from '../workflows/types';
import { DotGrid } from './DotGrid';

export interface PreflightItem {
  kind: 'warn' | 'error';
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface Props {
  /** Run count + destination chips (hidden for text-result workflows). */
  batch?: {
    count: number;
    /** What one run produces: the count chip's unit. */
    output: OutputKind;
    onCountPress: () => void;
    destination: string;
    onDestinationPress: () => void;
  };
  submitting: boolean;
  onLaunch: () => void;
  preflight: PreflightItem[];
}

export function LaunchBar({ batch, submitting, onLaunch, preflight }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const count = batch?.count ?? 1;

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <DotGrid color={signature.dot} spacing={14} />
      {preflight.map((item, i) => (
        <View
          key={i}
          style={[styles.pre, item.kind === 'error' && styles.preError]}
          accessibilityRole="alert"
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            {item.kind === 'error' ? (
              <Path
                d="M12 7.5v5.5M12 16.5v.01M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z"
                stroke={signature.dangerText}
                strokeWidth={2}
                strokeLinecap="round"
                fill="none"
              />
            ) : (
              <Path
                d="M12 4l9 16H3zM12 10v4M12 17v.01"
                stroke={signature.warningText}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            )}
          </Svg>
          <Text
            style={[styles.preText, item.kind === 'error' && styles.preTextError]}
          >
            {item.text}
          </Text>
          {item.actionLabel && item.onAction && (
            <Pressable
              accessibilityRole="button"
              onPress={item.onAction}
              style={({ pressed }) => [styles.preAction, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.preActionText}>{item.actionLabel}</Text>
            </Pressable>
          )}
        </View>
      ))}

      <View style={styles.row}>
        {batch && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(`launch.outputs.${batch.output}.countA11y`, { count: batch.count })}
              onPress={batch.onCountPress}
              style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
            >
              <Text style={styles.chipValue}>×{batch.count}</Text>
              <Text style={styles.chipLabel}>
                {t(`launch.outputs.${batch.output}.unit`, { count: batch.count })}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('launch.destinationA11y', { path: batch.destination })}
              onPress={batch.onDestinationPress}
              style={({ pressed }) => [
                styles.chip,
                styles.chipDest,
                pressed && styles.chipPressed,
              ]}
            >
              <Text style={styles.chipPath} numberOfLines={1}>
                {batch.destination}
              </Text>
              <Text style={styles.chipLabel}>{t('launch.destination')}</Text>
            </Pressable>
          </>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ busy: submitting, disabled: submitting }}
          disabled={submitting}
          onPress={onLaunch}
          style={({ pressed }) => [
            styles.cta,
            pressed && styles.ctaPressed,
            submitting && styles.ctaBusy,
          ]}
        >
          {submitting ? (
            <ActivityIndicator color={signature.bg} />
          ) : (
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Path d="M8 5.5v13l10.5-6.5z" fill={signature.bg} />
            </Svg>
          )}
          <Text style={styles.ctaText}>
            {submitting
              ? t('launch.launching')
              : count > 1
                ? t('launch.launchX', { count })
                : t('launch.launch')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  bar: {
    overflow: 'hidden',
    gap: spacing.sm + 4,
    paddingTop: spacing.md - 2,
    paddingHorizontal: spacing.md - 2,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: signature.bg,
    borderTopWidth: 1,
    borderColor: signature.border,
  },
  pre: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    padding: spacing.sm + 2,
    paddingLeft: spacing.md - 4,
    borderRadius: radii.md,
    backgroundColor: signature.warningFill,
  },
  preError: {
    backgroundColor: signature.dangerFill,
  },
  preText: {
    flex: 1,
    color: signature.warningText,
    fontFamily: typography.uiMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  preTextError: {
    color: signature.dangerText,
  },
  preAction: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md - 4,
    borderRadius: radii.sm + 2,
    backgroundColor: signature.text,
  },
  preActionText: {
    color: signature.bg,
    fontFamily: typography.uiSemiBold,
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 54,
    minWidth: 60,
    justifyContent: 'center',
    gap: 1,
    paddingHorizontal: spacing.md - 4,
    borderRadius: 15,
    backgroundColor: signature.chip,
    borderWidth: 1,
    borderColor: signature.chipBorder,
  },
  chipDest: {
    maxWidth: 116,
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipValue: {
    color: signature.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  chipPath: {
    color: signature.text,
    fontFamily: typography.mono,
    fontSize: 13,
  },
  chipLabel: {
    color: signature.textMuted,
    fontFamily: typography.ui,
    fontSize: 11,
  },
  cta: {
    flex: 1,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: 15,
    backgroundColor: signature.accent,
  },
  ctaPressed: {
    opacity: 0.85,
  },
  ctaBusy: {
    opacity: 0.6,
  },
  ctaText: {
    color: signature.bg,
    fontFamily: typography.uiBold,
    fontSize: 17,
  },
}));
