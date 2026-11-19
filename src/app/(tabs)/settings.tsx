/**
 * Settings, grouped by subject with the server first: power and console on
 * the banner card, then Connection (ComfyUI address, supervisor pairing),
 * Generation (previews, LoRA cap), Appearance (theme, language) and Storage
 * (server trash). Persisted through the settings store.
 */

import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ComfyApiError, createClient, testConnection } from '../../api/client';
import { queryClient } from '../../api/queryClient';
import { ServerPowerCard } from '../../components/ServerPowerCard';
import { SupervisorPairing } from '../../components/SupervisorPairing';
import { useQueue } from '../../hooks/useQueue';
import type { Lang } from '../../i18n';
import {
  SERVER_URL_PLACEHOLDER,
  useSettings,
  type ThemePreference,
} from '../../store/settings';
import { useConnection } from '../../store/connection';
import { useToast } from '../../store/toast';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../../theme/tokens';
import { makeStyles, useTheme } from '../../theme/theme';
import { formatBytes } from '../../utils/format';
import Svg, { Path } from 'react-native-svg';

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok'; version: string }
  | { phase: 'error'; message: string };

const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

const LORA_CAP_MAX = 12;

/** Section title + its grouped card. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

/** Segmented control for a short list of choices. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { code: T; label: string }[];
  onChange: (code: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.seg} accessibilityRole="radiogroup">
      {options.map(({ code, label }) => {
        const on = value === code;
        return (
          <Pressable
            key={code}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync();
              onChange(code);
            }}
            style={[styles.segBtn, on && styles.segBtnOn]}
          >
            <Text style={[styles.segText, on && styles.segTextOn]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const THEMES: { code: ThemePreference; label: string }[] = [
  { code: 'auto', label: 'settings.themeAuto' },
  { code: 'light', label: 'settings.themeLight' },
  { code: 'dark', label: 'settings.themeDark' },
];

export default function Settings() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const setServerUrl = useSettings((s) => s.setServerUrl);
  const clientId = useSettings((s) => s.clientId);
  const previewsEnabled = useSettings((s) => s.previewsEnabled);
  const setPreviewsEnabled = useSettings((s) => s.setPreviewsEnabled);
  const loraMaxCount = useSettings((s) => s.loraMaxCount);
  const setLoraMaxCount = useSettings((s) => s.setLoraMaxCount);
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const themePreference = useSettings((s) => s.themePreference);
  const setThemePreference = useSettings((s) => s.setThemePreference);
  const online = useConnection((s) => s.online);
  const showToast = useToast((s) => s.show);
  const pendingCount = useQueue().query.data?.queue_pending.length ?? 0;

  const [draft, setDraft] = useState(serverUrl);
  const [test, setTest] = useState<TestState>({ phase: 'idle' });
  const [emptying, setEmptying] = useState(false);
  // Last cap, kept while the limit is off so toggling back restores it.
  const [lastCap, setLastCap] = useState(loraMaxCount ?? 4);

  // Trash contents (komfy-listing extension) — powers the "empty trash"
  // confirmation. Silent on 404/503 (button just stays disabled).
  const trash = useQuery({
    queryKey: ['trashInfo', serverUrl],
    enabled: online === true && !!serverUrl,
    retry: false,
    staleTime: 5_000,
    queryFn: () => createClient(serverUrl).trashInfo(),
  });
  const trashTotals = useMemo(() => {
    let count = 0;
    let bytes = 0;
    for (const r of Object.values(trash.data ?? {})) {
      count += r.count;
      bytes += r.bytes;
    }
    return { count, bytes };
  }, [trash.data]);

  const doEmptyTrash = async () => {
    setEmptying(true);
    try {
      const { freed } = await createClient(serverUrl).emptyTrash();
      let count = 0;
      let bytes = 0;
      for (const r of Object.values(freed)) {
        count += r.count;
        bytes += r.bytes;
      }
      showToast(
        t('settings.trashEmptied', { count, size: formatBytes(bytes) }),
      );
      queryClient.invalidateQueries({ queryKey: ['trashInfo'] });
    } catch (e) {
      if (e instanceof ComfyApiError && (e.status === 404 || e.status === 405)) {
        Alert.alert(
          t('gallery.updateExtTitle'),
          t('gallery.updateExtBody', { action: t('settings.trashEmpty') }),
        );
      } else {
        Alert.alert(
          t('settings.trashEmptyFailed'),
          e instanceof Error ? e.message : String(e),
        );
      }
    } finally {
      setEmptying(false);
    }
  };

  const confirmEmptyTrash = () => {
    Alert.alert(
      t('settings.trashConfirmTitle'),
      t('settings.trashConfirmBody', {
        count: trashTotals.count,
        size: formatBytes(trashTotals.bytes),
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.trashEmpty'),
          style: 'destructive',
          onPress: doEmptyTrash,
        },
      ],
    );
  };

  const normalized = draft.trim().replace(/\/+$/, '');
  const isValid = /^https?:\/\/.+/.test(normalized);
  const isDirty = normalized !== serverUrl;

  const runTest = async () => {
    if (!isValid) return;
    setTest({ phase: 'testing' });
    const result = await testConnection(normalized);
    setTest(
      result.ok
        ? { phase: 'ok', version: result.version }
        : { phase: 'error', message: result.error },
    );
  };

  const save = () => {
    if (!isValid) return;
    setServerUrl(normalized);
  };

  const toggleLoraLimit = (limited: boolean) =>
    setLoraMaxCount(limited ? lastCap : null);

  const stepCap = (delta: number) => {
    if (loraMaxCount == null) return;
    const next = Math.max(1, Math.min(LORA_CAP_MAX, loraMaxCount + delta));
    if (next === loraMaxCount) return;
    Haptics.selectionAsync();
    setLoraMaxCount(next);
    setLastCap(next);
  };

  const stepIcon = (d: string, disabled: boolean) => (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        d={d}
        stroke={disabled ? colors.textDisabled : colors.text}
        strokeWidth={2.2}
        strokeLinecap="round"
      />
    </Svg>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      <ServerPowerCard pendingCount={pendingCount} />

      <Section title={t('settings.sectionConnection')}>
        <View style={styles.block}>
          <Text style={styles.label}>{t('settings.serverUrl')}</Text>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              setTest({ phase: 'idle' });
            }}
            placeholder={SERVER_URL_PLACEHOLDER}
            placeholderTextColor={colors.textDisabled}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.hint}>{t('settings.serverHint')}</Text>
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                styles.buttonSecondary,
                (!isValid || test.phase === 'testing') && styles.buttonDisabled,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
              onPress={runTest}
              disabled={!isValid || test.phase === 'testing'}
            >
              {test.phase === 'testing' ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.buttonText}>{t('settings.test')}</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.button,
                styles.buttonPrimary,
                (!isValid || !isDirty) && styles.buttonDisabled,
                pressed && { opacity: 0.85 },
              ]}
              onPress={save}
              disabled={!isValid || !isDirty}
            >
              <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                {isDirty ? t('common.save') : t('settings.saved')}
              </Text>
            </Pressable>
          </View>
          {test.phase === 'ok' && (
            <Text style={styles.testOk}>{t('settings.testOk', { version: test.version })}</Text>
          )}
          {test.phase === 'error' && (
            <Text style={styles.testError}>{test.message}</Text>
          )}
        </View>
        <View style={[styles.block, styles.separated]}>
          <SupervisorPairing />
        </View>
      </Section>

      <Section title={t('settings.sectionGeneration')}>
        <View style={styles.row}>
          <View style={styles.rowTexts}>
            <Text style={styles.rowTitle}>{t('settings.previews')}</Text>
            <Text style={styles.rowHint}>{t('settings.previewsHint')}</Text>
          </View>
          <Switch
            value={previewsEnabled}
            onValueChange={setPreviewsEnabled}
            trackColor={{ false: colors.field, true: colors.accent }}
            thumbColor={colors.switchThumb}
          />
        </View>
        <View style={[styles.row, styles.separated]}>
          <View style={styles.rowTexts}>
            <Text style={styles.rowTitle}>{t('settings.loraMax')}</Text>
            <Text style={styles.rowHint}>{t('settings.loraMaxHint')}</Text>
          </View>
          <Switch
            value={loraMaxCount != null}
            onValueChange={toggleLoraLimit}
            trackColor={{ false: colors.field, true: colors.accent }}
            thumbColor={colors.switchThumb}
          />
        </View>
        {loraMaxCount != null && (
          <View style={[styles.row, styles.separated, styles.subRow]}>
            <Text style={styles.subLabel}>{t('settings.loraMaxValue')}</Text>
            <View style={styles.stepper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('launch.countLess')}
                disabled={loraMaxCount <= 1}
                onPress={() => stepCap(-1)}
                style={styles.stepBtn}
              >
                {stepIcon('M6 12h12', loraMaxCount <= 1)}
              </Pressable>
              <Text style={styles.stepValue} accessibilityLiveRegion="polite">
                {loraMaxCount}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('launch.countMore')}
                disabled={loraMaxCount >= LORA_CAP_MAX}
                onPress={() => stepCap(1)}
                style={styles.stepBtn}
              >
                {stepIcon('M12 6v12M6 12h12', loraMaxCount >= LORA_CAP_MAX)}
              </Pressable>
            </View>
          </View>
        )}
      </Section>

      <Section title={t('settings.sectionAppearance')}>
        <View style={styles.rowStacked}>
          <Text style={styles.rowTitle}>{t('settings.theme')}</Text>
          <Segmented
            value={themePreference}
            options={THEMES.map(({ code, label }) => ({ code, label: t(label) }))}
            onChange={setThemePreference}
          />
        </View>
        <View style={[styles.rowStacked, styles.separated]}>
          <Text style={styles.rowTitle}>{t('settings.language')}</Text>
          <Segmented value={language} options={LANGUAGES} onChange={setLanguage} />
        </View>
      </Section>

      {online === true && (
        <Section title={t('settings.sectionStorage')}>
          <View style={styles.row}>
            <View style={styles.rowTexts}>
              <Text style={styles.rowTitle}>{t('settings.trashTitle')}</Text>
              <Text style={styles.rowHint}>
                {trash.isLoading
                  ? t('common.loading')
                  : trashTotals.count === 0
                    ? t('settings.trashEmptyState')
                    : t('settings.trashSummary', {
                        count: trashTotals.count,
                        size: formatBytes(trashTotals.bytes),
                      })}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.trashBtn,
                (emptying || trashTotals.count === 0) && styles.buttonDisabled,
                pressed && { opacity: 0.7 },
              ]}
              onPress={confirmEmptyTrash}
              disabled={emptying || trashTotals.count === 0}
            >
              {emptying ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <Text style={styles.trashBtnText}>{t('settings.trashEmpty')}</Text>
              )}
            </Pressable>
          </View>
        </Section>
      )}

      <View style={styles.meta}>
        <Text style={styles.metaLabel}>client_id</Text>
        <Text style={styles.metaValue} selectable>
          {clientId}
        </Text>
      </View>
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  group: {
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  separated: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  block: {
    gap: spacing.xs + 2,
    padding: spacing.md - 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md - 2,
  },
  rowStacked: {
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md - 2,
  },
  subRow: {
    backgroundColor: colors.bgElevated,
    paddingLeft: spacing.lg,
  },
  rowTexts: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  rowHint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  subLabel: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: 14,
  },
  label: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: 14,
  },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radii.md,
    backgroundColor: colors.field,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: 14,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  button: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radii.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: colors.strong,
  },
  buttonSecondary: {
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  buttonTextPrimary: {
    color: colors.onStrong,
  },
  testOk: {
    color: colors.success,
    fontFamily: typography.uiMedium,
    fontSize: 14,
  },
  testError: {
    color: colors.danger,
    fontFamily: typography.uiMedium,
    fontSize: 14,
  },
  seg: {
    flexDirection: 'row',
    gap: 3,
    padding: 3,
    borderRadius: radii.md,
    backgroundColor: colors.field,
  },
  segBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md - 3,
  },
  segBtnOn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: 14,
  },
  segTextOn: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.field,
  },
  stepBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 28,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: 16,
    textAlign: 'center',
  },
  trashBtn: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
  },
  trashBtnText: {
    color: colors.danger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  meta: {
    marginTop: 'auto',
    gap: 2,
    paddingHorizontal: spacing.xs,
  },
  metaLabel: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  metaValue: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: 12,
  },
}));
