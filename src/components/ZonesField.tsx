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
 * cheaper than deleting it and typing everything back. The drag is held by
 * the handle alone so the page keeps scrolling everywhere else; the parent
 * is told through `onDragChange` to freeze its scroll while a card is in the
 * air, to scroll it back from the edges (ZoneDragScroller) and to show which
 * zone the card is headed for. The card in the air folds down to its header,
 * and its landing slot is outlined in the list. The chevron at the other end
 * of that header folds a card by hand, the same way and just as harmlessly:
 * folding only stops rendering the editor, the zone's setup lives in the form
 * value throughout.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
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

/** Vertical gap between two cards — the drag maths needs it (styles.wrap). */
const CARD_GAP = spacing.md;

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
  // Per-zone denoise text being edited (intermediate states like "0,"
  // tolerated; numeric commit on the fly).
  const [denoiseTexts, setDenoiseTexts] = useState<Record<number, string>>({});
  // Cards folded by hand (same folded look as a card in the air): the setup
  // survives untouched, only the editor is out of the way.
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  // "Detail level" panel (guide_size): collapsed by default, per zone.
  const [detailOpen, setDetailOpen] = useState<Record<number, boolean>>({});
  // Per-zone modified area being edited (empty string = inherit the shared
  // field, which is also what an absent `dilation` means).
  const [dilationTexts, setDilationTexts] = useState<Record<number, string>>({});

  // Drag & drop: measured card heights (index = position in the list), the
  // card in the air and the slot it currently targets.
  const heights = useRef<Record<number, number>>({});
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  // Same state, readable from the gesture callbacks without waiting for the
  // render that follows setDrag.
  const dragRef = useRef<{ from: number; to: number } | null>(null);
  const dragY = useSharedValue(0);
  const dragStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

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
    // indexes shift: restart from the committed values
    setDenoiseTexts({});
    setDilationTexts({});
    setCollapsed({});
    heights.current = {};
    onChange({ ...value, zones: value.zones.filter((_, j) => j !== i) });
  };

  const moveZone = (from: number, to: number) => {
    const zones = value.zones.slice();
    const [moved] = zones.splice(from, 1);
    zones.splice(to, 0, moved);
    setDenoiseTexts((s) => remapIndexed(s, from, to));
    setDilationTexts((s) => remapIndexed(s, from, to));
    setDetailOpen((s) => remapIndexed(s, from, to));
    setCollapsed((s) => remapIndexed(s, from, to));
    heights.current = remapIndexed(heights.current, from, to);
    onChange({ ...value, zones });
  };

  /**
   * Slot the dragged card would land on, walking neighbour by neighbour: a
   * card is taken over once the finger has passed half of its height, which
   * keeps the swap honest with cards of very different sizes (a bypassed card
   * is a fraction of the height of one carrying four LoRAs).
   */
  const targetIndex = (from: number, translation: number) => {
    let to = from;
    let rest = translation;
    while (rest > 0 && to < value.zones.length - 1) {
      const step = (heights.current[to + 1] ?? 0) + CARD_GAP;
      if (rest <= step / 2) break;
      rest -= step;
      to += 1;
    }
    while (rest < 0 && to > 0) {
      const step = (heights.current[to - 1] ?? 0) + CARD_GAP;
      if (-rest <= step / 2) break;
      rest += step;
      to -= 1;
    }
    return to;
  };

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
  // leave its ticker behind.
  useEffect(() => stopEdgeScroll, []);

  /**
   * Places the dragged card and picks the slot it targets. The card travels in
   * content coordinates: the finger's own travel PLUS whatever the page has
   * scrolled under it since the drag started — that sum is what keeps the card
   * under the finger, and what the slot maths is expressed in.
   */
  const applyDrag = () => {
    const current = dragRef.current;
    if (!current) return;
    const scrolled = (scroller?.offset() ?? 0) - scrollAtStart.current;
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
    if (!scroller || !dragRef.current) return;
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
    dragY.value = 0;
    rawTravel.current = 0;
    fingerY.current = absoluteY;
    scrollAtStart.current = scroller?.offset() ?? 0;
    dragRef.current = { from: i, to: i };
    setDrag(dragRef.current);
    onDragChange?.(dragRef.current);
    Haptics.selectionAsync().catch(() => {});
    if (scroller) {
      stopEdgeScroll();
      edgeTimer.current = setInterval(edgeScrollTick, EDGE_TICK_MS);
    }
  };

  const updateDrag = (translation: number, absoluteY: number) => {
    if (!dragRef.current) return;
    rawTravel.current = translation;
    fingerY.current = absoluteY;
    applyDrag();
  };

  const endDrag = (commit: boolean) => {
    stopEdgeScroll();
    const current = dragRef.current;
    dragRef.current = null;
    dragY.value = 0;
    if (!current) return;
    setDrag(null);
    onDragChange?.(null);
    if (commit && current.to !== current.from) {
      moveZone(current.from, current.to);
    }
  };

  /** Top of card `index` in the list, as laid out before any drag. */
  const slotTop = (index: number) => {
    let top = 0;
    for (let j = 0; j < index; j += 1) top += (heights.current[j] ?? 0) + CARD_GAP;
    return top;
  };

  /**
   * The hole the shifted cards leave open, i.e. where the dragged card lands
   * on release — drawn as a dashed outline so the drop is not a guess. Moving
   * DOWN frees the bottom of the block that stepped up (hence the target
   * card's own height in the offset); moving UP frees its top.
   */
  const placeholder = (() => {
    if (!drag) return null;
    const height = heights.current[drag.from] ?? 0;
    if (drag.to === drag.from) return { top: slotTop(drag.from), height };
    if (drag.to > drag.from) {
      return {
        top: slotTop(drag.to) + (heights.current[drag.to] ?? 0) - height,
        height,
      };
    }
    return { top: slotTop(drag.to), height };
  })();

  /**
   * Where a card that is NOT the dragged one sits while the drag lasts: the
   * cards the dragged card flew over step into the hole it left behind.
   */
  const shiftFor = (i: number) => {
    if (!drag || drag.from === drag.to || i === drag.from) return 0;
    const step = (heights.current[drag.from] ?? 0) + CARD_GAP;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -step;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return step;
    return 0;
  };

  const measure = (i: number) => (e: LayoutChangeEvent) => {
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
      .onUpdate((e) => updateDrag(e.translationY, e.absoluteY))
      .onEnd(() => endDrag(true))
      .onFinalize(() => endDrag(false));

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
          {/* The cards get their own layer so the drop outline can be placed
              against them (absolute, measured from the first card). */}
          <View style={styles.zoneList}>
            {placeholder && (
              <View
                pointerEvents="none"
                style={[
                  styles.dropSlot,
                  { top: placeholder.top, height: placeholder.height },
                ]}
              >
                <Text style={styles.dropSlotText} numberOfLines={1}>
                  {t('zones.dropTarget', { number: (drag?.to ?? 0) + 1 })}
                </Text>
              </View>
            )}
            {value.zones.map((zone, i) => {
              // Card in the air: it folds down to its header so it stops
              // covering the list, while its slot keeps the height it had —
              // freezing that height is what leaves the layout (and the drop
              // maths, expressed in it) untouched by the folding. Nothing is
              // unmounted, least of all the handle holding the gesture: the
              // body is simply not rendered until the card lands.
              const dragged = drag?.from === i;
              const folded = dragged || !!collapsed[i];
              return (
              <Animated.View
                key={i}
                onLayout={measure(i)}
                style={[
                  dragged
                    ? [
                        styles.zoneSlotDragging,
                        { height: heights.current[i] },
                        dragStyle,
                      ]
                    : { transform: [{ translateY: shiftFor(i) }] },
                ]}
              >
                <View
                  style={[
                    styles.zoneCard,
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
                        hitSlop={6}
                      >
                        <Ionicons
                          name="reorder-three-outline"
                          size={20}
                          color={dragged ? colors.accent : colors.textMuted}
                        />
                      </View>
                    </GestureDetector>
                  )}
                  <Pressable
                    onPress={() =>
                      setCollapsed((s) => ({ ...s, [i]: !s[i] }))
                    }
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
                    <Text style={styles.zoneBadgeText}>{i + 1}</Text>
                  </View>
                  <Text
                    style={[
                      styles.zoneTitle,
                      zone.bypass && { color: colors.textMuted },
                    ]}
                  >
                    {t('zones.zoneTitle', { number: i + 1 })}
                  </Text>
                  {value.zones.length > 1 && (
                    <Pressable
                      onPress={() => removeZone(i)}
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
                  <Text style={styles.dragSummary} numberOfLines={1}>
                    {zone.bypass
                      ? t('zones.bypassLabel')
                      : zone.prompt.trim() || t('zones.dragEmpty')}
                  </Text>
                ) : (
                  <>
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
                  </>
                )}
                </View>
              </Animated.View>
              );
            })}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.addBtn,
              pressed && { backgroundColor: colors.surfacePressed },
              atMax && { opacity: 0.4 },
            ]}
            onPress={addZone}
            disabled={atMax}
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
  zoneList: {
    gap: spacing.md,
  },
  // Drop outline: the slot the dragged card would take, dashed so it reads as
  // a hole rather than another card.
  dropSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderColor: colors.accent,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  dropSlotText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  zoneCard: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  zoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  // Card in the air: an accent outline, no floating shadow — the border alone
  // reads on both themes.
  zoneCardDragging: {
    borderColor: colors.accent,
    backgroundColor: colors.surfacePressed,
  },
  // Its slot: keeps the full height the card had (set inline) so the list
  // holds still, and stacks above the neighbours it flies over.
  zoneSlotDragging: {
    zIndex: 2,
    elevation: 2,
  },
  /** Folded card: what it carries, in one line. */
  dragSummary: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  dragHandle: {
    width: MIN_TOUCH_TARGET - 12,
    height: MIN_TOUCH_TARGET - 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.xs,
  },
  // Folding sits next to the handle: both are harmless, and a mistap costs
  // nothing. The delete cross stays alone at the far end, out of reach of
  // either — losing a zone card costs a whole setup.
  foldBtn: {
    width: MIN_TOUCH_TARGET - 16,
    height: MIN_TOUCH_TARGET - 12,
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
