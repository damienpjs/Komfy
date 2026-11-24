/**
 * Form input video field: any clip of the server (output or input folder,
 * through the media picker), or one imported from Photos into
 * input/komfy-video. The value is a loader filename, annotated for the
 * output folder (`sub/clip.mp4 [output]`, cf. utils/annotated), that core
 * LoadVideo resolves. "Use in" from the viewer fills it directly.
 *
 * Once picked, the clip's size and length are read from a muted player and,
 * with `upscaleEstimate`, turned into the x2 output size and a rough time
 * estimate, so a 38-minute render is never launched by surprise.
 */

import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { createClient } from '../api/client';
import { useSettings } from '../store/settings';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { listingPath, loaderValue, parseAnnotated } from '../utils/annotated';
import { MediaPickerSheet } from './MediaPickerSheet';

/**
 * Measured on an M3 Max with free memory: 38 min to upscale 4.4 s from
 * 512×768 to 1024×1536. Time grows about linearly with frames × pixels.
 */
const REF_MINUTES = 38;
const REF_SECONDS = 4.4;
const REF_PIXELS = 512 * 768;
/** Beyond this, memory gets tight on 64 GB (only 4.4 s was measured). */
const LONG_SECONDS = 5;

interface Props {
  /** Annotated output path ('' = none). */
  value: string;
  onChange: (value: string) => void;
  /** Show the x2 size and the time estimate of the video upscale. */
  upscaleEstimate?: boolean;
}

export function VideoInputField({ value, onChange, upscaleEstimate }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);

  return (
    <>
      {value === '' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setPicking(true)}
          style={({ pressed }) => [styles.emptyBtn, pressed && { backgroundColor: colors.surfacePressed }]}
        >
          <Ionicons name="film-outline" size={20} color={colors.accent} />
          <Text style={styles.emptyText}>{t('mediaInput.chooseVideo')}</Text>
        </Pressable>
      ) : (
        <View style={styles.filledRow}>
          <VideoSummary value={value} upscaleEstimate={upscaleEstimate} />
          <View style={styles.actions}>
            <Pressable
              onPress={() => setPicking(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('mediaInput.chooseVideo')}
              style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: colors.surfacePressed }]}
            >
              <Ionicons name="swap-horizontal" size={18} color={colors.accent} />
            </Pressable>
            <Pressable
              onPress={() => onChange('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: colors.surfacePressed }]}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
      )}
      <MediaPickerSheet
        visible={picking}
        kind="video"
        title={t('mediaPicker.chooseVideo')}
        current={value !== '' ? listingPath(value) : null}
        onClose={() => setPicking(false)}
        onPick={([path]) => {
          setPicking(false);
          if (path) onChange(loaderValue(path));
        }}
      />
    </>
  );
}

/** Muted first frame + size, length and (upscale) the estimate. */
function VideoSummary({ value, upscaleEstimate }: { value: string; upscaleEstimate?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const ref = parseAnnotated(value);
  const uri = createClient(serverUrl).viewUrl(ref.filename, ref.subfolder, ref.type);
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
  });
  const [info, setInfo] = useState<{ w: number; h: number; s: number } | null>(null);

  useEffect(() => {
    const sub = player.addListener('sourceLoad', ({ duration, availableVideoTracks }) => {
      const size = availableVideoTracks?.[0]?.size;
      if (size && duration > 0) setInfo({ w: size.width, h: size.height, s: duration });
    });
    return () => sub.remove();
  }, [player]);

  let meta = '…';
  let long = false;
  if (info) {
    meta = t('mediaInput.videoMeta', { w: info.w, h: info.h, seconds: info.s.toFixed(1) });
    if (upscaleEstimate) {
      const minutes = Math.max(
        1,
        Math.round(REF_MINUTES * (info.s / REF_SECONDS) * ((info.w * info.h) / REF_PIXELS)),
      );
      meta += `\n${t('mediaInput.upscaleMeta', { w: info.w * 2, h: info.h * 2, minutes })}`;
      long = info.s > LONG_SECONDS;
      if (long) meta += `\n${t('mediaInput.upscaleLong', { max: LONG_SECONDS })}`;
    }
  }

  return (
    <>
      <VideoView player={player} style={styles.thumb} contentFit="cover" nativeControls={false} />
      <View style={styles.texts}>
        <Text style={styles.filename} numberOfLines={1}>
          {ref.filename}
        </Text>
        <Text style={[styles.meta, long && { color: colors.warning }]}>{meta}</Text>
      </View>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
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
    overflow: 'hidden',
    backgroundColor: colors.bgElevated,
  },
  texts: {
    flex: 1,
    gap: 2,
  },
  filename: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: typography.ui,
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
}));
