/**
 * Attention backend the app asks for when it turns ComfyUI on (Settings,
 * offline diagnostic). "Server default" sends no mode: the supervisor keeps
 * its COMFY_START_ARGS. Split trades speed for memory: it is what lets a
 * two-image edit fit on the reference 64 GB machine.
 */

import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useSettings, type StartMode } from '../store/settings';
import { makeStyles } from '../theme/theme';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';

const MODES: { mode: StartMode; label: string }[] = [
  { mode: 'default', label: 'supervisor.modeDefault' },
  { mode: 'sdpa', label: 'supervisor.modeSdpa' },
  { mode: 'split', label: 'supervisor.modeSplit' },
];

export function AttentionModePicker() {
  const styles = useStyles();
  const { t } = useTranslation();
  const startMode = useSettings((s) => s.startMode);
  const setStartMode = useSettings((s) => s.setStartMode);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('supervisor.mode')}</Text>
      <View style={styles.track} accessibilityRole="radiogroup">
        {MODES.map(({ mode, label }) => {
          const on = mode === startMode;
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => {
                Haptics.selectionAsync();
                setStartMode(mode);
              }}
              style={[styles.segment, on && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
                {t(label)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{t('supervisor.modeHint')}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    gap: spacing.xs + 2,
  },
  label: {
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  track: {
    flexDirection: 'row',
    padding: 3,
    gap: 3,
    borderRadius: radii.md,
    backgroundColor: colors.field,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md - 3,
  },
  segmentOn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segmentText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: 14,
  },
  segmentTextOn: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
  },
}));
