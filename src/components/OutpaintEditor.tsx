/**
 * Canvas expansion editor (outpaint field): the source sits on a larger
 * dashed canvas, and a handle on each edge drags that side outward. Every
 * figure shown is in source pixels, live: what each side adds, the final
 * size and ratio, the share of the image the model will invent, and the size
 * it will actually be generated at.
 *
 * Also exports the pieces the form row reuses: the static diagram, the
 * readout and the template chips.
 *
 * Drag maths: while a finger is down the view is frozen (scale and source
 * position), so the handle follows the finger one to one and the canvas grows
 * around a still source. On release the view re-fits, leaving room around the
 * canvas for the next drag. The gestures are built once and read everything
 * through refs (rebuilding them mid-drag would re-attach the detector and
 * drop the touch, cf. MaskEditor).
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import {
  applyTemplate,
  clampSides,
  finalSize,
  generatedFraction,
  hasExpansion,
  maxSide,
  OUTPAINT_DRAG_STEP,
  OUTPAINT_RISKY_FRACTION,
  OUTPAINT_SIDES,
  planOutpaint,
  RATIO_TEMPLATES,
  ratioLabel,
  ratioTemplateId,
  ZOOM_TEMPLATES,
  zoomTemplateId,
  type OutpaintSide,
} from '../workflows/outpaint';
import type { OutpaintAnchor, OutpaintValue } from '../workflows/types';

/** Own "Done" bar: the form's accessory view does not reach into a Modal. */
const EDITOR_ACCESSORY_ID = 'komfy-outpaint-done';

/** Room kept around the canvas for the handles (screen points). */
const STAGE_MARGIN = 28;
/**
 * At rest the source never takes more than this share of the stage, so there
 * is always space to drag an edge outward before the view has to zoom out.
 */
const SOURCE_MAX_SHARE = 0.55;

const ANCHORS: OutpaintAnchor[] = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];

const SIDE_ICONS: Record<OutpaintSide, keyof typeof Ionicons.glyphMap> = {
  left: 'arrow-back',
  top: 'arrow-up',
  right: 'arrow-forward',
  bottom: 'arrow-down',
};

const fmt = (n: number) => String(Math.round(n));

/** Where the source sits on screen, and how many points one source pixel is. */
interface StageLayout {
  scale: number;
  srcX: number;
  srcY: number;
}

function fitLayout(
  value: OutpaintValue,
  stage: { width: number; height: number },
): StageLayout {
  const f = finalSize(value);
  const availW = Math.max(1, stage.width - 2 * STAGE_MARGIN);
  const availH = Math.max(1, stage.height - 2 * STAGE_MARGIN);
  if (!f.width || !f.height) return { scale: 0, srcX: 0, srcY: 0 };
  const scale = Math.min(
    availW / f.width,
    availH / f.height,
    (availW * SOURCE_MAX_SHARE) / value.sourceWidth,
    (availH * SOURCE_MAX_SHARE) / value.sourceHeight,
  );
  const canvasX = (stage.width - f.width * scale) / 2;
  const canvasY = (stage.height - f.height * scale) / 2;
  return {
    scale,
    srcX: canvasX + value.left * scale,
    srcY: canvasY + value.top * scale,
  };
}

/** Canvas + source drawn at a layout; shared by the editor and the form row. */
function CanvasDrawing({
  value,
  sourceUrl,
  layout,
  activeSide,
}: {
  value: OutpaintValue;
  sourceUrl: string;
  layout: StageLayout;
  activeSide?: OutpaintSide | null;
}) {
  const f = finalSize(value);
  const { scale, srcX, srcY } = layout;
  const canvas = {
    left: srcX - value.left * scale,
    top: srcY - value.top * scale,
    width: f.width * scale,
    height: f.height * scale,
  };
  const src = {
    left: srcX,
    top: srcY,
    width: value.sourceWidth * scale,
    height: value.sourceHeight * scale,
  };
  // "+N" written in the middle of each grown band, when it fits.
  const bands: { side: OutpaintSide; left: number; top: number; width: number; height: number }[] = [
    { side: 'left', left: canvas.left, top: src.top, width: value.left * scale, height: src.height },
    { side: 'right', left: src.left + src.width, top: src.top, width: value.right * scale, height: src.height },
    { side: 'top', left: src.left, top: canvas.top, width: src.width, height: value.top * scale },
    { side: 'bottom', left: src.left, top: src.top + src.height, width: src.width, height: value.bottom * scale },
  ];
  return (
    <>
      <View pointerEvents="none" style={[styles.canvas, canvas]} />
      <Image
        source={{ uri: sourceUrl }}
        style={[styles.source, src]}
        contentFit="fill"
        cachePolicy="disk"
      />
      {bands.map(
        (b) =>
          value[b.side] > 0 &&
          b.width >= 36 &&
          b.height >= 18 && (
            <View
              key={b.side}
              pointerEvents="none"
              style={[styles.bandLabelWrap, { left: b.left, top: b.top, width: b.width, height: b.height }]}
            >
              <Text
                style={[styles.bandLabel, activeSide === b.side && styles.bandLabelActive]}
                numberOfLines={1}
              >
                +{fmt(value[b.side])}
              </Text>
            </View>
          ),
      )}
    </>
  );
}

