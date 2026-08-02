/**
 * Editor for a launch form's LoRA selection: cards (name, folder, strength
 * slider, removal) + an add button opening the explorer (LoraPicker).
 */

import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../store/settings';
import { loraDirName, loraDisplayName } from '../utils/pathTree';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import type { LoraSelection, LorasField } from '../workflows/types';
import { LoraPicker } from './LoraPicker';

interface Props {
  field: LorasField;
  value: LoraSelection[];
  onChange: (value: LoraSelection[]) => void;
}

const STRENGTH_MIN = -10;
const STRENGTH_MAX = 10;
const STRENGTH_STEP = 0.05;

export function LoraField({ field, value, onChange }: Props) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Global cap (Settings), applied to every workflow type. null = no limit.
  const maxCount = useSettings((s) => s.loraMaxCount);
  // Value displayed WHILE sliding (the selection is only committed on
  // release, but the user sees where they are).
  const [liveStrength, setLiveStrength] = useState<Record<string, number>>({});
  const defaultStrength = field.defaultStrength ?? 1.0;

  const toggle = (path: string) => {
    if (value.some((l) => l.name === path)) {
      onChange(value.filter((l) => l.name !== path));
    } else if (maxCount == null || value.length < maxCount) {
      onChange([...value, { name: path, strength: defaultStrength }]);
    }
  };

  const setStrength = (path: string, strength: number) => {
    onChange(
      value.map((l) =>
        l.name === path ? { ...l, strength: Number(strength.toFixed(2)) } : l,
      ),
    );
  };

  const atMax = maxCount != null && value.length >= maxCount;

  return (
    <View style={styles.wrap}>
      {value.map((lora, index) => (
        // Key by name+index: the same LoRA can legitimately appear twice (e.g.
        // both WAN i2v experts default to the lightx2v distill), and a bare
        // name key would collide (cf. GraphSummary, same pattern).
        <View key={`${lora.name}-${index}`} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName} numberOfLines={1}>
                {loraDisplayName(lora.name)}
              </Text>
              {loraDirName(lora.name) !== '' && (
                <View style={styles.dirChip}>
                  <Ionicons
                    name="folder-outline"
                    size={11}
                    color={colors.textMuted}
                  />
                  <Text style={styles.dirChipText} numberOfLines={1}>
                    {loraDirName(lora.name)}
                  </Text>
                </View>
              )}
            </View>
            <Pressable
              onPress={() => toggle(lora.name)}
              hitSlop={10}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Ionicons
                name="close-circle"
                size={22}
                color={colors.textMuted}
              />
            </Pressable>
          </View>

          <View style={styles.strengthRow}>
            <Slider
              style={styles.slider}
              minimumValue={STRENGTH_MIN}
              maximumValue={STRENGTH_MAX}
              step={STRENGTH_STEP}
              value={lora.strength}
              onValueChange={(v) =>
                setLiveStrength((s) => ({ ...s, [lora.name]: v }))
              }
              onSlidingComplete={(v) => {
                setStrength(lora.name, v);
                setLiveStrength((s) => {
                  const { [lora.name]: _, ...rest } = s;
                  return rest;
                });
              }}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.bgElevated}
              thumbTintColor={colors.accent}
            />
            <Text
              style={[
                styles.strengthValue,
                liveStrength[lora.name] != null && { color: colors.accent },
              ]}
            >
              ×{(liveStrength[lora.name] ?? lora.strength).toFixed(2)}
            </Text>
          </View>
        </View>
      ))}

      <Pressable
        style={({ pressed }) => [
          styles.addBtn,
          pressed && { backgroundColor: colors.surfacePressed },
          atMax && { opacity: 0.4 },
        ]}
        onPress={() => setPickerOpen(true)}
        disabled={atMax}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={styles.addText}>
          {atMax ? t('lora.max', { count: maxCount }) : t('lora.add')}
        </Text>
      </Pressable>

      <LoraPicker
        visible={pickerOpen}
        selected={value.map((l) => l.name)}
        onToggle={toggle}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardTitleWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  cardName: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  dirChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.bgElevated,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  dirChipText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  slider: {
    flex: 1,
    height: 32,
  },
  strengthValue: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    minWidth: 64,
    textAlign: 'right',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  addText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
