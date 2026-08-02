/**
 * First-launch wizard: the ComfyUI server URL is mandatory (no fallback), so
 * this screen gates the whole app until one is set — see the `hydrated &&
 * !serverUrl` check in app/_layout.tsx. Chosen UX: a successful /system_stats
 * test enables the primary "Save & continue"; a syntactically valid URL always
 * allows "Save anyway" (server may just be offline — the address is editable
 * later in Settings). Mirrors the URL block of the Settings screen.
 */

import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { testConnection } from '../api/client';
import { SERVER_URL_PLACEHOLDER, useSettings } from '../store/settings';
import { useToast } from '../store/toast';
import {
  applyPairing,
  normalizeServerUrl,
  parsePairingCode,
} from '../utils/pairing';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import { PairingScanner } from './PairingScanner';

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok'; version: string }
  | { phase: 'error'; message: string };

export function SetupWizard() {
  const { t } = useTranslation();
  const setServerUrl = useSettings((s) => s.setServerUrl);
  const showToast = useToast((s) => s.show);

  const [draft, setDraft] = useState('');
  const [test, setTest] = useState<TestState>({ phase: 'idle' });
  const [scanning, setScanning] = useState(false);
  const insets = useSafeAreaInsets();

  // Accepts a bare IP / MagicDNS host (adds http:// and :8188 when missing).
  const normalized = normalizeServerUrl(draft);
  const isValid = /^https?:\/\/.+/.test(normalized);

  // A pairing code fills serverUrl (+ supervisor URL/token) → the _layout gate
  // dismisses the wizard as soon as serverUrl becomes non-empty.
  const onPaste = async () => {
    const text = await Clipboard.getStringAsync();
    const result = text ? parsePairingCode(text) : null;
    if (!result) {
      showToast(t(text ? 'pairing.invalid' : 'pairing.pasteEmpty'));
      return;
    }
    applyPairing(result);
  };

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

  // Both paths commit the same value; the gate in _layout dismisses the wizard
  // as soon as serverUrl is non-empty.
  const commit = () => {
    if (!isValid) return;
    setServerUrl(normalized);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      <Text style={styles.brand}>Komfy</Text>
      <Text style={styles.title}>{t('setup.title')}</Text>
      <Text style={styles.subtitle}>{t('setup.subtitle')}</Text>

      <View style={styles.pairRow}>
        <Pressable
          style={({ pressed }) => [
            styles.scanBtn,
            pressed && { backgroundColor: colors.brandPressed },
          ]}
          onPress={() => setScanning(true)}
        >
          <Text style={styles.scanText}>{t('pairing.scan')}</Text>
        </Pressable>
        <Pressable
          onPress={onPaste}
          hitSlop={spacing.sm}
          style={({ pressed }) => pressed && { opacity: 0.6 }}
        >
          <Text style={styles.pasteLink}>{t('pairing.paste')}</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>{t('setup.urlLabel')}</Text>
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
        autoFocus
        keyboardType="url"
      />
      <Text style={styles.hint}>{t('setup.hint')}</Text>

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

      {test.phase === 'ok' && (
        <Text style={styles.testOk}>
          {t('settings.testOk', { version: test.version })}
        </Text>
      )}
      {test.phase === 'error' && (
        <Text style={styles.testError}>✗ {test.message}</Text>
      )}

      <Pressable
        style={({ pressed }) => [
          styles.button,
          styles.buttonPrimary,
          test.phase !== 'ok' && styles.buttonDisabled,
          pressed && { backgroundColor: colors.accentPressed },
        ]}
        onPress={commit}
        disabled={test.phase !== 'ok'}
      >
        <Text style={styles.buttonText}>{t('setup.save')}</Text>
      </Pressable>

      {/* "Save anyway": always available with a valid URL (the server may just
          be offline). Hidden once the test passes — the primary button is then
          the obvious path. */}
      {isValid && test.phase !== 'ok' && (
        <View style={styles.anywayWrap}>
          <Pressable
            onPress={commit}
            hitSlop={spacing.sm}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.anywayLink}>{t('setup.saveAnyway')}</Text>
          </Pressable>
          <Text style={styles.anywayHint}>{t('setup.saveAnywayHint')}</Text>
        </View>
      )}

      <PairingScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onResult={(result) => {
          setScanning(false);
          applyPairing(result); // sets serverUrl → the wizard dismisses itself
        }}
      />
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
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  brand: {
    color: colors.brand,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.lg,
    letterSpacing: 1,
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.xl,
    marginTop: spacing.xs,
  },
  subtitle: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    marginBottom: spacing.md,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  scanBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanText: {
    color: colors.onBrand,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  pasteLink: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
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
  button: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
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
  anywayWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  anywayLink: {
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
    textDecorationLine: 'underline',
  },
  anywayHint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
  },
});
