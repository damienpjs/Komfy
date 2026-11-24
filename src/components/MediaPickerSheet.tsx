/**
 * In-app picker over the server's files, in the Library's look: breadcrumb,
 * folder chips, square grid newest first. It opens on the most recent files
 * of its kind (videos or images) and the folders reach every other one, in
 * the output and input roots alike.
 *
 * Videos can also come from Photos: uploaded to input/komfy-video under a
 * name never reused (utils/imageUpload.uploadName), then picked like the
 * others.
 *
 * A limit of 1 picks on tap. A larger one numbers the picks in order and
 * adds them with one button (keyframes).
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createClient } from '../api/client';
import { useGallery, type GalleryImage } from '../hooks/useGallery';
import { useSettings } from '../store/settings';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { uploadName } from '../utils/imageUpload';
import { listDirectory, type LoraDirEntry } from '../utils/pathTree';
import { VIDEO_THUMB_HEIGHT, VideoThumb } from './VideoThumb';

const COLUMNS = 3;
/** Files shown at the root, before any folder is opened. */
const RECENT = 12;
const IMPORT_SUBFOLDER = 'komfy-video';
/** ComfyUI's default --max-upload-size: a larger upload is refused (413). */
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;

interface Props {
  visible: boolean;
  kind: 'video' | 'image';
  title: string;
  /** Most files picked at once (default 1: a tap picks and closes). */
  limit?: number;
  /** Listing path of the current value (`output/sub/clip.mp4`), ringed. */
  current?: string | null;
  onClose: () => void;
  /** Listing paths (`output/sub/a.png`), in pick order. */
  onPick: (paths: string[]) => void;
}

const newestFirst = (a: GalleryImage, b: GalleryImage) => (b.mtime ?? 0) - (a.mtime ?? 0);

