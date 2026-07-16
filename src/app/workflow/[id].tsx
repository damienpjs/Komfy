/**
 * Launch screen: form generated from the workflow manifest, graph patch →
 * POST /prompt → toast + redirect to the Queue.
 * ComfyUI validation errors (400, node_errors) are displayed.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ComfyApiError, createClient } from '../../api/client';
import type { PromptErrorResponse } from '../../api/types';
import { ImageInputField } from '../../components/ImageInputField';
import { LoraField } from '../../components/LoraField';
import { OutputDirPicker } from '../../components/OutputDirPicker';
import { PersonsField } from '../../components/PersonsField';
import { PresetBar } from '../../components/PresetBar';
import { PromptField } from '../../components/PromptField';
import { useBatchPrefs } from '../../store/batchPrefs';
import { useFieldPrefs } from '../../store/fieldPrefs';
import { useOutputPrefs } from '../../store/outputPrefs';
import { usePromptHistory } from '../../store/promptHistory';
import { useSettings } from '../../store/settings';
import { useToast } from '../../store/toast';
import { presetLabel } from '../../utils/presetLabel';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../../theme/tokens';
import {
  accessoryId,
  KEYBOARD_ACCESSORY_ID,
} from '../../utils/formAccessory';
import { getWorkflow } from '../../workflows';
import {
  DEFAULT_OUTPUT_DIR,
  DIMENSION_STEP,
  effectiveDimensions,
  patchGraph,
  randomSeed,
  validate,
} from '../../workflows/patch';
import { DEFAULT_GUIDE_SIZE } from '../../workflows/types';
import type {
  DimensionsValue,
  FieldValues,
  LoraSelection,
  PersonsValue,
  WorkflowField,
} from '../../workflows/types';


// Image count shortcuts (usual grids) offered as chips.
const BATCH_PRESETS = [1, 2, 4, 9, 16, 25];
const BATCH_MAX = 100;

const NAMED_RATIOS: [number, string][] = [
  [1, '1:1'],
  [5 / 4, '5:4'],
  [4 / 3, '4:3'],
  [3 / 2, '3:2'],
  [16 / 10, '16:10'],
  [16 / 9, '16:9'],
  [2, '2:1'],
  [21 / 9, '21:9'],
];

function ratioLabel(w: number, h: number): string {
  if (!w || !h) return '—';
  const r = w / h;
  for (const [value, label] of NAMED_RATIOS) {
    if (Math.abs(r - value) < 0.02) return label;
  }
  return `≈${r.toFixed(2)}`;
}

function initialValues(
  fields: WorkflowField[],
  prefill?: string,
  remembered?: Record<string, number>,
): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    if (field.kind === 'text' || field.kind === 'number')
      values[field.key] = field.default;
    if (field.kind === 'seed') values[field.key] = 'random';
    if (field.kind === 'select') {
      // `remember` field: last choice kept (if the index still exists).
      const kept = field.remember ? remembered?.[field.key] : undefined;
      values[field.key] =
        kept != null && kept >= 0 && kept < field.options.length
          ? kept
          : field.defaultIndex;
    }
    if (field.kind === 'loras') values[field.key] = [];
    if (field.kind === 'image') values[field.key] = '';
    if (field.kind === 'dimensions')
      values[field.key] = { ...field.default, inverted: false, custom: false };
    if (field.kind === 'persons')
      values[field.key] = {
        persons: [
          {
            prompt: '',
            loras: [],
            denoise: field.defaultDenoise,
            guideSize: DEFAULT_GUIDE_SIZE,
          },
        ],
        steps: field.defaultSteps,
        seed: 'random',
      };
  }
  // Remix (Sprint 4b): values extracted from an image, on top of defaults.
  if (prefill) {
    try {
      const extracted = JSON.parse(prefill) as FieldValues;
      for (const field of fields) {
        if (extracted[field.key] != null) values[field.key] = extracted[field.key];
      }
    } catch {
      // unreadable prefill: form falls back to defaults.
    }
  }
  return values;
}

function comfyErrorMessage(e: unknown): string {
  if (e instanceof ComfyApiError && e.body) {
    const body = e.body as PromptErrorResponse;
    if (body.error) {
      const nodeDetails = Object.values(body.node_errors ?? {})
        .flatMap((n) => n.errors.map((err) => err.details))
        .join('\n');
      return [body.error.message, nodeDetails].filter(Boolean).join('\n');
    }
  }
  return e instanceof Error ? e.message : String(e);
}

export default function WorkflowLaunchScreen() {
  const { id, prefill } = useLocalSearchParams<{
    id: string;
    prefill?: string;
  }>();
  const manifest = getWorkflow(id ?? '');
  const router = useRouter();
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const clientId = useSettings((s) => s.clientId);
  const showToast = useToast((s) => s.show);
  const rememberedSelects = useFieldPrefs(
    (s) => s.selections[manifest?.id ?? ''],
  );

  const [values, setValues] = useState<FieldValues>(() =>
    initialValues(manifest?.fields ?? [], prefill, rememberedSelects),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  // Image count: global persisted memory (AsyncStorage), recalled everywhere.
  const batchCount = useBatchPrefs((s) => s.count);
  const setBatchPref = useBatchPrefs((s) => s.setCount);
  const applyCount = (n: number) =>
    setBatchPref(Math.max(1, Math.min(BATCH_MAX, Math.round(n))));
  // Raw text of the editable field; null = show the store value.
  const [countText, setCountText] = useState<string | null>(null);

  // Held +/- press: instead of a fixed step of 1 per tap, the increment
  // accelerates with hold duration (short tap = ±1, long press = ±10).
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = () => {
    if (holdTimer.current) {
      clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
  };
  const startHold = (dir: 1 | -1) => {
    stopHold();
    setCountText(null);
    const start = Date.now();
    const stepFor = (ms: number) =>
      ms < 1500 ? 1 : ms < 3000 ? 2 : ms < 5000 ? 5 : 10;
    applyCount(useBatchPrefs.getState().count + dir); // immediate first step
    holdTimer.current = setInterval(() => {
      const cur = useBatchPrefs.getState().count;
      applyCount(cur + dir * stepFor(Date.now() - start));
      // Limit reached: no point in keeping the interval running.
      if ((dir < 0 && cur <= 1) || (dir > 0 && cur >= BATCH_MAX)) stopHold();
    }, 140);
  };
  useEffect(() => stopHold, []);

  const outputDir =
    useOutputPrefs((s) => s.dirs[manifest?.id ?? '']) ?? DEFAULT_OUTPUT_DIR;
  const setOutputDir = useOutputPrefs((s) => s.setDir);

  if (!manifest) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{t('launch.notFound')}</Text>
      </View>
    );
  }

  // Text-result workflow: a single job, no batch or destination, and the
  // result screen replaces the redirect to the Queue.
  const isTextResult = manifest.textNodeId != null;

  const setValue = (key: string, value: FieldValues[string]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
    // `remember` select field: the choice is persisted for this workflow.
    const field = manifest.fields.find((f) => f.key === key);
    if (field?.kind === 'select' && field.remember && typeof value === 'number') {
      useFieldPrefs.getState().setSelection(manifest.id, key, value);
    }
  };

  // Re-applies a setting from history: only overwrites fields known to the
  // current manifest (a preset from another workflow stays inert).
  const applyPreset = (preset: FieldValues) => {
    setValues((cur) => {
      const next = { ...cur };
      for (const field of manifest.fields) {
        if (preset[field.key] != null) next[field.key] = preset[field.key];
      }
      return next;
    });
    setErrors({});
    showToast(t('launch.applied'));
  };

  const launch = async () => {
    const validationErrors = validate(manifest, values);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setSubmitting(true);
    try {
      const client = createClient(serverUrl);

      if (isTextResult) {
        const graph = patchGraph(manifest, values);
        const res = await client.postPrompt(graph, clientId);
        usePromptHistory
          .getState()
          .record(manifest.id, values, presetLabel(manifest.fields, values));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace(
          `/workflow/text-result?promptId=${encodeURIComponent(
            res.prompt_id,
          )}&nodeId=${encodeURIComponent(manifest.textNodeId!)}` as Href,
        );
        return;
      }

      let firstNumber: number | null = null;
      for (let i = 0; i < batchCount; i++) {
        // Batch: random seed → new draw per job (patchGraph),
        // fixed seed → incremented (seed, seed+1, …) for variants.
        const runValues = { ...values };
        const seedField = manifest.fields.find((f) => f.kind === 'seed');
        if (seedField && runValues[seedField.key] !== 'random' && i > 0) {
          runValues[seedField.key] = Number(runValues[seedField.key]) + i;
        }
        const personsField = manifest.fields.find((f) => f.kind === 'persons');
        if (personsField && i > 0) {
          const pv = runValues[personsField.key] as PersonsValue;
          if (pv.seed !== 'random') {
            // Each character pass consumes seed..seed+n → shift by the
            // number of characters to keep the jobs distinct.
            runValues[personsField.key] = {
              ...pv,
              seed: Number(pv.seed) + i * Math.max(1, pv.persons.length),
            };
          }
        }
        const graph = patchGraph(manifest, runValues, { outputDir });
        const res = await client.postPrompt(graph, clientId);
        firstNumber ??= res.number;
      }
      // Local settings history (base values, without the batch seed
      // increments): deduplicated and moved to the top.
      usePromptHistory
        .getState()
        .record(manifest.id, values, presetLabel(manifest.fields, values));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(
        batchCount > 1
          ? t('launch.jobsQueued', { count: batchCount, number: firstNumber })
          : t('launch.jobQueued', { number: firstNumber }),
      );
      router.replace('/');
    } catch (e) {
      Alert.alert(t('launch.launchFailed'), comfyErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t(manifest.name) }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // The keyboard "docks" under the active field: the scrollable area
        // shrinks when the keyboard opens and scrolls to the field (iOS).
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.description}>{t(manifest.description)}</Text>

        <PresetBar workflowId={manifest.id} onApply={applyPreset} />

        {manifest.fields.map((field) => (
          <View key={field.key} style={styles.fieldBlock}>
            <Text style={styles.label}>{t(field.label)}</Text>

            {field.kind === 'persons' && (
              <PersonsField
                field={field}
                value={values[field.key] as PersonsValue}
                onChange={(v) => setValue(field.key, v)}
              />
            )}

            {field.kind === 'image' && (
              <ImageInputField
                value={String(values[field.key] ?? '')}
                onChange={(name) => setValue(field.key, name)}
              />
            )}

            {field.kind === 'text' && field.multiline && (
              <PromptField
                label={t(field.label)}
                value={String(values[field.key] ?? '')}
                onChange={(text) => setValue(field.key, text)}
                placeholder={field.placeholder ? t(field.placeholder) : undefined}
              />
            )}

            {field.kind === 'text' && !field.multiline && (
              <TextInput
                style={styles.input}
                value={String(values[field.key] ?? '')}
                onChangeText={(text) => setValue(field.key, text)}
                placeholder={field.placeholder ? t(field.placeholder) : undefined}
                placeholderTextColor={colors.textDisabled}
                autoCapitalize="none"
                inputAccessoryViewID={accessoryId}
              />
            )}

            {field.kind === 'number' && (
              <TextInput
                style={styles.input}
                value={String(values[field.key] ?? '')}
                onChangeText={(text) => setValue(field.key, text.replace(',', '.'))}
                keyboardType="decimal-pad"
                inputAccessoryViewID={accessoryId}
              />
            )}

            {field.kind === 'seed' && (
              <View style={styles.seedRow}>
                <TextInput
                  style={[styles.input, styles.seedInput]}
                  value={
                    values[field.key] === 'random'
                      ? ''
                      : String(values[field.key])
                  }
                  onChangeText={(text) =>
                    setValue(field.key, text.trim() === '' ? 'random' : text)
                  }
                  placeholder={t('persons.randomSeed')}
                  placeholderTextColor={colors.textDisabled}
                  keyboardType="numeric"
                  inputAccessoryViewID={accessoryId}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.diceBtn,
                    pressed && { backgroundColor: colors.surfacePressed },
                  ]}
                  onPress={() =>
                    setValue(
                      field.key,
                      values[field.key] === 'random'
                        ? randomSeed()
                        : 'random',
                    )
                  }
                >
                  <Ionicons
                    name={
                      values[field.key] === 'random'
                        ? 'dice-outline'
                        : 'refresh-outline'
                    }
                    size={20}
                    color={colors.accent}
                  />
                </Pressable>
              </View>
            )}

            {field.kind === 'dimensions' &&
              (() => {
                const v =
                  (values[field.key] as DimensionsValue) ?? {
                    ...field.default,
                    inverted: false,
                    custom: false,
                  };
                const setDim = (patch: Partial<DimensionsValue>) =>
                  setValue(field.key, { ...v, ...patch });
                const eff = effectiveDimensions(v);
                return (
                  <View style={styles.dimWrap}>
                    <View style={styles.dimGrid}>
                      {field.options.map((o) => {
                        const selected =
                          !v.custom &&
                          v.width === o.width &&
                          v.height === o.height;
                        return (
                          <Pressable
                            key={`${o.width}x${o.height}`}
                            style={[
                              styles.dimChip,
                              selected && styles.dimChipSelected,
                            ]}
                            onPress={() =>
                              setDim({
                                width: o.width,
                                height: o.height,
                                custom: false,
                              })
                            }
                          >
                            <Text
                              style={[
                                styles.dimChipText,
                                selected && styles.dimChipTextSelected,
                              ]}
                            >
                              {o.width}×{o.height}
                            </Text>
                            <Text style={styles.dimChipRatio}>
                              {ratioLabel(o.width, o.height)}
                            </Text>
                          </Pressable>
                        );
                      })}
                      <Pressable
                        style={[
                          styles.dimChip,
                          v.custom && styles.dimChipSelected,
                        ]}
                        onPress={() => setDim({ custom: true })}
                      >
                        <Text
                          style={[
                            styles.dimChipText,
                            v.custom && styles.dimChipTextSelected,
                          ]}
                        >
                          {t('launch.custom')}
                        </Text>
                        <Text style={styles.dimChipRatio}>
                          {v.custom ? ratioLabel(v.width, v.height) : '…'}
                        </Text>
                      </Pressable>
                    </View>

                    {v.custom && (
                      <View style={styles.dimCustomRow}>
                        <TextInput
                          style={[styles.input, styles.dimCustomInput]}
                          keyboardType="number-pad"
                          value={v.width ? String(v.width) : ''}
                          onChangeText={(text) =>
                            setDim({ width: parseInt(text, 10) || 0 })
                          }
                          placeholder="W"
                          placeholderTextColor={colors.textDisabled}
                          inputAccessoryViewID={accessoryId}
                        />
                        <Text style={styles.dimTimes}>×</Text>
                        <TextInput
                          style={[styles.input, styles.dimCustomInput]}
                          keyboardType="number-pad"
                          value={v.height ? String(v.height) : ''}
                          onChangeText={(text) =>
                            setDim({ height: parseInt(text, 10) || 0 })
                          }
                          placeholder="H"
                          placeholderTextColor={colors.textDisabled}
                          inputAccessoryViewID={accessoryId}
                        />
                        <Text style={styles.dimStepHint}>
                          {t('launch.multiplesOf', { step: DIMENSION_STEP })}
                        </Text>
                      </View>
                    )}

                    <View style={styles.invertRow}>
                      <Text style={styles.invertLabel}>
                        {t('launch.invert')}
                      </Text>
                      <Switch
                        value={v.inverted}
                        onValueChange={(x) => setDim({ inverted: x })}
                        trackColor={{
                          false: colors.bgElevated,
                          true: colors.accent,
                        }}
                        thumbColor={colors.text}
                      />
                    </View>
                    <Text style={styles.dimSummary}>
                      → {eff.width} × {eff.height}
                      {v.inverted ? t('launch.portrait') : ''}
                    </Text>
                  </View>
                );
              })()}

            {field.kind === 'loras' && (
              <LoraField
                field={field}
                value={
                  Array.isArray(values[field.key])
                    ? (values[field.key] as LoraSelection[])
                    : []
                }
                onChange={(loras) => setValue(field.key, loras)}
              />
            )}

            {field.kind === 'select' && (
              <View style={styles.segmentRow}>
                {field.options.map((option, index) => {
                  const selected = values[field.key] === index;
                  return (
                    <Pressable
                      key={option.label}
                      style={[
                        styles.segment,
                        selected && styles.segmentSelected,
                      ]}
                      onPress={() => setValue(field.key, index)}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          selected && styles.segmentTextSelected,
                        ]}
                      >
                        {t(option.label)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {field.hint && !errors[field.key] && (
              <Text style={styles.hint}>{t(field.hint)}</Text>
            )}
            {!!errors[field.key] && (
              <Text style={styles.fieldError}>{errors[field.key]}</Text>
            )}
          </View>
        ))}

        {!isTextResult && (
        <View style={styles.fieldBlock}>
          <Text style={styles.label}>{t('launch.imageCount')}</Text>
          <View style={styles.batchRow}>
            <Pressable
              style={({ pressed }) => [
                styles.batchBtn,
                pressed && { backgroundColor: colors.surfacePressed },
                batchCount <= 1 && { opacity: 0.4 },
              ]}
              disabled={batchCount <= 1}
              onPressIn={() => startHold(-1)}
              onPressOut={stopHold}
            >
              <Ionicons name="remove" size={20} color={colors.text} />
            </Pressable>
            <TextInput
              style={styles.batchValue}
              keyboardType="number-pad"
              selectTextOnFocus
              maxLength={3}
              value={countText ?? String(batchCount)}
              onFocus={() => setCountText(String(batchCount))}
              onChangeText={(text) => {
                setCountText(text);
                const n = parseInt(text, 10);
                if (Number.isFinite(n)) applyCount(n);
              }}
              onBlur={() => setCountText(null)}
              inputAccessoryViewID={accessoryId}
            />
            <Pressable
              style={({ pressed }) => [
                styles.batchBtn,
                pressed && { backgroundColor: colors.surfacePressed },
                batchCount >= BATCH_MAX && { opacity: 0.4 },
              ]}
              disabled={batchCount >= BATCH_MAX}
              onPressIn={() => startHold(1)}
              onPressOut={stopHold}
            >
              <Ionicons name="add" size={20} color={colors.text} />
            </Pressable>
            <Text style={styles.batchHint}>
              {batchCount > 1 ? t('launch.distinctSeeds') : ''}
            </Text>
          </View>
          <View style={styles.batchPresets}>
            {BATCH_PRESETS.map((preset) => {
              const active = batchCount === preset;
              return (
                <Pressable
                  key={preset}
                  style={({ pressed }) => [
                    styles.batchChip,
                    active && styles.batchChipActive,
                    pressed &&
                      !active && { backgroundColor: colors.surfacePressed },
                  ]}
                  onPress={() => {
                    setCountText(null);
                    applyCount(preset);
                  }}
                >
                  <Text
                    style={[
                      styles.batchChipText,
                      active && styles.batchChipTextActive,
                    ]}
                  >
                    {preset}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        )}

        {!isTextResult && (
        <View style={styles.fieldBlock}>
          <Text style={styles.label}>{t('launch.destination')}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.destRow,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            onPress={() => setDirPickerOpen(true)}
          >
            <Ionicons name="folder-outline" size={18} color={colors.warning} />
            <Text style={styles.destPath} numberOfLines={1}>
              output/{outputDir === '' ? '' : `${outputDir}/`}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textDisabled}
            />
          </Pressable>
        </View>
        )}

        <Pressable
          style={({ pressed }) => [
            styles.launchBtn,
            pressed && { backgroundColor: colors.brandPressed },
            submitting && { opacity: 0.4 },
          ]}
          onPress={launch}
          disabled={submitting}
        >
          <Ionicons name="play" size={18} color={colors.onBrand} />
          <Text style={styles.launchText}>
            {submitting
              ? t('launch.launching')
              : !isTextResult && batchCount > 1
                ? t('launch.launchX', { count: batchCount })
                : t('launch.launch')}
          </Text>
        </Pressable>

        <OutputDirPicker
          visible={dirPickerOpen}
          initial={outputDir}
          onSelect={(dir) => manifest && setOutputDir(manifest.id, dir)}
          onClose={() => setDirPickerOpen(false)}
        />
      </ScrollView>

      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={KEYBOARD_ACCESSORY_ID}>
          <View style={styles.accessoryBar}>
            <Pressable
              onPress={Keyboard.dismiss}
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={styles.accessoryDone}>{t('launch.done')}</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  fieldBlock: {
    gap: spacing.xs,
  },
  label: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  seedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  seedInput: {
    flex: 1,
    fontFamily: typography.mono,
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
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  segment: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.bgElevated,
  },
  segmentText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  segmentTextSelected: {
    color: colors.accent,
  },
  hint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  fieldError: {
    color: colors.danger,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  errorText: {
    color: colors.danger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  accessoryDone: {
    color: colors.accent,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.md,
  },
  dimWrap: {
    gap: spacing.sm,
  },
  dimGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  dimChip: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    gap: 2,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  dimChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.bgElevated,
  },
  dimChipText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  dimChipTextSelected: {
    color: colors.accent,
  },
  dimChipRatio: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: 10,
  },
  dimCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dimCustomInput: {
    flex: 1,
    fontFamily: typography.mono,
    textAlign: 'center',
  },
  dimTimes: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.md,
  },
  dimStepHint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  invertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  invertLabel: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  dimSummary: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  batchPresets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  batchChip: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  batchChipText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.md,
  },
  batchChipTextActive: {
    color: colors.text,
  },
  batchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  batchBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batchValue: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.lg,
    minWidth: 56,
    minHeight: MIN_TOUCH_TARGET,
    textAlign: 'center',
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
  },
  batchHint: {
    flex: 1,
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  destRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  destPath: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  launchBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radii.md,
    backgroundColor: colors.brand, // main CTA in neon yellow (style guide)
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  launchText: {
    color: colors.onBrand,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.md,
  },
});
