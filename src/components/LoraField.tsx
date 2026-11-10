/**
 * Editor for a launch form's LoRA selection: cards (name, folder, strength
 * slider, removal) + an add button opening the explorer (LoraPicker).
 */

import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../store/settings';
import { loraDirName, loraDisplayName } from '../utils/pathTree';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import type { LoraSelection, LorasField } from '../workflows/types';
import { LoraPicker } from './LoraPicker';

interface Props {
  field: LorasField;
  value: LoraSelection[];
  onChange: (value: LoraSelection[]) => void;
}

const STRENGTH_MIN = -10;
const STRENGTH_MAX = 10;
const STRENGTH_STEP = 0.05;
// A full sweep of [-10, 10] at a 0.05 step crosses 400 values: one pulse per
// step saturates the motor and the ticks end up lagging behind the thumb.
// Spacing them keeps the feedback in sync with the finger.
const HAPTIC_MIN_INTERVAL_MS = 45;
// Notches: a firmer pulse on every multiple of 0.5, so a half-unit move can
// be done by feel instead of by reading the label. Sparser than the step
// ticks, so a shorter guard: a notch must not be swallowed by the limiter.
const NOTCH = 0.5;
const NOTCH_HAPTIC_MIN_INTERVAL_MS = 20;

// Lift-off drift. One step is under 1 pt of track: the finger rolling off
// the glass moves the thumb several steps in the last few milliseconds. When
// a value was held long enough to be read and the thumb only moved at the
// very end, the held value is the one that was meant.
const LIFT_WINDOW_MS = 120; // changes this close to release count as drift
const DWELL_MS = 150; // minimum hold for a value to count as chosen
const MAX_LIFT_DRIFT = 0.5; // beyond this, the final move was deliberate
// Under half a step, so the native slider rounds it away; but it changes the
// `value` prop, which is what moves the native thumb. Without it, a commit
// equal to the previous strength leaves the thumb where the finger lifted.
const THUMB_NUDGE = 0.0001;

// −/+ buttons: one step per tap, for the single-step moves a finger cannot
// make on the track. Held down, they repeat after a short delay.
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 70;
const STEP_HIT_SLOP = (MIN_TOUCH_TARGET - 28) / 2;

interface Sample {
  v: number;
  t: number;
}

/** Value to commit on release (cf. LIFT_WINDOW_MS). */
function settleRelease(samples: Sample[], released: number, now: number) {
  let i = samples.length - 1;
  while (i >= 0 && samples[i].t >= now - LIFT_WINDOW_MS) i--;
  // Nothing moved right before the release: nothing to undo.
  if (i === samples.length - 1) return released;
  // Nothing moved before that final burst: a quick flick from a standstill
  // is a deliberate move, not drift.
  if (i < 0) return released;
  const held = samples[i];
  if (samples[i + 1].t - held.t < DWELL_MS) return released;
  if (Math.abs(released - held.v) > MAX_LIFT_DRIFT) return released;
  return held.v;
}

/** True when a move from `from` to `to` lands on or crosses a notch. */
function crossesNotch(from: number, to: number) {
  // Integer hundredths: float multiples of 0.05 do not divide cleanly.
  const a = Math.round(from * 100);
  const b = Math.round(to * 100);
  const n = Math.round(NOTCH * 100);
  if (b > a) return Math.floor(a / n) * n + n <= b;
  if (b < a) return Math.ceil(a / n) * n - n >= b;
  return false;
}

