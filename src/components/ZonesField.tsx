/**
 * Zone editor for Detect & Replace. Two modes:
 *  - "same content for every zone": a single card, no numbering — the pass
 *    covers all detected zones, however many;
 *  - one card per zone (zone number left → right, prompt, dedicated LoRAs —
 *    same editor and explorer as the other workflows).
 * Plus the shared settings (denoise, steps, seed).
 *
 * In numbered mode a card is draggable by its handle: the card number is a
 * position, so moving a card moves its whole setup (prompt, LoRAs, denoise,
 * detail level, modified area and bypass) onto another detected zone —
 * cheaper than deleting it and typing everything back.
 *
 * Holding the handle switches the list to a compact reorder view: every card
 * folds down to its header and a one-line summary, all of the same fixed
 * height (FOLDED_HEIGHT), so the whole list fits on screen and a slot is a
 * plain multiple of one step. The page is scrolled up by what the cards above
 * lost, so the card held stays under the finger; the reverse happens on
 * release, around the card that landed. While the card is in the air its
 * neighbours slide out of its way, every badge shows the number the card is
 * about to take, and the landing slot is a tinted block. On release the card
 * glides into that slot before the list unfolds, then keeps an accent outline
 * for a moment: the eye can follow where it went.
 *
 * The drag is held by the handle alone so the page keeps scrolling everywhere
 * else; the parent is told through `onDragChange` to freeze its scroll while
 * a card is in the air, to scroll it back from the edges (ZoneDragScroller)
 * and to show which zone the card is headed for. VoiceOver moves a card
 * without dragging: the handle is adjustable, one swipe per position. The
 * chevron at the other end of the header folds a card by hand: folding only
 * stops rendering the editor, the zone's setup lives in the form value
 * throughout.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  interpolateColor,
  LayoutAnimationConfig,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import { accessoryId } from '../utils/formAccessory';
import { randomSeed } from '../workflows/patch';
import {
  DEFAULT_GUIDE_SIZE,
  GUIDE_SIZE_OPTIONS,
} from '../workflows/types';
import type {
  LorasField,
  ZonesField as ZonesFieldSpec,
  ZonesValue,
} from '../workflows/types';
import { LoraField } from './LoraField';
import { SourceSeedChip } from './SourceSeedChip';

interface Props {
  field: ZonesFieldSpec;
  value: ZonesValue;
  onChange: (value: ZonesValue) => void;
  /** Remix: shared seed of the source image, offered back in one tap. */
  sourceSeed?: number;
  /**
   * Current value of the shared dilation field (cf. ZonesField.dilation):
   * what a zone that sets nothing inherits, shown as the placeholder.
   */
  baseDilation?: number;
  /**
   * A card is being dragged (null = none): the parent freezes its scroll
   * meanwhile, and shows where the card would land — the list itself scrolls
   * away under the finger, a reminder pinned to the screen does not.
   */
  onDragChange?: (drag: { from: number; to: number } | null) => void;
  /** Lets a card dragged to an edge scroll the page under itself. */
  scroller?: ZoneDragScroller;
}

/** Vertical gap between two cards (styles.zoneList). */
const CARD_GAP = spacing.md;
/** Header height, set by the drag handle and the fold button (styles). */
const HEADER_HEIGHT = MIN_TOUCH_TARGET - 12;
/** Line height of the summary a folded card shows (styles.foldedSummary). */
const SUMMARY_LINE = 18;
/** Card border width (styles.zoneCard). */
const CARD_BORDER = 1;
/**
 * Height of a folded card, fixed rather than measured: during a drag every
 * card is folded, so each slot is exactly one step high and the drag maths
 * needs no measurement to know where anything sits.
 */
const FOLDED_HEIGHT =
  2 * CARD_BORDER + 2 * spacing.md + HEADER_HEIGHT + spacing.sm + SUMMARY_LINE;
const ROW_STEP = FOLDED_HEIGHT + CARD_GAP;

/** Neighbours stepping aside, drop slot following them. */
const SHIFT_MS = 160;
/** Released card gliding into its slot before the list unfolds. */
const LANDING_MS = 180;
/** Accent outline kept by a card that just landed, then faded out. */
const LANDED_HOLD_MS = 450;
const LANDED_FADE_MS = 500;
/** Content of a card appearing (unfold, new card). */
const BODY_FADE_MS = 180;
/** Slight lift of the card in the air — its outline does the rest. */
const LIFT_SCALE = 0.02;
const LIFT_SPRING = { damping: 18, stiffness: 260 };

/**
 * Page scroller a dragged card drives when it reaches an edge of the screen.
 * The list lives inside the launch form's ScrollView, whose scroll is frozen
 * while a card is in the air: without this the card would hit the edge of the
 * viewport and stop there, unable to reach a zone further down the page.
 */
export interface ZoneDragScroller {
  /** Scrollable area in window coordinates (what the gesture reports). */
  viewport: () => { top: number; bottom: number };
  /** Current scroll offset. */
  offset: () => number;
  /** Largest reachable offset. */
  max: () => number;
  /** Jumps to an offset — unanimated, the finger sets the pace. */
  scrollTo: (y: number) => void;
}

