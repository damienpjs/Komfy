/**
 * Form input audio field (a voice): an audio file from the Files app (a
 * Voice Memos recording saved to Files, an AirDrop, iCloud Drive) or the
 * sound of a video from the photo library. The file is uploaded as is to
 * input/komfy-voice/ and the value becomes its server-side path, patched
 * into a core LoadAudio (which decodes the audio track of a video too).
 *
 * Once picked, the voice can be played back from the server and its length
 * is shown: in the talking video workflow it sets the clip's duration.
 */

import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useVideoPlayer } from 'expo-video';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import { createClient } from '../api/client';
import { useSettings } from '../store/settings';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { inputRef, parseAnnotated } from '../utils/annotated';

/** A voice-over is short; a phone video carrying it can weigh more. */
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const SUBFOLDER = 'komfy-voice';

interface Props {
  /** Server-side path ('' = none). */
  value: string;
  onChange: (serverName: string) => void;
  /** Longest voice the workflow accepts, in seconds (shown in red beyond). */
  maxSeconds?: number;
}

interface Picked {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number | null;
}

export function AudioInputField({ value, onChange, maxSeconds }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: Picked, limit: number) => {
    if (file.size != null && file.size > limit) {
      Alert.alert(
        t('mediaInput.tooLarge'),
        t('mediaInput.tooLargeBody', {
          size: (file.size / 1024 / 1024).toFixed(1),
          limit: limit / 1024 / 1024,
        }),
      );
      return;
    }
    setUploading(true);
    try {
      const uploaded = await createClient(serverUrl).uploadImage(
        file.uri,
        file.name,
        SUBFOLDER,
        file.mimeType ?? 'application/octet-stream',
      );
      onChange(inputRef(SUBFOLDER, uploaded.name));
    } catch (e) {
      Alert.alert(
        t('imageInput.uploadFailed'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setUploading(false);
    }
  };

  const pickFile = async () => {
    // Loaded on demand: the module is native, and a binary built before it
    // was added would otherwise break the whole launch form at import.
    let DocumentPicker: typeof import('expo-document-picker');
    try {
      DocumentPicker = await import('expo-document-picker');
    } catch {
      Alert.alert(t('mediaInput.needsBuild'), t('mediaInput.needsBuildBody'));
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({
      type: 'audio/*',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    await upload(
      { uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size },
      MAX_AUDIO_BYTES,
    );
  };

  const pickVideo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('imageInput.accessDenied'), t('imageInput.accessDeniedBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'videos' });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    await upload(
      {
        uri: a.uri,
        name: a.fileName ?? `komfy_voice_${Date.now()}.mov`,
        mimeType: a.mimeType ?? 'video/quicktime',
        size: a.fileSize,
      },
      MAX_VIDEO_BYTES,
    );
  };

  if (value === '') {
    return (
      <View style={styles.emptyRow}>
        {uploading ? (
          <View style={[styles.emptyBtn, styles.busy]}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            <EmptyButton icon="document-outline" label={t('mediaInput.audioFile')} onPress={pickFile} />
            <EmptyButton icon="film-outline" label={t('mediaInput.videoSound')} onPress={pickVideo} />
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.filledRow}>
      <VoicePlayer value={value} maxSeconds={maxSeconds} />
      <View style={styles.actions}>
        <Pressable
          onPress={pickFile}
          disabled={uploading}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('mediaInput.audioFile')}
          style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: colors.surfacePressed }]}
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
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: colors.surfacePressed }]}
        >
          <Ionicons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function EmptyButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.emptyBtn, pressed && { backgroundColor: colors.surfacePressed }]}
    >
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={styles.emptyText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Play/pause from the server, with the voice's length once loaded. */
function VoicePlayer({ value, maxSeconds }: { value: string; maxSeconds?: number }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const ref = parseAnnotated(value);
  const uri = createClient(serverUrl).viewUrl(ref.filename, ref.subfolder, ref.type);
  const player = useVideoPlayer(uri);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const subs = [
      player.addListener('sourceLoad', ({ duration: d }) => d > 0 && setDuration(d)),
      player.addListener('statusChange', ({ status }) => {
        if (status === 'readyToPlay' && player.duration > 0) setDuration(player.duration);
        setFailed(status === 'error');
      }),
      player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying)),
      player.addListener('playToEnd', () => {
        player.currentTime = 0;
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player]);

  const tooLong = maxSeconds != null && duration > maxSeconds;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={playing ? t('mediaInput.pause') : t('mediaInput.play')}
        onPress={() => (playing ? player.pause() : player.play())}
        disabled={failed}
        style={({ pressed }) => [styles.playBtn, pressed && { backgroundColor: colors.surfacePressed }]}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={22} color={colors.accent} />
      </Pressable>
      <View style={styles.texts}>
        <Text style={styles.filename} numberOfLines={1}>
          {ref.filename}
        </Text>
        <Text style={[styles.meta, tooLong && { color: colors.danger }]} numberOfLines={2}>
          {failed
            ? t('mediaInput.unreadable')
            : duration > 0
              ? tooLong
                ? t('mediaInput.tooLong', { seconds: duration.toFixed(1), max: maxSeconds })
                : t('mediaInput.seconds', { seconds: duration.toFixed(1) })
              : '…'}
        </Text>
      </View>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  emptyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  emptyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 72,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  busy: {
    opacity: 0.5,
  },
  emptyText: {
    flexShrink: 1,
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
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
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
