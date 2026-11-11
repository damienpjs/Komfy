/**
 * Form row for a hand-drawn inpaint mask.
 *
 * Rasterizes the strokes at upload resolution, encodes the PNG in JS and
 * uploads it to ComfyUI's input folder: the value handed back to the form
 * is the server-side filename, exactly like the image field, and gets
 * patched into LoadImageMask.
 *
 * The strokes behind each uploaded mask are kept on the phone
 * (store/maskStrokes), keyed by that filename, so re-opening the editor
 * (after a remix, or coming back to the form) resumes the drawing. A mask
 * whose strokes are not on the phone (drawn on another device, before the
 * store existed, or forgotten past its cap) stays as it is until something
 * new is drawn over it.
 *
 * The mask is meaningless without its picture, so the row stays disabled
 * until the source image field holds one, and resets when that picture
 * changes (a mask drawn for another framing would land anywhere).
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image as RNImage,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createClient } from '../api/client';
import { useMaskStrokes } from '../store/maskStrokes';
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
  rasterizeMaskAsync,
  type MaskStroke,
} from '../utils/maskRaster';
import { MaskEditor } from './MaskEditor';

/**
 * Long side of the uploaded mask. ComfyUI interpolates it down to the
 * latent grid (an eighth of the image) before sampling, so more resolution
 * than this buys nothing but upload time.
 */
const MASK_MAX_SIDE = 1024;

const NO_STROKES: MaskStroke[] = [];

interface Props {
  /** Server-side filename of the mask ('' = none). */
  value: string;
  onChange: (serverName: string) => void;
  /** Server-side filename of the source image ('' = not picked yet). */
  sourceFilename: string;
}

type SourceSize = { width: number; height: number } | 'loading' | 'error';

