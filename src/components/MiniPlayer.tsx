/**
 * The running job, docked above the tab bar on every tab but Activity: a
 * piece of the banner (signature surface) with the latest preview, the
 * job's title, its step and the pending count, and a yellow progress line.
 * Tap → Activity. Renders nothing while the queue is idle.
 */

import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useRunningJob } from '../hooks/useRunningJob';
import { makeStyles } from '../theme/theme';
import { radii, signature, spacing, typography } from '../theme/tokens';
import { DotGrid } from './DotGrid';

export function MiniPlayer() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { job, pending } = useRunningJob();
  if (!job) return null;

  const parts = [
    job.max > 0
      ? t('shell.step', { value: job.value, max: job.max })
      : t('shell.running'),
  ];
  if (pending > 0) parts.push(t('shell.pending', { count: pending }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('shell.openActivity')}
      onPress={() => router.navigate('/activity' as Href)}
      style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.85 }]}
    >
      <DotGrid color={signature.dot} spacing={14} />
      {job.preview ? (
        <Image source={{ uri: job.preview.dataUri }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}
      <View style={styles.texts}>
        <Text style={styles.title} numberOfLines={1}>
          {job.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {parts.join(' · ')}
        </Text>
      </View>
      <View style={styles.open}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path
            d="M6 15l6-6 6 6"
            stroke={signature.text}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
      </View>
      {job.fraction != null && (
        <View style={[styles.progress, { width: `${job.fraction * 100}%` }]} />
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    marginHorizontal: spacing.sm + 2,
    marginBottom: spacing.sm,
    minHeight: 60,
    borderRadius: radii.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: signature.bg,
    borderWidth: 1,
    borderColor: signature.border,
    overflow: 'hidden',
  },
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 9,
  },
  thumbEmpty: {
    backgroundColor: signature.chip,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    color: signature.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  sub: {
    color: signature.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  open: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: signature.chip,
  },
  progress: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
    backgroundColor: colors.brand,
  },
}));
