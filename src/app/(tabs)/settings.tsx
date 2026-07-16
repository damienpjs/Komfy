/**
 * Settings screen: server URL, connection test, language selector,
 * AsyncStorage persistence via the settings store.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ComfyApiError, createClient, testConnection } from '../../api/client';
import { queryClient } from '../../api/queryClient';
import type { Lang } from '../../i18n';
import { DEFAULT_SERVER_URL, useSettings } from '../../store/settings';
import { useConnection } from '../../store/connection';
import { useToast } from '../../store/toast';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../../theme/tokens';
import { formatBytes } from '../../utils/format';

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok'; version: string }
  | { phase: 'error'; message: string };

const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

export default function Settings() {
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const setServerUrl = useSettings((s) => s.setServerUrl);
  const clientId = useSettings((s) => s.clientId);
  const previewsEnabled = useSettings((s) => s.previewsEnabled);
  const setPreviewsEnabled = useSettings((s) => s.setPreviewsEnabled);
  const language = useSettings((s) => s.language);
  const setLanguage = useSettings((s) => s.setLanguage);
  const online = useConnection((s) => s.online);
  const showToast = useToast((s) => s.show);

  const [draft, setDraft] = useState(serverUrl);
  const [test, setTest] = useState<TestState>({ phase: 'idle' });
  const [emptying, setEmptying] = useState(false);

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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      <Text style={styles.label}>{t('settings.serverUrl')}</Text>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          setTest({ phase: 'idle' });
        }}
        placeholder={DEFAULT_SERVER_URL}
        placeholderTextColor={colors.textDisabled}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.hint}>{t('settings.serverHint')}</Text>

      <View style={styles.buttonRow}>
        <Pressable
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
          style={({ pressed }) => [
            styles.button,
            styles.buttonPrimary,
            (!isValid || !isDirty) && styles.buttonDisabled,
            pressed && { backgroundColor: colors.accentPressed },
          ]}
          onPress={save}
          disabled={!isValid || !isDirty}
        >
          <Text style={styles.buttonText}>
            {isDirty ? t('common.save') : t('settings.saved')}
          </Text>
        </Pressable>
      </View>

      {test.phase === 'ok' && (
        <Text style={styles.testOk}>
          {t('settings.testOk', { version: test.version })}
        </Text>
      )}
      {test.phase === 'error' && (
        <Text style={styles.testError}>✗ {test.message}</Text>
      )}

      <View style={styles.toggleRow}>
        <View style={styles.toggleTextWrap}>
          <Text style={styles.toggleLabel}>{t('settings.previews')}</Text>
          <Text style={styles.toggleHint}>{t('settings.previewsHint')}</Text>
        </View>
        <Switch
          value={previewsEnabled}
          onValueChange={setPreviewsEnabled}
          trackColor={{ false: colors.bgElevated, true: colors.accent }}
          thumbColor={colors.text}
        />
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{t('settings.language')}</Text>
        <View style={styles.langRow}>
          {LANGUAGES.map(({ code, label }) => (
            <Pressable
              key={code}
              style={[
                styles.langButton,
                language === code && styles.langButtonActive,
              ]}
              onPress={() => setLanguage(code)}
            >
              <Text
                style={[
                  styles.langText,
                  language === code && styles.langTextActive,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {online === true && (
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextWrap}>
            <Text style={styles.toggleLabel}>{t('settings.trashTitle')}</Text>
            <Text style={styles.toggleHint}>
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
      )}

      <Link href="/ws-log" style={styles.wsLogLink}>
        {t('settings.wsLog')}
      </Link>

      <View style={styles.metaCard}>
        <Text style={styles.metaLabel}>client_id</Text>
        <Text style={styles.metaValue}>{clientId}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flexGrow: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  label: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  button: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
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
  testOk: {
    color: colors.success,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  testError: {
    color: colors.danger,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  toggleTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  toggleLabel: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  toggleHint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  langRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  langButton: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  langText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  langTextActive: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
  },
  trashBtn: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.danger,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trashBtnText: {
    color: colors.danger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  wsLogLink: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
    paddingVertical: spacing.sm,
  },
  metaCard: {
    marginTop: 'auto',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  metaLabel: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  metaValue: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
});
