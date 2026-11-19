/**
 * Full-screen viewer: horizontal swipe between items (list frozen at open
 * time). Still images get pinch/pan/double-tap zoom in Reanimated with clamped
 * translations; videos get an expo-video player with autoplay/loop and custom
 * play-pause + scrubber controls. A single tap toggles the chrome (top bar +
 * caption + video controls) for an immersive full-bleed view. Swipe down
 * dismisses, swipe up opens the file details sheet (ImageInfoSheet).
 *
 * Hero transition with the grid (Photos-app style): the image grows out of
 * the tapped thumbnail on open and flies back into its grid cell on close,
 * the backdrop fading so the grid shows through. The Modal is transparent
 * for that reason; the gallery keeps its grid scrolled on the displayed item
 * so the landing cell is always on screen. Videos (no still to fly) and items
 * the grid cannot place fall back to a plain fade.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GalleryImage } from '../hooks/useGallery';
import { radii, spacing, typography } from '../theme/tokens';
import { makeStyles, ThemeOverride, useTheme } from '../theme/theme';
import { showActionSheet, type SheetAction } from '../utils/actionSheet';
import { saveImageToPhotos } from '../utils/saveToPhotos';
import { ImageInfoSheet } from './ImageInfoSheet';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Live transform of a page (zoom + drag), to start the closing flight. */
interface PageTransform {
  tx: number;
  ty: number;
  scale: number;
}

interface Props {
  visible: boolean;
  images: GalleryImage[];
  initialIndex: number;
  viewUrl: (image: GalleryImage) => string;
  /**
   * Leaves the viewer, once its exit animation is over. `flew` tells whether
   * the image flew back into its thumbnail (false: plain fade).
   */
  onClose: (flew: boolean) => void;
  /** Window rect of the tapped thumbnail: the opening flight starts there. */
  originRect?: Rect | null;
  /** Intrinsic sizes already known by the caller (loaded thumbnails). */
  knownSizes?: Record<string, Size>;
  /**
   * Window rect of an item's thumbnail (scrolled into view first), or null
   * when it is not on the grid: the closing flight lands there.
   */
  getThumbRect?: (image: GalleryImage) => Promise<Rect | null>;
  /** The displayed item changed (open, swipe, delete). */
  onCurrentChange?: (image: GalleryImage) => void;
  /**
   * "Create a variant" (Sprint 4b) — shown for images and videos when provided.
   * The recipe comes from the PNG metadata (stills) or /history (both), so a
   * video whose job is still in the session history remixes like an image.
   */
  onRemix?: (image: GalleryImage) => Promise<void>;
  /** Move this item (••• menu) — closes the viewer on the gallery side. */
  onMove?: (image: GalleryImage) => void;
  /**
   * Delete this item (••• menu). Confirms + trashes on the gallery side and
   * resolves true when the file was removed; the viewer then advances to the
   * neighbour item (or closes if it was the last one).
   */
  onDelete?: (image: GalleryImage) => Promise<boolean>;
}

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

// Swipe-down-to-dismiss thresholds (vertical distance OR velocity).
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;
// Swipe-up-for-details thresholds — lower: it opens a sheet, nothing is lost.
const DETAILS_DISTANCE = 60;
const DETAILS_VELOCITY = 700;
// Drag distance (fraction of the page height) at which the backdrop is gone
// and the image has shrunk to its smallest while swiping down.
const DRAG_FULL = 0.5;
const DRAG_MIN_SCALE = 0.7;

// Hero flight between the grid cell and the full-screen image.
const FLIGHT_MS = 320;
const FLIGHT_EASING = Easing.bezier(0.2, 0.85, 0.25, 1);
const FADE_MS = 200;

/** Rect of an image of `size` letterboxed (contain) in a `w × h` page. */
function containRect(size: Size, w: number, h: number): Rect {
  const s = Math.min(w / size.width, h / size.height);
  const width = size.width * s;
  const height = size.height * s;
  return { x: (w - width) / 2, y: (h - height) / 2, width, height };
}

/** `rect` after a page transform (translate, then scale about the centre). */
function transformRect(
  rect: Rect,
  t: PageTransform,
  w: number,
  h: number,
): Rect {
  return {
    x: (rect.x - w / 2) * t.scale + w / 2 + t.tx,
    y: (rect.y - h / 2) * t.scale + h / 2 + t.ty,
    width: rect.width * t.scale,
    height: rect.height * t.scale,
  };
}

