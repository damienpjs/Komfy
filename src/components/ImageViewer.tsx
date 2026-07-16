/**
 * Full-screen viewer: horizontal swipe between images (list frozen at open
 * time), pinch/pan/double-tap zoom in Reanimated with clamped translations —
 * the image can never leave the viewport. Loading spinner, handling of
 * unserved files (evicted iCloud 404 → retry).
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
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
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GalleryImage } from '../hooks/useGallery';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { showActionSheet, type SheetAction } from '../utils/actionSheet';
import { saveImageToPhotos } from '../utils/saveToPhotos';

interface Props {
  visible: boolean;
  images: GalleryImage[];
  initialIndex: number;
  viewUrl: (image: GalleryImage) => string;
  onClose: () => void;
  /** "Create a variant" (Sprint 4b) — shown when provided. */
  onRemix?: (image: GalleryImage) => Promise<void>;
  /** Move this image (••• menu) — closes the viewer on the gallery side. */
  onMove?: (image: GalleryImage) => void;
  /**
   * Delete this image (••• menu). Confirms + trashes on the gallery side and
   * resolves true when the file was removed; the viewer then advances to the
   * neighbour image (or closes if it was the last one).
   */
  onDelete?: (image: GalleryImage) => Promise<boolean>;
}

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

// Swipe-to-dismiss thresholds (vertical distance OR velocity).
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;

function ZoomablePage({
  uri,
  width,
  height,
  onZoomChange,
  onDismiss,
}: {
  uri: string;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
  /** Vertical swipe (up/down) on a non-zoomed image → closes the viewer. */
  onDismiss: () => void;
}) {
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

  // Vertical dismiss swipe (non-zoomed image): the image follows the finger
  // then escapes top/bottom on release when the threshold is crossed.
  // `failOffsetX` leaves horizontal swipes to the pager (image navigation).
  const dismissPan = Gesture.Pan()
    .enabled(!zoomed)
    .activeOffsetY([-15, 15])
    .failOffsetX([-20, 20])
    .onUpdate((e) => {
      'worklet';
      ty.value = e.translationY;
    })
    .onEnd((e) => {
      'worklet';
      if (
        Math.abs(e.translationY) > DISMISS_DISTANCE ||
        Math.abs(e.velocityY) > DISMISS_VELOCITY
      ) {
        // Leaves the screen in the swipe direction, then closes.
        ty.value = withTiming(
          Math.sign(e.translationY || 1) * height,
          { duration: 180 },
          () => runOnJS(onDismiss)(),
        );
      } else {
        ty.value = withTiming(0);
      }
    });

  const gesture = Gesture.Race(
    doubleTap,
    Gesture.Simultaneous(pinch, pan),
    dismissPan,
  );

  const animatedStyle = useAnimatedStyle(() => {
    // Fade proportional to the drag, only outside zoom (otherwise ty is
    // used to move the zoomed image).
    const dismissing = scale.value <= 1.01;
    const progress = dismissing
      ? Math.min(Math.abs(ty.value) / (height * 0.6), 1)
      : 0;
    return {
      opacity: 1 - progress * 0.75,
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { scale: scale.value },
      ],
    };
  });

  if (failed) {
    return (
      <View style={[styles.page, { width, height }]}>
        <View style={styles.errorBox}>
          <Ionicons name="cloud-offline-outline" size={40} color={colors.warning} />
          <Text style={styles.errorTitle}>{t('viewer.imageUnavailable')}</Text>
          <Text style={styles.errorDetail}>{t('viewer.icloudBody')}</Text>
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
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
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

export function ImageViewer({
  visible,
  images,
  initialIndex,
  viewUrl,
  onClose,
  onRemix,
  onMove,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(initialIndex);
  // Local, mutable copy of the frozen list: deleting drops the image here so
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

  // Delete the displayed image, then stay in the viewer on the neighbour
  // (the following image slides into the freed slot; else the previous one) —
  // or close when it was the last remaining image.
  const deleteCurrent = async (image: GalleryImage) => {
    if (!onDelete) return;
    const ok = await onDelete(image);
    if (!ok) return;
    const delIndex = items.findIndex((i) => i.path === image.path);
    if (delIndex === -1) return;
    const next = items.filter((_, k) => k !== delIndex);
    if (next.length === 0) {
      onClose();
      return;
    }
    const newIndex = Math.min(delIndex, next.length - 1);
    setItems(next);
    setIndex(newIndex);
    setSaveState('idle');
    setZoomed(false); // the neighbour page starts unzoomed → un-freeze the pager
    // Deleting a middle image leaves the pager's pixel offset on the image
    // that shifted into the slot — no scroll needed. Deleting the LAST image
    // leaves the offset past the end, so pull it back to the new last page.
    requestAnimationFrame(() =>
      listRef.current?.scrollToIndex({ index: newIndex, animated: false }),
    );
  };

  // ••• menu: save / move / delete the displayed image.
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

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
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
      onRequestClose={onClose}
    >
      {/* RNGH gestures require their own root INSIDE a RN Modal. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View
          style={styles.container}
          onLayout={(e) => {
            const { width: w, height: h } = e.nativeEvent.layout;
            setPageSize({ w, h });
          }}
        >
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
              renderItem={({ item }) => (
                <ZoomablePage
                  uri={viewUrl(item)}
                  width={pageSize.w}
                  height={pageSize.h}
                  onZoomChange={setZoomed}
                  onDismiss={onClose}
                />
              )}
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

          <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
            <Text style={styles.counter}>
              {index + 1} / {items.length}
            </Text>
          </View>

          {current && (
            <View
              style={[styles.caption, { paddingBottom: insets.bottom + spacing.md }]}
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
                      pressed && { backgroundColor: colors.accentPressed },
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
                      color={colors.text}
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
            </View>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  page: {
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
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
    backgroundColor: colors.accent,
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
  remixText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  errorBox: {
    flex: 1,
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
    backgroundColor: colors.accent,
  },
  retryText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
