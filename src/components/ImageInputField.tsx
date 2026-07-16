/**
 * Form input image field: pick from the phone's photo library → immediate
 * upload to /upload/image (ComfyUI input folder) → the value becomes the
 * server-side filename (patched into LoadImage).
 * Preview served via /view?type=input (also works for a remix prefill).
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createClient } from '../api/client';
import { useSettings } from '../store/settings';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

/**
 * Guard against filling up the output volume: locally reject an upload
 * that is too heavy before sending it. (Robust protection would live on
 * the server; this at least prevents accidents from the app.)
 */
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30 MB

interface Props {
  /** Server-side filename ('' = none). */
  value: string;
  onChange: (serverName: string) => void;
}

export function ImageInputField({ value, onChange }: Props) {
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const [uploading, setUploading] = useState(false);

  const pick = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        t('imageInput.accessDenied'),
        t('imageInput.accessDeniedBody'),
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    if (asset.fileSize != null && asset.fileSize > MAX_UPLOAD_BYTES) {
      Alert.alert(
        t('imageInput.tooLarge'),
        t('imageInput.tooLargeBody', {
          size: (asset.fileSize / 1024 / 1024).toFixed(1),
          limit: MAX_UPLOAD_BYTES / 1024 / 1024,
        }),
      );
      return;
    }
    const ext = asset.uri.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
    const name = asset.fileName ?? `komfy_input_${Date.now()}.${ext}`;

    setUploading(true);
    try {
      const uploaded = await createClient(serverUrl).uploadImage(
        asset.uri,
        name,
      );
      onChange(uploaded.name);
    } catch (e) {
      Alert.alert(
        t('imageInput.uploadFailed'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setUploading(false);
    }
  };

  if (value === '') {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.emptyBtn,
          pressed && { backgroundColor: colors.surfacePressed },
          uploading && { opacity: 0.5 },
        ]}
        onPress={pick}
        disabled={uploading}
      >
        {uploading ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <Ionicons name="image-outline" size={20} color={colors.accent} />
            <Text style={styles.emptyText}>{t('imageInput.choose')}</Text>
          </>
        )}
      </Pressable>
    );
  }

  return (
    <View style={styles.filledRow}>
      <Image
        source={{ uri: createClient(serverUrl).viewUrl(value, '', 'input') }}
        style={styles.thumb}
        contentFit="cover"
        cachePolicy="disk"
      />
      <Text style={styles.filename} numberOfLines={2}>
        {value}
      </Text>
      <View style={styles.actions}>
        <Pressable
          onPress={pick}
          disabled={uploading}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconBtn,
            pressed && { backgroundColor: colors.surfacePressed },
          ]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="swap-horizontal" size={18} color={colors.accent} />
          )}
        </Pressable>
        <Pressable
          onPress={() => onChange('')}
          hitSlop={8}
          style={({ pressed }) => [
            styles.iconBtn,
            pressed && { backgroundColor: colors.surfacePressed },
          ]}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 72,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  emptyText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  filledRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radii.sm,
    backgroundColor: colors.bgElevated,
  },
  filename: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconBtn: {
    width: MIN_TOUCH_TARGET - 8,
    height: MIN_TOUCH_TARGET - 8,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.border,
    borderWidth: 1,
  },
});
