/**
 * Launch screen: form generated from the workflow manifest, graph patch →
 * POST /prompt → toast ("View" opens Activity); the form stays put so the
 * next variation is one tap away. The launch bar is pinned under the form
 * with the image count, the destination and the checks run before sending.
 * ComfyUI validation errors (400, node_errors) are displayed.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
import { AudioInputField } from '../../components/AudioInputField';
import { EmotionMixer } from '../../components/EmotionMixer';
import { ImageInputField } from '../../components/ImageInputField';
import { KeyframesField } from '../../components/KeyframesField';
import { VideoInputField } from '../../components/VideoInputField';
import { MaskInputField } from '../../components/MaskInputField';
import { LoraField } from '../../components/LoraField';
import { ModelField } from '../../components/ModelField';
import { ModelSourceField } from '../../components/ModelSourceField';
import { OutpaintField } from '../../components/OutpaintField';
import { OutputDirPicker } from '../../components/OutputDirPicker';
import { CountSheet, BATCH_MAX } from '../../components/CountSheet';
import { FamilySwitch } from '../../components/FamilySwitch';
import { FieldHint } from '../../components/FieldHint';
import { LaunchBar, type PreflightItem } from '../../components/LaunchBar';
import { PresetBar } from '../../components/PresetBar';
import { PresetNameDialog } from '../../components/PresetNameDialog';
import { PromptField } from '../../components/PromptField';
import { SourceSeedChip } from '../../components/SourceSeedChip';
import { ZonesField } from '../../components/ZonesField';
import type { ZoneDragScroller } from '../../components/ZonesField';
import { useBatchPrefs } from '../../store/batchPrefs';
import { useCatalogPrefs } from '../../store/catalogPrefs';
import { useFieldPrefs } from '../../store/fieldPrefs';
import { useGeneratedPrompts } from '../../store/generatedPrompts';
import { useOutputPrefs } from '../../store/outputPrefs';
import { type Preset, sameName, usePresets } from '../../store/presets';
import { usePromptPick } from '../../store/promptPick';
import { useSettings } from '../../store/settings';
import { useToast } from '../../store/toast';
import {
  applyPresetValues,
  presetValues,
  suggestPresetName,
} from '../../utils/presets';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../../theme/tokens';
import { makeStyles, useTheme } from '../../theme/theme';
import {
  accessoryId,
  KEYBOARD_ACCESSORY_ID,
} from '../../utils/formAccessory';
import { useAvailability, useNodeInfo } from '../../hooks/useAvailability';
import { memoryWarnings } from '../../workflows/preflight';
import type { SourceSeeds } from '../../workflows/match';
import { pickVariantFile, variantOf } from '../../workflows/modelVariant';
import { initialOutpaintValue } from '../../workflows/outpaint';
import { emptyKeyframes, ownedKeys } from '../../workflows/keyframes';
import { NEUTRAL_MIX } from '../../workflows/emotions';
import { legacyLoras, parseLoraList } from '../../workflows/nodeLoras';
import { entryOf } from '../../workflows/catalog';
import { getAnyWorkflow } from '../../workflows/registry';
import {
  DEFAULT_OUTPUT_DIR,
  DIMENSION_STEP,
  effectiveDimensions,
  parseNumber,
  patchGraph,
  randomSeed,
  resolveModelSource,
  validate,
} from '../../workflows/patch';
import {
  modelFieldOptions,
  modelSourceOptions,
} from '../../workflows/requirements';
import {
  ALL_ZONES_SEED_STRIDE,
  DEFAULT_GUIDE_SIZE,
  isFieldShown,
} from '../../workflows/types';
import type {
  DimensionsValue,
  FieldValues,
  LoraSelection,
  ModelSourceValue,
  OutpaintValue,
  WorkflowField,
  ZonesValue,
} from '../../workflows/types';



/**
 * Positive-prompt field key — the one a saved prompt can be dropped into.
 * Same convention infer.ts applies when naming imported fields ('prompt' vs
 * 'negative'); the instruction fields ('consigne', 'idee') are not targets.
 */