export function MediaPickerSheet({
  visible,
  kind,
  title,
  limit = 1,
  current,
  onClose,
  onPick,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const serverUrl = useSettings((s) => s.serverUrl);
  const gallery = useGallery();
  const [dir, setDir] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  // Each opening starts at the root with nothing picked, on a fresh listing
  // (a render that just finished, a clip just imported).
  const refetch = useRef(gallery.refetch);
  refetch.current = gallery.refetch;
  useEffect(() => {
    if (!visible) return;
    setDir('');
    setPicked([]);
    refetch.current().catch(() => {});
  }, [visible]);

  const media = useMemo(
    () => gallery.images.filter((i) => i.isVideo === (kind === 'video')),
    [gallery.images, kind],
  );

  const { folders, files } = useMemo(() => {
    const byPath = new Map(media.map((i) => [i.path, i]));
    const entries = listDirectory(
      media.map((i) => i.path),
      dir,
    );
    const here =
      dir === ''
        ? [...media].sort(newestFirst).slice(0, RECENT)
        : entries
            .flatMap((e) => (e.kind === 'file' ? [byPath.get(e.path)] : []))
            .filter((i): i is GalleryImage => !!i)
            .sort(newestFirst);
    return {
      folders: entries.filter((e): e is LoraDirEntry => e.kind === 'dir'),
      files: here,
    };
  }, [media, dir]);

  const crumbs = dir === '' ? [] : dir.split('/');
  const crumbScroll = useRef<ScrollView>(null);

  const tap = (path: string) => {
    if (limit === 1) {
      onPick([path]);
      return;
    }
    setPicked((cur) =>
      cur.includes(path)
        ? cur.filter((p) => p !== path)
        : cur.length < limit
          ? [...cur, path]
          : cur,
    );
    Haptics.selectionAsync().catch(() => {});
  };

  const importVideo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('imageInput.accessDenied'), t('imageInput.accessDeniedBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'videos',
      // H.264 rather than the HEVC (often HDR) original: what PyAV and the
      // MLX nodes read without surprise.
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (asset.fileSize != null && asset.fileSize > MAX_VIDEO_UPLOAD_BYTES) {
      Alert.alert(
        t('mediaInput.tooLarge'),
        t('mediaInput.tooLargeBody', {
          size: (asset.fileSize / 1024 / 1024).toFixed(1),
          limit: MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024,
        }),
      );
      return;
    }
    const name = uploadName(asset, 'komfy_video', 'mp4');
    setImporting(true);
    try {
      const uploaded = await createClient(serverUrl).uploadImage(
        asset.uri,
        name,
        IMPORT_SUBFOLDER,
        asset.mimeType ?? (name.endsWith('.mov') ? 'video/quicktime' : 'video/mp4'),
      );
      refetch.current().catch(() => {});
      onPick([`input/${IMPORT_SUBFOLDER}/${uploaded.name}`]);
    } catch (e) {
      Alert.alert(t('imageInput.uploadFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const renderTile = ({ item }: { item: GalleryImage }) => {
    const order = picked.indexOf(item.path);
    const isCurrent = limit === 1 && current === item.path;
    const on = order >= 0 || isCurrent;
    return (
      <Pressable
        onPress={() => tap(item.path)}
        disabled={importing}
        style={({ pressed }) => [
          styles.cell,
          on && styles.cellOn,
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={item.filename}
      >
        {item.isVideo ? (
          <VideoThumb
            uri={gallery.thumbUrl(item, VIDEO_THUMB_HEIGHT)}
            filename={item.filename}
            recyclingKey={item.path}
          />
        ) : (
          <Image
            source={{ uri: gallery.viewUrl(item) }}
            style={styles.fill}
            contentFit="cover"
            cachePolicy="disk"
            recyclingKey={item.path}
            transition={100}
          />
        )}
        {on && (
          <View style={styles.badge}>
            {order >= 0 ? (
              <Text style={styles.badgeText}>{order + 1}</Text>
            ) : (
              <Ionicons name="checkmark" size={14} color={colors.onAccent} />
            )}
          </View>
        )}
      </Pressable>
    );
  };

  const empty =
    dir === ''
      ? t(kind === 'video' ? 'mediaPicker.noVideo' : 'mediaPicker.noImage')
      : t('mediaPicker.emptyFolder');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} accessibilityRole="header">
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.headerBtn}>{t('common.cancel')}</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={crumbScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          // A deep path keeps its current folder (the end) in view.
          onContentSizeChange={() => crumbScroll.current?.scrollToEnd({ animated: false })}
          style={styles.crumbScroll}
          contentContainerStyle={styles.crumbs}
        >
          <Pressable
            onPress={() => setDir('')}
            disabled={dir === ''}
            style={styles.crumbHit}
            accessibilityRole="button"
          >
            <Text style={[styles.crumb, dir === '' && styles.crumbCurrent]}>
              {t('gallery.root')}
            </Text>
          </Pressable>
          {crumbs.map((crumb, i) => (
            <View key={`${crumb}-${i}`} style={styles.crumbGroup}>
              <Ionicons name="chevron-forward" size={14} color={colors.textDisabled} />
              <Pressable
                onPress={() => setDir(crumbs.slice(0, i + 1).join('/'))}
                disabled={i === crumbs.length - 1}
                style={styles.crumbHit}
                accessibilityRole="button"
              >
                <Text
                  style={[styles.crumb, i === crumbs.length - 1 && styles.crumbCurrent]}
                  numberOfLines={1}
                >
                  {crumb}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>

        {(kind === 'video' || folders.length > 0) && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chips}
          >
            {kind === 'video' && (
              <Pressable
                onPress={importVideo}
                disabled={importing}
                accessibilityRole="button"
                accessibilityState={{ busy: importing, disabled: importing }}
                style={({ pressed }) => [
                  styles.chip,
                  styles.importChip,
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}
              >
                {importing ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons name="images-outline" size={16} color={colors.accent} />
                )}
                <Text style={styles.importText}>
                  {importing ? t('mediaPicker.importing') : t('mediaPicker.fromPhotos')}
                </Text>
              </Pressable>
            )}
            {folders.map((folder) => (
              <Pressable
                key={folder.name}
                onPress={() => setDir(dir === '' ? folder.name : `${dir}/${folder.name}`)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.chip,
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}
              >
                <Ionicons name="folder-outline" size={16} color={colors.textMuted} />
                <Text style={styles.folderName} numberOfLines={1}>
                  {folder.name}
                </Text>
                <Text style={styles.folderCount}>{folder.count}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {gallery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : gallery.isError ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{t('mediaPicker.listError')}</Text>
            <Pressable
              onPress={() => refetch.current().catch(() => {})}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.headerBtn}>{t('common.retry')}</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={files}
            numColumns={COLUMNS}
            keyExtractor={(i) => i.path}
            renderItem={renderTile}
            style={styles.list}
            columnWrapperStyle={styles.row}
            contentContainerStyle={[
              styles.grid,
              limit === 1 && { paddingBottom: insets.bottom + spacing.lg },
            ]}
            ListHeaderComponent={
              dir === '' && files.length > 0 ? (
                <Text style={styles.section}>{t('mediaPicker.recent')}</Text>
              ) : null
            }
            ListEmptyComponent={
              folders.length === 0 ? <Text style={styles.empty}>{empty}</Text> : null
            }
          />
        )}

        {limit > 1 && (
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
            <Pressable
              onPress={() => onPick(picked)}
              disabled={picked.length === 0}
              accessibilityRole="button"
              accessibilityState={{ disabled: picked.length === 0 }}
              style={({ pressed }) => [
                styles.addBtn,
                pressed && { backgroundColor: colors.accentPressed },
                picked.length === 0 && { opacity: 0.4 },
              ]}
            >
              <Text style={styles.addText}>
                {t('mediaPicker.addSelected', { count: picked.length })}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  headerBtn: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  // Breadcrumb and folder chips: the Library's (GalleryBrowser).
  crumbScroll: {
    flexGrow: 0,
    paddingLeft: spacing.md - 6,
    paddingTop: spacing.xs,
  },
  crumbs: {
    alignItems: 'center',
    paddingRight: spacing.md,
  },
  crumbGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crumbHit: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  crumb: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: 15,
  },
  crumbCurrent: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
  },
  chipScroll: {
    flexGrow: 0,
  },
  chips: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
  },
  chip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md - 4,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // An action among the folders: dashed and transparent, like the
  // Library's new-folder chip.
  importChip: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  importText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: 14,
  },
  folderName: {
    maxWidth: 160,
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 14,
  },
  folderCount: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  list: {
    flex: 1,
  },
  grid: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
  },
  row: {
    gap: spacing.xs,
  },
  section: {
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
    paddingBottom: spacing.xs,
  },
  cell: {
    flex: 1 / COLUMNS,
    aspectRatio: 1,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  cellOn: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 4,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  badgeText: {
    color: colors.onAccent,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.xs,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  errorText: {
    color: colors.danger,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  retryBtn: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  empty: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  footer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  addBtn: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.strong,
  },
  addText: {
    color: colors.onStrong,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
}));