/** Distance to an edge of the viewport where the page starts following. */
const EDGE_ZONE = 96;
/** Scroll step at the very edge (px per tick), tapering off to 0 at EDGE_ZONE. */
const EDGE_SPEED = 14;
const EDGE_TICK_MS = 16;

/**
 * Moves an index-keyed map along with the card it describes: the transient
 * editor state (denoise being typed, open detail panel, measured heights) is
 * keyed by position, so a reorder that ignored it would drop an open panel or
 * a half-typed number on the wrong card.
 */
function remapIndexed<T>(
  source: Record<number, T>,
  from: number,
  to: number,
): Record<number, T> {
  const moved: Record<number, T> = {};
  for (const [key, entry] of Object.entries(source)) {
    const i = Number(key);
    let next = i;
    if (i === from) next = to;
    else if (from < to && i > from && i <= to) next = i - 1;
    else if (from > to && i >= to && i < from) next = i + 1;
    moved[next] = entry;
  }
  return moved;
}

/**
 * Drops card `removed` from an index-keyed map and moves the cards after it
 * up one place: the cards that remain keep their state, measured heights
 * included (a surviving row keeps its frame, so it would not be re-measured).
 */
function dropIndexed<T>(
  source: Record<number, T>,
  removed: number,
): Record<number, T> {
  const kept: Record<number, T> = {};
  for (const [key, entry] of Object.entries(source)) {
    const i = Number(key);
    if (i !== removed) kept[i > removed ? i - 1 : i] = entry;
  }
  return kept;
}

interface ZoneRowProps {
  /** Held under the finger: follows `dragY` instead of its own shift. */
  dragged: boolean;
  /** Held and not yet released: slightly scaled up. */
  lifted: boolean;
  /** Offset to step aside by while another card flies over it (px). */
  shift: number;
  dragY: SharedValue<number>;
  /** Non-zero, and new, when the card has just landed: outline it. */
  landedKey: number;
  reduceMotion: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  cardStyle: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * One card of the numbered list, with the motion that lets a reorder be
 * followed by eye. Every offset here is a transform on top of the flow
 * layout, and the list remounts its rows when a drag ends (ZonesField
 * `epoch`): the new rows start from zero, so no leftover offset has to be
 * cleared in step with the reorder that makes it obsolete.
 */
function ZoneRow({
  dragged,
  lifted,
  shift,
  dragY,
  landedKey,
  reduceMotion,
  onLayout,
  cardStyle,
  children,
}: ZoneRowProps) {
  const shiftY = useSharedValue(0);
  const lift = useSharedValue(0);
  const glow = useSharedValue(landedKey ? 1 : 0);

  useEffect(() => {
    shiftY.value = reduceMotion
      ? shift
      : withTiming(shift, { duration: SHIFT_MS });
  }, [shift, reduceMotion, shiftY]);

  useEffect(() => {
    lift.value = reduceMotion ? 0 : withSpring(lifted ? 1 : 0, LIFT_SPRING);
  }, [lifted, reduceMotion, lift]);

  useEffect(() => {
    if (!landedKey) return;
    glow.value = withSequence(
      withTiming(1, { duration: 0 }),
      withDelay(
        LANDED_HOLD_MS,
        withTiming(0, { duration: reduceMotion ? 0 : LANDED_FADE_MS }),
      ),
    );
  }, [landedKey, reduceMotion, glow]);

  const rowStyle = useAnimatedStyle(
    () => ({
      transform: [
        { translateY: dragged ? dragY.value : shiftY.value },
        { scale: 1 + LIFT_SCALE * lift.value },
      ],
    }),
    [dragged],
  );

  const restColor = dragged ? colors.accentStrong : colors.border;
  const glowColor = colors.accentStrong;
  const outlineStyle = useAnimatedStyle(
    () => ({
      borderColor: interpolateColor(glow.value, [0, 1], [restColor, glowColor]),
    }),
    [restColor],
  );

  return (
    <Animated.View
      onLayout={onLayout}
      style={[dragged && styles.zoneSlotDragging, rowStyle]}
    >
      <Animated.View style={[cardStyle, outlineStyle]}>{children}</Animated.View>
    </Animated.View>
  );
}

/**
 * Where the card in the air lands on release: a tinted block the height of a
 * folded card, following the neighbours as they step aside. Filled rather
 * than dashed, so it cannot pass for a bypassed card.
 */
function DropSlot({
  index,
  label,
  reduceMotion,
}: {
  index: number;
  label: string;
  reduceMotion: boolean;
}) {
  const y = useSharedValue(index * ROW_STEP);
  useEffect(() => {
    const top = index * ROW_STEP;
    y.value = reduceMotion ? top : withTiming(top, { duration: SHIFT_MS });
  }, [index, reduceMotion, y]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.dropSlot, style]}>
      <Text style={styles.dropSlotText} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

export function ZonesField({
  field,
  value,
  onChange,
  sourceSeed,
  baseDilation,
  onDragChange,
  scroller,
}: Props) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  // Per-zone denoise text being edited (intermediate states like "0,"
  // tolerated; numeric commit on the fly).
  const [denoiseTexts, setDenoiseTexts] = useState<Record<number, string>>({});
  // Cards folded by hand (same folded look as during a drag): the setup
  // survives untouched, only the editor is out of the way.
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  // "Detail level" panel (guide_size): collapsed by default, per zone.
  const [detailOpen, setDetailOpen] = useState<Record<number, boolean>>({});
  // Per-zone modified area being edited (empty string = inherit the shared
  // field, which is also what an absent `dilation` means).
  const [dilationTexts, setDilationTexts] = useState<Record<number, string>>({});