export function LoraField({ field, value, onChange }: Props) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Global cap (Settings), applied to every workflow type. null = no limit.
  const maxCount = useSettings((s) => s.loraMaxCount);
  // Value displayed WHILE sliding (the selection is only committed on
  // release, but the user sees where they are).
  const [liveStrength, setLiveStrength] = useState<Record<string, number>>({});
  const defaultStrength = field.defaultStrength ?? 1.0;
  // Timestamp of the last tick, shared by the cards: only one slider can be
  // dragged at a time.
  const lastHapticAt = useRef(0);
  // The drag in progress (one slider at a time, like the haptics): the
  // value changes with their arrival time, for settleRelease.
  const drag = useRef<{ samples: Sample[]; last: number }>({
    samples: [],
    last: 0,
  });
  // Flipped on every commit to toggle THUMB_NUDGE (see there).
  const [thumbSync, setThumbSync] = useState(0);
  // The hold-to-repeat timer outlives renders: it reads the latest props
  // here rather than the ones captured when the press began.
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const repeat = useRef<{
    delay?: ReturnType<typeof setTimeout>;
    tick?: ReturnType<typeof setInterval>;
  }>({});
  useEffect(() => {
    const timers = repeat.current;
    return () => {
      clearTimeout(timers.delay);
      clearInterval(timers.tick);
    };
  }, []);

  /** One step up or down; false once the strength hits a bound. */
  const stepStrength = (path: string, dir: 1 | -1) => {
    const { value: current, onChange: commit } = latest.current;
    const lora = current.find((l) => l.name === path);
    if (!lora) return false;
    const next = Number(
      Math.min(
        STRENGTH_MAX,
        Math.max(STRENGTH_MIN, lora.strength + dir * STRENGTH_STEP),
      ).toFixed(2),
    );
    if (next === lora.strength) return false;
    Haptics.selectionAsync();
    commit(
      current.map((l) => (l.name === path ? { ...l, strength: next } : l)),
    );
    return true;
  };

  const stopRepeat = () => {
    clearTimeout(repeat.current.delay);
    clearInterval(repeat.current.tick);
  };

  const startRepeat = (path: string, dir: 1 | -1) => {
    stopRepeat();
    if (!stepStrength(path, dir)) return;
    repeat.current.delay = setTimeout(() => {
      repeat.current.tick = setInterval(() => {
        if (!stepStrength(path, dir)) stopRepeat();
      }, REPEAT_INTERVAL_MS);
    }, REPEAT_DELAY_MS);
  };

  const tickHaptic = (from: number, to: number) => {
    const now = Date.now();
    const notch = crossesNotch(from, to);
    const guard = notch ? NOTCH_HAPTIC_MIN_INTERVAL_MS : HAPTIC_MIN_INTERVAL_MS;
    if (now - lastHapticAt.current < guard) return;
    lastHapticAt.current = now;
    if (notch) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    else Haptics.selectionAsync();
  };

  const toggle = (path: string) => {
    if (value.some((l) => l.name === path)) {
      onChange(value.filter((l) => l.name !== path));
    } else if (maxCount == null || value.length < maxCount) {
      onChange([...value, { name: path, strength: defaultStrength }]);
    }
  };

  const setStrength = (path: string, strength: number) => {
    onChange(
      value.map((l) =>
        l.name === path ? { ...l, strength: Number(strength.toFixed(2)) } : l,
      ),
    );
  };

  const atMax = maxCount != null && value.length >= maxCount;

  return (
    <View style={styles.wrap}>
      {/*
        LoRAs the workflow always applies (LorasField.fixed): shown so the
        recipe stays readable, but with no slider and no remove button — they
        are part of the workflow, not of the selection.
      */}
      {(field.fixed ?? []).map((lora, index) => (
        <View key={`fixed-${lora.name}-${index}`} style={[styles.card, styles.fixedCard]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName} numberOfLines={1}>
                {loraDisplayName(lora.name)}
              </Text>
              <View style={styles.dirChip}>
                <Ionicons name="lock-closed" size={11} color={colors.textMuted} />
                <Text style={styles.dirChipText} numberOfLines={1}>
                  {t('lora.fixed', { strength: lora.strength })}
                </Text>
              </View>
            </View>
          </View>
        </View>
      ))}

      {value.map((lora, index) => (
        // Key by name+index: the same LoRA can legitimately appear twice in a
        // chain (stacked at two strengths), and a bare name key would collide
        // (cf. GraphSummary, same pattern).
        <View key={`${lora.name}-${index}`} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text style={styles.cardName} numberOfLines={1}>
                {loraDisplayName(lora.name)}
              </Text>
              {loraDirName(lora.name) !== '' && (
                <View style={styles.dirChip}>
                  <Ionicons
                    name="folder-outline"
                    size={11}
                    color={colors.textMuted}
                  />
                  <Text style={styles.dirChipText} numberOfLines={1}>
                    {loraDirName(lora.name)}
                  </Text>
                </View>
              )}
            </View>
            <Pressable
              onPress={() => toggle(lora.name)}
              hitSlop={10}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Ionicons
                name="close-circle"
                size={22}
                color={colors.textMuted}
              />
            </Pressable>
          </View>

          <View style={styles.strengthRow}>
            <Slider
              style={styles.slider}
              minimumValue={STRENGTH_MIN}
              maximumValue={STRENGTH_MAX}
              step={STRENGTH_STEP}
              value={lora.strength + (thumbSync % 2 ? THUMB_NUDGE : 0)}
              onSlidingStart={(v) => {
                drag.current = { samples: [], last: v };
              }}
              onValueChange={(v) => {
                tickHaptic(drag.current.last, v);
                drag.current.last = v;
                drag.current.samples.push({ v, t: Date.now() });
                setLiveStrength((s) => ({ ...s, [lora.name]: v }));
              }}
              onSlidingComplete={(v) => {
                const committed = settleRelease(
                  drag.current.samples,
                  v,
                  Date.now(),
                );
                drag.current.samples = [];
                // Distinct from the sliding ticks: marks the committed value.
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setStrength(lora.name, committed);
                setThumbSync((n) => n + 1);
                setLiveStrength((s) => {
                  const { [lora.name]: _, ...rest } = s;
                  return rest;
                });
              }}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.bgElevated}
              thumbTintColor={colors.accent}
            />
            <Pressable
              onPressIn={() => startRepeat(lora.name, -1)}
              onPressOut={stopRepeat}
              hitSlop={STEP_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('lora.strengthDown')}
              style={({ pressed }) => [
                styles.stepBtn,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              <Ionicons name="remove" size={16} color={colors.accent} />
            </Pressable>
            <Text
              style={[
                styles.strengthValue,
                liveStrength[lora.name] != null && { color: colors.accent },
              ]}
            >
              ×{(liveStrength[lora.name] ?? lora.strength).toFixed(2)}
            </Text>
            <Pressable
              onPressIn={() => startRepeat(lora.name, 1)}
              onPressOut={stopRepeat}
              hitSlop={STEP_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={t('lora.strengthUp')}
              style={({ pressed }) => [
                styles.stepBtn,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              <Ionicons name="add" size={16} color={colors.accent} />
            </Pressable>
          </View>
        </View>
      ))}

      <Pressable
        style={({ pressed }) => [
          styles.addBtn,
          pressed && { backgroundColor: colors.surfacePressed },
          atMax && { opacity: 0.4 },
        ]}
        onPress={() => setPickerOpen(true)}
        disabled={atMax}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={styles.addText}>
          {atMax ? t('lora.max', { count: maxCount }) : t('lora.add')}
        </Text>
      </Pressable>

      <LoraPicker
        visible={pickerOpen}
        selected={value.map((l) => l.name)}
        onToggle={toggle}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  fixedCard: {
    borderStyle: 'dashed',
    backgroundColor: colors.bgElevated,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  cardTitleWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  cardName: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  dirChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.bgElevated,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  dirChipText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  slider: {
    flex: 1,
    height: 32,
  },
  strengthValue: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    minWidth: 56,
    textAlign: 'center',
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
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
});