/** Shrink applied while an unzoomed image is dragged down to dismiss. */
function dragShrink(ty: number, scale: number, height: number): number {
  'worklet';
  if (scale > 1.01 || ty <= 0) return 1;
  return 1 - Math.min(ty / (height * DRAG_FULL), 1) * (1 - DRAG_MIN_SCALE);
}

/** mm:ss for the video scrubber / duration row. */
function formatClock(sec: number): string {
  const s = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ZoomablePage({
  path,
  uri,
  width,
  height,
  dragProgress,
  registerTransform,
  onZoomChange,
  onDismiss,
  onShowDetails,
  onToggleChrome,
  onImageSize,
  onImageError,
}: {
  path: string;
  uri: string;
  width: number;
  height: number;
  /** 0 → 1 as the image is dragged down: fades the backdrop and chrome. */
  dragProgress: SharedValue<number>;
  /** Exposes the live transform, where the closing flight takes off. */
  registerTransform: (path: string, get: () => PageTransform) => () => void;
  onZoomChange: (zoomed: boolean) => void;
  /** Swipe down on a non-zoomed image → closes the viewer. */
  onDismiss: () => void;
  /** Swipe up on a non-zoomed image → file details sheet. */
  onShowDetails: () => void;
  /** Single tap on a non-zoomed image → hide/show the chrome. */
  onToggleChrome: () => void;
  /** Reports the intrinsic pixel size once the image has loaded. */
  onImageSize: (size: { width: number; height: number }) => void;
  onImageError: () => void;
}) {
  const styles = useStyles('dark');
  const { colors } = useTheme('dark');
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  useEffect(
    () =>
      registerTransform(path, () => ({
        tx: tx.value,
        ty: ty.value,
        scale: scale.value * dragShrink(ty.value, scale.value, height),
      })),
    [registerTransform, path, height, tx, ty, scale],
  );

  const notifyZoom = (z: boolean) => {
    setZoomed(z);
    onZoomChange(z);
  };

  // Clamped translations: the (scaled) image always covers the viewport.
  const clampOffsets = () => {
    'worklet';
    const maxX = (width * (scale.value - 1)) / 2;
    const maxY = (height * (scale.value - 1)) / 2;
    tx.value = Math.min(maxX, Math.max(-maxX, tx.value));
    ty.value = Math.min(maxY, Math.max(-maxY, ty.value));
  };

  const resetZoom = () => {
    'worklet';
    scale.value = withTiming(1);
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedScale.value = 1;
    savedTx.value = 0;
    savedTy.value = 0;
    runOnJS(notifyZoom)(false);
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      'worklet';
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
      clampOffsets();
    })
    .onEnd(() => {
      'worklet';
      if (scale.value <= 1.02) {
        resetZoom();
      } else {
        savedScale.value = scale.value;
        savedTx.value = tx.value;
        savedTy.value = ty.value;
        runOnJS(notifyZoom)(true);
      }
    });

  // Pan only on a zoomed image (otherwise the FlatList keeps the swipe).
  const pan = Gesture.Pan()
    .enabled(zoomed)
    .onUpdate((e) => {
      'worklet';
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
      clampOffsets();
    })
    .onEnd(() => {
      'worklet';
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      'worklet';
      if (scale.value > 1) {
        resetZoom();
      } else {
        const z = DOUBLE_TAP_SCALE;
        const maxX = (width * (z - 1)) / 2;
        const maxY = (height * (z - 1)) / 2;
        const targetX = Math.min(maxX, Math.max(-maxX, (width / 2 - e.x) * z));
        const targetY = Math.min(maxY, Math.max(-maxY, (height / 2 - e.y) * z));
        scale.value = withTiming(z);
        tx.value = withTiming(targetX);
        ty.value = withTiming(targetY);
        savedScale.value = z;
        savedTx.value = targetX;
        savedTy.value = targetY;
        runOnJS(notifyZoom)(true);
      }
    });

  // Single tap → immersive chrome toggle. Exclusive with the double-tap so a
  // zoom gesture is never also read as a chrome toggle.
  const singleTap = Gesture.Tap()
    .numberOfTaps(1)
    .maxDuration(250)
    .onEnd(() => {
      'worklet';
      runOnJS(onToggleChrome)();
    });

  // Vertical swipe (non-zoomed image): DOWN follows the finger in both axes
  // while the image shrinks and the backdrop fades onto the grid; released
  // past the threshold it closes, the flight taking off from where it was
  // dropped. UP opens the file details sheet (damped follow, springs back).
  // `failOffsetX` leaves horizontal swipes to the pager (image navigation).
  const dismissPan = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY([-15, 15])
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      'worklet';
      if (e.translationY > 0) {
        ty.value = e.translationY;
        tx.value = e.translationX;
        dragProgress.value = Math.min(e.translationY / (height * DRAG_FULL), 1);
      } else {
        ty.value = e.translationY / 2;
        tx.value = 0;
        dragProgress.value = 0;
      }
    })
    .onEnd((e) => {
      'worklet';
      if (
        e.translationY < 0 &&
        (-e.translationY > DETAILS_DISTANCE || -e.velocityY > DETAILS_VELOCITY)
      ) {
        ty.value = withTiming(0);
        runOnJS(onShowDetails)();
      } else if (
        e.translationY > 0 &&
        (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY)
      ) {
        runOnJS(onDismiss)();
      } else {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        dragProgress.value = withTiming(0);
      }
    });

  const gesture = Gesture.Race(
    Gesture.Exclusive(doubleTap, singleTap),
    Gesture.Simultaneous(pinch, pan),
    dismissPan,
  );

  // The drag-to-dismiss shrink only applies outside zoom (there ty pans the
  // zoomed image) and only downward (upward opens the details sheet).
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value * dragShrink(ty.value, scale.value, height) },
    ],
  }));

  if (failed) {
    return (
      <View style={[styles.page, { width, height }]}>
        <View style={styles.errorBox}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.warning} />
          <Text style={styles.errorTitle}>{t('viewer.imageUnavailable')}</Text>
          <Text style={styles.errorDetail}>{t('viewer.unavailableBody')}</Text>
          <Pressable
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
            onPress={() => {
              setFailed(false);
              setLoaded(false);
              setAttempt((n) => n + 1);
            }}
          >
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.page, { width, height }]}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ width, height }, animatedStyle]}>
          <Image
            key={attempt}
            source={{ uri: `${uri}${attempt > 0 ? `&retry=${attempt}` : ''}` }}
            style={{ width, height }}
            contentFit="contain"
            cachePolicy="disk"
            transition={100}
            onLoad={(e) => {
              setLoaded(true);
              onImageSize({ width: e.source.width, height: e.source.height });
            }}
            onError={() => {
              setFailed(true);
              onImageError();
            }}
          />
        </Animated.View>
      </GestureDetector>
      {!loaded && (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )}
    </View>
  );
}