/** Static diagram for the form row: the canvas fitted in a fixed box. */
export function OutpaintDiagram({
  value,
  sourceUrl,
  height,
}: {
  value: OutpaintValue;
  sourceUrl: string;
  height: number;
}) {
  const [box, setBox] = useState({ width: 0, height });
  const layout = useMemo(() => {
    const f = finalSize(value);
    if (!box.width || !f.width || !f.height) return { scale: 0, srcX: 0, srcY: 0 };
    const pad = spacing.sm;
    const scale = Math.min(
      (box.width - 2 * pad) / f.width,
      (box.height - 2 * pad) / f.height,
    );
    return {
      scale,
      srcX: (box.width - f.width * scale) / 2 + value.left * scale,
      srcY: (box.height - f.height * scale) / 2 + value.top * scale,
    };
  }, [box, value]);
  return (
    <View
      style={[styles.diagramBox, { height }]}
      onLayout={(e) =>
        setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }
    >
      {layout.scale > 0 && (
        <CanvasDrawing value={value} sourceUrl={sourceUrl} layout={layout} />
      )}
    </View>
  );
}

/** Size, ratio, generated share and working size, in a few mono lines. */
export function OutpaintReadout({ value }: { value: OutpaintValue }) {
  const { t } = useTranslation();
  const f = finalSize(value);
  const plan = planOutpaint(value);
  const fraction = generatedFraction(value);
  const risky = fraction > OUTPAINT_RISKY_FRACTION;
  return (
    <View style={styles.readout}>
      <Text style={styles.readoutMain}>
        {value.sourceWidth} × {value.sourceHeight}
        <Text style={styles.readoutDim}>{'  →  '}</Text>
        {f.width} × {f.height}
        <Text style={styles.readoutDim}>{'  '}{ratioLabel(f.width, f.height)}</Text>
      </Text>
      {hasExpansion(value) ? (
        <Text style={[styles.readoutSub, risky && styles.readoutRisky]}>
          {t('outpaint.generated', { percent: Math.round(fraction * 100) })}
          {plan
            ? ` · ${t('outpaint.workingSize', {
                width: plan.canvas.width,
                height: plan.canvas.height,
              })}`
            : ''}
        </Text>
      ) : (
        <Text style={styles.readoutSub}>{t('outpaint.noExpansion')}</Text>
      )}
      {risky && (
        <Text style={styles.readoutRisky}>
          {t('outpaint.risky', { percent: Math.round(OUTPAINT_RISKY_FRACTION * 100) })}
        </Text>
      )}
    </View>
  );
}

/** Format and zoom-out templates, as one wrapping row of chips. */
export function OutpaintTemplates({
  value,
  onChange,
  scroll,
}: {
  value: OutpaintValue;
  onChange: (v: OutpaintValue) => void;
  /** One horizontal scrolling line (form row) instead of wrapped rows. */
  scroll?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const chips = [
    ...RATIO_TEMPLATES.map((r) => ({ id: ratioTemplateId(r.id), label: r.id })),
    ...ZOOM_TEMPLATES.map((k) => ({
      id: zoomTemplateId(k),
      label: t('outpaint.zoomChip', { factor: k.toLocaleString(i18n.language) }),
    })),
  ];
  const body = chips.map((c) => {
    const selected = value.template === c.id;
    return (
      <Pressable
        key={c.id}
        onPress={() => {
          Haptics.selectionAsync();
          onChange(applyTemplate(value, c.id));
        }}
        style={({ pressed }) => [
          styles.chip,
          selected && styles.chipSelected,
          pressed && !selected && { backgroundColor: colors.surfacePressed },
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected }}
      >
        <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
          {c.label}
        </Text>
      </Pressable>
    );
  });
  return scroll ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
      keyboardShouldPersistTaps="handled"
    >
      {body}
    </ScrollView>
  ) : (
    <View style={[styles.chipRow, styles.chipWrap]}>{body}</View>
  );
}

