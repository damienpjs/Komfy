/**
 * Emotion mixer of the voice workflow (field kind `emotions`): one slider
 * per IndexTTS emotion, preset chips that set the whole mix, and a reset.
 * Like the IndexTTS web UI's vector mode, the weights blend: several
 * emotions can be up at once.
 *
 * A slider commits on release (the launch form re-renders on every value),
 * its number follows the thumb while it moves.
 */

import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import {
  EMOTION_KEYS,
  EMOTION_PRESETS,
  EMOTION_STEP,
  matchingPreset,
  NEUTRAL_MIX,
  presetMix,
} from '../workflows/emotions';

/** IndexTTS caps the total of the mix at this value (after its bias). */
const MIX_CAP = 0.8;

interface Props {
  value: number[];
  onChange: (mix: number[]) => void;
}

export function EmotionMixer({ value, onChange }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  // Live value of the slider being dragged (index → weight).
  const [live, setLive] = useState<{ index: number; v: number } | null>(null);

  const mix = EMOTION_KEYS.map((_, i) => value[i] ?? 0);
  const selected = matchingPreset(mix);
  const isNeutral = mix.every((v) => v === 0);
  const total = mix.reduce((a, b) => a + b, 0);

  const commit = (index: number, v: number) => {
    setLive(null);
    const rounded = Number((Math.round(v / EMOTION_STEP) * EMOTION_STEP).toFixed(2));
    if (rounded === mix[index]) return;
    onChange(mix.map((old, i) => (i === index ? rounded : old)));
  };

  const applyPreset = (key: string) => {
    const preset = EMOTION_PRESETS.find((p) => p.key === key);
    if (!preset) return;
    Haptics.selectionAsync();
    onChange(presetMix(preset.mix));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.chips}>
        {EMOTION_PRESETS.map((p) => {
          const active = selected === p.key;
          return (
            <Pressable
              key={p.key}
              style={({ pressed }) => [
                styles.chip,
                active && styles.chipActive,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
              onPress={() => applyPreset(p.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {t(`emotions.presets.${p.key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.card}>
        {EMOTION_KEYS.map((key, i) => {
          const shown = live?.index === i ? live.v : mix[i];
          return (
            <View key={key} style={styles.row}>
              <Text style={[styles.name, shown > 0 && styles.nameOn]} numberOfLines={1}>
                {t(`emotions.${key}`)}
              </Text>
              <Slider
                style={styles.slider}
                value={mix[i]}
                minimumValue={0}
                maximumValue={1}
                step={EMOTION_STEP}
                onValueChange={(v) => setLive({ index: i, v })}
                onSlidingComplete={(v) => commit(i, v)}
                minimumTrackTintColor={colors.accent}
                maximumTrackTintColor={colors.field}
                thumbTintColor={colors.accent}
                accessibilityLabel={t(`emotions.${key}`)}
              />
              <Text style={[styles.value, shown === 0 && styles.valueOff]}>
                {shown.toFixed(2)}
              </Text>
            </View>
          );
        })}

        <View style={styles.footer}>
          <Text style={styles.note}>
            {isNeutral
              ? t('emotions.neutralNote')
              : total > MIX_CAP
                ? t('emotions.cappedNote', { cap: MIX_CAP })
                : t('emotions.mixNote')}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.reset, (pressed || isNeutral) && { opacity: 0.5 }]}
            onPress={() => {
              Haptics.selectionAsync();
              onChange([...NEUTRAL_MIX]);
            }}
            disabled={isNeutral}
            accessibilityRole="button"
            hitSlop={spacing.sm}
          >
            <Ionicons name="refresh" size={14} color={colors.accent} />
            <Text style={styles.resetText}>{t('emotions.reset')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // Same as the form's select segments ([id].tsx): presets read as choices.
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.bgElevated,
  },
  chipText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  chipTextActive: {
    color: colors.accent,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  name: {
    width: 96,
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  nameOn: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
  },
  slider: {
    flex: 1,
    height: 32,
  },
  value: {
    minWidth: 40,
    textAlign: 'right',
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  valueOff: {
    color: colors.textDisabled,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  note: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  reset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  resetText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
}));
