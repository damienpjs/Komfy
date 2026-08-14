/**
 * Form row for a hand-drawn inpaint mask.
 *
 * Owns the strokes (so re-opening the editor resumes the drawing rather
 * than starting over), rasterizes them at upload resolution, encodes the
 * PNG in JS and uploads it to ComfyUI's input folder — the value handed
 * back to the form is the server-side filename, exactly like the image
 * field, and gets patched into LoadImageMask.
 *
 * The mask is meaningless without its picture, so the row stays disabled
 * until the source image field holds one, and resets when that picture
 * changes (a mask drawn for another framing would land anywhere).
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Image as RNImage,
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
import {
  isMaskEmpty,
  maskDimensions,
  maskToPngBase64,
  rasterizeMask,
  type MaskStroke,
} from '../utils/maskRaster';
import { MaskEditor } from './MaskEditor';

/**
 * Long side of the uploaded mask. ComfyUI interpolates it down to the
 * latent grid (an eighth of the image) before sampling, so more resolution
 * than this buys nothing but upload time.
 */
const MASK_MAX_SIDE = 1024;

interface Props {
  /** Server-side filename of the mask ('' = none). */
  value: string;
  onChange: (serverName: string) => void;
  /** Server-side filename of the source image ('' = not picked yet). */
  sourceFilename: string;
}

export function MaskInputField({ value, onChange, sourceFilename }: Props) {
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const [strokes, setStrokes] = useState<MaskStroke[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const previousSource = useRef(sourceFilename);

  const client = createClient(serverUrl);
  const sourceUrl =
    sourceFilename === '' ? '' : client.viewUrl(sourceFilename, '', 'input');

  // Real pixel dimensions of the source: the mask must keep its aspect
  // ratio, or ComfyUI's bilinear resize stretches the drawing off target.
  useEffect(() => {
    if (sourceUrl === '') {
      setSize(null);
      return;
    }
    let cancelled = false;
    RNImage.getSize(
      sourceUrl,
      (width, height) => {
        if (!cancelled) setSize({ width, height });
      },
      () => {
        if (!cancelled) setSize(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  // A new source picture invalidates the drawing (different framing, often
  // different aspect ratio). Only on a real change — never on mount, which
  // would wipe a mask restored by a remix.
  useEffect(() => {
    if (previousSource.current === sourceFilename) return;
    previousSource.current = sourceFilename;
    setStrokes([]);
    onChange('');
    // onChange is recreated on each parent render; the source is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilename]);

  const commit = async (drawn: MaskStroke[]) => {
    setEditing(false);
    setStrokes(drawn);
    if (!size) return;

    const dims = maskDimensions(size.width, size.height, MASK_MAX_SIDE);
    const mask = rasterizeMask(drawn, dims.width, dims.height);
    // Everything erased (or nothing drawn): clear rather than upload a mask
    // that would make the sampler a no-op.
    if (isMaskEmpty(mask)) {
      onChange('');
      return;
    }

    setBusy(true);
    try {
      const name = `komfy_mask_${Date.now()}.png`;
      const path = FileSystem.cacheDirectory + name;
      await FileSystem.writeAsStringAsync(
        path,
        maskToPngBase64(mask, dims.width, dims.height),
        { encoding: FileSystem.EncodingType.Base64 },
      );
      const uploaded = await client.uploadImage(path, name);
      onChange(uploaded.name);
      // The upload is what matters; the cache copy has served its purpose.
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch (e) {
      Alert.alert(
        t('maskInput.uploadFailed'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  if (sourceFilename === '') {
    return (
      <View style={[styles.emptyBtn, styles.disabled]}>
        <Ionicons name="brush-outline" size={20} color={colors.textDisabled} />
        <Text style={styles.disabledText}>{t('maskInput.needsSource')}</Text>
      </View>
    );
  }

  return (
    <>
      {value === '' ? (
        <Pressable
          style={({ pressed }) => [
            styles.emptyBtn,
            pressed && { backgroundColor: colors.surfacePressed },
            (busy || !size) && { opacity: 0.5 },
          ]}
          onPress={() => setEditing(true)}
          disabled={busy || !size}
        >
          {busy || !size ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Ionicons name="brush-outline" size={20} color={colors.accent} />
              <Text style={styles.emptyText}>{t('maskInput.draw')}</Text>
            </>
          )}
        </Pressable>
      ) : (
        <View style={styles.filledRow}>
          {/* The mask itself (white = repainted): unambiguous at thumbnail
              size, where a tinted overlay would just muddy the picture. */}
          <Image
            source={{ uri: client.viewUrl(value, '', 'input') }}
            style={styles.thumb}
            contentFit="contain"
            cachePolicy="disk"
          />
          <Text style={styles.filename} numberOfLines={2}>
            {value}
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={() => setEditing(true)}
              disabled={busy}
              hitSlop={8}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="brush" size={18} color={colors.accent} />
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setStrokes([]);
                onChange('');
              }}
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
      )}

      {size != null && (
        <MaskEditor
          visible={editing}
          sourceUrl={sourceUrl}
          imageWidth={size.width}
          imageHeight={size.height}
          initialStrokes={strokes}
          onCancel={() => setEditing(false)}
          onDone={commit}
        />
      )}
    </>
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
  disabled: {
    backgroundColor: colors.bgElevated,
  },
  disabledText: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
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
