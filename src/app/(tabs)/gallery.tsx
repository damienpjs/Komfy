/**
 * Gallery screen: folder navigation through the rebuilt tree (session
 * history + root files), thumbnail grid, full-screen viewer. Disabled when
 * the output volume is not mounted.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ComfyApiError, createClient } from '../../api/client';
import { queryClient } from '../../api/queryClient';
import { useGallery, type GalleryImage } from '../../hooks/useGallery';
import { useRemix } from '../../hooks/useRemix';
import { useSettings } from '../../store/settings';
import { useToast } from '../../store/toast';
import { showActionSheet } from '../../utils/actionSheet';
import { saveImageToPhotos } from '../../utils/saveToPhotos';
import { useConnection } from '../../store/connection';
import {
  colors,
  radii,
  spacing,
  typography,
} from '../../theme/tokens';
import { ImageViewer } from '../../components/ImageViewer';
import { OutputDirPicker } from '../../components/OutputDirPicker';
import { RemixSheet, type RemixSheetState } from '../../components/RemixSheet';
import {
  listDirectory,
  type LoraEntry,
  type LoraFileEntry,
} from '../../utils/pathTree';

// Target thumbnail width: spread the available space into as many columns
// as possible (min. 3), which densifies the grid in landscape / on iPad
// without stretching thumbnails in portrait.
const TARGET_CELL_WIDTH = 118;

// Guard against filling the input folder: reject a too-heavy upload locally
// before sending it (same ceiling as the workflow image field).
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30 MB

/** Input subfolder ('' = root) targeted by an upload from the folder `dir`. */
function inputSubfolder(dir: string): string {
  if (dir === 'input') return '';
  if (dir.startsWith('input/')) return dir.slice('input/'.length);
  return ''; // outside input (root or output) → input root
}

