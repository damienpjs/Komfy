/**
 * Pending job row: position, workflow icon, name and prompt excerpt, and a
 * visible remove button (the swipe still works, it is just no longer the
 * only way). Rows stack into one grouped list: `first`/`last` round it.
 */

import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { QueueEntry } from '../api/types';
import { jobInfo } from '../hooks/useQueue';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { iconOf } from '../workflows/catalog';
import { WorkflowIcon } from './WorkflowIcon';

interface Props {
  entry: QueueEntry;
  position: number;
  first: boolean;
  last: boolean;
  onDelete: (promptId: string) => void;
  /** Tap on the row → job detail. */
  onPress: (entry: QueueEntry) => void;
}

export function PendingJobRow({ entry, position, first, last, onDelete, onPress }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [, promptId, graph] = entry;
  const { t } = useTranslation();
  const info = jobInfo(promptId, graph);

  const remove = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onDelete(promptId);
  };

  return (
    <ReanimatedSwipeable
      overshootRight={false}
      containerStyle={[styles.container, first && styles.first, last && styles.last]}
      renderRightActions={() => (
        <Pressable
          style={({ pressed }) => [
            styles.deleteAction,
            pressed && { backgroundColor: colors.dangerPressed },
          ]}
          onPress={remove}
        >
          <Text style={styles.deleteText}>{t('common.delete')}</Text>
        </Pressable>
      )}
    >
      <View style={[styles.row, !first && styles.separated]}>
        <Pressable
          style={({ pressed }) => [styles.main, pressed && styles.mainPressed]}
          onPress={() => onPress(entry)}
          accessibilityRole="button"
        >
          <Text style={styles.position}>{position}</Text>
          <View style={styles.tile}>
            <WorkflowIcon
              name={info.manifestId ? iconOf(info.manifestId) : 'graph'}
              color={colors.accent}
              knockout={colors.accentSoft}
              size={22}
            />
          </View>
          <View style={styles.texts}>
            <Text style={styles.title} numberOfLines={1}>
              {info.title}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {info.prompt ?? promptId.slice(0, 8)}
            </Text>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('queue.removeA11y', { title: info.title })}
          onPress={remove}
          hitSlop={4}
          style={({ pressed }) => [styles.remove, pressed && styles.mainPressed]}
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
    </ReanimatedSwipeable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  first: {
    borderTopWidth: 1,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  last: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    backgroundColor: colors.surface,
  },
  separated: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    alignSelf: 'stretch',
    paddingLeft: spacing.md - 2,
    paddingVertical: spacing.sm + 2,
  },
  mainPressed: {
    backgroundColor: colors.surfacePressed,
  },
  position: {
    minWidth: 14,
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
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
  },
  sub: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
  },
  remove: {
    width: MIN_TOUCH_TARGET + 4,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteAction: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    width: 96,
  },
  deleteText: {
    color: colors.onDanger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
}));
