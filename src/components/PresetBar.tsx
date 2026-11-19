/**
 * Saved presets bar at the top of the launch form.
 * Horizontal chips of the presets the user saved for THIS workflow, sorted
 * by name: tap = apply, long press = update / rename / delete.
 * Nothing renders while the workflow has no preset.
 */

import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { type Preset, sameName, usePresets } from '../store/presets';
import { showActionSheet } from '../utils/actionSheet';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import type { FieldValues } from '../workflows/types';
import { PresetNameDialog } from './PresetNameDialog';

interface Props {
  workflowId: string;
  onApply: (preset: Preset) => void;
  /** The form's current preset values, for "Update with current settings". */
  capture: () => FieldValues;
  /** Save the form as a new preset: a trailing chip, so the bar always shows. */
  onSave?: () => void;
}

export function PresetBar({ workflowId, onApply, capture, onSave }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const presets = usePresets((s) => s.byWorkflow[workflowId]);
  const [renaming, setRenaming] = useState<Preset | null>(null);

  const ordered = useMemo(
    () =>
      [...(presets ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [presets],
  );

  if (ordered.length === 0 && !onSave) return null;

  const store = usePresets.getState;

  const openMenu = (preset: Preset) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    showActionSheet(preset.name, [
      {
        label: t('presets.overwrite'),
        onPress: () =>
          Alert.alert(
            t('presets.overwriteTitle', { name: preset.name }),
            t('presets.overwriteBody'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('presets.replace'),
                onPress: () => {
                  store().overwrite(workflowId, preset.id, capture());
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                  );
                },
              },
            ],
          ),
      },
      { label: t('presets.rename'), onPress: () => setRenaming(preset) },
      {
        label: t('common.delete'),
        destructive: true,
        onPress: () =>
          Alert.alert(t('presets.deleteTitle', { name: preset.name }), undefined, [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: () => store().remove(workflowId, preset.id),
            },
          ]),
      },
    ]);
  };

  const rename = (name: string) => {
    if (!renaming) return;
    const taken = ordered.some(
      (p) => p.id !== renaming.id && sameName(p.name, name),
    );
    if (taken) {
      Alert.alert(t('presets.nameTaken', { name }));
      return; // dialog stays open for another name
    }
    store().rename(workflowId, renaming.id, name);
    setRenaming(null);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('presets.title')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {ordered.map((preset) => (
          <Pressable
            key={preset.id}
            accessibilityRole="button"
            accessibilityLabel={t('presets.apply', { name: preset.name })}
            accessibilityHint={t('presets.menuHint')}
            style={({ pressed }) => [
              styles.chip,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onApply(preset);
            }}
            onLongPress={() => openMenu(preset)}
          >
            <Text style={styles.chipLabel} numberOfLines={1}>
              {preset.name}
            </Text>
          </Pressable>
        ))}
        {onSave && (
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.chip,
              styles.saveChip,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            onPress={onSave}
          >
            <Text style={[styles.chipLabel, styles.saveLabel]} numberOfLines={1}>
              + {t('presets.saveShort')}
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <PresetNameDialog
        visible={renaming != null}
        title={t('presets.renameTitle')}
        initialName={renaming?.name ?? ''}
        onCancel={() => setRenaming(null)}
        onSubmit={rename}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
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
    maxWidth: 220,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  chipLabel: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  saveChip: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  saveLabel: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
  },
}));
