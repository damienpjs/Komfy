/**
 * Character editor for the multi FaceSwap: one card per character (face
 * number left → right, identity prompt, dedicated LoRAs — same editor and
 * explorer as the other workflows), + shared settings (denoise, steps,
 * seed).
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
  PersonsField as PersonsFieldSpec,
  PersonsValue,
} from '../workflows/types';
import { LoraField } from './LoraField';

interface Props {
  field: PersonsFieldSpec;
  value: PersonsValue;
  onChange: (value: PersonsValue) => void;
}

export function PersonsField({ field, value, onChange }: Props) {
  const { t } = useTranslation();
  // Per-character denoise text being edited (intermediate states like "0,"
  // tolerated; numeric commit on the fly).
  const [denoiseTexts, setDenoiseTexts] = useState<Record<number, string>>({});
  // "Detail level" panel (guide_size): collapsed by default, per character.
  const [detailOpen, setDetailOpen] = useState<Record<number, boolean>>({});

  // Per-character LoRA config: reuses the existing editor.
  const loraFieldSpec: LorasField = {
    kind: 'loras',
    key: 'loras',
    label: 'LoRAs',
    modelSource: { nodeId: '', output: 0 },
    modelTargets: [],
    maxCount: field.maxLorasPerPerson,
    defaultStrength: field.defaultStrength,
  };

  const setPerson = (i: number, patch: Partial<PersonsValue['persons'][0]>) =>
    onChange({
      ...value,
      persons: value.persons.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    });

  const removePerson = (i: number) => {
    setDenoiseTexts({}); // indexes shift: restart from committed values
    onChange({ ...value, persons: value.persons.filter((_, j) => j !== i) });
  };

  const addPerson = () =>
    onChange({
      ...value,
      persons: [
        ...value.persons,
        {
          prompt: '',
          loras: [],
          denoise: field.defaultDenoise,
          guideSize: DEFAULT_GUIDE_SIZE,
        },
      ],
    });

  const atMax = value.persons.length >= field.maxPersons;

  return (
    <View style={styles.wrap}>
      {value.persons.map((person, i) => (
        <View
          key={i}
          style={[styles.personCard, person.bypass && styles.personCardBypass]}
        >
          <View style={styles.personHeader}>
            <View
              style={[
                styles.personBadge,
                person.bypass && styles.personBadgeBypass,
              ]}
            >
              <Text style={styles.personBadgeText}>{i + 1}</Text>
            </View>
            <Text
              style={[
                styles.personTitle,
                person.bypass && { color: colors.textMuted },
              ]}
            >
              {t('persons.faceTitle', { number: i + 1 })}
            </Text>
            {value.persons.length > 1 && (
              <Pressable
                onPress={() => removePerson(i)}
                hitSlop={10}
                style={({ pressed }) => pressed && { opacity: 0.6 }}
              >
                <Ionicons name="close-circle" size={22} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          <View style={styles.bypassRow}>
            <Text style={styles.bypassLabel}>{t('persons.bypassLabel')}</Text>
            <Switch
              value={!!person.bypass}
              onValueChange={(bypass) => setPerson(i, { bypass })}
              trackColor={{ false: colors.bgElevated, true: colors.warning }}
              thumbColor={colors.text}
            />
          </View>

          {person.bypass ? (
            <Text style={styles.bypassNote}>{t('persons.bypassNote')}</Text>
          ) : (
            <>
              <TextInput
                style={styles.promptInput}
                value={person.prompt}
                onChangeText={(t) => setPerson(i, { prompt: t })}
                placeholder={t('persons.identityPlaceholder')}
                placeholderTextColor={colors.textDisabled}
                multiline
                autoCapitalize="none"
                inputAccessoryViewID={accessoryId}
              />

              <LoraField
                field={loraFieldSpec}
                value={person.loras}
                onChange={(loras) => setPerson(i, { loras })}
              />

              <View style={styles.personDenoiseRow}>
                <Text style={styles.personDenoiseLabel}>
                  {t('persons.denoiseLabel')}
                </Text>
                <TextInput
                  style={styles.personDenoiseInput}
                  keyboardType="decimal-pad"
                  value={denoiseTexts[i] ?? String(person.denoise)}
                  onChangeText={(t) => {
                    setDenoiseTexts((s) => ({ ...s, [i]: t }));
                    const n = Number(t.replace(',', '.'));
                    if (Number.isFinite(n)) setPerson(i, { denoise: n });
                  }}
                  inputAccessoryViewID={accessoryId}
                />
              </View>

              <View style={styles.detailPanel}>
                <Pressable
                  style={styles.detailHeader}
                  onPress={() =>
                    setDetailOpen((s) => ({ ...s, [i]: !s[i] }))
                  }
                  hitSlop={8}
                >
                  <Ionicons
                    name={detailOpen[i] ? 'chevron-down' : 'chevron-forward'}
                    size={16}
                    color={colors.textMuted}
                  />
                  <Text style={styles.detailHeaderLabel}>
                    {t('persons.detailLabel')}
                  </Text>
                  <Text style={styles.detailHeaderValue}>
                    {person.guideSize ?? DEFAULT_GUIDE_SIZE} px
                  </Text>
                </Pressable>

                {detailOpen[i] && (
                  <>
                    <View style={styles.detailOptions}>
                      {GUIDE_SIZE_OPTIONS.map((size) => {
                        const active =
                          (person.guideSize ?? DEFAULT_GUIDE_SIZE) === size;
                        return (
                          <Pressable
                            key={size}
                            style={[
                              styles.detailOption,
                              active && styles.detailOptionActive,
                            ]}
                            onPress={() => setPerson(i, { guideSize: size })}
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
                    <Text style={styles.detailHint}>
                      {t('persons.detailHint')}
                    </Text>
                  </>
                )}
              </View>
            </>
          )}
        </View>
      ))}

      <Pressable
        style={({ pressed }) => [
          styles.addBtn,
          pressed && { backgroundColor: colors.surfacePressed },
          atMax && { opacity: 0.4 },
        ]}
        onPress={addPerson}
        disabled={atMax}
      >
        <Ionicons name="person-add-outline" size={18} color={colors.accent} />
        <Text style={styles.addText}>
          {atMax
            ? t('persons.maxPersons', { count: field.maxPersons })
            : t('persons.addPerson')}
        </Text>
      </Pressable>

      <View style={styles.sharedRow}>
        <View style={styles.sharedItem}>
          <Text style={styles.sharedLabel}>{t('persons.steps')}</Text>
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
          <Text style={styles.sharedLabel}>{t('persons.seed')}</Text>
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
              placeholder={t('persons.randomSeed')}
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  personCard: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  personHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  personBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personBadgeText: {
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.xs,
  },
  personTitle: {
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
  personCardBypass: {
    opacity: 0.75,
    borderStyle: 'dashed',
  },
  personBadgeBypass: {
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
  personDenoiseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  personDenoiseLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  personDenoiseInput: {
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
