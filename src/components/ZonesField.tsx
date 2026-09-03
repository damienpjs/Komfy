/**
 * Zone editor for Detect & Replace. Two modes:
 *  - "same content for every zone": a single card, no numbering — the pass
 *    covers all detected zones, however many;
 *  - one card per zone (zone number left → right, prompt, dedicated LoRAs —
 *    same editor and explorer as the other workflows).
 * Plus the shared settings (denoise, steps, seed).
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import { accessoryId } from '../utils/formAccessory';
import { randomSeed } from '../workflows/patch';
import {
  DEFAULT_GUIDE_SIZE,
  GUIDE_SIZE_OPTIONS,
} from '../workflows/types';
import type {
  LorasField,
  ZonesField as ZonesFieldSpec,
  ZonesValue,
} from '../workflows/types';
import { LoraField } from './LoraField';
import { SourceSeedChip } from './SourceSeedChip';

interface Props {
  field: ZonesFieldSpec;
  value: ZonesValue;
  onChange: (value: ZonesValue) => void;
  /** Remix: shared seed of the source image, offered back in one tap. */
  sourceSeed?: number;
}

export function ZonesField({ field, value, onChange, sourceSeed }: Props) {
  const { t } = useTranslation();
  // Per-zone denoise text being edited (intermediate states like "0,"
  // tolerated; numeric commit on the fly).
  const [denoiseTexts, setDenoiseTexts] = useState<Record<number, string>>({});
  // "Detail level" panel (guide_size): collapsed by default, per zone.
  const [detailOpen, setDetailOpen] = useState<Record<number, boolean>>({});

  // Per-zone LoRA config: reuses the existing editor (the LoRA count
  // cap comes from the global setting, applied inside LoraField).
  const loraFieldSpec: LorasField = {
    kind: 'loras',
    key: 'loras',
    label: 'LoRAs',
    modelSource: { nodeId: '', output: 0 },
    modelTargets: [],
    defaultStrength: field.defaultStrength,
  };

  const setZone = (i: number, patch: Partial<ZonesValue['zones'][0]>) =>
    onChange({
      ...value,
      zones: value.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)),
    });

  const removeZone = (i: number) => {
    setDenoiseTexts({}); // indexes shift: restart from committed values
    onChange({ ...value, zones: value.zones.filter((_, j) => j !== i) });
  };

  const addZone = () =>
    onChange({
      ...value,
      zones: [
        ...value.zones,
        {
          prompt: '',
          loras: [],
          denoise: field.defaultDenoise,
          guideSize: DEFAULT_GUIDE_SIZE,
        },
      ],
    });

  const allZones = !!value.allZones;
  const atMax =
    field.maxZones != null && value.zones.length >= field.maxZones;

  // Prompt + LoRAs + denoise + detail level: identical in both modes.
  const zoneBody = (zone: ZonesValue['zones'][0], i: number) => (
    <>
      <TextInput
        style={styles.promptInput}
        value={zone.prompt}
        onChangeText={(t) => setZone(i, { prompt: t })}
        placeholder={t('zones.promptPlaceholder')}
        placeholderTextColor={colors.textDisabled}
        multiline
        autoCapitalize="none"
        inputAccessoryViewID={accessoryId}
      />

      <LoraField
        field={loraFieldSpec}
        value={zone.loras}
        onChange={(loras) => setZone(i, { loras })}
      />

      <View style={styles.zoneDenoiseRow}>
        <Text style={styles.zoneDenoiseLabel}>
          {allZones ? t('zones.denoiseLabelAll') : t('zones.denoiseLabel')}
        </Text>
        <TextInput
          style={styles.zoneDenoiseInput}
          keyboardType="decimal-pad"
          value={denoiseTexts[i] ?? String(zone.denoise)}
          onChangeText={(t) => {
            setDenoiseTexts((s) => ({ ...s, [i]: t }));
            const n = Number(t.replace(',', '.'));
            if (Number.isFinite(n)) setZone(i, { denoise: n });
          }}
          inputAccessoryViewID={accessoryId}
        />
      </View>

      <View style={styles.detailPanel}>
        <Pressable
          style={styles.detailHeader}
          onPress={() => setDetailOpen((s) => ({ ...s, [i]: !s[i] }))}
          hitSlop={8}
        >
          <Ionicons
            name={detailOpen[i] ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.detailHeaderLabel}>
            {t('zones.detailLabel')}
          </Text>
          <Text style={styles.detailHeaderValue}>
            {zone.guideSize ?? DEFAULT_GUIDE_SIZE} px
          </Text>
        </Pressable>

        {detailOpen[i] && (
          <>
            <View style={styles.detailOptions}>
              {GUIDE_SIZE_OPTIONS.map((size) => {
                const active = (zone.guideSize ?? DEFAULT_GUIDE_SIZE) === size;
                return (
                  <Pressable
                    key={size}
                    style={[
                      styles.detailOption,
                      active && styles.detailOptionActive,
                    ]}
                    onPress={() => setZone(i, { guideSize: size })}
                  >
                    <Text
                      style={[
                        styles.detailOptionText,
                        active && styles.detailOptionTextActive,
                      ]}
                    >
                      {size}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.detailHint}>{t('zones.detailHint')}</Text>
          </>
        )}
      </View>
    </>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.modeRow}>
        <Text style={styles.modeLabel}>{t('zones.allZonesLabel')}</Text>
        <Switch
          value={allZones}
          onValueChange={(v) => onChange({ ...value, allZones: v })}
          trackColor={{ false: colors.bgElevated, true: colors.accent }}
          thumbColor={colors.text}
        />
      </View>

      {allZones ? (
        <View style={styles.zoneCard}>
          <View style={styles.zoneHeader}>
            <View style={styles.zoneBadge}>
              <Ionicons name="apps-outline" size={14} color={colors.text} />
            </View>
            <Text style={styles.zoneTitle}>{t('zones.allZonesTitle')}</Text>
          </View>
          <Text style={styles.modeNote}>{t('zones.allZonesNote')}</Text>
          {zoneBody(value.zones[0], 0)}
        </View>
      ) : (
        <>
          {value.zones.map((zone, i) => (
            <View
              key={i}
              style={[
                styles.zoneCard,
                zone.bypass && styles.zoneCardBypass,
              ]}
            >
              <View style={styles.zoneHeader}>
                <View
                  style={[
                    styles.zoneBadge,
                    zone.bypass && styles.zoneBadgeBypass,
                  ]}
                >
                  <Text style={styles.zoneBadgeText}>{i + 1}</Text>
                </View>
                <Text
                  style={[
                    styles.zoneTitle,
                    zone.bypass && { color: colors.textMuted },
                  ]}
                >
                  {t('zones.zoneTitle', { number: i + 1 })}
                </Text>
                {value.zones.length > 1 && (
                  <Pressable
                    onPress={() => removeZone(i)}
                    hitSlop={10}
                    style={({ pressed }) => pressed && { opacity: 0.6 }}
                  >
                    <Ionicons
                      name="close-circle"
                      size={22}
                      color={colors.textMuted}
                    />
                  </Pressable>
                )}
              </View>

              <View style={styles.bypassRow}>
                <Text style={styles.bypassLabel}>
                  {t('zones.bypassLabel')}
                </Text>
                <Switch
                  value={!!zone.bypass}
                  onValueChange={(bypass) => setZone(i, { bypass })}
                  trackColor={{ false: colors.bgElevated, true: colors.warning }}
                  thumbColor={colors.text}
                />
              </View>

              {zone.bypass ? (
                <Text style={styles.bypassNote}>{t('zones.bypassNote')}</Text>
              ) : (
                zoneBody(zone, i)
              )}
            </View>
          ))}

          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              pressed && { backgroundColor: colors.surfacePressed },
              atMax && { opacity: 0.4 },
            ]}
            onPress={addZone}
            disabled={atMax}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color={colors.accent}
            />
            <Text style={styles.addText}>
              {atMax
                ? t('zones.maxZones', { count: field.maxZones })
                : t('zones.addZone')}
            </Text>
          </Pressable>
        </>
      )}

      <View style={styles.sharedRow}>
        <View style={styles.sharedItem}>
          <Text style={styles.sharedLabel}>{t('zones.steps')}</Text>
          <TextInput
            style={styles.sharedInput}
            keyboardType="number-pad"
            value={String(value.steps)}
            onChangeText={(t) =>
              onChange({ ...value, steps: parseInt(t, 10) || 0 })
            }
            inputAccessoryViewID={accessoryId}
          />
        </View>
        <View style={[styles.sharedItem, { flex: 1.4 }]}>
          <Text style={styles.sharedLabel}>{t('zones.seed')}</Text>
          <View style={styles.seedRow}>
            <TextInput
              style={[styles.sharedInput, { flex: 1 }]}
              keyboardType="number-pad"
              value={value.seed === 'random' ? '' : String(value.seed)}
              onChangeText={(t) =>
                onChange({
                  ...value,
                  seed: t.trim() === '' ? 'random' : parseInt(t, 10) || 0,
                })
              }
              placeholder={t('zones.randomSeed')}
              placeholderTextColor={colors.textDisabled}
              inputAccessoryViewID={accessoryId}
            />
            <Pressable
              style={({ pressed }) => [
                styles.diceBtn,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
              onPress={() =>
                onChange({
                  ...value,
                  seed: value.seed === 'random' ? randomSeed() : 'random',
                })
              }
            >
              <Ionicons
                name={value.seed === 'random' ? 'dice-outline' : 'refresh-outline'}
                size={18}
                color={colors.accent}
              />
            </Pressable>
          </View>
        </View>
      </View>

      {/* Remix: the seed the source image was drawn with (full width — the
          shared row is too narrow for it). */}
      <SourceSeedChip
        seed={sourceSeed}
        current={value.seed}
        onReuse={(seed) => onChange({ ...value, seed })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  modeLabel: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  modeNote: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: 18,
  },
  zoneCard: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  zoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  zoneBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBadgeText: {
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.xs,
  },
  zoneTitle: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  promptInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  zoneCardBypass: {
    opacity: 0.75,
    borderStyle: 'dashed',
  },
  zoneBadgeBypass: {
    backgroundColor: colors.textDisabled,
  },
  bypassRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bypassLabel: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  bypassNote: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: 18,
  },
  zoneDenoiseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  zoneDenoiseLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  zoneDenoiseInput: {
    minWidth: 88,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  detailPanel: {
    gap: spacing.sm,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  detailHeaderLabel: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  detailHeaderValue: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  detailOptions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  detailOption: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailOptionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfacePressed,
  },
  detailOptionText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  detailOptionTextActive: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
  },
  detailHint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: 18,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
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
  sharedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sharedItem: {
    flex: 1,
    gap: spacing.xs,
  },
  sharedLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
  },
  sharedInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    paddingHorizontal: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    textAlign: 'center',
  },
  seedRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  diceBtn: {
    width: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
