/**
 * Supervisor access, in the Connection group of Settings: the pairing QR
 * (or a pasted code) fills both fields at once; the address and token can
 * also be typed. Fields commit on blur.
 */

import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useSupervisor } from '../hooks/useSupervisor';
import { useSettings } from '../store/settings';
import { useToast } from '../store/toast';
import { makeStyles, useTheme } from '../theme/theme';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { applyPairing, parsePairingCode, type PairingResult } from '../utils/pairing';
import { PairingScanner } from './PairingScanner';

export function SupervisorPairing() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { effectiveUrl } = useSupervisor();
  const showToast = useToast((s) => s.show);

  const supervisorUrl = useSettings((s) => s.supervisorUrl);
  const supervisorToken = useSettings((s) => s.supervisorToken);
  const setSupervisorUrl = useSettings((s) => s.setSupervisorUrl);
  const setSupervisorToken = useSettings((s) => s.setSupervisorToken);

  const [urlDraft, setUrlDraft] = useState(supervisorUrl);
  const [tokenDraft, setTokenDraft] = useState(supervisorToken);
  const [scanning, setScanning] = useState(false);

  // Follow the store when it changes from outside this group, e.g. the
  // `komfy://setup` deep link applied in src/app/_layout.tsx.
  useEffect(() => setUrlDraft(supervisorUrl), [supervisorUrl]);
  useEffect(() => setTokenDraft(supervisorToken), [supervisorToken]);

  const applyAndSync = (result: PairingResult) => {
    applyPairing(result);
    if (result.supervisorUrl) setUrlDraft(result.supervisorUrl);
    if (result.token) setTokenDraft(result.token);
    showToast(t('pairing.applied'));
  };

  const onPaste = async () => {
    const text = await Clipboard.getStringAsync();
    const result = text ? parsePairingCode(text) : null;
    if (!result) {
      showToast(t(text ? 'pairing.invalid' : 'pairing.pasteEmpty'));
      return;
    }
    applyAndSync(result);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.pairRow}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setScanning(true)}
          style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.85 }]}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            <Rect x={4} y={4} width={6} height={6} rx={1} stroke={colors.onStrong} strokeWidth={2} fill="none" />
            <Rect x={14} y={4} width={6} height={6} rx={1} stroke={colors.onStrong} strokeWidth={2} fill="none" />
            <Rect x={4} y={14} width={6} height={6} rx={1} stroke={colors.onStrong} strokeWidth={2} fill="none" />
            <Path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" stroke={colors.onStrong} strokeWidth={2} />
          </Svg>
          <Text style={styles.scanText}>{t('pairing.scan')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onPaste}
          style={({ pressed }) => [styles.pasteBtn, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.pasteText}>{t('pairing.paste')}</Text>
        </Pressable>
      </View>

      <Text style={styles.label}>{t('supervisor.supervisorUrl')}</Text>
      <TextInput
        style={styles.input}
        value={urlDraft}
        onChangeText={setUrlDraft}
        onEndEditing={() => setSupervisorUrl(urlDraft)}
        onBlur={() => setSupervisorUrl(urlDraft)}
        placeholder={effectiveUrl || 'http://100.x.y.z:8189'}
        placeholderTextColor={colors.textDisabled}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.hint}>{t('supervisor.supervisorUrlHint')}</Text>

      <Text style={[styles.label, styles.labelSpaced]}>{t('supervisor.token')}</Text>
      <TextInput
        style={styles.input}
        value={tokenDraft}
        onChangeText={setTokenDraft}
        onEndEditing={() => setSupervisorToken(tokenDraft)}
        onBlur={() => setSupervisorToken(tokenDraft)}
        placeholder="…"
        placeholderTextColor={colors.textDisabled}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      <Text style={styles.hint}>{t('supervisor.tokenHint')}</Text>

      <PairingScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onResult={(result) => {
          setScanning(false);
          applyAndSync(result);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    gap: spacing.xs + 2,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  scanBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md + 2,
    backgroundColor: colors.strong,
  },
  scanText: {
    color: colors.onStrong,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  pasteBtn: {
    minHeight: MIN_TOUCH_TARGET + 4,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md + 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pasteText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  label: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: 14,
  },
  labelSpaced: {
    marginTop: spacing.sm,
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
}));
