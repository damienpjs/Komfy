/**
 * Images half of the Library tab: folder navigation through the rebuilt tree
 * (session history + root files), thumbnail grid, full-screen viewer.
 * Disabled when the output volume is not mounted.
 *
 * A component rather than the route itself, on purpose: everything here
 * depends on the server, and it bails out early when the volume is missing
 * or the server is offline. The tab shell (app/(tabs)/library.tsx) owns the
 * segment control *above* this, so those bail-outs can never take the
 * phone-local Prompts half down with them.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation, useRouter, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
// The gesture-handler list (and its RefreshControl) exposes the scroll as a
// native gesture, so the grid pinch can run alongside it instead of losing
// the touch to the scroll view.
import {
  FlatList,
  Gesture,
  GestureDetector,
  RefreshControl,
  type GestureType,
} from 'react-native-gesture-handler';
import Animated, { FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ComfyApiError, createClient } from '../api/client';
import { queryClient } from '../api/queryClient';
import { useGallery, type GalleryImage } from '../hooks/useGallery';
import { useRemix } from '../hooks/useRemix';
import { useImportDraft } from '../store/importDraft';
import { useSettings } from '../store/settings';
import { useToast } from '../store/toast';
import { PICK_FOR_UPLOAD } from '../utils/imageUpload';
import { isHeif } from '../utils/media';
import { remixHref } from '../utils/remixHref';
import { getAnyWorkflow } from '../workflows/registry';
import { saveImageToPhotos } from '../utils/saveToPhotos';
import { useConnection } from '../store/connection';
import {
  effectiveColumns,
  GALLERY_COLUMN_CHOICES,
  useGalleryPrefs,
} from '../store/galleryPrefs';
import { showActionSheet } from '../utils/actionSheet';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { ImageViewer, type Rect, type Size } from './ImageViewer';
import { OutputDirPicker } from './OutputDirPicker';
import { RemixSheet, type RemixSheetState } from './RemixSheet';
import {
  listDirectory,
  type LoraEntry,
  type LoraFileEntry,
} from '../utils/pathTree';

// Pinch scale that changes the column count by one: spread → fewer, bigger
// thumbnails; pinch → denser grid.
const PINCH_STEP_IN = 1.35;
const PINCH_STEP_OUT = 0.75;
// How long the "you were here" ring stays on a cell the viewer closed on
// without the flight animation (videos, unmeasurable cell).
const LANDED_RING_MS = 400;

// Guard against filling the input folder: reject a too-heavy upload locally
// before sending it (same ceiling as the workflow image field).
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30 MB

/** Input subfolder ('' = root) targeted by an upload from the folder `dir`. */
function inputSubfolder(dir: string): string {
  if (dir === 'input') return '';
  if (dir.startsWith('input/')) return dir.slice('input/'.length);
  return ''; // outside input (root or output) → input root
}

