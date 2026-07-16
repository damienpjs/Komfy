/**
 * Pending job row: position, label, swipe-to-delete (ReanimatedSwipeable —
 * the revealed red action deletes the item).
 */

import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { QueueEntry } from '../api/types';
import { describeGraph } from '../hooks/useQueue';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

interface Props {
  entry: QueueEntry;
  position: number;
  onDelete: (promptId: string) => void;
  /** Tap on the row → job detail. */
  onPress: (entry: QueueEntry) => void;
}

export function PendingJobRow({ entry, position, onDelete, onPress }: Props) {
  const [, promptId, graph] = entry;
  const { t } = useTranslation();

  return (
    <ReanimatedSwipeable
      overshootRight={false}
      renderRightActions={() => (
        <Pressable
          style={({ pressed }) => [
            styles.deleteAction,
            pressed && { backgroundColor: colors.dangerPressed },
          ]}
          onPress={() => onDelete(promptId)}
        >
          <Text style={styles.deleteText}>{t('common.delete')}</Text>
        </Pressable>
      )}
    >
      <Pressable
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
        onPress={() => onPress(entry)}
      >
        <Text style={styles.position}>#{position}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {describeGraph(graph)}
        </Text>
        <Text style={styles.promptId}>{promptId.slice(0, 8)}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.textDisabled} />
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET + 8,
  },
  position: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    minWidth: 32,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  promptId: {
    color: colors.textDisabled,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  deleteAction: {
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
    width: 96,
    marginLeft: spacing.sm,
  },
  deleteText: {
    color: colors.onBrand, // dark text: readable on the pastel coral
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
