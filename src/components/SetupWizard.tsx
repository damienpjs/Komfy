/**
 * First-launch wizard: the ComfyUI server URL is mandatory (no fallback), so
 * this screen gates the whole app until one is set — see the `hydrated &&
 * !serverUrl` check in app/_layout.tsx.
 *
 * The pairing QR comes first: one scan fills the server URL and the
 * supervisor access, nothing to type. Pasting a code or typing the address
 * stay one tap away; the address form only opens on request, so no keyboard
 * covers the QR option on launch. Typed path: a successful /system_stats test
 * enables "Save & continue"; a valid URL always allows "Save anyway" (the
 * server may just be offline). Below, what gets checked once connected.
 */

import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { testConnection } from '../api/client';
import { SERVER_URL_PLACEHOLDER, useSettings } from '../store/settings';
import { useToast } from '../store/toast';
import {
  applyPairing,
  normalizeServerUrl,
  parsePairingCode,
} from '../utils/pairing';
import { MIN_TOUCH_TARGET, radii, signature, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { DotGrid } from './DotGrid';
import { PairingScanner } from './PairingScanner';

type TestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok'; version: string }
  | { phase: 'error'; message: string };

const CHECKS: { title: string; sub: string; tag: string }[] = [
  { title: 'setup.checkComfy', sub: 'setup.checkComfySub', tag: 'setup.required' },
  { title: 'setup.checkSupervisor', sub: 'setup.checkSupervisorSub', tag: 'setup.optional' },
  { title: 'setup.checkListing', sub: 'setup.checkListingSub', tag: 'setup.optional' },
];

export function SetupWizard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const setServerUrl = useSettings((s) => s.setServerUrl);
  const showToast = useToast((s) => s.show);

  const [draft, setDraft] = useState('');
  const [test, setTest] = useState<TestState>({ phase: 'idle' });
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
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

  const icon = (d: React.ReactNode) => (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      {d}
    </Svg>
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
    >
      <View style={styles.hero}>
        <DotGrid color={signature.dot} spacing={14} />
        <Image
          source={require('../../assets/images/icon.png')}
          style={styles.appIcon}
          accessibilityLabel="Komfy"
        />
        <Text style={styles.title} accessibilityRole="header">
          {t('setup.title')}
        </Text>
        <Text style={styles.subtitle}>{t('setup.subtitle')}</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => setScanning(true)}
        style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.85 }]}
      >
        <Svg width={28} height={28} viewBox="0 0 24 24">
          <Rect x={3.5} y={3.5} width={6.5} height={6.5} rx={1.2} stroke={colors.onStrong} strokeWidth={1.8} fill="none" />
          <Rect x={14} y={3.5} width={6.5} height={6.5} rx={1.2} stroke={colors.onStrong} strokeWidth={1.8} fill="none" />
          <Rect x={3.5} y={14} width={6.5} height={6.5} rx={1.2} stroke={colors.onStrong} strokeWidth={1.8} fill="none" />
          <Path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5h1.5M18.5 14h2" stroke={colors.onStrong} strokeWidth={1.8} />
        </Svg>
        <View style={styles.scanTexts}>
          <Text style={styles.scanTitle}>{t('setup.scan')}</Text>
          <Text style={styles.scanSub}>{t('setup.scanSub')}</Text>
        </View>
      </Pressable>

      <View style={styles.altRow}>
        <Pressable
          accessibilityRole="button"
          onPress={onPaste}
          style={({ pressed }) => [styles.altBtn, pressed && { backgroundColor: colors.surfacePressed }]}
        >
          {icon(
            <>
              <Rect x={6} y={4} width={12} height={17} rx={2.5} stroke={colors.text} strokeWidth={1.8} fill="none" />
              <Path d="M9.5 4V3h5v1" stroke={colors.text} strokeWidth={1.8} fill="none" />
            </>,
          )}
          <Text style={styles.altText}>{t('pairing.paste')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: manual }}
          onPress={() => setManual((m) => !m)}
          style={({ pressed }) => [
            styles.altBtn,
            manual && styles.altBtnOn,
            pressed && { backgroundColor: colors.surfacePressed },
          ]}
        >
          {icon(
            <Path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" stroke={colors.text} strokeWidth={1.8} fill="none" strokeLinejoin="round" />,
          )}
          <Text style={styles.altText}>{t('setup.typeAddress')}</Text>
        </Pressable>
      </View>

      {manual && (
        <View style={styles.form}>
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
            // Opened on purpose by "Type the address": the keyboard is wanted.
            autoFocus
            keyboardType="url"
          />
          <Text style={styles.hint}>{t('setup.hint')}</Text>

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
                test.phase !== 'ok' && styles.buttonDisabled,
                pressed && { opacity: 0.85 },
              ]}
              onPress={commit}
              disabled={test.phase !== 'ok'}
            >
              <Text style={[styles.buttonText, styles.buttonTextPrimary]}>
                {t('setup.save')}
              </Text>
            </Pressable>
          </View>

          {test.phase === 'ok' && (
            <Text style={styles.testOk}>{t('settings.testOk', { version: test.version })}</Text>
          )}
          {test.phase === 'error' && <Text style={styles.testError}>{test.message}</Text>}

          {/* "Save anyway": always available with a valid URL (the server may
              just be offline). Hidden once the test passes. */}
          {isValid && test.phase !== 'ok' && (
            <View style={styles.anywayWrap}>
              <Pressable
                accessibilityRole="button"
                onPress={commit}
                style={({ pressed }) => [styles.anywayBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.anywayLink}>{t('setup.saveAnyway')}</Text>
              </Pressable>
              <Text style={styles.hint}>{t('setup.saveAnywayHint')}</Text>
            </View>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>{t('setup.checkedAfter')}</Text>
      <View style={styles.group}>
        {CHECKS.map((check, i) => (
          <View key={check.title} style={[styles.row, i > 0 && styles.separated]}>
            <View style={styles.rowTexts}>
              <Text style={styles.rowTitle}>{t(check.title)}</Text>
              <Text style={styles.rowSub}>{t(check.sub)}</Text>
            </View>
            <Text style={styles.tag}>{t(check.tag)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.hint}>{t('setup.checkedHint')}</Text>

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

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  hero: {
    overflow: 'hidden',
    gap: spacing.md - 2,
    paddingVertical: spacing.lg - 2,
    paddingHorizontal: spacing.md + 4,
    borderRadius: radii.lg + 4,
    backgroundColor: signature.bg,
    borderWidth: 1,
    borderColor: signature.border,
  },
  appIcon: {
    width: 64,
    height: 64,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: signature.border,
  },
  title: {
    color: signature.text,
    fontFamily: typography.uiBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  subtitle: {
    color: signature.textMuted,
    fontFamily: typography.ui,
    fontSize: 14,
    lineHeight: 20,
  },
  scanBtn: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.strong,
  },
  scanTexts: {
    flex: 1,
    gap: 2,
  },
  scanTitle: {
    color: colors.onStrong,
    fontFamily: typography.uiBold,
    fontSize: 17,
    lineHeight: 22,
  },
  scanSub: {
    color: colors.onStrong,
    opacity: 0.8,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  altRow: {
    flexDirection: 'row',
    gap: spacing.sm + 2,
    marginTop: -spacing.xs,
  },
  altBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md + 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  altBtnOn: {
    borderColor: colors.text,
  },
  altText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 14,
  },
  form: {
    gap: spacing.xs + 2,
    padding: spacing.md - 2,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md + 2,
  },
  buttonPrimary: {
    backgroundColor: colors.strong,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
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
  anywayWrap: {
    gap: 2,
  },
  anywayBtn: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  anywayLink: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  sectionTitle: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  group: {
    overflow: 'hidden',
    marginTop: -spacing.xs,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    minHeight: 60,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md - 2,
  },
  separated: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
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
  rowSub: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
  },
  tag: {
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: colors.field,
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: 11,
  },
}));