const PROMPT_FIELD_KEY = 'prompt';

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
  rememberedModels?: Record<string, string>,
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
    if (field.kind === 'model') {
      // `remember`: last file kept (the picker flags it if now missing).
      const kept = field.remember ? rememberedModels?.[field.key] : undefined;
      values[field.key] = kept ?? field.default;
    }
    if (field.kind === 'modelSource') {
      const def: ModelSourceValue = {
        mode: 'diffusion',
        checkpoint: field.defaultCheckpoint,
        unet: field.defaultUnet,
        clip: field.defaultClip,
        clipType: field.defaultClipType,
        vae: field.defaultVae,
      };
      // `remember`: last full selection kept, serialized as JSON in the same
      // per-workflow store as the model fields.
      const kept = field.remember ? rememberedModels?.[field.key] : undefined;
      let restored = def;
      if (kept) {
        try {
          restored = { ...def, ...(JSON.parse(kept) as Partial<ModelSourceValue>) };
        } catch {
          restored = def;
        }
      }
      values[field.key] = restored;
    }
    if (field.kind === 'loras') {
      // `remember`: last selection kept (JSON, same store as the model
      // fields), else the single LoRA remembered before the list existed.
      const kept = field.remember ? rememberedModels?.[field.key] : undefined;
      values[field.key] =
        (kept != null ? parseLoraList(kept) : undefined) ??
        (field.remember ? legacyLoras(field, rememberedModels) : undefined) ??
        field.default ??
        [];
    }
    if (field.kind === 'emotions') values[field.key] = [...NEUTRAL_MIX];
    if (
      field.kind === 'image' ||
      field.kind === 'mask' ||
      field.kind === 'audio' ||
      field.kind === 'video'
    )
      values[field.key] = '';
    if (field.kind === 'dimensions')
      values[field.key] = { ...field.default, inverted: false, custom: false };
    if (field.kind === 'outpaint')
      values[field.key] = initialOutpaintValue(field.defaultBudget);
    if (field.kind === 'keyframes') values[field.key] = emptyKeyframes();
    if (field.kind === 'zones')
      values[field.key] = {
        zones: [
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
  const styles = useStyles();
  const { colors } = useTheme();
  const { id, prefill, seeds } = useLocalSearchParams<{
    id: string;
    prefill?: string;
    seeds?: string;
  }>();
  const manifest = getAnyWorkflow(id ?? '');
  const catalogEntry = manifest ? entryOf(manifest.id) : undefined;
  const router = useRouter();
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const clientId = useSettings((s) => s.clientId);
  const showToast = useToast((s) => s.show);
  const rememberedSelects = useFieldPrefs(
    (s) => s.selections[manifest?.id ?? ''],
  );
  const rememberedModels = useFieldPrefs(
    (s) => s.values[manifest?.id ?? ''],
  );
  const nodeInfo = useNodeInfo();

  const [values, setValues] = useState<FieldValues>(() =>
    initialValues(
      manifest?.fields ?? [],
      prefill,
      rememberedSelects,
      rememberedModels,
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [countSheetOpen, setCountSheetOpen] = useState(false);
  const availability = useAvailability();
  /** Each field block's offset in the scroll content (scroll to an error). */
  const fieldY = useRef<Record<string, number>>({});
  /** Pristine values (no prefill, no remembered prefs): what "modified" means. */
  const defaults = useMemo(
    () => initialValues(manifest?.fields ?? []),
    [manifest],
  );
  // Advanced settings (fields flagged `advanced`): folded by default.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // A zone card is being dragged: the page must hold still under it, or the
  // scroll and the card would follow the same finger. It scrolls again, but
  // driven by the card itself once it reaches an edge (zoneScroller).
  const [zoneDrag, setZoneDrag] = useState<{ from: number; to: number } | null>(
    null,
  );
  const scrollRef = useRef<ScrollView>(null);
  const pageRef = useRef<View>(null);
  /**
   * What the zone drag needs to scroll the page itself: where the scrollable
   * area sits on screen (the gesture reports window coordinates), how far it
   * is scrolled and how far it can go.
   */
  const scrollInfo = useRef({ offset: 0, content: 0, layout: 0, top: 0, bottom: 0 });
  const measureViewport = () => {
    pageRef.current?.measureInWindow((_x, y, _w, h) => {
      scrollInfo.current.top = y;
      scrollInfo.current.bottom = y + h;
    });
  };
  const zoneScroller = useMemo<ZoneDragScroller>(
    () => ({
      viewport: () => ({
        top: scrollInfo.current.top,
        bottom: scrollInfo.current.bottom,
      }),
      offset: () => scrollInfo.current.offset,
      max: () =>
        Math.max(0, scrollInfo.current.content - scrollInfo.current.layout),
      scrollTo: (y) => {
        // Kept in sync here as well: onScroll may lag a tick behind, and the
        // next tick computes its step from this offset.
        scrollInfo.current.offset = y;
        scrollRef.current?.scrollTo({ y, animated: false });
      },
    }),
    [],
  );

  // Remix: seed(s) of the source image, offered under the seed fields
  // (SourceSeedChip) — never applied on their own, a variant keeps its new
  // seed unless the user asks for the original one.
  const sourceSeeds = useMemo<SourceSeeds>(() => {
    if (!seeds) return {};
    try {
      return JSON.parse(seeds) as SourceSeeds;
    } catch {
      return {}; // unreadable param: no offer, form untouched
    }
  }, [seeds]);

  // Prompt picked in the library: this screen stayed mounted underneath it,
  // so the pick lands here on the way back. Merged into the one field it was
  // opened for — the rest of the form is left alone — then consumed.
  const picked = usePromptPick((s) => s.text);
  const pickedField = usePromptPick((s) => s.fieldKey);
  useEffect(() => {
    if (picked == null || pickedField == null) return;
    usePromptPick.getState().clear();
    if (!manifest?.fields.some((f) => f.key === pickedField)) return;
    setValues((cur) => ({ ...cur, [pickedField]: picked }));
    showToast(t('prompts.applied'));
  }, [picked, pickedField, manifest, showToast, t]);
  // Image count: global persisted memory (AsyncStorage), recalled everywhere.
  const batchCount = useBatchPrefs((s) => s.count);
  const setBatchPref = useBatchPrefs((s) => s.setCount);
  const applyCount = (n: number) =>
    setBatchPref(Math.max(1, Math.min(BATCH_MAX, Math.round(n))));
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

  // Advanced fields render last, behind a toggle; a validation error in one
  // of them unfolds the section, or the error would stay out of sight.
  const advancedFields = manifest.fields.filter((f) => f.advanced);
  const orderedFields = [
    ...manifest.fields.filter((f) => !f.advanced),
    ...advancedFields,
  ];
  const firstAdvancedKey = advancedFields[0]?.key;
  // Fields a keyframes timeline draws at its ends (first/last image and their
  // strengths): skipped in the list, owned key → timeline key.
  const timelineOwner = new Map<string, string>();
  for (const f of manifest.fields) {
    if (f.kind === 'keyframes') for (const k of ownedKeys(f)) timelineOwner.set(k, f.key);
  }
  const showAdvanced =
    advancedOpen || advancedFields.some((f) => !!errors[f.key]);
  // Standard / GGUF switches: their exact-file picker lives in the advanced
  // section (only when the form has one).
  const variantFields = manifest.fields.filter(
    (f) => f.kind === 'model' && f.variantSwitch,
  );

  const setValue = (key: string, value: FieldValues[string]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
    // `remember` select/model field: the choice is persisted per workflow.
    const field = manifest.fields.find((f) => f.key === key);
    if (field?.kind === 'select' && field.remember && typeof value === 'number') {
      useFieldPrefs.getState().setSelection(manifest.id, key, value);
    }
    if (field?.kind === 'model' && field.remember && typeof value === 'string') {
      useFieldPrefs.getState().setValue(manifest.id, key, value);
    }
    if (field?.kind === 'modelSource' && field.remember) {
      useFieldPrefs.getState().setValue(manifest.id, key, JSON.stringify(value));
    }
    if (field?.kind === 'loras' && field.remember && Array.isArray(value)) {
      useFieldPrefs.getState().setValue(manifest.id, key, JSON.stringify(value));
    }
  };

  // Saved preset → form. The source image and mask stay as they are: a
  // preset is a way of working, reused on the next photo.
  const applyPreset = (preset: Preset) => {
    setValues((cur) => applyPresetValues(manifest.fields, cur, preset.values));
    setErrors({});
    showToast(t('presets.applied', { name: preset.name }));
  };

  const capturePreset = () => presetValues(manifest.fields, values);

  const savePreset = (name: string) => {
    const store = usePresets.getState();
    const snapshot = capturePreset();
    const commit = () => {
      store.save(manifest.id, name, snapshot);
      setSavingPreset(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(t('presets.saved', { name }));
    };
    const taken = (store.byWorkflow[manifest.id] ?? []).find((p) =>
      sameName(p.name, name),
    );
    if (!taken) return commit();
    Alert.alert(
      t('presets.overwriteTitle', { name: taken.name }),
      t('presets.overwriteBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('presets.replace'), onPress: commit },
      ],
    );
  };

  const launch = async () => {
    const validationErrors = validate(manifest, values, nodeInfo);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // After the re-render: an error in a folded advanced field unfolds it.
      const first = orderedFields.find((f) => validationErrors[f.key]);
      if (first) setTimeout(() => scrollToField(first.key), 80);
      return;
    }
    setSubmitting(true);
    try {
      const client = createClient(serverUrl);

      if (isTextResult) {
        const graph = patchGraph(manifest, values);
        const res = await client.postPrompt(graph, clientId);
        // File the job before it has produced anything: leaving the result
        // screen mid-generation then loses nothing — the WS (or the library's
        // catch-up) fills the text in later.
        useGeneratedPrompts.getState().record({
          text: null,
          workflowId: manifest.id,
          promptId: res.prompt_id,
          nodeId: manifest.textNodeId!,
        });
        useCatalogPrefs.getState().markLaunched(manifest.id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.replace(
          `/workflow/text-result?promptId=${encodeURIComponent(
            res.prompt_id,
          )}&nodeId=${encodeURIComponent(
            manifest.textNodeId!,
          )}&workflowId=${encodeURIComponent(manifest.id)}` as Href,
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
        const zonesField = manifest.fields.find((f) => f.kind === 'zones');
        if (zonesField && i > 0) {
          const zv = runValues[zonesField.key] as ZonesValue;
          if (zv.seed !== 'random') {
            // Each zone pass consumes seed..seed+n → shift by the number of
            // zones to keep the jobs distinct. In allZones mode the single
            // pass consumes one seed per DETECTED zone, a count unknown
            // until the detector runs: stride by the ceiling.
            const stride = zv.allZones
              ? ALL_ZONES_SEED_STRIDE
              : Math.max(1, zv.zones.length);
            runValues[zonesField.key] = {
              ...zv,
              seed: Number(zv.seed) + i * stride,
            };
          }
        }
        const graph = patchGraph(manifest, runValues, { outputDir });
        const res = await client.postPrompt(graph, clientId);
        firstNumber ??= res.number;
      }
      useCatalogPrefs.getState().markLaunched(manifest.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(
        batchCount > 1
          ? t('launch.jobsQueued', { count: batchCount, number: firstNumber })
          : t('launch.jobQueued', { number: firstNumber }),
        'success',
        {
          label: t('launch.view'),
          onPress: () => router.navigate('/activity' as Href),
        },
      );
    } catch (e) {
      Alert.alert(t('launch.launchFailed'), comfyErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const scrollToField = (key: string) => {
    const y = fieldY.current[key] ?? fieldY.current[timelineOwner.get(key) ?? ''];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  };

  const errorKeys = orderedFields.map((f) => f.key).filter((k) => !!errors[k]);
  const preflight: PreflightItem[] = [];
  if (errorKeys.length > 0) {
    preflight.push({
      kind: 'error',
      text: t('launch.errorsSummary', { count: errorKeys.length }),
      actionLabel: t('launch.goToField'),
      onAction: () => scrollToField(errorKeys[0]),
    });
  }
  for (const warning of memoryWarnings(manifest.id, values)) {
    preflight.push({ kind: 'warn', text: t(warning.message) });
  }

  const missing = availability?.[manifest.id];
  const advancedModified = advancedFields.filter(
    (f) => JSON.stringify(values[f.key]) !== JSON.stringify(defaults[f.key]),
  ).length;

  return (
    <View style={{ flex: 1 }} ref={pageRef} onLayout={measureViewport}>
      <Stack.Screen
        options={{ title: catalogEntry ? t(catalogEntry.name) : t(manifest.name) }}
      />
      <ScrollView
        ref={scrollRef}
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        // The page holds still under a dragged zone card, but the card may
        // still drive it from the edges (zoneScroller) — hence the offset
        // and content-size tracking below.
        scrollEnabled={zoneDrag == null}
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollInfo.current.offset = e.nativeEvent.contentOffset.y;
        }}
        onContentSizeChange={(_w, h) => {
          scrollInfo.current.content = h;
        }}
        onLayout={(e) => {
          scrollInfo.current.layout = e.nativeEvent.layout.height;
          measureViewport();
        }}
        // The keyboard "docks" under the active field: the scrollable area
        // shrinks when the keyboard opens and scrolls to the field (iOS).
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.description}>{t(manifest.description)}</Text>

        <FamilySwitch manifest={manifest} values={values} />

        {missing && !missing.ok && (
          <View style={styles.missingBanner} accessibilityRole="alert">
            <Ionicons name="warning-outline" size={18} color={colors.warning} />
            <View style={styles.missingText}>
              <Text style={styles.missingTitle}>{t('availability.title')}</Text>
              {missing.missingNodes.length > 0 && (
                <Text style={styles.missingBody}>
                  {t('availability.missingNodes', {
                    list: missing.missingNodes.join('\n'),
                  })}
                </Text>
              )}
              {missing.missingValues.length > 0 && (
                <Text style={styles.missingBody}>
                  {t('availability.missingModels', {
                    list: [...new Set(missing.missingValues.map((v) => v.value))].join('\n'),
                  })}
                </Text>
              )}
            </View>
          </View>
        )}

        <PresetBar
          workflowId={manifest.id}
          onApply={applyPreset}
          capture={capturePreset}
          onSave={() => setSavingPreset(true)}
        />

        {orderedFields.map((field) => {
          const advancedHeader =
            field.key === firstAdvancedKey ? (
              <Fragment key="advanced-header">
                <Pressable
                  style={({ pressed }) => [
                    styles.advancedToggle,
                    pressed && { opacity: 0.6 },
                  ]}
                  onPress={() => setAdvancedOpen((o) => !o)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showAdvanced }}
                >
                  <Ionicons
                    name={showAdvanced ? 'chevron-down' : 'chevron-forward'}
                    size={16}
                    color={colors.accent}
                  />
                  <View style={styles.advancedTexts}>
                    <Text style={styles.advancedToggleText}>
                      {t('launch.advanced')}
                    </Text>
                    <Text style={styles.advancedSummary}>
                      {t('launch.advancedSummary', { count: advancedFields.length })}
                      {advancedModified > 0
                        ? ` · ${t('launch.advancedModified', { count: advancedModified })}`
                        : ''}
                    </Text>
                  </View>
                  {advancedModified > 0 && <View style={styles.modifiedDot} />}
                </Pressable>
                {showAdvanced &&
                  variantFields.map(
                    (vf) =>
                      vf.kind === 'model' && (
                        <View key={`${vf.key}-file`} style={styles.fieldBlock}>
                          <Text style={styles.label}>
                            {t('wf.common.modelFile')}
                          </Text>
                          <ModelField
                            field={vf}
                            value={
                              typeof values[vf.key] === 'string'
                                ? (values[vf.key] as string)
                                : vf.default
                            }
                            options={modelFieldOptions(manifest, vf, nodeInfo)}
                            onChange={(v) => setValue(vf.key, v)}
                          />
                        </View>
                      ),
                  )}
              </Fragment>
            ) : null;
          // Conditional field: hidden until its controlling field matches
          // (e.g. the distilled strengths appear only when the toggle is On).
          if (
            (field.advanced && !showAdvanced) ||
            !isFieldShown(field, values) ||
            timelineOwner.has(field.key)
          ) {
            return advancedHeader;
          }
          return (
          <Fragment key={field.key}>
          {advancedHeader}
          <View
            style={styles.fieldBlock}
            onLayout={(e) => {
              fieldY.current[field.key] = e.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.label}>{t(field.label)}</Text>

            {field.kind === 'zones' && (
              <ZonesField
                field={field}
                value={values[field.key] as ZonesValue}
                onChange={(v) => setValue(field.key, v)}
                sourceSeed={sourceSeeds[field.key]}
                baseDilation={
                  field.dilation
                    ? parseNumber(values[field.dilation.fieldKey])
                    : undefined
                }
                onDragChange={setZoneDrag}
                scroller={zoneScroller}
              />
            )}

            {field.kind === 'keyframes' && (
              <KeyframesField
                field={field}
                values={values}
                errors={errors}
                onChange={setValue}
              />
            )}

            {field.kind === 'image' && (
              <ImageInputField
                value={String(values[field.key] ?? '')}
                onChange={(name) => setValue(field.key, name)}
              />
            )}

            {field.kind === 'audio' && (
              <AudioInputField
                value={String(values[field.key] ?? '')}
                onChange={(name) => setValue(field.key, name)}
                maxSeconds={field.maxSeconds}
              />
            )}

            {field.kind === 'emotions' && (
              <EmotionMixer
                value={
                  Array.isArray(values[field.key])
                    ? (values[field.key] as number[])
                    : [...NEUTRAL_MIX]
                }
                onChange={(mix) => setValue(field.key, mix)}
              />
            )}

            {field.kind === 'video' && (
              <VideoInputField
                value={String(values[field.key] ?? '')}
                onChange={(name) => setValue(field.key, name)}
                upscaleEstimate={field.upscaleEstimate}
              />
            )}

            {field.kind === 'outpaint' && (
              <OutpaintField
                field={field}
                value={
                  (values[field.key] as OutpaintValue | undefined) ??
                  initialOutpaintValue(field.defaultBudget)
                }
                onChange={(v) => setValue(field.key, v)}
                sourceFilename={String(values[field.sourceKey] ?? '')}
              />
            )}

            {field.kind === 'mask' && (
              <MaskInputField
                value={String(values[field.key] ?? '')}
                onChange={(name) => setValue(field.key, name)}
                sourceFilename={String(values[field.sourceKey] ?? '')}
              />
            )}

            {field.kind === 'text' && field.multiline && (
              <PromptField
                label={t(field.label)}
                value={String(values[field.key] ?? '')}
                onChange={(text) => setValue(field.key, text)}
                placeholder={field.placeholder ? t(field.placeholder) : undefined}
                onPickSaved={
                  field.key === PROMPT_FIELD_KEY
                    ? () =>
                        router.push(
                          `/prompts?pick=${encodeURIComponent(
                            field.key,
                          )}` as Href,
                        )
                    : undefined
                }
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
              <>
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
                    placeholder={t('zones.randomSeed')}
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
                <SourceSeedChip
                  seed={sourceSeeds[field.key]}
                  current={values[field.key] as number | string | undefined}
                  onReuse={(seed) => setValue(field.key, seed)}
                />
              </>
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
                        thumbColor={colors.switchThumb}
                      />
                    </View>
                    <Text style={styles.dimSummary}>
                      → {eff.width} × {eff.height}
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

            {field.kind === 'model' && field.variantSwitch &&
              (() => {
                // Standard / GGUF: each side resolves to a server file.
                const options = modelFieldOptions(manifest, field, nodeInfo);
                const current =
                  typeof values[field.key] === 'string'
                    ? (values[field.key] as string)
                    : field.default;
                const active = variantOf(current);
                const ggufFile = pickVariantFile('gguf', options, current, field.default);
                const missing = options != null && !options.includes(current);
                return (
                  <>
                    <View style={styles.segmentRow}>
                      {(['standard', 'gguf'] as const).map((variant) => {
                        const file = pickVariantFile(
                          variant,
                          options,
                          current,
                          field.default,
                        );
                        const selected = active === variant;
                        return (
                          <Pressable
                            key={variant}
                            disabled={!file}
                            style={[
                              styles.segment,
                              selected && styles.segmentSelected,
                              !file && styles.segmentDisabled,
                            ]}
                            onPress={() => file && setValue(field.key, file)}
                          >
                            <Text
                              style={[
                                styles.segmentText,
                                selected && styles.segmentTextSelected,
                              ]}
                            >
                              {t(
                                variant === 'gguf'
                                  ? 'model.ggufChip'
                                  : 'model.standard',
                              )}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {missing && (
                      <Text style={styles.fieldError}>{t('model.missing')}</Text>
                    )}
                    {options != null && !ggufFile && (
                      <Text style={styles.hint}>{t('model.ggufUnavailable')}</Text>
                    )}
                  </>
                );
              })()}

            {field.kind === 'model' && !field.variantSwitch && (
              <ModelField
                field={field}
                value={
                  typeof values[field.key] === 'string'
                    ? (values[field.key] as string)
                    : field.default
                }
                options={modelFieldOptions(manifest, field, nodeInfo)}
                onChange={(v) => setValue(field.key, v)}
              />
            )}

            {field.kind === 'modelSource' && (
              <ModelSourceField
                field={field}
                value={resolveModelSource(field, values[field.key])}
                options={modelSourceOptions(manifest, field, nodeInfo)}
                onChange={(v) => setValue(field.key, v)}
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

            {field.hint && !errors[field.key] && <FieldHint text={t(field.hint)} />}
            {!!errors[field.key] && (
              <Text style={styles.fieldError}>{errors[field.key]}</Text>
            )}
          </View>
          </Fragment>
          );
        })}

        <PresetNameDialog
          visible={savingPreset}
          title={t('presets.saveTitle')}
          initialName={
            savingPreset ? suggestPresetName(manifest.fields, values) : ''
          }
          note={t('presets.localNote')}
          onCancel={() => setSavingPreset(false)}
          onSubmit={savePreset}
        />

        <OutputDirPicker
          visible={dirPickerOpen}
          initial={outputDir}
          onSelect={(dir) => manifest && setOutputDir(manifest.id, dir)}
          onClose={() => setDirPickerOpen(false)}
        />
      </ScrollView>

      <LaunchBar
        batch={
          isTextResult
            ? undefined
            : {
                count: batchCount,
                output: manifest.output ?? 'image',
                onCountPress: () => setCountSheetOpen(true),
                destination: `${outputDir === '' ? 'output' : outputDir}/`,
                onDestinationPress: () => setDirPickerOpen(true),
              }
        }
        submitting={submitting}
        onLaunch={launch}
        preflight={preflight}
      />

      <CountSheet
        visible={countSheetOpen}
        count={batchCount}
        onChange={applyCount}
        onClose={() => setCountSheetOpen(false)}
        output={manifest.output ?? 'image'}
      />

      {/* Dragged zone card: where it stands, pinned to the screen — the list
          under the finger scrolls, this does not. */}
      {zoneDrag && (
        <View pointerEvents="none" style={styles.zoneDragBanner}>
          <Text style={styles.zoneDragBannerText}>
            {t('zones.dragBanner', {
              from: zoneDrag.from + 1,
              to: zoneDrag.to + 1,
            })}
          </Text>
        </View>
      )}

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

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
  },
  // Sits above the page, out of the scroll, low enough to stay clear of the
  // card being dragged around the middle of the screen.
  zoneDragBanner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.accent,
    borderWidth: 1,
    backgroundColor: colors.bgElevated,
  },
  zoneDragBannerText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  center: {
    flex: 1,
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
  segmentDisabled: {
    opacity: 0.4,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  advancedToggleText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
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
  missingBanner: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    padding: spacing.md - 4,
    borderRadius: radii.md,
    backgroundColor: colors.warningSoft,
  },
  missingText: {
    flex: 1,
    gap: spacing.xs,
  },
  missingTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  missingBody: {
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  advancedTexts: {
    flex: 1,
    gap: 2,
  },
  advancedSummary: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  modifiedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
}));
