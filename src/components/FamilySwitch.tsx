/**
 * Mode switch at the top of a launch form whose workflow belongs to a family
 * (Repaint a zone, Video, Write a prompt). Switching replaces the form with
 * the sibling manifest and carries over what the user brought (photo,
 * painted mask, texts: CARRIED_KINDS) whenever the sibling has the same field
 * with the same kind. The painted strokes follow too: they are stored under
 * the mask's filename. Renders nothing for a workflow outside a family.
 */

import * as Haptics from 'expo-haptics';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useCatalogPrefs } from '../store/catalogPrefs';
import { makeStyles, useTheme } from '../theme/theme';
import { radii, spacing, typography } from '../theme/tokens';
import {
  CARRIED_KINDS,
  entryOf,
  isFamily,
  type FamilyMember,
} from '../workflows/catalog';
import { getAnyWorkflow } from '../workflows/registry';
import type { FieldValues, WorkflowManifest } from '../workflows/types';
import { WorkflowIcon } from './WorkflowIcon';

interface Props {
  manifest: WorkflowManifest;
  values: FieldValues;
}

export function FamilySwitch({ manifest, values }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const entry = entryOf(manifest.id);
  if (!entry || !isFamily(entry)) return null;

  const current = entry.members.find((m) => m.manifestId === manifest.id)!;
  // One segment per mode, in catalogue order (Video ▸ Image has two engines).
  const modes = entry.members.filter(
    (m, i) => entry.members.findIndex((o) => o.mode === m.mode) === i,
  );
  const engines = entry.members.filter((m) => m.mode === current.mode && m.engine);

  const switchTo = (target: FamilyMember) => {
    if (target.manifestId === manifest.id) return;
    const sibling = getAnyWorkflow(target.manifestId);
    if (!sibling) return;
    const carried: FieldValues = {};
    for (const field of sibling.fields) {
      if (!CARRIED_KINDS.has(field.kind)) continue;
      const own = manifest.fields.find((f) => f.key === field.key);
      const value = values[field.key];
      if (own?.kind === field.kind && value != null && value !== '') {
        carried[field.key] = value;
      }
    }
    Haptics.selectionAsync();
    useCatalogPrefs.getState().setLastMember(entry.key, target.manifestId);
    const prefill = Object.keys(carried).length
      ? `?prefill=${encodeURIComponent(JSON.stringify(carried))}`
      : '';
    router.replace(`/workflow/${target.manifestId}${prefill}` as Href);
  };

  /** Switching mode keeps the current engine when the target mode has it. */
  const memberForMode = (mode: string): FamilyMember =>
    entry.members.find((m) => m.mode === mode && m.engine === current.engine) ??
    entry.members.find((m) => m.mode === mode)!;

  return (
    <View style={styles.wrap}>
      <View style={styles.seg} accessibilityRole="tablist">
        {modes.map((m) => {
          const on = m.mode === current.mode;
          return (
            <Pressable
              key={m.mode}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => switchTo(memberForMode(m.mode))}
              style={[styles.option, on && styles.optionOn]}
            >
              <WorkflowIcon
                name={m.icon}
                size={20}
                color={on ? colors.text : colors.textMuted}
                knockout={on ? colors.surface : colors.field}
              />
              <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
                {t(m.mode)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {engines.length > 1 && (
        <View style={styles.engines}>
          {engines.map((m) => {
            const on = m.manifestId === manifest.id;
            return (
              <Pressable
                key={m.manifestId}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => switchTo(m)}
                style={[styles.engine, on && styles.engineOn]}
              >
                <Text style={[styles.engineText, on && styles.engineTextOn]}>
                  {m.engine}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    gap: spacing.sm,
  },
  seg: {
    flexDirection: 'row',
    gap: 2,
    padding: 2,
    borderRadius: radii.md,
    backgroundColor: colors.field,
  },
  option: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  optionOn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: {
    flexShrink: 1,
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: 13,
  },
  labelOn: {
    color: colors.text,
  },
  engines: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  engine: {
    minHeight: 36,
    paddingHorizontal: spacing.md - 4,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  engineOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  engineText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  engineTextOn: {
    color: colors.accent,
  },
}));
