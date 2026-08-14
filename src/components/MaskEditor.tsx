/**
 * Full-screen mask editor: the user paints the area to inpaint over the
 * source image with a finger, pinching to zoom for the fine work.
 *
 * The overlay showing the painted area is the *real* mask, rasterized and
 * PNG-encoded in JS on every change (cf. utils/maskRaster) — at preview
 * resolution while drawing, so what you see is literally what gets uploaded,
 * feathered edges and eraser included. There is no native canvas involved:
 * Komfy ships as a JS-only Expo Go bundle.
 *
 * Gestures: one finger draws, two fingers pan/zoom (raced, so a second
 * finger landing never leaves a stray stroke behind).
 */

import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  maskDimensions,
  maskToOverlayPngBase64,
  rasterizeMask,
  type MaskPoint,
  type MaskStroke,
} from '../utils/maskRaster';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

/** Long side of the raster backing the on-screen overlay. */
const PREVIEW_MAX_SIDE = 320;
/** Shortest gap between two overlay refreshes while a stroke is in progress. */
const PREVIEW_THROTTLE_MS = 60;
/** A sample is kept once the finger has travelled this far (screen points). */
const MIN_SAMPLE_DISTANCE = 2;

const BRUSH_MIN = 6;
const BRUSH_MAX = 160;
const BRUSH_DEFAULT = 44;

const MIN_SCALE = 1;
const MAX_SCALE = 8;

interface Props {
  visible: boolean;
  /** /view URL of the already-uploaded source image. */
  sourceUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** Strokes to resume from (re-opening the editor keeps the drawing). */
  initialStrokes: MaskStroke[];
  onCancel: () => void;
  onDone: (strokes: MaskStroke[]) => void;
}

