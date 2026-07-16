/**
 * "Recent settings" bar at the top of the launch form.
 * Horizontal chips of the latest settings (pinned first): tap = re-apply,
 * long press = pin/unpin or delete.
 * Nothing renders until at least one setting has been recorded.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePromptHistory } from '../store/promptHistory';
import { showActionSheet } from '../utils/actionSheet';
import { colors, radii, spacing, typography } from '../theme/tokens';
import type { FieldValues } from '../workflows/types';

interface Props {
  workflowId: string;
  onApply: (values: FieldValues) => void;
}

function formatAgo(
  at: number,
  t: (key: string, opts?: { count: number }) => string,
): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return t('presets.justNow');
  const m = Math.round(s / 60);
  if (m < 60) return t('presets.minutesAgo', { count: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('presets.hoursAgo', { count: h });
  const d = Math.round(h / 24);
  return t('presets.daysAgo', { count: d });
}

export function PresetBar({ workflowId, onApply }: Props) {
  const { t } = useTranslation();
  const entries = usePromptHistory((s) => s.byWorkflow[workflowId]);
  const togglePin = usePromptHistory((s) => s.togglePin);
  const remove = usePromptHistory((s) => s.remove);

  // Pinned first, each group sorted by recency.
  const ordered = useMemo(() => {
    const list = entries ?? [];
    const pinned = list.filter((e) => e.pinned).sort((a, b) => b.at - a.at);
    const recents = list.filter((e) => !e.pinned).sort((a, b) => b.at - a.at);
    return [...pinned, ...recents];
  }, [entries]);

  if (ordered.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('presets.title')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {ordered.map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityLabel={t('presets.apply', { label: entry.label })}
            style={({ pressed }) => [
              styles.chip,
              entry.pinned && styles.chipPinned,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onApply(entry.values);
            }}
            onLongPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              showActionSheet(entry.label, [
                {
                  label: entry.pinned ? t('presets.unpin') : t('presets.pin'),
                  onPress: () => togglePin(workflowId, entry.id),
                },
                {
                  label: t('common.delete'),
                  destructive: true,
                  onPress: () => remove(workflowId, entry.id),
                },
              ]);
            }}
          >
            {entry.pinned && (
              <Ionicons
                name="star"
                size={12}
                color={colors.accent}
                style={styles.pinIcon}
              />
            )}
            <Text style={styles.chipLabel} numberOfLines={1}>
              {entry.label}
            </Text>
            <Text style={styles.chipTime}>{formatAgo(entry.at, t)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  title: {
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
  },
  row: {
    gap: spacing.sm,
    paddingVertical: 2,
    paddingRight: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: 220,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  chipPinned: {
    borderColor: colors.accent,
  },
  pinIcon: {
    marginRight: 2,
  },
  chipLabel: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  chipTime: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: 10,
  },
});
