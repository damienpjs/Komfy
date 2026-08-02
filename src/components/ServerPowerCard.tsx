/**
 * Settings card: remote ComfyUI power (via the supervisor) + a link to the
 * live console. Three states from useSupervisor (unreachable / off / on) drive
 * the status line and the single action button. The supervisor URL/token can
 * be entered by hand here (Phase 2) or filled by the pairing QR (Phase 3).
 */

import * as Clipboard from 'expo-clipboard';
import { Link, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SupervisorError } from '../api/supervisor';
import { useSupervisor, type PowerState } from '../hooks/useSupervisor';
import { useSettings } from '../store/settings';
import { useToast } from '../store/toast';
import {
  applyPairing,
  parsePairingCode,
  type PairingResult,
} from '../utils/pairing';
import { PairingScanner } from './PairingScanner';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

const DOT_COLOR: Record<PowerState, string> = {
  on: colors.success,
  off: colors.warning,
  starting: colors.brand,
  unreachable: colors.danger,
  loading: colors.textDisabled,
  unconfigured: colors.textDisabled,
};

export function ServerPowerCard() {
  const { t } = useTranslation();
  const { state, hasToken, effectiveUrl, start, stop } = useSupervisor();
  const showToast = useToast((s) => s.show);

  const supervisorUrl = useSettings((s) => s.supervisorUrl);
  const supervisorToken = useSettings((s) => s.supervisorToken);
  const setSupervisorUrl = useSettings((s) => s.setSupervisorUrl);
  const setSupervisorToken = useSettings((s) => s.setSupervisorToken);

  const [urlDraft, setUrlDraft] = useState(supervisorUrl);
  const [tokenDraft, setTokenDraft] = useState(supervisorToken);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

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

  const statusLabel: Record<PowerState, string> = {
    on: t('supervisor.on'),
    off: t('supervisor.off'),
    starting: t('supervisor.starting'),
    unreachable: t('supervisor.unreachable'),
    loading: t('supervisor.checking'),
    unconfigured: t('supervisor.title'),
  };

  // Hint under the status line: token-missing takes priority when reachable.
  let hint = '';
  if (state === 'unconfigured') hint = t('supervisor.notConfigured');
  else if (state === 'unreachable') hint = t('supervisor.unreachableHint');
  else if ((state === 'off' || state === 'on') && !hasToken)
    hint = t('supervisor.needsToken');
  else if (state === 'off') hint = t('supervisor.offHint');
  else if (state === 'on') hint = t('supervisor.onHint');

  const onTurnOn = async () => {
    setBusy(true);
    try {
      await start();
    } catch (e) {
      if (e instanceof SupervisorError && e.status === 409) {
        showToast(t('supervisor.alreadyRunning'));
      } else {
        Alert.alert(
          t('supervisor.startFailed'),
          e instanceof Error ? e.message : String(e),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onTurnOff = () => {
    Alert.alert(t('supervisor.turnOffTitle'), t('supervisor.turnOffBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('supervisor.turnOff'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await stop();
          } catch (e) {
            Alert.alert(
              t('supervisor.stopFailed'),
              e instanceof Error ? e.message : String(e),
            );
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const canControl = hasToken && !busy;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.statusWrap}>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: DOT_COLOR[state] }]} />
            <Text style={styles.title}>{statusLabel[state]}</Text>
            {(state === 'starting' || busy) && (
              <ActivityIndicator size="small" color={colors.textMuted} />
            )}
          </View>
          {hint !== '' && <Text style={styles.hint}>{hint}</Text>}
        </View>

        {/* Buttons stay visible but disabled without a token (clearer than
            hiding — it shows the action exists, the hint says what's missing). */}
        {state === 'off' && (
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              styles.turnOn,
              !canControl && styles.disabled,
              pressed && { backgroundColor: colors.brandPressed },
            ]}
            onPress={onTurnOn}
            disabled={!canControl}
          >
            <Text style={styles.turnOnText}>{t('supervisor.turnOn')}</Text>
          </Pressable>
        )}
        {(state === 'on' || state === 'starting') && (
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              styles.turnOff,
              (!canControl || state === 'starting') && styles.disabled,
              pressed && { opacity: 0.7 },
            ]}
            onPress={onTurnOff}
            disabled={!canControl || state === 'starting'}
          >
            <Text style={styles.turnOffText}>{t('supervisor.turnOff')}</Text>
          </Pressable>
        )}
      </View>

      {/* Config: supervisor URL (optional) + token. Committed on blur. */}
      <View style={styles.config}>
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
        <Text style={styles.subHint}>{t('supervisor.supervisorUrlHint')}</Text>

        <Text style={[styles.label, { marginTop: spacing.sm }]}>
          {t('supervisor.token')}
        </Text>
        <TextInput
          style={styles.input}
          value={tokenDraft}
          onChangeText={setTokenDraft}
          onEndEditing={() => setSupervisorToken(tokenDraft)}
          onBlur={() => setSupervisorToken(tokenDraft)}
          placeholder="—"
          placeholderTextColor={colors.textDisabled}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <Text style={styles.subHint}>{t('supervisor.tokenHint')}</Text>
      </View>

      {/* Route exists (app/comfy-console.tsx); the `as Href` cast bridges the
          typed-routes union until expo regenerates it on the next `expo start`. */}
      {effectiveUrl && supervisorToken ? (
        <Link href={'/comfy-console' as Href} style={styles.consoleLink}>
          {t('supervisor.openConsole')}
        </Link>
      ) : null}

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

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  actionBtn: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  turnOn: {
    backgroundColor: colors.brand,
  },
  turnOnText: {
    color: colors.onBrand,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  turnOff: {
    borderColor: colors.danger,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  turnOffText: {
    color: colors.danger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  disabled: {
    opacity: 0.4,
  },
  config: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xs,
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
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  subHint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  consoleLink: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
    paddingVertical: spacing.xs,
  },
});
