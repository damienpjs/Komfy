/**
 * Full-screen QR scanner for the pairing code. Used by the setup wizard and the
 * Server power card. Scans in-app (works in Expo Go, unlike a komfy:// deep link
 * opened from the OS camera). Ignores non-Komfy codes and keeps scanning until a
 * valid one is found.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parsePairingCode, type PairingResult } from '../utils/pairing';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

interface Props {
  visible: boolean;
  onClose: () => void;
  onResult: (result: PairingResult) => void;
}

export function PairingScanner({ visible, onClose, onResult }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  // Reset the one-shot guard each time the scanner opens.
  useEffect(() => {
    if (visible) handled.current = false;
  }, [visible]);

  // Ask once on open if we can.
  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  const onBarcode = ({ data }: { data: string }) => {
    if (handled.current) return;
    const result = parsePairingCode(data);
    if (!result) return; // not ours → keep scanning
    handled.current = true;
    onResult(result);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcode}
          />
        ) : (
          <View style={styles.center}>
            <Text style={styles.deniedText}>{t('pairing.cameraDenied')}</Text>
            {permission?.canAskAgain !== false && (
              <Pressable
                style={({ pressed }) => [
                  styles.grantBtn,
                  pressed && { backgroundColor: colors.accentPressed },
                ]}
                onPress={requestPermission}
              >
                <Text style={styles.grantText}>{t('pairing.grantCamera')}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Overlay: title/hint at the top, a scan frame, cancel at the bottom. */}
        <View
          style={[styles.overlay, { paddingTop: insets.top + spacing.lg }]}
          pointerEvents="box-none"
        >
          <Text style={styles.title}>{t('pairing.scanTitle')}</Text>
          <Text style={styles.hint}>{t('pairing.scanHint')}</Text>
        </View>
        {permission?.granted && <View style={styles.frame} pointerEvents="none" />}
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Pressable
            style={({ pressed }) => [
              styles.cancelBtn,
              pressed && { opacity: 0.7 },
            ]}
            onPress={onClose}
          >
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  deniedText: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.md,
    textAlign: 'center',
  },
  grantBtn: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grantText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  title: {
    color: '#fff',
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.lg,
    textAlign: 'center',
  },
  hint: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  frame: {
    position: 'absolute',
    alignSelf: 'center',
    top: '30%',
    width: 240,
    height: 240,
    borderColor: colors.brand,
    borderWidth: 2,
    borderRadius: radii.lg,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  cancelBtn: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: '#fff',
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