export function MaskInputField({ value, onChange, sourceFilename }: Props) {
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const saveStrokes = useMaskStrokes((s) => s.save);
  const savedStrokes = useMaskStrokes((s) =>
    value === '' ? undefined : s.byMask[value]?.strokes,
  );
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Strokes drawn but not (yet) uploaded: in flight, or failed. */
  const [draft, setDraft] = useState<MaskStroke[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [size, setSize] = useState<SourceSize>('loading');
  const [sizeAttempt, setSizeAttempt] = useState(0);
  const previousSource = useRef(sourceFilename);
  /**
   * Bumped by anything that makes an upload in flight obsolete (a newer
   * drawing, a cleared field, another source picture): a stale upload must
   * never land its filename in the form.
   */
  const uploadSeq = useRef(0);

  const client = createClient(serverUrl);
  const sourceUrl =
    sourceFilename === '' ? '' : client.viewUrl(sourceFilename, '', 'input');

  // Real pixel dimensions of the source: the mask must keep its aspect
  // ratio, or ComfyUI's bilinear resize stretches the drawing off target.
  useEffect(() => {
    if (sourceUrl === '') return;
    let cancelled = false;
    setSize('loading');
    RNImage.getSize(
      sourceUrl,
      (width, height) => {
        if (!cancelled) setSize({ width, height });
      },
      () => {
        if (!cancelled) setSize('error');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sourceUrl, sizeAttempt]);

  /** Drops the mask, the pending drawing and any upload in flight. */
  const reset = () => {
    uploadSeq.current++;
    setBusy(false);
    setDraft(null);
    setUploadError(null);
    onChange('');
  };

  // A new source picture invalidates the drawing (different framing, often
  // different aspect ratio). Only on a real change, never on mount, which
  // would wipe a mask restored by a remix.
  useEffect(() => {
    if (previousSource.current === sourceFilename) return;
    previousSource.current = sourceFilename;
    reset();
    // reset/onChange are recreated on each parent render; the source is the
    // trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilename]);

  // Leaving the form abandons an upload in flight: its filename must not
  // land in a form nobody looks at any more.
  useEffect(
    () => () => {
      uploadSeq.current++;
    },
    [],
  );

  const upload = async (drawn: MaskStroke[]) => {
    if (typeof size !== 'object') return;
    const seq = ++uploadSeq.current;
    // A mask whose strokes are not on the phone survives a drawing that
    // ends up empty (an eraser pass over nothing): only Remove drops it.
    const keepOnEmpty =
      value !== '' && draft == null && savedStrokes == null ? value : '';
    const dims = maskDimensions(size.width, size.height, MASK_MAX_SIDE);
    setDraft(drawn);
    setUploadError(null);
    setBusy(true);
    // The previous mask no longer matches the drawing: a launch must not
    // pick it up while the new one is on its way (or if it never arrives).
    onChange('');
    let path: string | null = null;
    try {
      const mask = await rasterizeMaskAsync(drawn, dims.width, dims.height, {
        isCancelled: () => seq !== uploadSeq.current,
      });
      if (mask == null || seq !== uploadSeq.current) return;
      // Everything erased (or nothing drawn): no mask rather than one that
      // would make the sampler a no-op.
      if (isMaskEmpty(mask)) {
        setDraft(null);
        if (keepOnEmpty !== '') onChange(keepOnEmpty);
        return;
      }
      const name = `komfy_mask_${Date.now()}.png`;
      path = FileSystem.cacheDirectory + name;
      await FileSystem.writeAsStringAsync(
        path,
        maskToPngBase64(mask, dims.width, dims.height),
        { encoding: FileSystem.EncodingType.Base64 },
      );
      const uploaded = await client.uploadImage(path, name);
      if (seq !== uploadSeq.current) return;
      saveStrokes(uploaded.name, drawn);
      setDraft(null);
      onChange(uploaded.name);
    } catch (e) {
      if (seq === uploadSeq.current) {
        setUploadError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (seq === uploadSeq.current) setBusy(false);
      // The upload is what matters; the cache copy has served its purpose.
      if (path) {
        FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      }
    }
  };

  const commit = (drawn: MaskStroke[], changed: boolean) => {
    setEditing(false);
    // Nothing new: keep the mask already uploaded (or restored by a remix).
    // A drawing whose upload failed is sent again.
    if (!changed && draft == null) return;
    void upload(drawn);
  };

  if (sourceFilename === '') {
    return (
      <View style={[styles.emptyBtn, styles.disabled]}>
        <Ionicons name="brush-outline" size={20} color={colors.textDisabled} />
        <Text style={styles.disabledText}>{t('maskInput.needsSource')}</Text>
      </View>
    );
  }

  if (size === 'error') {
    return (
      <View style={styles.row}>
        <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
        <Text style={styles.rowText}>{t('maskInput.sizeFailed')}</Text>
        <RowButton
          icon="refresh"
          label={t('common.retry')}
          onPress={() => setSizeAttempt((n) => n + 1)}
        />
      </View>
    );
  }

  const strokes = draft ?? savedStrokes ?? NO_STROKES;
  const unknownStrokes = value !== '' && draft == null && savedStrokes == null;

  let body: ReactNode;
  if (size === 'loading') {
    body = (
      <View style={[styles.emptyBtn, styles.disabled]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  } else if (busy) {
    body = (
      <View style={styles.row}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.rowText}>{t('maskInput.uploading')}</Text>
      </View>
    );
  } else if (draft != null && uploadError != null) {
    body = (
      <View style={styles.row}>
        <Ionicons name="alert-circle-outline" size={20} color={colors.warning} />
        <View style={styles.rowTextBlock}>
          <Text style={styles.rowTitle}>{t('maskInput.notUploaded')}</Text>
          <Text style={styles.rowDetail} numberOfLines={2}>
            {uploadError}
          </Text>
        </View>
        <View style={styles.actions}>
          <RowButton
            icon="refresh"
            label={t('common.retry')}
            onPress={() => void upload(draft)}
          />
          <RowButton
            icon="brush"
            label={t('maskInput.edit')}
            onPress={() => setEditing(true)}
          />
          <RowButton
            icon="close"
            label={t('maskInput.remove')}
            muted
            onPress={reset}
          />
        </View>
      </View>
    );
  } else if (value === '') {
    body = (
      <Pressable
        style={({ pressed }) => [
          styles.emptyBtn,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
        onPress={() => setEditing(true)}
        accessibilityRole="button"
      >
        <Ionicons name="brush-outline" size={20} color={colors.accent} />
        <Text style={styles.emptyText}>{t('maskInput.draw')}</Text>
      </Pressable>
    );
  } else {
    body = (
      <View style={styles.row}>
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
          <RowButton
            icon="brush"
            label={t('maskInput.edit')}
            onPress={() => setEditing(true)}
          />
          <RowButton
            icon="close"
            label={t('maskInput.remove')}
            muted
            onPress={reset}
          />
        </View>
      </View>
    );
  }

  return (
    <>
      {body}
      {typeof size === 'object' && (
        <MaskEditor
          visible={editing}
          sourceUrl={sourceUrl}
          imageWidth={size.width}
          imageHeight={size.height}
          initialStrokes={strokes}
          notice={unknownStrokes ? t('maskEditor.unknownStrokes') : undefined}
          onCancel={() => setEditing(false)}
          onDone={commit}
        />
      )}
    </>
  );
}

function RowButton({
  icon,
  label,
  muted,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconBtn,
        pressed && { backgroundColor: colors.surfacePressed },
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={muted ? colors.textMuted : colors.accent}
      />
    </Pressable>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 72,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  rowTextBlock: {
    flex: 1,
    gap: 2,
  },
  rowText: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  rowTitle: {
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  rowDetail: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
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
    // At least twice the buttons' hitSlop, so a tap near the edge of Edit
    // never lands on Remove.
    gap: spacing.sm,
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
