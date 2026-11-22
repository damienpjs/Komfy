/**
 * Mode switch at the top of a launch form whose workflow belongs to a family
 * (Repaint a zone, Video, Write a prompt). Switching replaces the form with
 * the sibling manifest and carries over what the user brought (photo,
 * painted mask, texts, voice sample: CARRIED_KINDS) whenever the sibling has
 * the same field with the same kind. The painted strokes follow too: they are
 * stored under the mask's filename. Renders nothing for a workflow outside a
 * family.
 *
 * A mode the server cannot run (custom node or engine not installed, cf.
 * useAvailability) is drawn dimmed but stays reachable: its form opens with
 * the banner that names what is missing, as the catalogue rows do.
 */

import * as Haptics from 'expo-haptics';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useAvailability } from '../hooks/useAvailability';
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
  const availability = useAvailability();
  const entry = entryOf(manifest.id);
  if (!entry || !isFamily(entry)) return null;

  const current = entry.members.find((m) => m.manifestId === manifest.id)!;
  // Four modes (Video) leave about 80 pt per segment on a phone: stack the
  // icon over the label so "First → last" is not cut.
  const stacked = entry.members.length > 3;

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

  return (
    <View style={styles.wrap}>
      <View style={styles.seg} accessibilityRole="tablist">
        {entry.members.map((m) => {
          const on = m.manifestId === current.manifestId;
          const check = availability?.[m.manifestId];
          const missing =
            check && !check.ok
              ? (check.missingNodes[0] ?? check.missingValues[0]?.value)
              : undefined;
          const off = missing != null;
          const tint = off ? colors.textDisabled : on ? colors.text : colors.textMuted;
          return (
            <Pressable
              key={m.manifestId}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityHint={off ? t('catalog.missing', { item: missing }) : undefined}
              onPress={() => switchTo(m)}
              style={[styles.option, stacked && styles.optionStacked, on && styles.optionOn]}
            >
              <WorkflowIcon
                name={m.icon}
                size={20}
                color={tint}
                knockout={on ? colors.surface : colors.field}
              />
              <Text
                style={[
                  styles.label,
                  stacked && styles.labelStacked,
                  on && styles.labelOn,
                  off && styles.labelOff,
                ]}
                numberOfLines={1}
              >
                {t(m.mode)}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
  optionStacked: {
    flexDirection: 'column',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 2,
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
  labelStacked: {
    fontSize: 12,
  },
  labelOff: {
    color: colors.textDisabled,
  },
  labelOn: {
    color: colors.text,
  },
}));