  // The latest value, for the drop that lands a timer tick after the release.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Stable identity per card, whatever its position: the key React tracks a
  // card by, so a card moved from VoiceOver keeps its own instance (and the
  // editor state inside) instead of every card staying put and swapping
  // contents. Grown or trimmed here when the value changes from outside
  // (preset, remix, added zone).
  const ids = useRef<number[]>([]);
  const nextId = useRef(0);
  while (ids.current.length < value.zones.length) {
    ids.current.push(nextId.current);
    nextId.current += 1;
  }
  if (ids.current.length > value.zones.length) {
    ids.current.length = value.zones.length;
  }
  // Bumped when a drag ends: every row remounts with no offset left (ZoneRow).
  const [epoch, setEpoch] = useState(0);

  // Drag & drop: unfolded card heights (index = position in the list), the
  // card in the air and the slot it currently targets.
  const heights = useRef<Record<number, number>>({});
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  // Same state, readable from the gesture callbacks without waiting for the
  // render that follows setDrag.
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  // Released card gliding into its slot: the list stays compact meanwhile.
  const [landing, setLanding] = useState(false);
  const landingRef = useRef(false);
  const landingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragY = useSharedValue(0);
  // Card that just landed, outlined for a moment (`key` restarts the outline
  // when the same card lands twice in a row).
  const [landed, setLanded] = useState<{ id: number; key: number } | null>(
    null,
  );
  const landedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const landedCount = useRef(0);

  // Per-zone LoRA config: reuses the existing editor (the LoRA count
  // cap comes from the global setting, applied inside LoraField).
  const loraFieldSpec: LorasField = {
    kind: 'loras',
    key: 'loras',
    label: 'LoRAs',
    modelSource: { nodeId: '', output: 0 },
    modelTargets: [],
    defaultStrength: field.defaultStrength,
  };

  const setZone = (i: number, patch: Partial<ZonesValue['zones'][0]>) =>
    onChange({
      ...value,
      zones: value.zones.map((z, j) => (j === i ? { ...z, ...patch } : z)),
    });

  const removeZone = (i: number) => {
    setDenoiseTexts((s) => dropIndexed(s, i));
    setDilationTexts((s) => dropIndexed(s, i));
    setDetailOpen((s) => dropIndexed(s, i));
    setCollapsed((s) => dropIndexed(s, i));
    heights.current = dropIndexed(heights.current, i);
    ids.current = ids.current.filter((_, j) => j !== i);
    onChange({ ...value, zones: value.zones.filter((_, j) => j !== i) });
  };

  const moveZone = (from: number, to: number) => {
    const current = valueRef.current;
    const zones = current.zones.slice();
    const [moved] = zones.splice(from, 1);
    zones.splice(to, 0, moved);
    const order = ids.current.slice();
    const [id] = order.splice(from, 1);
    order.splice(to, 0, id);
    ids.current = order;
    setDenoiseTexts((s) => remapIndexed(s, from, to));
    setDilationTexts((s) => remapIndexed(s, from, to));
    setDetailOpen((s) => remapIndexed(s, from, to));
    setCollapsed((s) => remapIndexed(s, from, to));
    heights.current = remapIndexed(heights.current, from, to);
    onChange({ ...current, zones });
  };

  const markLanded = (id: number) => {
    landedCount.current += 1;
    setLanded({ id, key: landedCount.current });
    if (landedTimer.current != null) clearTimeout(landedTimer.current);
    landedTimer.current = setTimeout(() => {
      landedTimer.current = null;
      setLanded(null);
    }, LANDED_HOLD_MS + LANDED_FADE_MS);
  };

  /** VoiceOver move, one position at a time (the handle is adjustable). */
  const nudgeZone = (from: number, to: number) => {
    if (dragRef.current || landingRef.current) return;
    if (to < 0 || to >= value.zones.length) return;
    moveZone(from, to);
    markLanded(ids.current[to]);
    Haptics.selectionAsync().catch(() => {});
    // iOS reads the new accessibilityValue on its own after an adjustment;
    // announcing it as well would say the same thing twice.
    if (Platform.OS === 'android') {
      AccessibilityInfo.announceForAccessibility(
        t('zones.movedTo', { number: to + 1 }),
      );
    }
  };

  /**
   * Slot the dragged card would land on: every card is folded to the same
   * height during a drag, so a neighbour is taken over once the card has
   * travelled half a step past it.
   */
  const targetIndex = (from: number, translation: number) =>
    Math.min(
      value.zones.length - 1,
      Math.max(0, from + Math.round(translation / ROW_STEP)),
    );