export function GalleryBrowser() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const gallery = useGallery();
  const remix = useRemix();
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const chosenColumns = useGalleryPrefs((s) => s.columns);
  const setChosenColumns = useGalleryPrefs((s) => s.setColumns);
  const columns = effectiveColumns(chosenColumns, windowWidth, windowHeight);
  const online = useConnection((s) => s.online);
  const outputAvailable = useConnection((s) => s.outputAvailable);

  const [dir, setDir] = useState('');
  // Snapshot frozen at open time: the gallery keeps refreshing during
  // generations, the viewer must not see its list move.
  const [viewer, setViewer] = useState<{
    images: GalleryImage[];
    index: number;
    /** Window rect of the tapped thumbnail: the image grows out of it. */
    origin: Rect | null;
    /** Intrinsic sizes the grid already knows, so the flights can start. */
    sizes: Record<string, Size>;
  } | null>(null);
  // Item shown full screen: its cell stays empty while the viewer is up, the
  // way the Photos app leaves the slot the image will fly back into.
  const [activePath, setActivePath] = useState<string | null>(null);
  // Cell to ring briefly after a close that could not fly back to it.
  const [landedPath, setLandedPath] = useState<string | null>(null);

  // Grid geometry, kept in refs: the viewer queries it to scroll the grid
  // behind itself and to find where to land, without re-rendering the grid.
  const listRef = useRef<FlatList<LoraEntry>>(null);
  const cellRefs = useRef(new Map<string, View>());
  const thumbSizes = useRef<Record<string, Size>>({});
  const scrollY = useRef(0);
  const [listBox, setListBox] = useState({ width: windowWidth, height: 0 });
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
  const [saving, setSaving] = useState(false);
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

  // Re-tap on the already-active Library tab → back to the output/ root.
  // Only while the Images segment is up: on Prompts this is unmounted, so a
  // re-tap does nothing there.
  // `tabPress` does not exist in expo-router's generic navigation type.
  const navigation = useNavigation() as unknown as {
    addListener(type: 'tabPress', cb: () => void): () => void;
    isFocused(): boolean;
    setOptions(options: { headerRight?: () => React.ReactNode }): void;
  };
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return; // arriving from another tab: no-op
      setDir('');
      setViewer(null);
      setActivePath(null);
      exitSelect();
    });
    return unsub;
  }, [navigation]);
  // The handler changes every render (it reads the current folder): the
  // header button calls the latest one through a ref.
  const uploadRef = useRef<() => void>(() => {});
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => uploadRef.current()}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel={t('gallery.importA11y')}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Ionicons name="cloud-upload-outline" size={22} color={colors.accent} />
          )}
        </Pressable>
      ),
    });
  }, [navigation, uploading, colors.accent, styles.iconBtn, t]);
  useEffect(() => () => navigation.setOptions({ headerRight: undefined }), [navigation]);

  const toggleSelect = (path: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  // Long-press entry point. The bare roots (`input` / `output`, no '/') are
  // structural — nothing to select there, so the hold stays a no-op.
  const startSelect = (path: string) => {
    if (!path.includes('/')) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
  // Returns true when every path was trashed (the viewer relies on this to
  // decide whether to drop the image it just deleted).
  const deletePaths = async (
    paths: string[],
    label: string,
  ): Promise<boolean> => {
    let failed: [string, string][];
    try {
      const result = await createClient(serverUrl).deletePaths(paths);
      failed = Object.entries(result.errors);
    } catch (e) {
      reportWriteError(e, t('gallery.actionDelete'));
      return false;
    }
    if (failed.length) {
      Alert.alert(
        t('gallery.partialDelete'),
        failed.map(([p, e]) => `${p} : ${e}`).join('\n'),
      );
    } else {
      showToast(t('gallery.trashToast', { label }));
    }
    exitSelect();
    invalidateGallery();
    return failed.length === 0;
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
  uploadRef.current = () => {
    void uploadImages();
  };
  const uploadImages = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('imageInput.accessDenied'), t('imageInput.accessDeniedBody'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      ...PICK_FOR_UPLOAD,
      allowsMultipleSelection: true,
    });
    if (result.canceled || result.assets.length === 0) return;

    if (result.assets.some((a) => isHeif(a.fileName ?? a.uri, a.mimeType))) {
      Alert.alert(t('imageInput.heic'), t('imageInput.heicBody'));
      return;
    }

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

  // Move from full screen: close the viewer first (the file is about to
  // change folder), then let its modal finish dismissing before presenting
  // the picker (iOS ignores a presentation started while a modal is
  // dismissing).
  const handleViewerMove = (image: GalleryImage) => {
    closeViewer(true);
    setTimeout(() => openMovePicker([image.path]), 300);
  };

  // Delete from full screen WITHOUT leaving the viewer: confirm over the open
  // Modal (a native alert stacks fine on top of it), trash server-side, and
  // resolve with the outcome so the viewer can advance to the neighbour image
  // instead of falling back to the grid.
  const deleteFromViewer = (image: GalleryImage): Promise<boolean> =>
    new Promise((resolve) => {
      const targets = realTargets([image.path]);
      if (targets.length === 0) {
        resolve(false);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        t('gallery.deleteTitle', { label: image.filename }),
        t('gallery.deleteBody'),
        [
          {
            text: t('common.cancel'),
            style: 'cancel',
            onPress: () => resolve(false),
          },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: () => resolve(deletePaths(targets, image.filename)),
          },
        ],
      );
    });

  const handleRemix = async (image: GalleryImage) => {
    try {
      const result = await remix.extract(image);
      if (result.status === 'match') {
        closeViewer(true);
        router.push(
          remixHref(result.manifestId, result.values, result.sourceSeeds),
        );
      } else if (result.status === 'no-metadata') {
        Alert.alert(t('gallery.noMetadataTitle'), t('gallery.noMetadataBody'));
      } else {
        // Readable recipe but outside the embedded workflows: generic
        // parameter sheet + requeue as-is (Remix v2). Same constraint as
        // move/delete: close the viewer modal first.
        const graph = result.graph;
        closeViewer(true);
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

  // Details sheet "Reuse" on the seed: the same variant, with the source
  // seed applied to the seed fields instead of only offered. Anything that
  // is not an embedded workflow falls back to the plain variant flow.
  const handleReuseSeed = async (image: GalleryImage) => {
    try {
      const result = await remix.extract(image);
      if (result.status !== 'match') {
        await handleRemix(image);
        return;
      }
      const manifest = getAnyWorkflow(result.manifestId);
      const values = { ...result.values };
      for (const [key, seed] of Object.entries(result.sourceSeeds)) {
        // Seed fields only: the zones field carries its seed inside an object.
        if (manifest?.fields.some((f) => f.key === key && f.kind === 'seed')) {
          values[key] = seed;
        }
      }
      closeViewer(true);
      router.push(remixHref(result.manifestId, values, result.sourceSeeds));
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

  // Folders go to the chip row, files to the grid (its row maths, scroll
  // anchoring and reveal all count files only).
  const folders = useMemo(() => entries.filter((e) => e.kind === 'dir'), [entries]);
  const files = useMemo(() => entries.filter((e) => e.kind === 'file'), [entries]);

  const imagesByPath = useMemo(
    () => new Map(gallery.images.map((i) => [i.path, i])),
    [gallery.images],
  );

  // Images of the current folder (grid display order), for full-screen
  // swiping.
  const dirImages = useMemo(() => {
    const files = entries.filter((e) => e.kind === 'file');
    return files
      .map((f) => (f.kind === 'file' ? imagesByPath.get(f.path) : undefined))
      .filter((i): i is GalleryImage => !!i);
  }, [entries, imagesByPath]);

  // Square cells: one stride per row (cell + row gap). Mirrors the FlatList
  // layout below (grid padding, column gap) so getItemLayout and the scroll
  // maths agree with what Yoga lays out.
  const cellSize =
    (listBox.width - 2 * spacing.md - (columns - 1) * spacing.xs) / columns;
  const rowStride = cellSize + spacing.xs;
  const rowCount = Math.ceil(files.length / columns);

  // First visible entry, so a column change (pinch, picker, rotation) reopens
  // the grid on the same images instead of jumping back to the top. Read
  // once per column count: FlatList only honours it when `key` remounts it.
  const firstVisible = useRef(0);
  const anchorRow = useMemo(
    () => Math.floor(firstVisible.current / columns),
    [columns],
  );

  // Scroll the grid (hidden behind the viewer) so `path`'s row is on screen.
  // Returns false when the item is not in the current folder.
  const revealPath = (path: string): boolean => {
    const idx = files.findIndex((e) => e.kind === 'file' && e.path === path);
    if (idx === -1 || rowStride <= 0) return false;
    const top = Math.floor(idx / columns) * rowStride;
    const bottom = top + cellSize;
    const viewTop = scrollY.current;
    const viewBottom = viewTop + listBox.height;
    let target: number | null = null;
    if (top < viewTop) target = top - spacing.xs;
    else if (bottom > viewBottom) target = bottom - listBox.height + spacing.xs;
    if (target !== null) {
      const offset = Math.max(0, target);
      scrollY.current = offset;
      listRef.current?.scrollToOffset({ offset, animated: false });
    }
    return true;
  };

  // Window rect of a thumbnail, scrolled into view first. Polls a few frames:
  // a far jump lets the FlatList render the new window before the cell
  // exists to be measured.
  const getThumbRect = (image: GalleryImage): Promise<Rect | null> =>
    new Promise((resolve) => {
      if (!revealPath(image.path)) {
        resolve(null);
        return;
      }
      let tries = 0;
      const attempt = () => {
        const node = cellRefs.current.get(image.path);
        if (node) {
          node.measureInWindow((x, y, width, height) =>
            resolve(width > 0 && height > 0 ? { x, y, width, height } : null),
          );
          return;
        }
        tries += 1;
        if (tries > 12) resolve(null);
        else requestAnimationFrame(attempt);
      };
      requestAnimationFrame(attempt);
    });

  const openViewer = (image: GalleryImage, index: number) => {
    const open = (origin: Rect | null) =>
      setViewer({
        images: dirImages,
        index,
        origin,
        sizes: { ...thumbSizes.current },
      });
    const node = cellRefs.current.get(image.path);
    if (!node) {
      open(null);
      return;
    }
    node.measureInWindow((x, y, width, height) =>
      open(width > 0 && height > 0 ? { x, y, width, height } : null),
    );
  };

  const closeViewer = (flew: boolean) => {
    if (!flew && activePath) {
      // No flight to follow: ring the cell instead, so the eye still finds it.
      const path = activePath;
      setLandedPath(path);
      setTimeout(
        () => setLandedPath((p) => (p === path ? null : p)),
        LANDED_RING_MS,
      );
    }
    setViewer(null);
    setActivePath(null);
  };

  const changeColumns = (next: number) => {
    if (next === chosenColumns) return;
    Haptics.selectionAsync();
    setChosenColumns(next);
  };

  const openColumnPicker = () =>
    showActionSheet(
      t('gallery.gridTitle'),
      GALLERY_COLUMN_CHOICES.map((n) => ({
        label:
          (n === chosenColumns ? '✓ ' : '') + t('gallery.perRow', { count: n }),
        onPress: () => changeColumns(n),
      })),
      t('gallery.gridHint'),
    );

  // Pinch on the grid, like the Photos app: spread for bigger thumbnails,
  // pinch for a denser grid. One column per gesture, so a long pinch never
  // races through every size. The pinch sits on a stable wrapper, not on
  // the FlatList: a new column count remounts the list (numColumns cannot
  // change in place). The list declares it simultaneous with its scroll
  // handler (`simultaneousHandlers`): the scroll wrapper blocks any other
  // gesture once active, and a pinch's fingers always drag the list first.
  const pinchRef = useRef<GestureType | undefined>(undefined);
  const pinchStepped = useRef(false);
  const pinch = Gesture.Pinch()
    .withRef(pinchRef)
    .runOnJS(true)
    .onStart(() => {
      pinchStepped.current = false;
    })
    .onUpdate((e) => {
      if (pinchStepped.current) return;
      const step =
        e.scale > PINCH_STEP_IN ? -1 : e.scale < PINCH_STEP_OUT ? 1 : 0;
      if (step === 0) return;
      pinchStepped.current = true;
      const choices: readonly number[] = GALLERY_COLUMN_CHOICES;
      const next = useGalleryPrefs.getState().columns + step;
      if (choices.includes(next)) changeColumns(next);
    });

  // Files of the selection, resolved to images. Folders never resolve, so a
  // checked folder makes the counts diverge and disables the Save button.
  const selectedImages = useMemo(
    () =>
      [...selected]
        .map((p) => imagesByPath.get(p))
        .filter((i): i is GalleryImage => !!i),
    [selected, imagesByPath],
  );
  const selectionHasDir = selectedImages.length !== selected.size;

  // Batch download into the photo library. Sequential on purpose: one
  // permission prompt, then a predictable order and a single failure alert.
  // On failure the selection is kept so the user can retry.
  const saveSelectionToPhotos = async () => {
    if (selectedImages.length === 0) return;
    setSaving(true);
    let done = 0;
    try {
      for (const image of selectedImages) {
        await saveImageToPhotos(gallery.viewUrl(image), image.filename);
        done += 1;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(t('gallery.savedCount', { count: done }));
      exitSelect();
    } catch (e) {
      Alert.alert(
        t('gallery.saveFailed'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setSaving(false);
    }
  };

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
  const crumbScrollRef = useRef<ScrollView>(null);

  if (outputAvailable === false) {
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

  const renderFolderChip = (folder: LoraEntry) => {
    if (folder.kind !== 'dir') return null;
    const path = dir === '' ? folder.name : `${dir}/${folder.name}`;
    const isSelected = selected.has(path);
    return (
      <Pressable
        key={path}
        accessibilityRole="button"
        accessibilityState={selectMode ? { selected: isSelected } : undefined}
        style={({ pressed }) => [
          styles.folderChip,
          isSelected && styles.folderChipSelected,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
        onPress={() => (selectMode ? toggleSelect(path) : setDir(path))}
        onLongPress={() => (selectMode ? toggleSelect(path) : startSelect(path))}
      >
        <Ionicons
          name={selectMode ? (isSelected ? 'checkmark-circle' : 'ellipse-outline') : 'folder-outline'}
          size={16}
          color={isSelected ? colors.accent : colors.textMuted}
        />
        <Text style={styles.folderName} numberOfLines={1}>
          {folder.name}
        </Text>
        <Text style={styles.folderCount}>{folder.count}</Text>
      </Pressable>
    );
  };

  const renderEntry = ({ item }: { item: LoraEntry; index: number }) => {
    if (item.kind === 'dir') return null;
    const image = imagesByPath.get(item.path);
    if (!image) return null;
    const imageIndex = dirImages.indexOf(image);
    const isSelected = selected.has(image.path);
    // Empty slot while this image is full screen (it flies back into it).
    const isActive = viewer !== null && activePath === image.path;
    return (
      <Pressable
        ref={(node) => {
          if (node) cellRefs.current.set(image.path, node);
          else cellRefs.current.delete(image.path);
        }}
        style={({ pressed }) => [
          styles.cell,
          { flex: 1 / columns },
          isSelected && styles.cellSelected,
          pressed && { opacity: 0.7 },
          isActive && styles.cellActive,
        ]}
        onPress={() =>
          selectMode
            ? toggleSelect(image.path)
            : openViewer(image, imageIndex)
        }
        onLongPress={() =>
          selectMode ? toggleSelect(image.path) : startSelect(image.path)
        }
      >
        {image.isVideo ? (
          // expo-image cannot decode a video frame; show a labelled
          // placeholder with a play badge instead (thumbnail generation
          // would mean downloading every clip).
          <View style={styles.videoThumb}>
            <Ionicons name="film-outline" size={26} color={colors.textMuted} />
            <Text style={styles.videoThumbName} numberOfLines={1}>
              {image.filename}
            </Text>
            <View style={styles.playBadge}>
              <Ionicons name="play" size={12} color={colors.text} />
            </View>
          </View>
        ) : (
          <Image
            source={{ uri: gallery.viewUrl(image) }}
            style={styles.thumb}
            contentFit="cover"
            cachePolicy="disk"
            recyclingKey={image.path}
            transition={100}
            onLoad={(e) => {
              thumbSizes.current[image.path] = {
                width: e.source.width,
                height: e.source.height,
              };
            }}
          />
        )}
        {landedPath === image.path && (
          <Animated.View
            pointerEvents="none"
            exiting={FadeOut.duration(450)}
            style={styles.landedRing}
          />
        )}
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
      <View style={styles.navRow}>
        <ScrollView
          ref={crumbScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          // A deep path keeps its current folder (the end) in view.
          onContentSizeChange={() => crumbScrollRef.current?.scrollToEnd({ animated: false })}
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
        <View style={styles.headerActions}>
          {!selectMode && (
            <Pressable
              onPress={openColumnPicker}
              accessibilityRole="button"
              accessibilityLabel={t('gallery.gridTitle')}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="grid-outline" size={20} color={colors.textMuted} />
            </Pressable>
          )}
          {selectMode && allPaths.length > 0 && (
            <Pressable
              onPress={toggleSelectAll}
              accessibilityRole="button"
              style={({ pressed }) => [styles.textBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.selectBtnText}>
                {allSelected ? t('gallery.deselectAll') : t('gallery.selectAll')}
              </Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}
            accessibilityRole="button"
            style={({ pressed }) => [styles.textBtn, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.selectBtnText}>
              {selectMode ? t('common.cancel') : t('gallery.select')}
            </Text>
          </Pressable>
        </View>
      </View>

      {!gallery.isLoading && (folders.length > 0 || !selectMode) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chips}
        >
          {folders.map(renderFolderChip)}
          {!selectMode && (
            <Pressable
              onPress={() => setNewFolderOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('gallery.newFolderTitle')}
              style={({ pressed }) => [
                styles.folderChip,
                styles.newFolderChip,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              <Ionicons name="add" size={18} color={colors.accent} />
            </Pressable>
          )}
        </ScrollView>
      )}

      {gallery.isLoading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <GestureDetector gesture={pinch}>
        <View style={styles.listWrap} collapsable={false}>
        <FlatList
          ref={listRef}
          simultaneousHandlers={pinchRef}
          data={files}
          key={columns}
          numColumns={columns}
          keyExtractor={(e) => (e.kind === 'dir' ? `d:${e.name}` : e.path)}
          renderItem={renderEntry}
          columnWrapperStyle={{ gap: spacing.xs }}
          // Index = row (FlatList hands rows to VirtualizedList). Offsets
          // include the row gap, so spacers and cells line up.
          getItemLayout={(_, index) => ({
            length: cellSize,
            offset: rowStride * index,
            index,
          })}
          initialScrollIndex={
            rowCount > 0 && anchorRow > 0
              ? Math.min(anchorRow, rowCount - 1)
              : undefined
          }
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setListBox((b) =>
              b.width === width && b.height === height ? b : { width, height },
            );
          }}
          onScroll={(e) => {
            const y = e.nativeEvent.contentOffset.y;
            scrollY.current = y;
            if (rowStride > 0) {
              firstVisible.current =
                Math.max(0, Math.floor(y / rowStride)) * columns;
            }
          }}
          scrollEventThrottle={32}
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
          // A folder holding only subfolders is not empty: its chips say so.
          ListEmptyComponent={
            folders.length > 0 ? null : (
              <Text style={styles.emptyText}>
                {t('gallery.empty')}
                {!gallery.fullListing && t('gallery.emptyLimited')}
              </Text>
            )
          }
        />
        </View>
        </GestureDetector>
      )}

      {viewer && (
        <ImageViewer
          visible
          images={viewer.images}
          initialIndex={viewer.index}
          viewUrl={gallery.viewUrl}
          originRect={viewer.origin}
          knownSizes={viewer.sizes}
          getThumbRect={getThumbRect}
          onCurrentChange={(image) => {
            setActivePath(image.path);
            revealPath(image.path);
          }}
          onClose={closeViewer}
          onRemix={handleRemix}
          onReuseSeed={handleReuseSeed}
          onMove={handleViewerMove}
          onDelete={deleteFromViewer}
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
            accessibilityLabel={t('gallery.save')}
            style={({ pressed }) => [
              styles.actionBtn,
              (selectedImages.length === 0 || selectionHasDir || saving) && {
                opacity: 0.4,
              },
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            disabled={selectedImages.length === 0 || selectionHasDir || saving}
            onPress={saveSelectionToPhotos}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons
                name="download-outline"
                size={20}
                color={colors.accent}
              />
            )}
          </Pressable>
          <Pressable
            accessibilityLabel={t('gallery.move')}
            style={({ pressed }) => [
              styles.actionBtn,
              (selected.size === 0 || saving) && { opacity: 0.4 },
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            disabled={selected.size === 0 || saving}
            onPress={() => openMovePicker([...selected])}
          >
            <Ionicons name="folder-open-outline" size={20} color={colors.accent} />
          </Pressable>
          <Pressable
            accessibilityLabel={t('common.delete')}
            style={({ pressed }) => [
              styles.actionBtn,
              (selected.size === 0 || saving) && { opacity: 0.4 },
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            disabled={selected.size === 0 || saving}
            onPress={() =>
              confirmDelete(
                [...selected],
                t('gallery.itemCount', { count: selected.size }),
              )
            }
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        </View>
      )}

      <RemixSheet
        state={recipe}
        onClose={() => setRecipe(null)}
        onImport={(graph, filename) => {
          setRecipe(null);
          // Default name = the PNG's basename (editable on the screen).
          useImportDraft
            .getState()
            .set(graph, filename.replace(/\.[a-z0-9]+$/i, ''));
          router.push('/workflow/import' as Href);
        }}
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

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.md - 6,
    paddingRight: spacing.sm,
    paddingTop: spacing.xs,
  },
  crumbScroll: {
    flex: 1,
  },
  crumbs: {
    alignItems: 'center',
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
  iconBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtn: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  chipScroll: {
    flexGrow: 0,
  },
  chips: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm + 2,
  },
  folderChip: {
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
  folderChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  newFolderChip: {
    width: 44,
    paddingHorizontal: 0,
    justifyContent: 'center',
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
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
  listWrap: {
    flex: 1,
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
  thumb: {
    width: '100%',
    height: '100%',
  },
  videoThumb: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
    backgroundColor: colors.bgElevated,
  },
  videoThumbName: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
  },
  playBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6, 4, 9, 0.6)',
  },
  cellSelected: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  cellActive: {
    opacity: 0,
  },
  landedRing: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.accentStrong,
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
    flexDirection: 'row',
    alignItems: 'center',
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
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
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
    backgroundColor: colors.strong,
  },
  retryText: {
    color: colors.onStrong,
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
}));