interface Props {
  visible: boolean;
  sourceUrl: string;
  value: OutpaintValue;
  budgets: number[];
  onCancel: () => void;
  onDone: (value: OutpaintValue) => void;
}

export function OutpaintEditor({
  visible,
  sourceUrl,
  value,
  budgets,
  onCancel,
  onDone,
}: Props) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(value);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [frozen, setFrozen] = useState<StageLayout | null>(null);
  const [activeSide, setActiveSide] = useState<OutpaintSide | null>(null);
  // Raw text of the side being typed (null = show the value).
  const [typing, setTyping] = useState<{ side: OutpaintSide; text: string } | null>(null);
  // Mirrored synchronously: moving from one side's input to another fires
  // the new focus and the old end-of-editing in an order not to rely on.
  const typingRef = useRef<{ side: OutpaintSide; text: string } | null>(null);

  // Re-arm from the form's value each time the editor opens.
  useEffect(() => {
    if (visible) {
      setDraft(value);
      setFrozen(null);
      setActiveSide(null);
      typingRef.current = null;
      setTyping(null);
    }
    // `value` changes identity on every form render; opening is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const layout = frozen ?? fitLayout(draft, stage);

  // Mirrors for the gestures (built once, cf. header).
  const draftRef = useRef(draft);
  const layoutRef = useRef(layout);
  useEffect(() => {
    draftRef.current = draft;
    layoutRef.current = layout;
  });
  const dragStart = useRef({ value: 0, layout });

  const gestures = useMemo(() => {
    const make = (side: OutpaintSide) =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          Keyboard.dismiss();
          dragStart.current = {
            value: draftRef.current[side],
            layout: layoutRef.current,
          };
          setFrozen(layoutRef.current);
          setActiveSide(side);
        })
        .onUpdate((e) => {
          const { scale } = dragStart.current.layout;
          if (!scale) return;
          const along =
            side === 'left'
              ? -e.translationX
              : side === 'right'
                ? e.translationX
                : side === 'top'
                  ? -e.translationY
                  : e.translationY;
          const raw = dragStart.current.value + along / scale;
          const next = Math.max(
            0,
            Math.min(
              maxSide(draftRef.current, side),
              Math.round(raw / OUTPAINT_DRAG_STEP) * OUTPAINT_DRAG_STEP,
            ),
          );
          // Functional update: move events can outrun the ref mirror. A drag
          // is a manual edit, so it detaches the template.
          setDraft((cur) =>
            cur[side] === next ? cur : { ...cur, [side]: next, template: null },
          );
        })
        .onFinalize(() => {
          Haptics.selectionAsync();
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setFrozen(null);
          setActiveSide(null);
        });
    return {
      left: make('left'),
      top: make('top'),
      right: make('right'),
      bottom: make('bottom'),
    };
  }, []);

  const updateTyping = (next: { side: OutpaintSide; text: string } | null) => {
    typingRef.current = next;
    setTyping(next);
  };

  /** A draft with a typed side folded in (clamped, template detached). */
  const fold = (
    cur: OutpaintValue,
    typed: { side: OutpaintSide; text: string } | null,
  ): OutpaintValue => {
    if (!typed) return cur;
    const n = parseInt(typed.text, 10);
    return clampSides({
      ...cur,
      [typed.side]: Number.isFinite(n) ? n : 0,
      template: null,
    });
  };

  const commitTyping = () => {
    const typed = typingRef.current;
    if (!typed) return;
    setDraft((cur) => fold(cur, typed));
    updateTyping(null);
  };

  const setAnchor = (anchor: OutpaintAnchor) => {
    Haptics.selectionAsync();
    setDraft((cur) => {
      const next = { ...cur, anchor };
      // An anchor only means something for a template: re-apply it.
      return cur.template ? applyTemplate(next, cur.template) : next;
    });
  };

  const reset = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraft((cur) => ({ ...cur, left: 0, top: 0, right: 0, bottom: 0, template: null }));
  };

  const f = finalSize(draft);
  const canvas = {
    left: layout.srcX - draft.left * layout.scale,
    top: layout.srcY - draft.top * layout.scale,
    width: f.width * layout.scale,
    height: f.height * layout.scale,
  };
  const handleCenter: Record<OutpaintSide, { x: number; y: number }> = {
    left: { x: canvas.left, y: canvas.top + canvas.height / 2 },
    right: { x: canvas.left + canvas.width, y: canvas.top + canvas.height / 2 },
    top: { x: canvas.left + canvas.width / 2, y: canvas.top },
    bottom: { x: canvas.left + canvas.width / 2, y: canvas.top + canvas.height },
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
          <Text style={styles.title}>{t('outpaint.editorTitle')}</Text>
          <Pressable
            // A side still being typed counts: Done must not drop it.
            onPress={() => onDone(fold(draft, typingRef.current))}
            hitSlop={8}
            style={styles.headerBtn}
          >
            <Text style={styles.done}>{t('common.done')}</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={styles.body}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={styles.stage}
            onLayout={(e) =>
              setStage({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })
            }
          >
            {layout.scale > 0 && (
              <>
                <CanvasDrawing
                  value={draft}
                  sourceUrl={sourceUrl}
                  layout={layout}
                  activeSide={activeSide}
                />
                {OUTPAINT_SIDES.map((side) => {
                  const c = handleCenter[side];
                  const vertical = side === 'left' || side === 'right';
                  const active = activeSide === side;
                  return (
                    <GestureDetector key={side} gesture={gestures[side]}>
                      <View
                        style={[
                          styles.handleHit,
                          {
                            left: c.x - MIN_TOUCH_TARGET / 2,
                            top: c.y - MIN_TOUCH_TARGET / 2,
                          },
                        ]}
                        accessibilityRole="adjustable"
                        accessibilityLabel={t(`outpaint.${side}`)}
                        accessibilityValue={{ text: `${draft[side]} px` }}
                        accessibilityActions={[
                          { name: 'increment' },
                          { name: 'decrement' },
                        ]}
                        onAccessibilityAction={(e) => {
                          const step = Math.max(
                            OUTPAINT_DRAG_STEP,
                            Math.round(
                              (vertical ? draft.sourceWidth : draft.sourceHeight) / 20,
                            ),
                          );
                          const delta = e.nativeEvent.actionName === 'increment' ? step : -step;
                          setDraft((cur) =>
                            clampSides({ ...cur, [side]: cur[side] + delta, template: null }),
                          );
                        }}
                      >
                        <View
                          style={[
                            styles.handle,
                            vertical ? styles.handleVertical : styles.handleHorizontal,
                            active && styles.handleActive,
                          ]}
                        />
                      </View>
                    </GestureDetector>
                  );
                })}
              </>
            )}
          </View>

          <ScrollView
            style={styles.panel}
            contentContainerStyle={[
              styles.panelContent,
              { paddingBottom: insets.bottom + spacing.md },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <OutpaintReadout value={draft} />

            <OutpaintTemplates value={draft} onChange={setDraft} />

            <View style={styles.controlsRow}>
              <View style={styles.anchorBlock}>
                <Text style={styles.sectionLabel}>{t('outpaint.anchor')}</Text>
                <View style={styles.anchorGrid}>
                  {ANCHORS.map((a) => {
                    const selected = draft.anchor === a;
                    return (
                      <Pressable
                        key={a}
                        onPress={() => setAnchor(a)}
                        style={styles.anchorCell}
                        accessibilityRole="button"
                        accessibilityLabel={t(`outpaint.anchors.${a}`)}
                        accessibilityState={{ selected }}
                      >
                        <View
                          style={[styles.anchorDot, selected && styles.anchorDotSelected]}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.sidesBlock}>
                <Text style={styles.sectionLabel}>{t('outpaint.sides')}</Text>
                <View style={styles.sidesGrid}>
                  {(['left', 'right', 'top', 'bottom'] as OutpaintSide[]).map((side) => (
                    <View key={side} style={styles.sideInputRow}>
                      <Ionicons
                        name={SIDE_ICONS[side]}
                        size={16}
                        color={colors.textMuted}
                        accessibilityLabel={t(`outpaint.${side}`)}
                      />
                      <TextInput
                        style={styles.sideInput}
                        keyboardType="number-pad"
                        selectTextOnFocus
                        maxLength={5}
                        value={typing?.side === side ? typing.text : String(draft[side])}
                        onFocus={() => {
                          // Another side still open: keep what was typed there.
                          if (typingRef.current && typingRef.current.side !== side) {
                            commitTyping();
                          }
                          updateTyping({ side, text: String(draft[side]) });
                        }}
                        onChangeText={(text) => updateTyping({ side, text })}
                        onEndEditing={commitTyping}
                        onSubmitEditing={commitTyping}
                        inputAccessoryViewID={
                          Platform.OS === 'ios' ? EDITOR_ACCESSORY_ID : undefined
                        }
                        accessibilityLabel={t(`outpaint.${side}`)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View>
              <Text style={styles.sectionLabel}>{t('outpaint.budget')}</Text>
              <View style={styles.segmentRow}>
                {budgets.map((b) => {
                  const selected = draft.budget === b;
                  return (
                    <Pressable
                      key={b}
                      onPress={() => setDraft((cur) => ({ ...cur, budget: b }))}
                      style={[styles.segment, selected && styles.segmentSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                        {t('outpaint.megapixels', { value: b.toLocaleString(i18n.language) })}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>{t('outpaint.budgetHint')}</Text>
            </View>

            <View style={styles.footerRow}>
              <Text style={[styles.hint, styles.footerHint]}>{t('outpaint.dragHint')}</Text>
              <Pressable
                onPress={reset}
                disabled={!hasExpansion(draft)}
                style={({ pressed }) => [
                  styles.resetBtn,
                  pressed && { backgroundColor: colors.surfacePressed },
                  !hasExpansion(draft) && { opacity: 0.4 },
                ]}
              >
                <Ionicons name="refresh-outline" size={16} color={colors.text} />
                <Text style={styles.resetText}>{t('outpaint.reset')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        {Platform.OS === 'ios' && (
          <InputAccessoryView nativeID={EDITOR_ACCESSORY_ID}>
            <View style={styles.accessoryBar}>
              <Pressable onPress={Keyboard.dismiss} hitSlop={8}>
                <Text style={styles.done}>{t('launch.done')}</Text>
              </Pressable>
            </View>
          </InputAccessoryView>
        )}
      </GestureHandlerRootView>
    </Modal>
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
  body: {
    flex: 1,
  },
  stage: {
    flex: 1,
    minHeight: 220,
    overflow: 'hidden',
  },
  // The area the model will invent: tinted, dashed outline = final frame.
  canvas: {
    position: 'absolute',
    backgroundColor: colors.accentSoft,
    borderColor: colors.accentStrong,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 1,
  },
  source: {
    position: 'absolute',
  },
  bandLabelWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandLabel: {
    color: colors.accentStrong,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  bandLabelActive: {
    color: colors.text,
  },
  handleHit: {
    position: 'absolute',
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    backgroundColor: colors.accentStrong,
    borderRadius: radii.full,
    borderColor: colors.bg,
    borderWidth: 2,
  },
  handleVertical: {
    width: 12,
    height: 36,
  },
  handleHorizontal: {
    width: 36,
    height: 12,
  },
  handleActive: {
    backgroundColor: colors.text,
  },
  panel: {
    flexGrow: 0,
    maxHeight: '55%',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.bgElevated,
  },
  panelContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
    marginBottom: spacing.xs,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  anchorBlock: {},
  anchorGrid: {
    // Three touch targets per row, plus the 1 pt border on each side.
    width: MIN_TOUCH_TARGET * 3 + 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
  },
  anchorCell: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anchorDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  anchorDotSelected: {
    width: 20,
    height: 14,
    backgroundColor: colors.accentStrong,
  },
  sidesBlock: {
    flex: 1,
  },
  sidesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
    columnGap: spacing.sm,
  },
  sideInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexBasis: '46%',
    flexGrow: 1,
  },
  sideInput: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xs,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: {
    borderColor: colors.accentStrong,
    backgroundColor: colors.accentSoft,
  },
  segmentText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  segmentTextSelected: {
    color: colors.text,
  },
  hint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    marginTop: spacing.xs,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  footerHint: {
    flex: 1,
    marginTop: 0,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  resetText: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Shared with the form row.
  diagramBox: {
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.bgElevated,
    overflow: 'hidden',
  },
  readout: {
    gap: 2,
  },
  readoutMain: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  readoutDim: {
    color: colors.textMuted,
  },
  readoutSub: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  readoutRisky: {
    color: colors.warning,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chipWrap: {
    flexWrap: 'wrap',
  },
  chip: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.full,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: colors.accentStrong,
    backgroundColor: colors.accentSoft,
  },
  chipText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  chipTextSelected: {
    color: colors.text,
  },
});