  /** Top of card `index` in the unfolded list, from the measured heights. */
  const unfoldedTop = (index: number, measured: Record<number, number>) => {
    let top = 0;
    for (let j = 0; j < index; j += 1) {
      top += (measured[j] ?? FOLDED_HEIGHT) + CARD_GAP;
    }
    return top;
  };

  // Page offset owed to a fold or unfold of the whole list (drag start and
  // drop): set along with the state change, applied right after its commit
  // rather than before, so the page does not jump ahead of the layout it
  // compensates.
  const pendingScroll = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  useLayoutEffect(() => {
    const y = pendingScroll.current;
    if (y == null || scrollFrame.current != null) return;
    scroller?.scrollTo(y);
    // Android runs view commands ahead of the mount they follow, so a scroll
    // past the end of the old content (the drop, which unfolds the list) is
    // clamped: issued again once the new layout is on screen. Until then the
    // offset stays pending, which is what the drag maths reads.
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = requestAnimationFrame(() => {
        scrollFrame.current = null;
        if (pendingScroll.current !== y) return;
        scroller?.scrollTo(y);
        pendingScroll.current = null;
      });
    });
  });
  const pageOffset = () => pendingScroll.current ?? scroller?.offset() ?? 0;

  // Finger position (window coordinates) and raw finger travel, kept for the
  // auto-scroll ticks: while the page slides under a motionless finger, the
  // card must keep advancing.
  const fingerY = useRef(0);
  const rawTravel = useRef(0);
  const scrollAtStart = useRef(0);
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopEdgeScroll = () => {
    if (edgeTimer.current == null) return;
    clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  };
  // A drag interrupted by a screen change (navigation, remix) would otherwise
  // leave its timers behind.
  useEffect(
    () => () => {
      stopEdgeScroll();
      if (landingTimer.current != null) clearTimeout(landingTimer.current);
      if (landedTimer.current != null) clearTimeout(landedTimer.current);
      if (scrollFrame.current != null) cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  /**
   * Places the dragged card and picks the slot it targets. The card travels in
   * content coordinates: the finger's own travel PLUS whatever the page has
   * scrolled under it since the drag started — that sum is what keeps the card
   * under the finger, and what the slot maths is expressed in.
   */
  const applyDrag = () => {
    const current = dragRef.current;
    if (!current) return;
    const scrolled = pageOffset() - scrollAtStart.current;
    const travel = rawTravel.current + scrolled;
    dragY.value = travel;
    const to = targetIndex(current.from, travel);
    if (to === current.to) return;
    dragRef.current = { from: current.from, to };
    setDrag(dragRef.current);
    onDragChange?.(dragRef.current);
    Haptics.selectionAsync().catch(() => {});
  };

  /**
   * One auto-scroll step, taken while the finger sits near an edge of the
   * scrollable area — the faster the closer, 0 outside the edge zone. Stops on
   * its own at either end of the page (scrollTo would clamp anyway).
   */
  const edgeScrollTick = () => {
    if (!scroller || !dragRef.current || pendingScroll.current != null) return;
    const { top, bottom } = scroller.viewport();
    const y = fingerY.current;
    let step = 0;
    if (y < top + EDGE_ZONE) {
      step = -EDGE_SPEED * Math.min(1, (top + EDGE_ZONE - y) / EDGE_ZONE);
    } else if (y > bottom - EDGE_ZONE) {
      step = EDGE_SPEED * Math.min(1, (y - (bottom - EDGE_ZONE)) / EDGE_ZONE);
    }
    if (step === 0) return;
    const current = scroller.offset();
    const next = Math.max(0, Math.min(scroller.max(), current + step));
    if (next === current) return;
    scroller.scrollTo(next);
    applyDrag();
  };

  const beginDrag = (i: number, absoluteY: number) => {
    // One card at a time, and not while the previous one is still landing.
    if (dragRef.current || landingRef.current) return;
    // The outline of the previous landing would replay on the remount.
    if (landedTimer.current != null) clearTimeout(landedTimer.current);
    landedTimer.current = null;
    setLanded(null);
    dragY.value = 0;
    rawTravel.current = 0;
    fingerY.current = absoluteY;
    if (scroller) {
      // The cards above fold: the page goes up by what they lose, so the card
      // held stays under the finger — unless the page cannot go that far: not
      // above its top, nor past the bottom of the folded page (every card
      // folds, the one held and those below included). Either way the card
      // then starts a little off the finger rather than on a wrong slot.
      const n = value.zones.length;
      const lost = unfoldedTop(i, heights.current) - i * ROW_STEP;
      const lostInAll = unfoldedTop(n, heights.current) - n * ROW_STEP;
      const foldedMax = Math.max(0, scroller.max() - lostInAll);
      const target = Math.min(
        foldedMax,
        Math.max(0, scroller.offset() - lost),
      );
      pendingScroll.current = target;
      scrollAtStart.current = target;
    } else {
      scrollAtStart.current = 0;
    }
    dragRef.current = { from: i, to: i };
    setDrag(dragRef.current);
    onDragChange?.(dragRef.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (scroller) {
      stopEdgeScroll();
      edgeTimer.current = setInterval(edgeScrollTick, EDGE_TICK_MS);
    }
  };

  const updateDrag = (i: number, translation: number, absoluteY: number) => {
    if (dragRef.current?.from !== i) return;
    rawTravel.current = translation;
    fingerY.current = absoluteY;
    applyDrag();
  };

  /**
   * The list unfolds and the card lands for good: the reorder is committed
   * with fresh rows (epoch), and the page scrolled down by what the cards
   * above the landed one gain, so it stays where it was dropped.
   */
  const finishDrop = (from: number, to: number) => {
    landingTimer.current = null;
    landingRef.current = false;
    const unfolded =
      to !== from ? remapIndexed(heights.current, from, to) : heights.current;
    if (scroller) {
      pendingScroll.current = Math.max(
        0,
        scroller.offset() + unfoldedTop(to, unfolded) - to * ROW_STEP,
      );
    }
    setLanding(false);
    setDrag(null);
    setEpoch((e) => e + 1);
    onDragChange?.(null);
    if (to !== from) {
      moveZone(from, to);
      markLanded(ids.current[to]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
  };

  const endDrag = (i: number, commit: boolean) => {
    // Another handle grabbed by a second finger does not end this drag.
    const current = dragRef.current;
    if (!current || current.from !== i) return;
    stopEdgeScroll();
    dragRef.current = null;
    // A cancelled drag (the system took the touch) flies back home.
    const to = commit ? current.to : current.from;
    if (to !== current.to) {
      setDrag({ from: current.from, to });
      onDragChange?.({ from: current.from, to });
    }
    landingRef.current = true;
    setLanding(true);
    const target = (to - current.from) * ROW_STEP;
    dragY.value = reduceMotion
      ? target
      : withTiming(target, { duration: LANDING_MS });
    landingTimer.current = setTimeout(
      () => finishDrop(current.from, to),
      reduceMotion ? 0 : LANDING_MS,
    );
  };

  /**
   * Where a card that is NOT the dragged one sits while the drag lasts: the
   * cards the dragged card flew over step into the hole it left behind.
   */
  const shiftFor = (i: number) => {
    if (!drag || drag.from === drag.to || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -ROW_STEP;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return ROW_STEP;
    return 0;
  };

  /** Number a card shows: during a drag, the one it is about to take. */
  const shownNumber = (i: number) => {
    if (!drag) return i + 1;
    if (i === drag.from) return drag.to + 1;
    return i + 1 + Math.sign(shiftFor(i));
  };

  const measure = (i: number) => (e: LayoutChangeEvent) => {
    // Only the unfolded layout is kept: during a drag every card is folded,
    // and these heights are what the page is scrolled back by on release.
    if (dragRef.current || landingRef.current) return;
    heights.current[i] = e.nativeEvent.layout.height;
  };

  const dragGesture = (i: number) =>
    Gesture.Pan()
      // The gesture runs on the JS thread (it drives React state) and only
      // takes over once the handle has been held: activating on movement
      // alone would race the page scroll for the same finger.
      .runOnJS(true)
      .activateAfterLongPress(150)
      .onStart((e) => beginDrag(i, e.absoluteY))
      .onUpdate((e) => updateDrag(i, e.translationY, e.absoluteY))
      .onEnd(() => endDrag(i, true))
      .onFinalize(() => endDrag(i, false));

  const addZone = () =>
    onChange({
      ...value,
      zones: [
        ...value.zones,
        {
          prompt: '',
          loras: [],
          denoise: field.defaultDenoise,
          guideSize: DEFAULT_GUIDE_SIZE,
        },
      ],
    });

  const allZones = !!value.allZones;
  const atMax =
    field.maxZones != null && value.zones.length >= field.maxZones;
  const allFolded =
    value.zones.length > 0 && value.zones.every((_, i) => collapsed[i]);
  const toggleAllFolded = () =>
    setCollapsed(
      allFolded
        ? {}
        : Object.fromEntries(value.zones.map((_, i) => [i, true])),
    );

  // Prompt + LoRAs + denoise + detail level: identical in both modes.
  const zoneBody = (zone: ZonesValue['zones'][0], i: number) => (
    <>
      <TextInput
        style={styles.promptInput}
        value={zone.prompt}
        onChangeText={(t) => setZone(i, { prompt: t })}
        placeholder={t('zones.promptPlaceholder')}
        placeholderTextColor={colors.textDisabled}
        multiline
        autoCapitalize="none"
        inputAccessoryViewID={accessoryId}
      />

      <LoraField
        field={loraFieldSpec}
        value={zone.loras}
        onChange={(loras) => setZone(i, { loras })}
      />

      <View style={styles.zoneDenoiseRow}>
        <Text style={styles.zoneDenoiseLabel}>
          {allZones ? t('zones.denoiseLabelAll') : t('zones.denoiseLabel')}
        </Text>
        <TextInput
          style={styles.zoneDenoiseInput}
          keyboardType="decimal-pad"
          value={denoiseTexts[i] ?? String(zone.denoise)}
          onChangeText={(t) => {
            setDenoiseTexts((s) => ({ ...s, [i]: t }));
            const n = Number(t.replace(',', '.'));
            if (Number.isFinite(n)) setZone(i, { denoise: n });
          }}
          inputAccessoryViewID={accessoryId}
        />
      </View>

      {/* Modified area, zone by zone: empty = the shared field applies (its
          value is the placeholder, so the inherited number stays readable).
          Hidden in all-zones mode, where the shared field IS the per-zone
          setting. */}
      {field.dilation && !allZones && (
        <View style={styles.zoneDenoiseRow}>
          <Text style={styles.zoneDenoiseLabel}>
            {t('zones.dilationLabel')}
          </Text>
          <TextInput
            style={styles.zoneDenoiseInput}
            keyboardType="number-pad"
            value={
              dilationTexts[i] ??
              (zone.dilation != null ? String(zone.dilation) : '')
            }
            onChangeText={(text) => {
              setDilationTexts((s) => ({ ...s, [i]: text }));
              if (text.trim() === '') {
                setZone(i, { dilation: undefined });
                return;
              }
              const n = parseInt(text, 10);
              if (Number.isFinite(n)) setZone(i, { dilation: n });
            }}
            placeholder={baseDilation != null ? String(baseDilation) : ''}
            placeholderTextColor={colors.textDisabled}
            inputAccessoryViewID={accessoryId}
          />
        </View>
      )}
      {/* Explained once, under the first card: repeating it on every card
          would cost a line each for one rule. */}
      {field.dilation && !allZones && i === 0 && (
        <Text style={styles.detailHint}>
          {t('zones.dilationInherit', { value: baseDilation ?? '?' })}
        </Text>
      )}

      <View style={styles.detailPanel}>
        <Pressable
          style={styles.detailHeader}
          onPress={() => setDetailOpen((s) => ({ ...s, [i]: !s[i] }))}
          hitSlop={8}
        >
          <Ionicons
            name={detailOpen[i] ? 'chevron-down' : 'chevron-forward'}
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.detailHeaderLabel}>
            {t('zones.detailLabel')}
          </Text>
          <Text style={styles.detailHeaderValue}>
            {zone.guideSize ?? DEFAULT_GUIDE_SIZE} px
          </Text>
        </Pressable>

        {detailOpen[i] && (
          <>
            <View style={styles.detailOptions}>
              {GUIDE_SIZE_OPTIONS.map((size) => {
                const active = (zone.guideSize ?? DEFAULT_GUIDE_SIZE) === size;
                return (
                  <Pressable
                    key={size}
                    style={[
                      styles.detailOption,
                      active && styles.detailOptionActive,
                    ]}
                    onPress={() => setZone(i, { guideSize: size })}
                  >
                    <Text
                      style={[
                        styles.detailOptionText,
                        active && styles.detailOptionTextActive,
                      ]}
                    >
                      {size}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.detailHint}>{t('zones.detailHint')}</Text>
          </>
        )}
      </View>
    </>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.modeRow}>
        <Text style={styles.modeLabel}>{t('zones.allZonesLabel')}</Text>
        <Switch
          value={allZones}
          onValueChange={(v) => onChange({ ...value, allZones: v })}
          // Switching mode unmounts the list, and a card held in it.
          disabled={drag != null}
          trackColor={{ false: colors.bgElevated, true: colors.accent }}
          thumbColor={colors.text}
        />
      </View>

      {allZones ? (
        <View style={styles.zoneCard}>
          <View style={styles.zoneHeader}>
            <View style={styles.zoneBadge}>
              <Ionicons name="apps-outline" size={14} color={colors.text} />
            </View>
            <Text style={styles.zoneTitle}>{t('zones.allZonesTitle')}</Text>
          </View>
          <Text style={styles.modeNote}>{t('zones.allZonesNote')}</Text>
          {zoneBody(value.zones[0], 0)}
        </View>
      ) : (
        <>
          {value.zones.length > 1 && (
            <View style={styles.listToolbar}>
              <Pressable
                onPress={toggleAllFolded}
                disabled={drag != null}
                hitSlop={6}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.foldAllBtn,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Ionicons
                  name={
                    allFolded ? 'chevron-expand-outline' : 'chevron-collapse-outline'
                  }
                  size={16}
                  color={colors.textMuted}
                />
                <Text style={styles.foldAllText}>
                  {t(allFolded ? 'zones.expandAll' : 'zones.collapseAll')}
                </Text>
              </Pressable>
            </View>
          )}

          {/* Content fades in when a card unfolds or appears, but not on the
              first render of the list: the screen opening is not news. */}
          <LayoutAnimationConfig skipEntering>
            {/* The cards get their own layer so the drop slot can be placed
                against them (absolute, one step per slot from the first). */}
            <View style={styles.zoneList}>
              {drag && (
                <DropSlot
                  index={drag.to}
                  label={t('zones.dropTarget', { number: drag.to + 1 })}
                  reduceMotion={reduceMotion}
                />
              )}
              {value.zones.map((zone, i) => {
                // During a drag every card is folded to its fixed height, the
                // one held included. Nothing is unmounted then, least of all
                // the handle holding the gesture: the bodies are simply not
                // rendered until the card lands.
                const dragged = drag?.from === i;
                const folded = drag != null || !!collapsed[i];
                const number = shownNumber(i);
                const id = ids.current[i];
                return (
                  <ZoneRow
                    key={`${id}:${epoch}`}
                    dragged={dragged}
                    lifted={dragged && !landing}
                    shift={shiftFor(i)}
                    dragY={dragY}
                    landedKey={landed?.id === id ? landed.key : 0}
                    reduceMotion={reduceMotion}
                    onLayout={measure(i)}
                    cardStyle={[
                      styles.zoneCard,
                      // Fixed height only while the drag maths needs it: a
                      // card folded by hand sizes itself (large text).
                      drag != null && styles.zoneCardFolded,
                      zone.bypass && styles.zoneCardBypass,
                      dragged && styles.zoneCardDragging,
                    ]}
                  >
                    <View style={styles.zoneHeader}>
                      {value.zones.length > 1 && (
                        <GestureDetector gesture={dragGesture(i)}>
                          <View
                            style={styles.dragHandle}
                            accessible
                            accessibilityRole="adjustable"
                            accessibilityLabel={t('zones.dragHandle', {
                              number: i + 1,
                            })}
                            accessibilityValue={{
                              text: t('zones.position', {
                                number: i + 1,
                                count: value.zones.length,
                              }),
                            }}
                            accessibilityActions={[
                              { name: 'increment', label: t('zones.moveDown') },
                              { name: 'decrement', label: t('zones.moveUp') },
                            ]}
                            onAccessibilityAction={(e) => {
                              if (e.nativeEvent.actionName === 'increment') {
                                nudgeZone(i, i + 1);
                              } else if (
                                e.nativeEvent.actionName === 'decrement'
                              ) {
                                nudgeZone(i, i - 1);
                              }
                            }}
                            hitSlop={6}
                          >
                            <Ionicons
                              name="reorder-three-outline"
                              size={20}
                              color={
                                dragged ? colors.accentStrong : colors.textMuted
                              }
                            />
                          </View>
                        </GestureDetector>
                      )}
                      <Pressable
                        onPress={() =>
                          setCollapsed((s) => ({ ...s, [i]: !s[i] }))
                        }
                        disabled={drag != null}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={t(
                          folded ? 'zones.expand' : 'zones.collapse',
                          { number: i + 1 },
                        )}
                        style={({ pressed }) => [
                          styles.foldBtn,
                          pressed && { opacity: 0.6 },
                        ]}
                      >
                        <Ionicons
                          name={folded ? 'chevron-down' : 'chevron-up'}
                          size={18}
                          color={colors.textMuted}
                        />
                      </Pressable>
                      <View
                        style={[
                          styles.zoneBadge,
                          zone.bypass && styles.zoneBadgeBypass,
                        ]}
                      >
                        {/* Keyed by the number: a card renumbered by the drag
                            fades its new number in. Not when the row itself
                            mounts (drop, new card): the number is not news. */}
                        <LayoutAnimationConfig skipEntering>
                          <Animated.Text
                            key={number}
                            entering={
                              reduceMotion
                                ? undefined
                                : FadeIn.duration(SHIFT_MS)
                            }
                            style={styles.zoneBadgeText}
                          >
                            {number}
                          </Animated.Text>
                        </LayoutAnimationConfig>
                      </View>
                      <Text
                        style={[
                          styles.zoneTitle,
                          zone.bypass && { color: colors.textMuted },
                        ]}
                        numberOfLines={1}
                      >
                        {t('zones.zoneTitle', { number })}
                      </Text>
                      {value.zones.length > 1 && (
                        <Pressable
                          onPress={() => removeZone(i)}
                          disabled={drag != null}
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.removeBtn,
                            pressed && { opacity: 0.6 },
                          ]}
                        >
                          <Ionicons
                            name="close-circle"
                            size={22}
                            color={colors.textMuted}
                          />
                        </Pressable>
                      )}
                    </View>

                    {folded ? (
                      <Text style={styles.foldedSummary} numberOfLines={1}>
                        {zone.bypass
                          ? t('zones.bypassLabel')
                          : zone.prompt.trim() || t('zones.dragEmpty')}
                      </Text>
                    ) : (
                      <Animated.View
                        entering={
                          reduceMotion
                            ? undefined
                            : FadeIn.duration(BODY_FADE_MS)
                        }
                        style={styles.zoneBody}
                      >
                        <View style={styles.bypassRow}>
                          <Text style={styles.bypassLabel}>
                            {t('zones.bypassLabel')}
                          </Text>
                          <Switch
                            value={!!zone.bypass}
                            onValueChange={(bypass) => setZone(i, { bypass })}
                            trackColor={{
                              false: colors.bgElevated,
                              true: colors.warning,
                            }}
                            thumbColor={colors.text}
                          />
                        </View>

                        {zone.bypass ? (
                          <Text style={styles.bypassNote}>
                            {t('zones.bypassNote')}
                          </Text>
                        ) : (
                          zoneBody(zone, i)
                        )}
                      </Animated.View>
                    )}
                  </ZoneRow>
                );
              })}
            </View>
          </LayoutAnimationConfig>

          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              pressed && { backgroundColor: colors.surfacePressed },
              atMax && { opacity: 0.4 },
            ]}
            onPress={addZone}
            disabled={atMax || drag != null}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color={colors.accent}
            />
            <Text style={styles.addText}>
              {atMax
                ? t('zones.maxZones', { count: field.maxZones })
                : t('zones.addZone')}
            </Text>
          </Pressable>
        </>
      )}

      <View style={styles.sharedRow}>
        <View style={styles.sharedItem}>
          <Text style={styles.sharedLabel}>{t('zones.steps')}</Text>
          <TextInput
            style={styles.sharedInput}
            keyboardType="number-pad"
            value={String(value.steps)}
            onChangeText={(t) =>
              onChange({ ...value, steps: parseInt(t, 10) || 0 })
            }
            inputAccessoryViewID={accessoryId}
          />
        </View>
        <View style={[styles.sharedItem, { flex: 1.4 }]}>
          <Text style={styles.sharedLabel}>{t('zones.seed')}</Text>
          <View style={styles.seedRow}>
            <TextInput
              style={[styles.sharedInput, { flex: 1 }]}
              keyboardType="number-pad"
              value={value.seed === 'random' ? '' : String(value.seed)}
              onChangeText={(t) =>
                onChange({
                  ...value,
                  seed: t.trim() === '' ? 'random' : parseInt(t, 10) || 0,
                })
              }
              placeholder={t('zones.randomSeed')}
              placeholderTextColor={colors.textDisabled}
              inputAccessoryViewID={accessoryId}
            />
            <Pressable
              style={({ pressed }) => [
                styles.diceBtn,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
              onPress={() =>
                onChange({
                  ...value,
                  seed: value.seed === 'random' ? randomSeed() : 'random',
                })
              }
            >
              <Ionicons
                name={value.seed === 'random' ? 'dice-outline' : 'refresh-outline'}
                size={18}
                color={colors.accent}
              />
            </Pressable>
          </View>
        </View>
      </View>

      {/* Remix: the seed the source image was drawn with (full width — the
          shared row is too narrow for it). */}
      <SourceSeedChip
        seed={sourceSeed}
        current={value.seed}
        onReuse={(seed) => onChange({ ...value, seed })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  modeLabel: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  modeNote: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: 18,
  },
  listToolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    // Tucked under the gap above: the toolbar belongs to the list below.
    marginBottom: -spacing.sm,
  },
  foldAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.xs,
  },
  foldAllText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  zoneList: {
    gap: CARD_GAP,
  },
  // Drop slot: the place the dragged card lands on, the height of a folded
  // card. A tinted block with a solid edge, so it reads as a place rather
  // than as another card, and never as a bypassed one (dashed).
  dropSlot: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: FOLDED_HEIGHT,
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentStrong,
    borderWidth: CARD_BORDER,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  dropSlotText: {
    color: colors.accentStrong,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  zoneCard: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: CARD_BORDER,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  // Card folded for a drag: header and one summary line, at the fixed height
  // the drag maths relies on (FOLDED_HEIGHT).
  zoneCardFolded: {
    height: FOLDED_HEIGHT,
    overflow: 'hidden',
  },
  zoneBody: {
    gap: spacing.sm,
  },
  zoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: HEADER_HEIGHT,
  },
  zoneBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBadgeText: {
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.xs,
  },
  zoneTitle: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  promptInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  zoneCardBypass: {
    opacity: 0.75,
    borderStyle: 'dashed',
  },
  // Card in the air: its accent outline is animated (ZoneRow, which owns the
  // border colour), no floating shadow — the border alone reads on the dark
  // background.
  zoneCardDragging: {
    backgroundColor: colors.surfacePressed,
  },
  // Its row stacks above the neighbours it flies over.
  zoneSlotDragging: {
    zIndex: 2,
    elevation: 2,
  },
  /** Folded card: what it carries, in one line. */
  foldedSummary: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: SUMMARY_LINE,
  },
  dragHandle: {
    width: HEADER_HEIGHT,
    height: HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.xs,
  },
  // Folding sits next to the handle: both are harmless, and a mistap costs
  // nothing. The delete cross stays alone at the far end, out of reach of
  // either — losing a zone card costs a whole setup.
  foldBtn: {
    width: MIN_TOUCH_TARGET - 16,
    height: HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.xs,
  },
  removeBtn: {
    marginLeft: spacing.sm,
  },
  zoneBadgeBypass: {
    backgroundColor: colors.textDisabled,
  },
  bypassRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bypassLabel: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  bypassNote: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: 18,
  },
  zoneDenoiseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  zoneDenoiseLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  zoneDenoiseInput: {
    minWidth: 88,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  detailPanel: {
    gap: spacing.sm,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
  },
  detailHeaderLabel: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  detailHeaderValue: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  detailOptions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  detailOption: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailOptionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfacePressed,
  },
  detailOptionText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  detailOptionTextActive: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
  },
  detailHint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: 18,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  addText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  sharedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sharedItem: {
    flex: 1,
    gap: spacing.xs,
  },
  sharedLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
  },
  sharedInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    paddingHorizontal: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    textAlign: 'center',
  },
  seedRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  diceBtn: {
    width: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
