/**
 * Form input video field: a clip picked among the server's own outputs (the
 * most recent videos of the gallery), never uploaded. The value is an
 * annotated filename (`sub/clip.mp4 [output]`, cf. utils/annotated) that
 * core LoadVideo resolves in the output folder. "Use in" from the viewer
 * fills it directly.
 *
 * Once picked, the clip's size and length are read from a muted player and,
 * with `upscaleEstimate`, turned into the x2 output size and a rough time
 * estimate, so a 38-minute render is never launched by surprise.
 */

import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createClient } from '../api/client';
import { useGallery } from '../hooks/useGallery';
import { useSettings } from '../store/settings';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { outputRef, parseAnnotated } from '../utils/annotated';
import { formatAgo } from '../utils/format';

/** Videos offered in the picker, most recent first. */
const RECENT_LIMIT = 40;

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
      <RecentVideosSheet
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(v) => {
          setPicking(false);
          onChange(v);
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

/** The most recent output videos, newest first. */
function RecentVideosSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (value: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { images } = useGallery();
  const videos = useMemo(
    () =>
      images
        .filter((i) => i.isVideo && i.root === 'output')
        .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
        .slice(0, RECENT_LIMIT),
    [images],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.grab} />
        <Text style={styles.sheetTitle} accessibilityRole="header">
          {t('mediaInput.recentVideos')}
        </Text>
        <FlatList
          data={videos}
          keyExtractor={(item) => item.path}
          style={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{t('mediaInput.noVideo')}</Text>}
          renderItem={({ item, index }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPick(outputRef(item.subfolder, item.filename))}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.rowSeparated,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              <Ionicons name="film-outline" size={20} color={colors.textMuted} />
              <View style={styles.texts}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.filename}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {[item.subfolder, item.mtime ? formatAgo(item.mtime * 1000, t) : '']
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </Modal>
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
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  sheet: {
    maxHeight: '70%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.sm,
  },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.sm,
  },
  rowSeparated: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowName: {
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  empty: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    paddingVertical: spacing.lg,
  },
}));