function VideoPage({
  uri,
  width,
  height,
  active,
  chromeVisible,
  bottomInset,
  onToggleChrome,
  onDuration,
  onSize,
}: {
  uri: string;
  width: number;
  height: number;
  /** Only the on-screen page plays; the neighbours stay paused. */
  active: boolean;
  chromeVisible: boolean;
  /** Height of the caption bar below — keeps the scrubber clear of it. */
  bottomInset: number;
  onToggleChrome: () => void;
  /** Reports the clip duration (seconds) once known — for the details sheet. */
  onDuration: (seconds: number) => void;
  /** Reports the intrinsic pixel size of the video track, once known. */
  onSize: (size: { width: number; height: number }) => void;
}) {
  const styles = useStyles('dark');
  const { colors } = useTheme('dark');
  const { t } = useTranslation();
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.timeUpdateEventInterval = 0.25;
  });

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const scrubbing = useRef(false);
  const trackWidth = useRef(1);

  useEffect(() => {
    const reportSize = (size?: { width: number; height: number }) => {
      if (size && size.width > 0 && size.height > 0) onSize(size);
    };
    const subs = [
      player.addListener('statusChange', ({ status: s }) => {
        if (s === 'readyToPlay') {
          setStatus('ready');
          if (player.duration > 0) {
            setDuration(player.duration);
            onDuration(player.duration);
          }
          reportSize(player.videoTrack?.size);
        } else if (s === 'error') {
          setStatus('error');
        } else if (s === 'loading') {
          setStatus('loading');
        }
      }),
      // `sourceLoad` carries the track metadata (size + duration) as soon as it
      // is parsed — earlier and more reliably than reading player.videoTrack.
      player.addListener('sourceLoad', ({ duration: d, availableVideoTracks }) => {
        if (d > 0) onDuration(d);
        reportSize(availableVideoTracks?.[0]?.size);
      }),
      player.addListener('videoTrackChange', ({ videoTrack }) =>
        reportSize(videoTrack?.size),
      ),
      player.addListener('playingChange', ({ isPlaying: p }) => setIsPlaying(p)),
      player.addListener('timeUpdate', ({ currentTime }) => {
        if (!scrubbing.current) setPosition(currentTime);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [player, onDuration, onSize]);

  // The on-screen page autoplays; swiping away pauses it.
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  const frac = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd(() => {
      'worklet';
      runOnJS(onToggleChrome)();
    });

  const seekAt = (x: number) => {
    const f = Math.min(1, Math.max(0, x / trackWidth.current));
    const target = f * duration;
    setPosition(target);
    player.currentTime = target;
    scrubbing.current = false;
  };
  const previewAt = (x: number) => {
    scrubbing.current = true;
    const f = Math.min(1, Math.max(0, x / trackWidth.current));
    setPosition(f * duration);
  };
  // minDistance 0 → a tap on the track also seeks (not only a drag).
  const seekPan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      'worklet';
      runOnJS(previewAt)(e.x);
    })
    .onUpdate((e) => {
      'worklet';
      runOnJS(previewAt)(e.x);
    })
    .onEnd((e) => {
      'worklet';
      runOnJS(seekAt)(e.x);
    });

  return (
    <View style={[styles.page, { width, height }]}>
      <GestureDetector gesture={tap}>
        <View style={StyleSheet.absoluteFill}>
          <VideoView
            player={player}
            style={{ width, height }}
            contentFit="contain"
            nativeControls={false}
          />
        </View>
      </GestureDetector>

      {status === 'loading' && (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )}

      {status === 'error' && (
        <View pointerEvents="none" style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.warning} />
          <Text style={styles.errorTitle}>{t('viewer.videoUnavailable')}</Text>
        </View>
      )}

      {chromeVisible && status !== 'error' && (
        <>
          <Pressable
            style={styles.playPauseCenter}
            onPress={() => (isPlaying ? player.pause() : player.play())}
            hitSlop={12}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={34}
              color={colors.text}
            />
          </Pressable>

          <View style={[styles.scrubberRow, { bottom: bottomInset + spacing.sm }]}>
            <Text style={styles.scrubberTime}>{formatClock(position)}</Text>
            <GestureDetector gesture={seekPan}>
              <View
                style={styles.track}
                hitSlop={12}
                onLayout={(e) => {
                  trackWidth.current = e.nativeEvent.layout.width || 1;
                }}
              >
                <View style={styles.trackBase} />
                <View style={[styles.trackFill, { width: `${frac * 100}%` }]} />
                <View style={[styles.trackThumb, { left: `${frac * 100}%` }]} />
              </View>
            </GestureDetector>
            <Text style={styles.scrubberTime}>{formatClock(duration)}</Text>
          </View>
        </>
      )}
    </View>
  );
}