export default function GalleryScreen() {
  const { t } = useTranslation();
  const gallery = useGallery();
  const remix = useRemix();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const columns = Math.max(3, Math.floor(windowWidth / TARGET_CELL_WIDTH));
  const online = useConnection((s) => s.online);
  const volumeMounted = useConnection((s) => s.volumeMounted);

  const [dir, setDir] = useState('');
  // Snapshot frozen at open time: the gallery keeps refreshing during
  // generations, the viewer must not see its list move.
  const [viewer, setViewer] = useState<{
    images: GalleryImage[];
    index: number;
  } | null>(null);
  const serverUrl = useSettings((s) => s.serverUrl);
  const showToast = useToast((s) => s.show);
  const insets = useSafeAreaInsets();

  // Multi-select mode: set of checked paths (files AND folders).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  // Targets of the move in progress (selected batch or single viewer image).
  const [moveTargets, setMoveTargets] = useState<string[]>([]);
  // "Recipe" sheet for an image whose workflow is unknown (Remix v2).
  const [recipe, setRecipe] = useState<RemixSheetState | null>(null);

  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await gallery.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  // Re-tap on the already-active Gallery tab → back to the output/ root.
  // `tabPress` does not exist in expo-router's generic navigation type.
  const navigation = useNavigation() as unknown as {
    addListener(type: 'tabPress', cb: () => void): () => void;
    isFocused(): boolean;
  };
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return; // arriving from another tab: no-op
      setDir('');
      setViewer(null);
      exitSelect();
    });
    return unsub;
  }, [navigation]);
  const toggleSelect = (path: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const startSelect = (path: string) => {
    setSelectMode(true);
    setSelected(new Set([path]));
  };

  const invalidateGallery = () => {
    queryClient.invalidateQueries({ queryKey: ['files'] });
    queryClient.invalidateQueries({ queryKey: ['outputFiles'] });
    queryClient.invalidateQueries({ queryKey: ['history'] });
  };

  // 404: extension missing · 405: old version loaded (the POST route does
  // not exist yet → ComfyUI's static front-end answers).
  const reportWriteError = (e: unknown, action: string) => {
    if (e instanceof ComfyApiError && (e.status === 404 || e.status === 405)) {
      Alert.alert(
        t('gallery.updateExtTitle'),
        t('gallery.updateExtBody', { action }),
      );
    } else {
      Alert.alert(
        t('gallery.actionFailedTitle', { action }),
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  // Server-side trash (komfy-listing extension) then gallery refresh.
  const deletePaths = async (paths: string[], label: string) => {
    try {
      const result = await createClient(serverUrl).deletePaths(paths);
      const failed = Object.entries(result.errors);
      if (failed.length) {
        Alert.alert(
          t('gallery.partialDelete'),
          failed.map(([p, e]) => `${p} : ${e}`).join('\n'),
        );
      } else {
        showToast(t('gallery.trashToast', { label }));
      }
    } catch (e) {
      reportWriteError(e, t('gallery.actionDelete'));
      return;
    }
    exitSelect();
    invalidateGallery();
  };

  // Server-side move (komfy-listing extension) then gallery refresh.
  const movePaths = async (paths: string[], dest: string, label: string) => {
    try {
      const result = await createClient(serverUrl).movePaths(paths, dest);
      const failed = Object.entries(result.errors);
      if (failed.length) {
        Alert.alert(
          t('gallery.partialMove'),
          failed.map(([p, e]) => `${p} : ${e}`).join('\n'),
        );
      } else {
        showToast(
          t('gallery.movedToast', {
            label,
            dest: dest === '' ? '' : `${dest}/`,
          }),
        );
      }
    } catch (e) {
      reportWriteError(e, t('gallery.actionMove'));
      return;
    }
    exitSelect();
    invalidateGallery();
  };

  // Folder creation (komfy-listing extension) then gallery refresh.
  const createFolder = async (path: string) => {
    if (path.trim() === '') return;
    try {
      await createClient(serverUrl).createDir(path);
      showToast(t('gallery.folderCreated', { path }));
    } catch (e) {
      reportWriteError(e, t('gallery.actionMkdir'));
      return;
    }
    invalidateGallery();
  };

  // Pick image(s) from the phone → upload into the input root (or the input
  // subfolder currently open), then reveal them in the gallery.
  const uploadImages = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('imageInput.accessDenied'), t('imageInput.accessDeniedBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsMultipleSelection: true,
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;

    const tooLarge = result.assets.find(
      (a) => a.fileSize != null && a.fileSize > MAX_UPLOAD_BYTES,
    );
    if (tooLarge) {
      Alert.alert(
        t('imageInput.tooLarge'),
        t('imageInput.tooLargeBody', {
          size: ((tooLarge.fileSize ?? 0) / 1024 / 1024).toFixed(1),
          limit: MAX_UPLOAD_BYTES / 1024 / 1024,
        }),
      );
      return;
    }

    const subfolder = inputSubfolder(dir);
    const client = createClient(serverUrl);
    setUploading(true);
    let done = 0;
    try {
      for (const asset of result.assets) {
        const ext = asset.uri.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
        const name = asset.fileName ?? `komfy_input_${Date.now()}_${done}.${ext}`;
        await client.uploadImage(asset.uri, name, subfolder);
        done += 1;
      }
    } catch (e) {
      Alert.alert(
        t('imageInput.uploadFailed'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setUploading(false);
    }
    if (done > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(t('gallery.uploadedToast', { count: done }));
      // Reveal the uploads: jump to the input folder they landed in.
      setDir(subfolder === '' ? 'input' : `input/${subfolder}`);
      invalidateGallery();
    }
  };

  // The bare roots (`input` / `output`, no '/') are structural — never a
  // valid delete/move target.
  const realTargets = (paths: string[]) => paths.filter((p) => p.includes('/'));

  const confirmDelete = (paths: string[], label: string) => {
    const targets = realTargets(paths);
    if (targets.length === 0) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(t('gallery.deleteTitle', { label }), t('gallery.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deletePaths(targets, label),
      },
    ]);
  };

  const openMovePicker = (paths: string[]) => {
    const targets = realTargets(paths);
    if (targets.length === 0) return;
    setMoveTargets(targets);
    setMovePickerOpen(true);
  };

  // Single-image actions from full screen: close the viewer first (the file
  // is about to change folder or go to the trash), then let its modal finish
  // dismissing before presenting another one (iOS ignores a presentation
  // started while a modal is dismissing).
  const handleViewerMove = (image: GalleryImage) => {
    setViewer(null);
    setTimeout(() => openMovePicker([image.path]), 300);
  };
  const handleViewerDelete = (image: GalleryImage) => {
    setViewer(null);
    setTimeout(() => confirmDelete([image.path], image.filename), 300);
  };

  const imageMenu = (image: GalleryImage) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showActionSheet(image.filename, [
      { label: t('gallery.remixAction'), onPress: () => handleRemix(image) },
      { label: t('gallery.selectAction'), onPress: () => startSelect(image.path) },
      {
        label: t('gallery.saveToPhotos'),
        onPress: async () => {
          try {
            await saveImageToPhotos(gallery.viewUrl(image), image.filename);
            showToast(t('gallery.savedToPhotos'));
          } catch (e) {
            Alert.alert(
              t('gallery.saveFailed'),
              e instanceof Error ? e.message : String(e),
            );
          }
        },
      },
      {
        label: t('common.delete'),
        destructive: true,
        onPress: () => confirmDelete([image.path], image.filename),
      },
    ]);
  };

  const dirMenu = (name: string, count: number) => {
    // Root folders (input / output) are structural: navigation only.
    if (dir === '') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const path = `${dir}/${name}`;
    showActionSheet(`${name}/ — ${t('gallery.fileCount', { count })}`, [
      { label: t('gallery.selectAction'), onPress: () => startSelect(path) },
      {
        label: t('gallery.deleteDir', { count }),
        destructive: true,
        onPress: () => confirmDelete([path], `${name}/`),
      },
    ]);
  };

  const handleRemix = async (image: GalleryImage) => {
    try {
      const result = await remix.extract(image);
      if (result.status === 'match') {
        setViewer(null);
        router.push(
          `/workflow/${result.manifestId}?prefill=${encodeURIComponent(
            JSON.stringify(result.values),
          )}` as Href,
        );
      } else if (result.status === 'no-metadata') {
        Alert.alert(t('gallery.noMetadataTitle'), t('gallery.noMetadataBody'));
      } else {
        // Readable recipe but outside the embedded workflows: generic
        // parameter sheet + requeue as-is (Remix v2). Same constraint as
        // move/delete: close the viewer modal first.
        const graph = result.graph;
        setViewer(null);
        setTimeout(
          () => setRecipe({ filename: image.filename, graph }),
          300,
        );
      }
    } catch (e) {
      Alert.alert(
        t('gallery.extractFailed'),
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  // Folders first (alpha), files by recency when the mtime is known
  // (full listing from the server extension).
  const entries = useMemo(() => {
    const list = listDirectory(gallery.paths, dir, gallery.emptyDirs);
    if (!gallery.fullListing) return list;
    const dirs = list.filter((e) => e.kind === 'dir');
    const files = list
      .filter((e): e is LoraFileEntry => e.kind === 'file')
      .sort(
        (a, b) =>
          (gallery.mtimes.get(b.path) ?? 0) - (gallery.mtimes.get(a.path) ?? 0),
      );
    return [...dirs, ...files];
  }, [gallery.paths, gallery.emptyDirs, gallery.mtimes, gallery.fullListing, dir]);

  // Images of the current folder (grid display order), for full-screen
  // swiping.
  const dirImages = useMemo(() => {
    const files = entries.filter((e) => e.kind === 'file');
    const byPath = new Map(gallery.images.map((i) => [i.path, i]));
    return files
      .map((f) => (f.kind === 'file' ? byPath.get(f.path) : undefined))
      .filter((i): i is GalleryImage => !!i);
  }, [entries, gallery.images]);

  // Every selectable path of the current folder (folders AND files), for
  // the "Select all" button. The bare roots (at racine level) are excluded:
  // they are structural, not deletable/movable.
  const allPaths = useMemo(
    () =>
      entries
        .map((e) =>
          e.kind === 'dir'
            ? dir === ''
              ? e.name
              : `${dir}/${e.name}`
            : e.path,
        )
        .filter((p) => p.includes('/')),
    [entries, dir],
  );
  const allSelected =
    allPaths.length > 0 && allPaths.every((p) => selected.has(p));
  const toggleSelectAll = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(allSelected ? new Set() : new Set(allPaths));
  };

  const crumbs = dir === '' ? [] : dir.split('/');

  if (volumeMounted === false) {
    return (
      <View style={styles.centerBox}>
        <Ionicons name="cloud-offline-outline" size={44} color={colors.warning} />
        <Text style={styles.disabledTitle}>{t('gallery.unavailable')}</Text>
        <Text style={styles.disabledDetail}>{t('gallery.volumeBody')}</Text>
      </View>
    );
  }

  if (online === false) {
    return (
      <View style={styles.centerBox}>
        <Text style={styles.disabledTitle}>{t('queue.offlineTitle')}</Text>
        <Pressable
          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
          onPress={gallery.refetch}
        >
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  const renderEntry = ({ item }: { item: LoraEntry; index: number }) => {
    if (item.kind === 'dir') {
      const path = dir === '' ? item.name : `${dir}/${item.name}`;
      const isSelected = selected.has(path);
      return (
        <Pressable
          style={({ pressed }) => [
            styles.cell,
            { flex: 1 / columns },
            styles.dirCell,
            isSelected && styles.cellSelected,
            pressed && { backgroundColor: colors.surfacePressed },
          ]}
          onPress={() =>
            selectMode
              ? toggleSelect(path)
              : setDir(dir === '' ? item.name : `${dir}/${item.name}`)
          }
          onLongPress={() =>
            selectMode ? toggleSelect(path) : dirMenu(item.name, item.count)
          }
        >
          <Ionicons name="folder" size={30} color={colors.warning} />
          <Text style={styles.dirName} numberOfLines={2}>
            {item.name}
          </Text>
          <Text style={styles.dirCount}>{item.count}</Text>
          {selectMode && (
            <View style={styles.checkOverlay}>
              <Ionicons
                name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={isSelected ? colors.accent : colors.textDisabled}
              />
            </View>
          )}
        </Pressable>
      );
    }
    const image = gallery.images.find((i) => i.path === item.path);
    if (!image) return null;
    const imageIndex = dirImages.indexOf(image);
    const isSelected = selected.has(image.path);
    return (
      <Pressable
        style={({ pressed }) => [
          styles.cell,
          { flex: 1 / columns },
          isSelected && styles.cellSelected,
          pressed && { opacity: 0.7 },
        ]}
        onPress={() =>
          selectMode
            ? toggleSelect(image.path)
            : setViewer({ images: dirImages, index: imageIndex })
        }
        onLongPress={() =>
          selectMode ? toggleSelect(image.path) : imageMenu(image)
        }
      >
        <Image
          source={{ uri: gallery.viewUrl(image) }}
          style={styles.thumb}
          contentFit="cover"
          cachePolicy="disk"
          recyclingKey={image.path}
          transition={100}
        />
        {selectMode && (
          <View
            style={[styles.checkOverlay, isSelected && styles.checkOverlayOn]}
          >
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={isSelected ? colors.accent : colors.text}
            />
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.breadcrumb}>
        {dir !== '' && (
          <Pressable
            onPress={() => setDir(crumbs.slice(0, -1).join('/'))}
            hitSlop={8}
            style={({ pressed }) => [
              styles.upBtn,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
          >
            <Ionicons name="chevron-back" size={18} color={colors.accent} />
          </Pressable>
        )}
        <Pressable onPress={() => setDir('')} hitSlop={8}>
          <Text style={[styles.crumb, dir === '' && styles.crumbCurrent]}>
            {t('gallery.root')}
          </Text>
        </Pressable>
        {crumbs.map((crumb, i) => (
          <View key={`${crumb}-${i}`} style={styles.crumbGroup}>
            <Text style={styles.crumbSep}>/</Text>
            <Pressable
              onPress={() => setDir(crumbs.slice(0, i + 1).join('/'))}
              hitSlop={8}
            >
              <Text
                style={[
                  styles.crumb,
                  i === crumbs.length - 1 && styles.crumbCurrent,
                ]}
              >
                {crumb}
              </Text>
            </Pressable>
          </View>
        ))}
        <View style={styles.headerActions}>
          {!selectMode && (
            <Pressable
              onPress={uploadImages}
              disabled={uploading}
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons
                  name="cloud-upload-outline"
                  size={22}
                  color={colors.accent}
                />
              )}
            </Pressable>
          )}
          {!selectMode && (
            <Pressable
              onPress={() => setNewFolderOpen(true)}
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Ionicons
                name="add-circle-outline"
                size={22}
                color={colors.accent}
              />
            </Pressable>
          )}
          {selectMode && allPaths.length > 0 && (
            <Pressable
              onPress={toggleSelectAll}
              hitSlop={8}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={styles.selectBtnText}>
                {allSelected ? t('gallery.deselectAll') : t('gallery.selectAll')}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}
            hitSlop={8}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.selectBtnText}>
              {selectMode ? t('common.cancel') : t('gallery.select')}
            </Text>
          </Pressable>
        </View>
      </View>

      {gallery.isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={entries}
          key={columns}
          numColumns={columns}
          keyExtractor={(e) => (e.kind === 'dir' ? `d:${e.name}` : e.path)}
          renderItem={renderEntry}
          columnWrapperStyle={{ gap: spacing.xs }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          }
          contentContainerStyle={[
            styles.grid,
            // Keep the (absolute) action bar from hiding the last rows.
            selectMode && { paddingBottom: insets.bottom + 88 },
          ]}
          ListEmptyComponent={
            <Text style={styles.emptyText}>
              {t('gallery.empty')}
              {!gallery.fullListing && t('gallery.emptyLimited')}
            </Text>
          }
        />
      )}

      {viewer && (
        <ImageViewer
          visible
          images={viewer.images}
          initialIndex={viewer.index}
          viewUrl={gallery.viewUrl}
          onClose={() => setViewer(null)}
          onRemix={handleRemix}
          onMove={handleViewerMove}
          onDelete={handleViewerDelete}
        />
      )}

      {selectMode && (
        <View
          style={[
            styles.actionBar,
            { paddingBottom: insets.bottom + spacing.sm },
          ]}
        >
          <Text style={styles.actionCount}>
            {t('gallery.selectedCount', { count: selected.size })}
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              selected.size === 0 && { opacity: 0.4 },
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            disabled={selected.size === 0}
            onPress={() => openMovePicker([...selected])}
          >
            <Ionicons name="folder-open-outline" size={18} color={colors.accent} />
            <Text style={styles.actionBtnText}>{t('gallery.move')}</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              selected.size === 0 && { opacity: 0.4 },
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            disabled={selected.size === 0}
            onPress={() =>
              confirmDelete(
                [...selected],
                t('gallery.itemCount', { count: selected.size }),
              )
            }
          >
            <Ionicons name="trash-outline" size={18} color={colors.danger} />
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>
              {t('common.delete')}
            </Text>
          </Pressable>
        </View>
      )}

      <RemixSheet
        state={recipe}
        onClose={() => setRecipe(null)}
        onRequeue={async (graph) => {
          try {
            const number = await remix.requeue(graph);
            setRecipe(null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            showToast(t('gallery.variantQueued', { number }));
          } catch (e) {
            Alert.alert(
              t('gallery.requeueFailed'),
              e instanceof Error ? e.message : String(e),
            );
          }
        }}
      />

      <OutputDirPicker
        visible={movePickerOpen}
        scope="all"
        initial={dir}
        title={t('gallery.moveTo')}
        confirmVerb={t('gallery.moveTo')}
        onSelect={(dest) =>
          movePaths(
            moveTargets,
            dest,
            moveTargets.length === 1
              ? (moveTargets[0].split('/').pop() ?? moveTargets[0])
              : t('gallery.itemCount', { count: moveTargets.length }),
          )
        }
        onClose={() => setMovePickerOpen(false)}
      />

      <OutputDirPicker
        visible={newFolderOpen}
        scope="all"
        initial={dir}
        title={t('gallery.newFolderTitle')}
        confirmVerb={t('gallery.createFolder')}
        onSelect={createFolder}
        onClose={() => setNewFolderOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  upBtn: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  crumbGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  crumb: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  crumbCurrent: {
    color: colors.text,
  },
  crumbSep: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  grid: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  cell: {
    aspectRatio: 1,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  dirCell: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderColor: colors.border,
    borderWidth: 1,
    padding: spacing.xs,
  },
  dirName: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
  },
  dirCount: {
    color: colors.textDisabled,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  cellSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  checkOverlay: {
    position: 'absolute',
    top: 4,
    right: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(6, 4, 9, 0.55)',
  },
  checkOverlayOn: {
    backgroundColor: 'transparent',
  },
  headerActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  selectBtnText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionCount: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionBtnText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  disabledTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.lg,
  },
  disabledDetail: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  retryText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  emptyText: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    lineHeight: 20,
  },
});
