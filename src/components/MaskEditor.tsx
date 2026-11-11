/**
 * Full-screen mask editor: the user paints the area to inpaint over the
 * source image with a finger, pinching to zoom for the fine work.
 *
 * The red overlay is the *real* mask, rasterized and PNG-encoded in JS
 * (cf. utils/maskRaster), feathered edges and eraser included. There is no
 * native canvas involved: Komfy ships as a JS-only Expo Go bundle.
 *
 * Two rasters back the overlay:
 *  - the whole image at a modest resolution, always up to date;
 *  - once zoomed in, a close-up of the visible part only, at screen
 *    density, so the edge you are refining is sharp instead of a blown-up
 *    blur. It is rebuilt when a pinch or pan settles; during the gesture the
 *    whole-image raster stands in.
 * Both are painted incrementally: a finger move stamps only the points it
 * added, so drawing stays as fast at the twentieth stroke as at the first.
 *
 * Gestures: one finger draws (on the JS thread, where the rasterizer is);
 * two fingers pan and zoom around the point between them (worklets on the
 * UI thread, no React render per frame). A second finger landing throws the
 * half-drawn stroke away.
 */

import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { useMaskPrefs } from '../store/maskPrefs';
import {
  MaskLayer,
  maskDimensions,
  maskToOverlayPngBase64,
  sameStrokes,
  type MaskPoint,
  type MaskStroke,
} from '../utils/maskRaster';
import {
  colors,
  maskBrushColors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

/** Long side of the whole-image overlay raster. */
const FULL_MAX_SIDE = 384;
/** Shortest gap between two overlay refreshes while a stroke is in progress. */
const PREVIEW_THROTTLE_MS = 50;

/** Never keep two samples closer than this (screen points). */
const MIN_SAMPLE_DISTANCE = 2;
/**
 * Sample spacing as a fraction of the brush diameter. Capsules join without
 * seams at any spacing, so denser samples only buy stamping work; at a fifth
 * of the brush the polyline strays from the finger's path by a few hundredths
 * of the radius, hidden under the brush itself.
 */
const SAMPLE_SPACING = 0.2;

const BRUSH_MIN = 6;
const BRUSH_MAX = 160;
const BRUSH_DEFAULT = 44;
/** Diameter range of the toolbar's brush gauge (it has a 44 pt slot). */
const GAUGE_MIN = 8;
const GAUGE_MAX = 36;

const MIN_SCALE = 1;
const MAX_SCALE = 8;
/** Below this zoom the whole-image raster is sharp enough on its own. */
const DETAIL_MIN_SCALE = 1.5;
/** Pixel budget of the close-up raster (encoded on every refresh). */
const DETAIL_MAX_PIXELS = 160_000;
/** Raster pixels per screen point, at most, for the close-up. */
const DETAIL_MAX_DENSITY = 1;
/** Pause after a pinch/pan before the close-up is rebuilt. */
const DETAIL_REBUILD_DELAY_MS = 120;
/** The close-up is rebuilt in slices of about this long, between frames. */
const DETAIL_SLICE_MS = 12;
/** Points stamped between two clock checks while it is rebuilt. */
const DETAIL_POINTS_PER_CHECK = 4;
/** A finger heading back by this much (points) has turned: sample the turn. */
const TURN_TOLERANCE = 1;
const FIT_DURATION_MS = 200;

const OVERLAY_OPACITY = 0.55;

interface Props {
  visible: boolean;
  /** /view URL of the already-uploaded source image. */
  sourceUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** Strokes to resume from (re-opening the editor keeps the drawing). */
  initialStrokes: MaskStroke[];
  /** One-line notice under the header, when the caller has something to say. */
  notice?: string;
  onCancel: () => void;
  /** `changed`: the strokes differ from the ones the editor opened with. */
  onDone: (strokes: MaskStroke[], changed: boolean) => void;
}

interface History {
  past: MaskStroke[][];
  present: MaskStroke[];
  future: MaskStroke[][];
}

/** A rectangle in the canvas's unzoomed coordinates. */
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: ViewTransform = { scale: 1, x: 0, y: 0 };
const EMPTY_RECT: Rect = { left: 0, top: 0, width: 0, height: 0 };

export function MaskEditor({
  visible,
  sourceUrl,
  imageWidth,
  imageHeight,
  initialStrokes,
  notice,
  onCancel,
  onDone,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [brush, setBrush] = useState(BRUSH_DEFAULT);
  const [erasing, setErasing] = useState(false);
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  /**
   * Encoded overlays: the whole image, and the close-up when zoomed in. Two
   * images, so switching between them never shows one bitmap stretched over
   * the other's frame while the new data URI decodes.
   */
  const [overlay, setOverlay] = useState<{
    full: string | null;
    /** `build` keys the Image; `ready` once its first bitmap decoded. */
    detail: { uri: string; rect: Rect; build: number; ready: boolean } | null;
    showDetail: boolean;
  }>({ full: null, detail: null, showDetail: false });
  const [pickingColor, setPickingColor] = useState(false);
  const brushColorId = useMaskPrefs((s) => s.brushColor);
  const setBrushColor = useMaskPrefs((s) => s.setBrushColor);
  const brushColor = (
    maskBrushColors.find((c) => c.id === brushColorId) ?? maskBrushColors[0]
  ).hex;
  const brushColorRef = useRef<string>(brushColor);
  const [zoomed, setZoomed] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [sizingBrush, setSizingBrush] = useState(false);

  // Undo history. The state drives the render; the ref holds the same value
  // for the gesture callbacks, and both change together (applyHistory).
  const [history, setHistory] = useState<History>(() => ({
    past: [],
    present: initialStrokes,
    future: [],
  }));
  const historyRef = useRef(history);
  /** Strokes the editor opened with, to tell whether anything changed. */
  const [initial, setInitial] = useState(initialStrokes);
  const applyHistory = useCallback((next: History) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  // Everything the gesture callbacks read is mirrored in refs, so the
  // gestures are built once: rebuilding them while a finger is down
  // re-attaches the GestureDetector and drops the gesture.
  const baseRef = useRef(EMPTY_RECT);
  const canvasRef = useRef({ width: 0, height: 0 });
  const brushRef = useRef(BRUSH_DEFAULT);
  const erasingRef = useRef(false);
  /** View transform as of the last settled gesture (the JS side's copy). */
  const viewRef = useRef<ViewTransform>(IDENTITY);

  // Same transform, owned by the UI thread for the pinch/pan worklets.
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const pinchPrev = useSharedValue(1);
  const panPrev = useSharedValue({ x: 0, y: 0 });
  const geometry = useSharedValue({ cw: 0, ch: 0, bw: 0, bh: 0 });
  const cursorX = useSharedValue(0);
  const cursorY = useSharedValue(0);
  const cursorOpacity = useSharedValue(0);

  // Rasters. `detail` is the zoomed-in close-up, null below DETAIL_MIN_SCALE.
  const fullLayer = useRef<MaskLayer | null>(null);
  const detail = useRef<{
    layer: MaskLayer;
    rect: Rect;
    build: number;
  } | null>(null);
  /** false while a pinch/pan is in flight (the close-up no longer lines up). */
  const showDetail = useRef(false);
  const detailTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped to abandon a close-up rebuild in progress. */
  const detailBuild = useRef(0);
  /** Build of the close-up whose bitmap is decoded and on screen. */
  const detailShown = useRef(0);

  // The stroke being drawn lives in a ref so each finger move mutates it
  // without a re-render; the overlay refresh is what shows it.
  const live = useRef<MaskStroke | null>(null);
  /** View transform the live stroke is mapped with. */
  const strokeView = useRef<ViewTransform>(IDENTITY);
  const lastSample = useRef<MaskPoint | null>(null);
  const lastFinger = useRef<MaskPoint | null>(null);
  /** Finger position farthest from the last sample since it was taken. */
  const farthest = useRef<{ x: number; y: number; d: number } | null>(null);
  /** Set when a second finger joins: the half-drawn stroke is thrown away. */
  const aborted = useRef(false);
  const lastPreviewAt = useRef(0);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs first, synchronously: a stroke starting right after a tap on the
  // eraser must already erase, without waiting for an effect to run.
  const changeBrush = (value: number) => {
    brushRef.current = value;
    setBrush(value);
  };
  const changeErasing = (value: boolean) => {
    erasingRef.current = value;
    setErasing(value);
  };

  /** Rect the image occupies, unzoomed, inside the canvas ("contain" fit). */
  const base = useMemo((): Rect => {
    if (!canvas.width || !canvas.height || !imageWidth || !imageHeight) {
      return EMPTY_RECT;
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

  const fullSize = useMemo(
    () => maskDimensions(imageWidth || 1, imageHeight || 1, FULL_MAX_SIDE),
    [imageWidth, imageHeight],
  );

  /**
   * Encodes the raster on display into its overlay image. `both` also
   * refreshes the whole-image overlay behind a close-up, so it is current
   * when the next pinch brings it back.
   */
  const renderOverlay = useCallback((both = false) => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    lastPreviewAt.current = Date.now();
    const full = fullLayer.current;
    const close = showDetail.current ? detail.current : null;
    if (!full || (historyRef.current.present.length === 0 && !live.current)) {
      setOverlay({ full: null, detail: null, showDetail: false });
      return;
    }
    const encode = (layer: MaskLayer) =>
      `data:image/png;base64,${maskToOverlayPngBase64(
        layer.mask,
        layer.width,
        layer.height,
        brushColorRef.current,
      )}`;
    if (close) {
      const uri = encode(close.layer);
      // Until the close-up's own bitmap is up, the whole-image overlay is
      // the one on screen: keep it following the finger.
      const fullUri =
        both || detailShown.current !== close.build ? encode(full) : null;
      setOverlay((prev) => ({
        full: fullUri ?? prev.full,
        detail: {
          uri,
          rect: close.rect,
          build: close.build,
          // A new build starts hidden until its own bitmap is decoded, so
          // the previous region's pixels never show in the new frame.
          ready: prev.detail?.build === close.build && prev.detail.ready,
        },
        showDetail: true,
      }));
    } else {
      const uri = encode(full);
      setOverlay((prev) => ({ ...prev, full: uri, showDetail: false }));
    }
  }, []);

  // A new brush colour repaints the overlays in it.
  useEffect(() => {
    brushColorRef.current = brushColor;
    renderOverlay(true);
  }, [brushColor, renderOverlay]);

  /** Throttled overlay refresh, called on every finger move. */
  const refreshPreview = useCallback(
    (immediate = false) => {
      const elapsed = Date.now() - lastPreviewAt.current;
      if (immediate || elapsed >= PREVIEW_THROTTLE_MS) {
        renderOverlay();
        return;
      }
      // Trailing refresh, so the last few points never stay invisible.
      if (!previewTimer.current) {
        previewTimer.current = setTimeout(
          renderOverlay,
          PREVIEW_THROTTLE_MS - elapsed,
        );
      }
    },
    [renderOverlay],
  );

  /** Repaints both rasters from the committed strokes (undo, redo, clear). */
  const rebuildLayers = useCallback(() => {
    const { present } = historyRef.current;
    fullLayer.current?.reset(present);
    detail.current?.layer.reset(present);
    renderOverlay(true);
  }, [renderOverlay]);

  /**
   * Builds the close-up raster for the part of the image currently on
   * screen, or drops it when the zoom is too low to need one.
   */
  const rebuildDetail = useCallback(() => {
    detailTimer.current = null;
    if (live.current) {
      // Never swap rasters under a finger; try again once it lifts.
      detailTimer.current = setTimeout(rebuildDetail, DETAIL_REBUILD_DELAY_MS);
      return;
    }
    const build = ++detailBuild.current;
    const v = viewRef.current;
    const b = baseRef.current;
    const c = canvasRef.current;
    detail.current = null;
    showDetail.current = false;
    if (v.scale >= DETAIL_MIN_SCALE && b.width && b.height) {
      // The visible canvas, mapped back to unzoomed coordinates, clipped to
      // the image.
      const cx = c.width / 2;
      const cy = c.height / 2;
      const left = Math.max(b.left, cx + (-cx - v.x) / v.scale);
      const right = Math.min(b.left + b.width, cx + (cx - v.x) / v.scale);
      const top = Math.max(b.top, cy + (-cy - v.y) / v.scale);
      const bottom = Math.min(b.top + b.height, cy + (cy - v.y) / v.scale);
      if (right > left && bottom > top) {
        const rect = { left, top, width: right - left, height: bottom - top };
        const screenW = rect.width * v.scale;
        const screenH = rect.height * v.scale;
        const density = Math.min(
          DETAIL_MAX_DENSITY,
          Math.sqrt(DETAIL_MAX_PIXELS / (screenW * screenH)),
        );
        const layer = new MaskLayer(screenW * density, screenH * density, {
          x: (left - b.left) / b.width,
          y: (top - b.top) / b.height,
          w: rect.width / b.width,
          h: rect.height / b.height,
        });
        // Painted in slices between frames, so a finger landing meanwhile is
        // answered at once; the whole-image overlay stands in until done. A
        // stroke, a gesture or an undo abandons the build (detailBuild).
        const strokes = historyRef.current.present;
        let i = 0;
        const step = () => {
          if (build !== detailBuild.current) return;
          const start = Date.now();
          // Points at a time, not strokes: at a high zoom one broad stroke
          // can cover the whole raster and outlast a slice on its own.
          while (i < strokes.length && Date.now() - start < DETAIL_SLICE_MS) {
            if (!layer.painting) layer.begin(strokes[i]);
            if (!layer.extend(DETAIL_POINTS_PER_CHECK, false)) {
              layer.commit();
              i++;
            }
          }
          if (i < strokes.length) {
            setTimeout(step, 0);
            return;
          }
          detail.current = { layer, rect, build };
          showDetail.current = true;
          renderOverlay();
        };
        renderOverlay();
        step();
        return;
      }
    }
    renderOverlay();
  }, [renderOverlay]);

  /** Rebuilds the close-up once things settle, if the zoom calls for one. */
  const scheduleDetail = useCallback(() => {
    if (detailTimer.current) clearTimeout(detailTimer.current);
    detailTimer.current = setTimeout(rebuildDetail, DETAIL_REBUILD_DELAY_MS);
  }, [rebuildDetail]);

  /** A pinch or pan starts: the close-up stops lining up, fall back. */
  const viewChangeStart = useCallback(() => {
    detailBuild.current++;
    if (detailTimer.current) {
      clearTimeout(detailTimer.current);
      detailTimer.current = null;
    }
    if (showDetail.current) {
      showDetail.current = false;
      renderOverlay();
    }
  }, [renderOverlay]);

  /** A pinch or pan settled at this transform. */
  const viewChangeEnd = useCallback(
    (s: number, x: number, y: number) => {
      viewRef.current = { scale: s, x, y };
      setZoomed(s > 1.01 || Math.abs(x) > 1 || Math.abs(y) > 1);
      scheduleDetail();
    },
    [scheduleDetail],
  );

  const resetView = useCallback(
    (animated: boolean) => {
      const to = (v: number) =>
        animated ? withTiming(v, { duration: FIT_DURATION_MS }) : v;
      scale.set(to(1));
      tx.set(to(0));
      ty.set(to(0));
      viewChangeStart();
      viewChangeEnd(1, 0, 0);
    },
    [scale, tx, ty, viewChangeStart, viewChangeEnd],
  );

  // Re-arm from the caller's strokes each time the editor opens.
  useEffect(() => {
    if (!visible) {
      // Closed: a close-up still being built has nobody left to show it to.
      detailBuild.current++;
      if (detailTimer.current) {
        clearTimeout(detailTimer.current);
        detailTimer.current = null;
      }
      return;
    }
    setOverlay({ full: null, detail: null, showDetail: false });
    setSizingBrush(false);
    setInitial(initialStrokes);
    applyHistory({ past: [], present: initialStrokes, future: [] });
    live.current = null;
    aborted.current = false;
    detailBuild.current++;
    detail.current = null;
    showDetail.current = false;
    setPickingColor(false);
    const layer = new MaskLayer(fullSize.width, fullSize.height);
    layer.reset(initialStrokes);
    fullLayer.current = layer;
    scale.set(1);
    tx.set(0);
    ty.set(0);
    viewRef.current = IDENTITY;
    setZoomed(false);
    setPeeking(false);
    renderOverlay();
    // initialStrokes may be a fresh array on every parent render; `visible`
    // is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, fullSize]);

  // A rotation (new canvas width) moves the image: start from a fitted view.
  // Any other resize (keyboard, toolbar) keeps the zoom and only redraws the
  // close-up for the new frame.
  const laidOutWidth = useRef(0);
  useEffect(() => {
    baseRef.current = base;
    canvasRef.current = canvas;
    geometry.set({
      cw: canvas.width,
      ch: canvas.height,
      bw: base.width,
      bh: base.height,
    });
    if (!visible) return;
    if (canvas.width !== laidOutWidth.current) {
      laidOutWidth.current = canvas.width;
      resetView(false);
    } else {
      const v = viewRef.current;
      viewChangeStart();
      viewChangeEnd(v.scale, v.x, v.y);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, canvas]);

  useEffect(
    () => () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
      if (detailTimer.current) clearTimeout(detailTimer.current);
      // A sliced close-up build reschedules itself: stop it too.
      detailBuild.current++;
    },
    [],
  );

  /** Canvas point → normalized image coordinates, undoing the zoom/pan. */
  const toImageSpace = useCallback(
    (px: number, py: number): MaskPoint | null => {
      const b = baseRef.current;
      const c = canvasRef.current;
      const v = strokeView.current;
      if (!b.width || !b.height) return null;
      const cx = c.width / 2;
      const cy = c.height / 2;
      const ux = (px - cx - v.x) / v.scale + cx;
      const uy = (py - cy - v.y) / v.scale + cy;
      return { x: (ux - b.left) / b.width, y: (uy - b.top) / b.height };
    },
    [],
  );

  /** Appends a sample to the live stroke and stamps it. */
  const addSample = useCallback(
    (stroke: MaskStroke, x: number, y: number) => {
      const p = toImageSpace(x, y);
      if (!p) return;
      stroke.points.push(p);
      lastSample.current = { x, y };
      farthest.current = null;
      fullLayer.current?.extend();
      detail.current?.layer.extend();
    },
    [toImageSpace],
  );

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
        strokeView.current = viewRef.current;
        if (!detail.current && viewRef.current.scale >= DETAIL_MIN_SCALE) {
          // A close-up was on its way: drop it, and build it again from the
          // finished stroke (rebuildDetail waits for the finger to lift).
          detailBuild.current++;
          scheduleDetail();
        }
        const p = toImageSpace(e.x, e.y);
        if (!p) return;
        aborted.current = false;
        // The brush keeps a constant *screen* size, so zooming in genuinely
        // buys precision.
        const b = baseRef.current;
        const stroke: MaskStroke = {
          points: [p],
          radius:
            brushRef.current /
            2 /
            strokeView.current.scale /
            Math.max(b.width, b.height),
          erase: erasingRef.current,
        };
        live.current = stroke;
        fullLayer.current?.begin(stroke);
        detail.current?.layer.begin(stroke);
        fullLayer.current?.extend();
        detail.current?.layer.extend();
        lastSample.current = { x: e.x, y: e.y };
        lastFinger.current = { x: e.x, y: e.y };
        farthest.current = null;
        cursorX.set(e.x);
        cursorY.set(e.y);
        cursorOpacity.set(1);
        refreshPreview(true);
      })
      .onUpdate((e) => {
        const stroke = live.current;
        if (!stroke || aborted.current) return;
        cursorX.set(e.x);
        cursorY.set(e.y);
        lastFinger.current = { x: e.x, y: e.y };
        const last = lastSample.current;
        if (!last) return;
        const gap = Math.max(
          MIN_SAMPLE_DISTANCE,
          brushRef.current * SAMPLE_SPACING,
        );
        const d = Math.hypot(e.x - last.x, e.y - last.y);
        if (d >= gap) {
          addSample(stroke, e.x, e.y);
          refreshPreview();
          return;
        }
        // Scrubbing back and forth never strays `gap` from the last sample:
        // keep the turning point, or the paint would stop short of where
        // the brush ring went.
        const far = farthest.current;
        if (!far || d > far.d) {
          farthest.current = { x: e.x, y: e.y, d };
        } else if (far.d - d > TURN_TOLERANCE && far.d >= MIN_SAMPLE_DISTANCE) {
          addSample(stroke, far.x, far.y);
          refreshPreview();
        }
      })
      .onFinalize(() => {
        cursorOpacity.set(0);
        const stroke = live.current;
        const discarded = aborted.current;
        live.current = null;
        aborted.current = false;
        if (!stroke) return;
        if (discarded) {
          fullLayer.current?.cancel();
          detail.current?.layer.cancel();
          refreshPreview(true);
          return;
        }
        // End the stroke where the finger lifted: the sample spacing may
        // have left its tail short.
        const finger = lastFinger.current;
        const sample = lastSample.current;
        if (
          finger &&
          sample &&
          (finger.x !== sample.x || finger.y !== sample.y)
        ) {
          addSample(stroke, finger.x, finger.y);
        }
        if (!fullLayer.current?.touched) {
          // Entirely off the image (the letterbox): nothing to keep, and
          // nothing that should count as a change.
          fullLayer.current?.cancel();
          detail.current?.layer.cancel();
          refreshPreview(true);
          return;
        }
        fullLayer.current?.commit();
        detail.current?.layer.commit();
        const h = historyRef.current;
        applyHistory({
          past: [...h.past, h.present],
          present: [...h.present, stroke],
          future: [],
        });
        renderOverlay(true);
      });

    // Keeps the image covering the canvas centre: never lost off-screen,
    // yet any edge can still be brought under the finger.
    const clampView = () => {
      'worklet';
      const maxX = (scale.get() * geometry.get().bw) / 2;
      const maxY = (scale.get() * geometry.get().bh) / 2;
      tx.set(Math.min(maxX, Math.max(-maxX, tx.get())));
      ty.set(Math.min(maxY, Math.max(-maxY, ty.get())));
    };

    const pinch = Gesture.Pinch()
      .onStart(() => {
        'worklet';
        pinchPrev.set(1);
        runOnJS(viewChangeStart)();
      })
      .onUpdate((e) => {
        'worklet';
        const next = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, (scale.get() * e.scale) / pinchPrev.get()),
        );
        pinchPrev.set(e.scale);
        // Zoom about the point between the fingers: it stays put on screen.
        const ratio = next / scale.get();
        const fx = e.focalX - geometry.get().cw / 2;
        const fy = e.focalY - geometry.get().ch / 2;
        tx.set(fx - ratio * (fx - tx.get()));
        ty.set(fy - ratio * (fy - ty.get()));
        scale.set(next);
        clampView();
      })
      .onEnd(() => {
        'worklet';
        runOnJS(viewChangeEnd)(scale.get(), tx.get(), ty.get());
      });

    const twoFingerPan = Gesture.Pan()
      .minPointers(2)
      .averageTouches(true)
      .onStart(() => {
        'worklet';
        panPrev.set({ x: 0, y: 0 });
        runOnJS(viewChangeStart)();
      })
      .onUpdate((e) => {
        'worklet';
        tx.set(tx.get() + e.translationX - panPrev.get().x);
        ty.set(ty.get() + e.translationY - panPrev.get().y);
        panPrev.set({ x: e.translationX, y: e.translationY });
        clampView();
      })
      .onEnd(() => {
        'worklet';
        runOnJS(viewChangeEnd)(scale.get(), tx.get(), ty.get());
      });

    return Gesture.Simultaneous(draw, pinch, twoFingerPan);
  }, [
    toImageSpace,
    addSample,
    applyHistory,
    refreshPreview,
    renderOverlay,
    scheduleDetail,
    viewChangeStart,
    viewChangeEnd,
    scale,
    tx,
    ty,
    pinchPrev,
    panPrev,
    geometry,
    cursorX,
    cursorY,
    cursorOpacity,
  ]);

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.get() },
      { translateY: ty.get() },
      { scale: scale.get() },
    ],
  }));
  const cursorStyle = useAnimatedStyle(() => ({
    opacity: cursorOpacity.get(),
    transform: [{ translateX: cursorX.get() }, { translateY: cursorY.get() }],
  }));

  const { past, present, future } = history;
  const dirty = !sameStrokes(present, initial);

  /** Undo, redo or clear moved the history: repaint, restart a close-up build. */
  const afterHistoryJump = () => {
    if (viewRef.current.scale >= DETAIL_MIN_SCALE) {
      // Zoomed in: drop the close-up (and any build of it in flight, which
      // would hold the old strokes) and rebuild it on the sliced path, so
      // an undo tap never blocks the JS thread for a full repaint.
      detailBuild.current++;
      detail.current = null;
      showDetail.current = false;
      scheduleDetail();
    }
    rebuildLayers();
  };

  const undo = () => {
    const h = historyRef.current;
    if (live.current) return;
    if (h.past.length > 0) {
      applyHistory({
        past: h.past.slice(0, -1),
        present: h.past[h.past.length - 1],
        future: [h.present, ...h.future],
      });
    } else if (h.present.length > 0) {
      // Strokes the editor reopened with have no history of their own:
      // undo peels them off one by one, as if they had just been drawn.
      applyHistory({
        past: [],
        present: h.present.slice(0, -1),
        future: [h.present, ...h.future],
      });
    } else {
      return;
    }
    Haptics.selectionAsync();
    afterHistoryJump();
  };

  const redo = () => {
    const h = historyRef.current;
    if (h.future.length === 0 || live.current) return;
    Haptics.selectionAsync();
    applyHistory({
      past: [...h.past, h.present],
      present: h.future[0],
      future: h.future.slice(1),
    });
    afterHistoryJump();
  };

  // Undoable like any stroke: a slip of the thumb costs nothing.
  const clear = () => {
    const h = historyRef.current;
    if (h.present.length === 0 || live.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    applyHistory({ past: [...h.past, h.present], present: [], future: [] });
    afterHistoryJump();
  };

  const requestCancel = () => {
    if (!dirty) {
      onCancel();
      return;
    }
    Alert.alert(t('maskEditor.discardTitle'), t('maskEditor.discardBody'), [
      { text: t('maskEditor.keepEditing'), style: 'cancel' },
      { text: t('maskEditor.discard'), style: 'destructive', onPress: onCancel },
    ]);
  };

  const gauge =
    GAUGE_MIN +
    ((brush - BRUSH_MIN) / (BRUSH_MAX - BRUSH_MIN)) * (GAUGE_MAX - GAUGE_MIN);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={requestCancel}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable
            onPress={requestCancel}
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityRole="button"
          >
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('maskEditor.title')}</Text>
          <Pressable
            onPress={() => onDone(historyRef.current.present, dirty)}
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityRole="button"
          >
            <Text style={styles.done}>{t('common.done')}</Text>
          </Pressable>
        </View>

        {notice != null && (
          <View style={styles.notice}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={colors.textMuted}
            />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

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
              <Animated.View
                style={[StyleSheet.absoluteFill, contentStyle]}
                pointerEvents="none"
              >
                <Image
                  source={{ uri: sourceUrl }}
                  style={[styles.layer, rectStyle(base)]}
                  contentFit="fill"
                  cachePolicy="disk"
                />
                {overlay.full != null && (
                  <Image
                    source={{ uri: overlay.full }}
                    style={[
                      styles.layer,
                      rectStyle(base),
                      {
                        opacity:
                          peeking || (overlay.showDetail && overlay.detail?.ready)
                            ? 0
                            : OVERLAY_OPACITY,
                      },
                    ]}
                    contentFit="fill"
                    cachePolicy="none"
                    allowDownscaling={false}
                  />
                )}
                {overlay.detail != null && (
                  <Image
                    key={overlay.detail.build}
                    source={{ uri: overlay.detail.uri }}
                    onLoad={() => {
                      const build = overlay.detail?.build;
                      if (build != null) detailShown.current = build;
                      setOverlay((prev) =>
                        prev.detail && prev.detail.build === build
                          ? { ...prev, detail: { ...prev.detail, ready: true } }
                          : prev,
                      );
                    }}
                    style={[
                      styles.layer,
                      rectStyle(overlay.detail.rect),
                      {
                        opacity:
                          !peeking && overlay.showDetail && overlay.detail.ready
                            ? OVERLAY_OPACITY
                            : 0,
                      },
                    ]}
                    contentFit="fill"
                    cachePolicy="none"
                    allowDownscaling={false}
                  />
                )}
              </Animated.View>

              {/* True-size brush, under the finger while drawing. */}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.cursor,
                  { marginLeft: -brush / 2, marginTop: -brush / 2 },
                  cursorStyle,
                ]}
              >
                <BrushRing size={brush} />
              </Animated.View>

              {/* ...and in the middle of the canvas while it is resized. */}
              {sizingBrush && (
                <View
                  pointerEvents="none"
                  style={[
                    styles.cursor,
                    {
                      left: canvas.width / 2 - brush / 2,
                      top: canvas.height / 2 - brush / 2,
                    },
                  ]}
                >
                  <BrushRing size={brush} />
                </View>
              )}
            </View>
          </GestureDetector>

          <View style={styles.canvasButtons} pointerEvents="box-none">
            {zoomed && (
              <FloatingButton
                icon="scan-outline"
                label={t('maskEditor.fit')}
                onPress={() => resetView(true)}
              />
            )}
            {present.length > 0 && (
              <FloatingButton
                icon={peeking ? 'eye-off-outline' : 'eye-outline'}
                label={t('maskEditor.peek')}
                onPressIn={() => setPeeking(true)}
                onPressOut={() => setPeeking(false)}
              />
            )}
          </View>
        </View>

        <View
          style={[
            styles.toolbar,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.brushRow}>
            {/* Brush footprint, scaled to fit (the true size shows on the
                canvas while the slider moves); tap it to change colour. */}
            <Pressable
              style={styles.brushGauge}
              onPress={() => {
                // The slider may unmount mid-drag, before its
                // onSlidingComplete: drop the centred ring with it.
                setSizingBrush(false);
                setPickingColor((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('maskEditor.color')}
              accessibilityState={{ expanded: pickingColor }}
            >
              <View
                style={{
                  width: gauge,
                  height: gauge,
                  borderRadius: gauge / 2,
                  backgroundColor: erasing ? colors.textMuted : brushColor,
                }}
              />
            </Pressable>
            {/* The swatches take the slider's place rather than adding a
                row: the toolbar keeps its height, so the canvas (and the
                zoom on it) never moves. */}
            {pickingColor ? (
              <View style={styles.swatches}>
                {maskBrushColors.map((c) => {
                  const selected = c.hex === brushColor;
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setBrushColor(c.id);
                        setPickingColor(false);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={t(`maskEditor.colors.${c.id}`)}
                      accessibilityState={{ selected }}
                      style={styles.swatchSlot}
                    >
                      <View
                        style={[
                          styles.swatch,
                          { backgroundColor: c.hex },
                          selected && styles.swatchSelected,
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <>
                <Slider
                  style={styles.slider}
                  minimumValue={BRUSH_MIN}
                  maximumValue={BRUSH_MAX}
                  value={brush}
                  onValueChange={changeBrush}
                  onSlidingStart={() => setSizingBrush(true)}
                  onSlidingComplete={() => setSizingBrush(false)}
                  minimumTrackTintColor={colors.brand}
                  maximumTrackTintColor={colors.border}
                  thumbTintColor={colors.brand}
                />
                <Text style={styles.brushValue}>{Math.round(brush)}</Text>
              </>
            )}
          </View>

          <View style={styles.tools}>
            <View style={styles.modes}>
              <ModeButton
                icon="brush"
                label={t('maskEditor.paint')}
                active={!erasing}
                onPress={() => changeErasing(false)}
              />
              <ModeButton
                icon="backspace-outline"
                label={t('maskEditor.erase')}
                active={erasing}
                onPress={() => changeErasing(true)}
              />
            </View>
            <IconButton
              icon="arrow-undo-outline"
              label={t('maskEditor.undo')}
              disabled={past.length === 0 && present.length === 0}
              onPress={undo}
            />
            <IconButton
              icon="arrow-redo-outline"
              label={t('maskEditor.redo')}
              disabled={future.length === 0}
              onPress={redo}
            />
            <IconButton
              icon="trash-outline"
              label={t('maskEditor.clear')}
              disabled={present.length === 0}
              onPress={clear}
            />
          </View>
          <Text style={styles.hint}>{t('maskEditor.hint')}</Text>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function rectStyle(rect: Rect) {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** Two concentric rings, so the outline reads on light and dark pictures. */
function BrushRing({ size }: { size: number }) {
  return (
    <View
      style={[
        styles.ringOuter,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <View style={[styles.ringInner, { borderRadius: size / 2 }]} />
    </View>
  );
}

function ModeButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        styles.mode,
        active && styles.modeActive,
        pressed && !active && { backgroundColor: colors.surfacePressed },
      ]}
    >
      <Ionicons
        name={icon}
        size={20}
        color={active ? colors.onBrand : colors.text}
      />
      <Text style={[styles.modeLabel, active && { color: colors.onBrand }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function IconButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.iconBtn,
        pressed && !disabled && { backgroundColor: colors.surfacePressed },
        disabled && { opacity: 0.35 },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
}

function FloatingButton({
  icon,
  label,
  onPress,
  onPressIn,
  onPressOut,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.floating,
        pressed && { backgroundColor: colors.surfacePressed },
      ]}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
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
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgElevated,
  },
  noticeText: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  canvas: {
    flex: 1,
    overflow: 'hidden',
  },
  canvasInner: {
    flex: 1,
  },
  layer: {
    position: 'absolute',
  },
  cursor: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  ringOuter: {
    borderWidth: 1,
    borderColor: colors.bg,
  },
  ringInner: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.text,
  },
  canvasButtons: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    gap: spacing.sm,
  },
  floating: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
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
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slider: {
    flex: 1,
    height: 40,
  },
  swatches: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  swatchSlot: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
  },
  swatchSelected: {
    borderWidth: 3,
    borderColor: colors.text,
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
    alignItems: 'center',
    gap: spacing.sm,
  },
  modes: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mode: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  modeActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  modeLabel: {
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  iconBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET + spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
  },
});