export function ImageViewer({
  visible,
  images,
  initialIndex,
  viewUrl,
  onClose,
  originRect,
  knownSizes,
  getThumbRect,
  onCurrentChange,
  onRemix,
  onMove,
  onDelete,
}: Props) {
  const styles = useStyles('dark');
  const { colors } = useTheme('dark');
  const { t } = useTranslation();
  const [index, setIndex] = useState(initialIndex);
  // Local, mutable copy of the frozen list: deleting drops the item here so
  // the pager keeps going instead of returning to the grid. The viewer is
  // remounted on every open, so seeding from the prop once is enough.
  const [items, setItems] = useState(images);
  const listRef = useRef<FlatList<GalleryImage>>(null);
  const [remixing, setRemixing] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'done'>(
    'idle',
  );
  // An active zoom freezes the pager (otherwise pan/swipe gestures clash).
  const [zoomed, setZoomed] = useState(false);
  // Immersive mode: a single tap hides the top bar + caption + video controls.
  const [chromeVisible, setChromeVisible] = useState(true);
  // Swipe-up file details sheet, on the displayed item.
  const [detailsVisible, setDetailsVisible] = useState(false);
  // Intrinsic pixel sizes reported by loaded pages (image load or video track),
  // keyed by path — feeds the details sheet's dimensions row for both media.
  // Seeded with the grid's loaded thumbnails so the opening flight knows the
  // aspect ratio before the full-screen page has loaded.
  const [imageSizes, setImageSizes] = useState<Record<string, Size>>(
    () => knownSizes ?? {},
  );
  // Clip durations (seconds) reported by loaded video pages, keyed by path.
  const [durations, setDurations] = useState<Record<string, number>>({});
  // Measured caption height, so the video scrubber stays above it.
  const [captionHeight, setCaptionHeight] = useState(0);

  const saveCurrentToPhotos = async (image: GalleryImage) => {
    setSaveState('saving');
    try {
      await saveImageToPhotos(viewUrl(image), image.filename);
      setSaveState('done');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch (e) {
      setSaveState('idle');
      Alert.alert(
        t('gallery.saveFailed'),
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  // Delete the displayed item, then stay in the viewer on the neighbour
  // (the following item slides into the freed slot; else the previous one) —
  // or close when it was the last remaining item.
  const deleteCurrent = async (image: GalleryImage) => {
    if (!onDelete) return;
    const ok = await onDelete(image);
    if (!ok) return;
    const delIndex = items.findIndex((i) => i.path === image.path);
    if (delIndex === -1) return;
    const next = items.filter((_, k) => k !== delIndex);
    if (next.length === 0) {
      onClose(false);
      return;
    }
    const newIndex = Math.min(delIndex, next.length - 1);
    setItems(next);
    setIndex(newIndex);
    setSaveState('idle');
    setZoomed(false); // the neighbour page starts unzoomed → un-freeze the pager
    // Deleting a middle item leaves the pager's pixel offset on the item that
    // shifted into the slot — no scroll needed. Deleting the LAST item leaves
    // the offset past the end, so pull it back to the new last page.
    requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({ index: newIndex, animated: false }),
    );
  };

  // ••• menu: save / move / delete the displayed item.
  const openMenu = (image: GalleryImage) => {
    const actions: SheetAction[] = [
      {
        label: t('gallery.saveToPhotos'),
        onPress: () => saveCurrentToPhotos(image),
      },
    ];
    if (onMove)
      actions.push({ label: t('gallery.move'), onPress: () => onMove(image) });
    if (onDelete) {
      actions.push({
        label: t('common.delete'),
        destructive: true,
        onPress: () => deleteCurrent(image),
      });
    }
    showActionSheet(image.filename, actions);
  };

  const insets = useSafeAreaInsets();
  // ACTUAL measured container size (not Dimensions.get, which can differ on
  // a Modal's first layout → offset pages / black screen).
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(
    null,
  );
  const current = items[index];

  // ---- Hero transition --------------------------------------------------
  // backdrop: black behind the pages; content: pager + chrome. Both start at
  // 0 so the transparent Modal opens onto the grid, then the flight (or the
  // fade fallback) brings them in.
  const backdrop = useSharedValue(0);
  const content = useSharedValue(0);
  const dragProgress = useSharedValue(0);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const fw = useSharedValue(0);
  const fh = useSharedValue(0);
  const fr = useSharedValue(0);
  // Rendered overlay (the flying image); its timeline lives in flightRef.
  const [flightUri, setFlightUri] = useState<string | null>(null);
  const flightRef = useRef<{
    path: string;
    to: Rect;
    closing: boolean;
    launched: boolean;
    landed: boolean;
  } | null>(null);
  const closingRef = useRef(false);
  const startedRef = useRef(false);
  const loadedRef = useRef(new Set<string>());
  const containerRef = useRef<View>(null);
  const windowOffset = useRef({ x: 0, y: 0 });
  const transforms = useRef(new Map<string, () => PageTransform>());

  const registerTransform = useCallback(
    (path: string, get: () => PageTransform) => {
      transforms.current.set(path, get);
      return () => {
        if (transforms.current.get(path) === get) transforms.current.delete(path);
      };
    },
    [],
  );

  // Gallery rects are window coordinates; the Modal may be offset (Android
  // status bar), so bring them into the container's space.
  const toLocal = (r: Rect): Rect => ({
    ...r,
    x: r.x - windowOffset.current.x,
    y: r.y - windowOffset.current.y,
  });

  // Hand over from the flying overlay to the pager (opening flight landed
  // and the page image is ready).
  const reveal = () => {
    if (!flightRef.current || flightRef.current.closing) return;
    flightRef.current = null;
    content.value = 1;
    setFlightUri(null);
  };

  const onFlightEnd = () => {
    const f = flightRef.current;
    if (!f) return;
    if (f.closing) {
      onClose(true);
      return;
    }
    f.landed = true;
    if (loadedRef.current.has(f.path)) reveal();
    // Never leave the overlay up if the page is slow or fails to load.
    else setTimeout(reveal, 1500);
  };

  // Starts once the overlay image is on screen (onDisplay), so hiding the
  // pager never leaves an empty frame. A timer covers a missed callback.
  const launchFlight = () => {
    const f = flightRef.current;
    if (!f || f.launched) return;
    f.launched = true;
    const cfg = { duration: FLIGHT_MS, easing: FLIGHT_EASING };
    content.value = 0;
    backdrop.value = withTiming(f.closing ? 0 : 1, cfg);
    fr.value = withTiming(f.closing ? radii.sm : 0, cfg);
    fx.value = withTiming(f.to.x, cfg);
    fy.value = withTiming(f.to.y, cfg);
    fh.value = withTiming(f.to.height, cfg);
    fw.value = withTiming(f.to.width, cfg, (finished) => {
      if (finished) runOnJS(onFlightEnd)();
    });
  };

  const startFlight = (
    item: GalleryImage,
    from: Rect,
    to: Rect,
    closing: boolean,
  ) => {
    fx.value = from.x;
    fy.value = from.y;
    fw.value = from.width;
    fh.value = from.height;
    fr.value = closing ? 0 : radii.sm;
    flightRef.current = {
      path: item.path,
      to,
      closing,
      launched: false,
      landed: false,
    };
    setFlightUri(viewUrl(item));
    setTimeout(launchFlight, 250);
  };

  const fadeIn = () => {
    backdrop.value = withTiming(1, { duration: FADE_MS });
    content.value = withTiming(1, { duration: FADE_MS });
  };

  // Opening: grow out of the tapped thumbnail when its rect and the image's
  // aspect ratio are known, else fade in.
  const beginOpen = (w: number, h: number) => {
    const item = items[index];
    const size = item ? imageSizes[item.path] : undefined;
    if (originRect && item && !item.isVideo && size) {
      startFlight(item, toLocal(originRect), containRect(size, w, h), false);
    } else {
      fadeIn();
    }
  };

  // Closing: fly from the image's current on-screen rect (zoom and drag
  // included) into its grid cell; fade out when there is no cell to reach.
  const requestClose = async () => {
    if (closingRef.current || flightRef.current) return;
    closingRef.current = true;
    setDetailsVisible(false);
    const item = current;
    const size = item ? imageSizes[item.path] : undefined;
    const target =
      item && !item.isVideo && size && pageSize && getThumbRect
        ? await getThumbRect(item)
        : null;
    if (!item || !size || !pageSize || !target) {
      content.value = withTiming(0, { duration: FADE_MS });
      backdrop.value = withTiming(0, { duration: FADE_MS }, (finished) => {
        if (finished) runOnJS(onClose)(false);
      });
      return;
    }
    const t = transforms.current.get(item.path)?.() ?? {
      tx: 0,
      ty: 0,
      scale: 1,
    };
    const from = transformRect(
      containRect(size, pageSize.w, pageSize.h),
      t,
      pageSize.w,
      pageSize.h,
    );
    // Fold the drag fade into the backdrop so the flight starts from what is
    // on screen.
    backdrop.value = backdrop.value * (1 - dragProgress.value);
    dragProgress.value = 0;
    startFlight(item, from, toLocal(target), true);
  };

  const markLoaded = (path: string) => {
    loadedRef.current.add(path);
    const f = flightRef.current;
    if (f && !f.closing && f.landed && f.path === path) reveal();
  };

  // Keep the gallery on the displayed item (it scrolls the grid behind and
  // empties that cell). Ref'd so an inline callback does not re-fire it.
  const onCurrentChangeRef = useRef(onCurrentChange);
  onCurrentChangeRef.current = onCurrentChange;
  useEffect(() => {
    if (current) onCurrentChangeRef.current?.(current);
  }, [current]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdrop.value * (1 - dragProgress.value),
  }));
  const contentStyle = useAnimatedStyle(() => ({ opacity: content.value }));
  // Chrome clears out fast once a dismiss drag starts.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: content.value * (1 - Math.min(dragProgress.value * 3, 1)),
  }));
  const flightStyle = useAnimatedStyle(() => ({
    left: fx.value,
    top: fy.value,
    width: fw.value,
    height: fh.value,
    borderRadius: fr.value,
  }));

  return (
    <Modal
      visible={visible}
      // Transparent + our own animations: the grid stays visible behind the
      // backdrop, which is what lets the image fly back into its cell.
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      // iOS: a native Modal does NOT follow the app's "default" orientation
      // (defaults to ['portrait'] only) → without this the viewer stays stuck
      // in portrait while the rest of the app rotates. The layout is already
      // measured via onLayout, so it recomputes by itself on rotation.
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape',
        'landscape-left',
        'landscape-right',
      ]}
      onRequestClose={requestClose}
    >
      {/* RNGH gestures require their own root INSIDE a RN Modal. */}
      <ThemeOverride name="dark">
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View
            ref={containerRef}
            style={styles.container}
            onLayout={(e) => {
              const { width: w, height: h } = e.nativeEvent.layout;
              setPageSize({ w, h });
              if (startedRef.current) return;
              startedRef.current = true;
              const node = containerRef.current;
              if (!node) {
                beginOpen(w, h);
                return;
              }
              node.measureInWindow((x, y) => {
                windowOffset.current = { x, y };
                beginOpen(w, h);
              });
            }}
          >
            <Animated.View
              pointerEvents="none"
              style={[styles.backdrop, backdropStyle]}
            />
            <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
            {pageSize && (
              <FlatList
                ref={listRef}
                data={items}
                horizontal
                pagingEnabled
                scrollEnabled={!zoomed}
                // initialScrollIndex (not contentOffset): it ALSO informs the
                // virtualization, which renders the pages around the requested
                // index — contentOffset alone left the window on an unrendered
                // area (black screen on first tap). Reliable here because the
                // width is measured before rendering (onLayout).
                initialScrollIndex={initialIndex}
                onScrollToIndexFailed={(info) => {
                  // Safety net: retry after the first batch has rendered.
                  setTimeout(() => {
                    listRef.current?.scrollToOffset({
                      offset: pageSize.w * info.index,
                      animated: false,
                    });
                  }, 50);
                }}
                getItemLayout={(_, i) => ({
                  length: pageSize.w,
                  offset: pageSize.w * i,
                  index: i,
                })}
                windowSize={3}
                initialNumToRender={2}
                keyExtractor={(img) => img.path}
                renderItem={({ item }) =>
                  item.isVideo ? (
                    <VideoPage
                      uri={viewUrl(item)}
                      width={pageSize.w}
                      height={pageSize.h}
                      active={item.path === current?.path}
                      chromeVisible={chromeVisible}
                      bottomInset={captionHeight}
                      onToggleChrome={() => setChromeVisible((v) => !v)}
                      onDuration={(seconds) =>
                        setDurations((prev) =>
                          prev[item.path] ? prev : { ...prev, [item.path]: seconds },
                        )
                      }
                      onSize={(size) =>
                        setImageSizes((prev) =>
                          prev[item.path] ? prev : { ...prev, [item.path]: size },
                        )
                      }
                    />
                  ) : (
                    <ZoomablePage
                      path={item.path}
                      uri={viewUrl(item)}
                      width={pageSize.w}
                      height={pageSize.h}
                      dragProgress={dragProgress}
                      registerTransform={registerTransform}
                      onZoomChange={setZoomed}
                      onDismiss={requestClose}
                      onShowDetails={() => setDetailsVisible(true)}
                      onToggleChrome={() => setChromeVisible((v) => !v)}
                      onImageSize={(size) => {
                        // The thumbnail's size may be a downscaled decode:
                        // the full image's own size wins.
                        setImageSizes((prev) =>
                          prev[item.path]?.width === size.width &&
                          prev[item.path]?.height === size.height
                            ? prev
                            : { ...prev, [item.path]: size },
                        );
                        markLoaded(item.path);
                      }}
                      onImageError={() => markLoaded(item.path)}
                    />
                  )
                }
                onMomentumScrollEnd={(e) => {
                  setIndex(
                    Math.max(
                      0,
                      Math.min(
                        items.length - 1,
                        Math.round(e.nativeEvent.contentOffset.x / pageSize.w),
                      ),
                    ),
                  );
                  setSaveState('idle');
                }}
                showsHorizontalScrollIndicator={false}
              />
            )}
            </Animated.View>

            {chromeVisible && (
              <Animated.View
                style={[
                  styles.topBar,
                  { paddingTop: insets.top + spacing.sm },
                  chromeStyle,
                ]}
              >
                <Pressable
                  onPress={requestClose}
                  hitSlop={12}
                  style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="close" size={24} color={colors.text} />
                </Pressable>
                <Text style={styles.counter}>
                  {index + 1} / {items.length}
                </Text>
              </Animated.View>
            )}

            {chromeVisible && current && (
              <Animated.View
                style={[
                  styles.caption,
                  { paddingBottom: insets.bottom + spacing.md },
                  chromeStyle,
                ]}
                onLayout={(e) => setCaptionHeight(e.nativeEvent.layout.height)}
              >
                <Text style={styles.captionName} numberOfLines={1}>
                  {current.filename}
                </Text>
                {current.subfolder !== '' && (
                  <Text style={styles.captionFolder} numberOfLines={1}>
                    {current.subfolder}/
                  </Text>
                )}
                <View style={styles.actionsRow}>
                  {onRemix && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.remixBtn,
                        pressed && { backgroundColor: colors.brandPressed },
                        remixing && { opacity: 0.5 },
                      ]}
                      disabled={remixing}
                      onPress={async () => {
                        setRemixing(true);
                        try {
                          await onRemix(current);
                        } finally {
                          setRemixing(false);
                        }
                      }}
                    >
                      <Ionicons
                        name="color-wand-outline"
                        size={18}
                        color={colors.onBrand}
                      />
                      <Text style={styles.remixText}>
                        {remixing
                          ? t('viewer.readingRecipe')
                          : t('gallery.remixAction')}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={({ pressed }) => [
                      styles.saveBtn,
                      // Fill the row when it's the only button (no remix handler).
                      onRemix ? null : styles.saveBtnWide,
                      pressed && { backgroundColor: colors.surfacePressed },
                      saveState === 'saving' && { opacity: 0.5 },
                    ]}
                    disabled={saveState === 'saving'}
                    onPress={() => openMenu(current)}
                    hitSlop={6}
                  >
                    <Ionicons
                      name={
                        saveState === 'done'
                          ? 'checkmark'
                          : saveState === 'saving'
                            ? 'hourglass-outline'
                            : 'ellipsis-horizontal'
                      }
                      size={20}
                      color={saveState === 'done' ? colors.success : colors.text}
                    />
                  </Pressable>
                </View>
              </Animated.View>
            )}

            {flightUri && (
              <Animated.View
                pointerEvents="none"
                style={[styles.flight, flightStyle]}
              >
                <Image
                  source={{ uri: flightUri }}
                  style={styles.flightImage}
                  contentFit="cover"
                  cachePolicy="disk"
                  onDisplay={launchFlight}
                />
              </Animated.View>
            )}

            <ImageInfoSheet
              image={detailsVisible ? (current ?? null) : null}
              dimensions={current ? imageSizes[current.path] : undefined}
              durationSec={current ? durations[current.path] : undefined}
              onClose={() => setDetailsVisible(false)}
            />
          </View>
        </GestureHandlerRootView>
      </ThemeOverride>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  // Transparent: the backdrop below fades independently so the grid can
  // show through during the hero transition and the dismiss drag.
  container: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  page: {
    overflow: 'hidden',
  },
  flight: {
    position: 'absolute',
    overflow: 'hidden',
  },
  flightImage: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playPauseCenter: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -32,
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6, 4, 9, 0.55)',
  },
  scrubberRow: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scrubberTime: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    minWidth: 34,
    textAlign: 'center',
  },
  track: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  trackBase: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  trackThumb: {
    position: 'absolute',
    top: '50%',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginTop: -7,
    marginLeft: -7,
    backgroundColor: colors.text,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: 'rgba(6, 4, 9, 0.75)',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  caption: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: 'rgba(6, 4, 9, 0.75)',
    gap: 2,
  },
  captionName: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  captionFolder: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  remixBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  saveBtn: {
    width: 44,
    minHeight: 44,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnWide: {
    flex: 1,
    width: undefined,
  },
  remixText: {
    color: colors.onBrand,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  errorBox: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  errorTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  errorDetail: {
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
}));