export function MaskEditor({
  visible,
  sourceUrl,
  imageWidth,
  imageHeight,
  initialStrokes,
  onCancel,
  onDone,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [strokes, setStrokes] = useState<MaskStroke[]>(initialStrokes);
  const [brush, setBrush] = useState(BRUSH_DEFAULT);
  const [erasing, setErasing] = useState(false);
  const [overlay, setOverlay] = useState<string | null>(null);
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });

  // View transform (pinch/pan). Mirrored into refs because the gesture
  // callbacks must not depend on it: rebuilding the gesture objects while a
  // finger is down re-attaches the GestureDetector and drops the gesture.
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  const gestureStart = useRef({ scale: 1, x: 0, y: 0 });

  // Same reason: everything the drawing maths reads is mirrored, so the
  // gestures below can be built once.
  const baseRef = useRef({ width: 0, height: 0, left: 0, top: 0 });
  const canvasRef = useRef({ width: 0, height: 0 });
  const brushRef = useRef(BRUSH_DEFAULT);
  const erasingRef = useRef(false);

  // The stroke being drawn lives in a ref so each finger move mutates it
  // without a re-render; the overlay refresh is what shows it.
  const current = useRef<MaskStroke | null>(null);
  const lastScreenPoint = useRef<MaskPoint | null>(null);
  const lastPreviewAt = useRef(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewTick, setPreviewTick] = useState(0);
  /** Set when a second finger joins: the half-drawn stroke is thrown away. */
  const aborted = useRef(false);

  const applyScale = useCallback((next: number) => {
    scaleRef.current = next;
    setScale(next);
  }, []);
  const applyOffset = useCallback((next: { x: number; y: number }) => {
    offsetRef.current = next;
    setOffset(next);
  }, []);

  useEffect(() => {
    brushRef.current = brush;
  }, [brush]);
  useEffect(() => {
    erasingRef.current = erasing;
  }, [erasing]);
  useEffect(() => {
    canvasRef.current = canvas;
  }, [canvas]);

  // Re-arm from the caller's strokes each time the editor opens.
  useEffect(() => {
    if (visible) {
      setStrokes(initialStrokes);
      applyScale(1);
      applyOffset({ x: 0, y: 0 });
      setPreviewTick((n) => n + 1);
    }
    // initialStrokes is a fresh array on every parent render; `visible` is
    // the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** Rect the image occupies, unzoomed, inside the canvas ("contain" fit). */
  const base = useMemo(() => {
    if (!canvas.width || !canvas.height || !imageWidth || !imageHeight) {
      return { width: 0, height: 0, left: 0, top: 0 };
    }
    const fit = Math.min(
      canvas.width / imageWidth,
      canvas.height / imageHeight,
    );
    const width = imageWidth * fit;
    const height = imageHeight * fit;
    return {
      width,
      height,
      left: (canvas.width - width) / 2,
      top: (canvas.height - height) / 2,
    };
  }, [canvas, imageWidth, imageHeight]);

  useEffect(() => {
    baseRef.current = base;
  }, [base]);

  const previewSize = useMemo(
    () => maskDimensions(imageWidth || 1, imageHeight || 1, PREVIEW_MAX_SIDE),
    [imageWidth, imageHeight],
  );

  /** Rebuilds the overlay PNG from the committed strokes + the live one. */
  useEffect(() => {
    if (!visible) return;
    const all = current.current ? [...strokes, current.current] : strokes;
    if (all.length === 0) {
      setOverlay(null);
      return;
    }
    const mask = rasterizeMask(all, previewSize.width, previewSize.height);
    setOverlay(
      maskToOverlayPngBase64(mask, previewSize.width, previewSize.height),
    );
  }, [previewTick, strokes, previewSize, visible]);

  /** Throttled overlay refresh — called on every finger move. */
  const refreshPreview = useCallback((immediate = false) => {
    const now = Date.now();
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    const elapsed = now - lastPreviewAt.current;
    if (immediate || elapsed >= PREVIEW_THROTTLE_MS) {
      lastPreviewAt.current = now;
      setPreviewTick((n) => n + 1);
      return;
    }
    // Trailing refresh, so the last few points never stay invisible.
    previewTimer.current = setTimeout(() => {
      lastPreviewAt.current = Date.now();
      setPreviewTick((n) => n + 1);
    }, PREVIEW_THROTTLE_MS - elapsed);
  }, []);

  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    },
    [],
  );

  /** Canvas point → normalized image coordinates, undoing the zoom/pan. */
  const toImageSpace = useCallback(
    (px: number, py: number): MaskPoint | null => {
      const b = baseRef.current;
      const c = canvasRef.current;
      if (!b.width || !b.height) return null;
      const cx = c.width / 2;
      const cy = c.height / 2;
      const ux = (px - cx - offsetRef.current.x) / scaleRef.current + cx;
      const uy = (py - cy - offsetRef.current.y) / scaleRef.current + cy;
      return { x: (ux - b.left) / b.width, y: (uy - b.top) / b.height };
    },
    [],
  );

  /**
   * Brush radius as a fraction of the image's long side. The brush keeps a
   * constant *screen* size, so zooming in genuinely buys precision.
   */
  const normalizedRadius = useCallback(() => {
    const b = baseRef.current;
    const longSide = Math.max(b.width, b.height);
    if (!longSide) return 0.02;
    return brushRef.current / 2 / scaleRef.current / longSide;
  }, []);

  const gesture = useMemo(() => {
    const draw = Gesture.Pan()
      .maxPointers(1)
      // Activate on touch-down rather than after a drag threshold, so a
      // single tap lays a dot instead of doing nothing.
      .minDistance(0)
      .runOnJS(true)
      .onTouchesDown((e) => {
        // A second finger means the user wants to zoom, not to draw.
        if (e.numberOfTouches > 1) aborted.current = true;
      })
      .onBegin((e) => {
        const p = toImageSpace(e.x, e.y);
        if (!p) return;
        aborted.current = false;
        current.current = {
          points: [p],
          radius: normalizedRadius(),
          erase: erasingRef.current,
        };
        lastScreenPoint.current = { x: e.x, y: e.y };
        refreshPreview(true);
      })
      .onUpdate((e) => {
        const stroke = current.current;
        const last = lastScreenPoint.current;
        if (!stroke || !last || aborted.current) return;
        // Drop near-duplicate samples: fewer segments to rasterize, and the
        // capsule chain stays identical to the eye.
        const dx = e.x - last.x;
        const dy = e.y - last.y;
        if (dx * dx + dy * dy < MIN_SAMPLE_DISTANCE * MIN_SAMPLE_DISTANCE) {
          return;
        }
        const p = toImageSpace(e.x, e.y);
        if (!p) return;
        stroke.points.push(p);
        lastScreenPoint.current = { x: e.x, y: e.y };
        refreshPreview();
      })
      .onFinalize(() => {
        const stroke = current.current;
        const discarded = aborted.current;
        current.current = null;
        lastScreenPoint.current = null;
        aborted.current = false;
        if (!stroke || discarded) {
          // Repaint without the abandoned stroke.
          if (stroke) refreshPreview(true);
          return;
        }
        setStrokes((prev) => [...prev, stroke]);
        refreshPreview(true);
      });

    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        gestureStart.current.scale = scaleRef.current;
      })
      .onUpdate((e) => {
        applyScale(
          Math.min(
            MAX_SCALE,
            Math.max(MIN_SCALE, gestureStart.current.scale * e.scale),
          ),
        );
      });

    const twoFingerPan = Gesture.Pan()
      .minPointers(2)
      .runOnJS(true)
      .onBegin(() => {
        gestureStart.current.x = offsetRef.current.x;
        gestureStart.current.y = offsetRef.current.y;
      })
      .onUpdate((e) => {
        applyOffset({
          x: gestureStart.current.x + e.translationX,
          y: gestureStart.current.y + e.translationY,
        });
      });

    return Gesture.Simultaneous(draw, Gesture.Simultaneous(pinch, twoFingerPan));
  }, [toImageSpace, normalizedRadius, refreshPreview, applyScale, applyOffset]);

  const undo = () => {
    Haptics.selectionAsync();
    setStrokes((prev) => prev.slice(0, -1));
    refreshPreview(true);
  };

  const clear = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStrokes([]);
    refreshPreview(true);
  };

  const resetView = () => {
    applyScale(1);
    applyOffset({ x: 0, y: 0 });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={onCancel} hitSlop={8} style={styles.headerBtn}>
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('maskEditor.title')}</Text>
          <Pressable
            onPress={() => onDone(strokes)}
            hitSlop={8}
            style={styles.headerBtn}
          >
            <Text style={styles.done}>{t('common.done')}</Text>
          </Pressable>
        </View>

        <View
          style={styles.canvas}
          onLayout={(e) =>
            setCanvas({
              width: e.nativeEvent.layout.width,
              height: e.nativeEvent.layout.height,
            })
          }
        >
          <GestureDetector gesture={gesture}>
            <View style={styles.canvasInner}>
              <View
                style={{
                  transform: [
                    { translateX: offset.x },
                    { translateY: offset.y },
                    { scale },
                  ],
                  ...StyleSheet.absoluteFillObject,
                }}
                pointerEvents="none"
              >
                <Image
                  source={{ uri: sourceUrl }}
                  style={{
                    position: 'absolute',
                    left: base.left,
                    top: base.top,
                    width: base.width,
                    height: base.height,
                  }}
                  contentFit="fill"
                  cachePolicy="disk"
                />
                {overlay != null && (
                  <Image
                    source={{ uri: `data:image/png;base64,${overlay}` }}
                    style={{
                      position: 'absolute',
                      left: base.left,
                      top: base.top,
                      width: base.width,
                      height: base.height,
                      opacity: 0.55,
                    }}
                    contentFit="fill"
                    tintColor={colors.danger}
                  />
                )}
              </View>
            </View>
          </GestureDetector>
        </View>

        <View
          style={[
            styles.toolbar,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.brushRow}>
            {/* Live brush footprint, at its true on-screen size. */}
            <View style={styles.brushGauge}>
              <View
                style={{
                  width: Math.min(brush, 40),
                  height: Math.min(brush, 40),
                  borderRadius: Math.min(brush, 40) / 2,
                  backgroundColor: erasing ? colors.textMuted : colors.danger,
                }}
              />
            </View>
            <Slider
              style={styles.slider}
              minimumValue={BRUSH_MIN}
              maximumValue={BRUSH_MAX}
              value={brush}
              onValueChange={setBrush}
              minimumTrackTintColor={colors.brand}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.brand}
            />
            <Text style={styles.brushValue}>{Math.round(brush)}</Text>
          </View>

          <View style={styles.tools}>
            <ToolButton
              icon="brush"
              label={t('maskEditor.paint')}
              active={!erasing}
              onPress={() => setErasing(false)}
            />
            <ToolButton
              icon="backspace-outline"
              label={t('maskEditor.erase')}
              active={erasing}
              onPress={() => setErasing(true)}
            />
            <ToolButton
              icon="arrow-undo-outline"
              label={t('maskEditor.undo')}
              disabled={strokes.length === 0}
              onPress={undo}
            />
            <ToolButton
              icon="trash-outline"
              label={t('maskEditor.clear')}
              disabled={strokes.length === 0}
              onPress={clear}
            />
            <ToolButton
              icon="scan-outline"
              label={t('maskEditor.fit')}
              disabled={scale === 1 && offset.x === 0 && offset.y === 0}
              onPress={resetView}
            />
          </View>
          <Text style={styles.hint}>{t('maskEditor.hint')}</Text>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ToolButton({
  icon,
  label,
  active,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.tool,
        active && styles.toolActive,
        pressed && !disabled && { backgroundColor: colors.surfacePressed },
        disabled && { opacity: 0.35 },
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={active ? colors.onBrand : colors.text}
      />
      <Text style={[styles.toolLabel, active && { color: colors.onBrand }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerBtn: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  cancel: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  done: {
    color: colors.brand,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  canvas: {
    flex: 1,
    overflow: 'hidden',
  },
  canvasInner: {
    flex: 1,
  },
  toolbar: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.bgElevated,
  },
  brushRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  brushGauge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slider: {
    flex: 1,
    height: 40,
  },
  brushValue: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    width: 32,
    textAlign: 'right',
  },
  tools: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tool: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  toolActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  toolLabel: {
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
  },
});
