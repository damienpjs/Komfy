/**
 * "Source seed" offer, under a seed input. A variant keeps drawing a new
 * seed by default (the whole point of a variant); this chip carries the seed
 * the remixed image was actually drawn with, one tap away — for iterating on
 * a prompt while freezing the noise. Shared between the seed field of the
 * launch screen and the FaceSwap shared seed (PersonsField), so any workflow
 * with a seed gets it for free.
 */

import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  /** Seed extracted from the remixed image — undefined hides the chip. */
  seed?: number;
  /** Current field value, to tell "offered" from "already reused". */
  current: number | string | 'random' | undefined;
  onReuse: (seed: number) => void;
}

export function SourceSeedChip({ seed, current, onReuse }: Props) {
  const { t } = useTranslation();
  if (seed == null) return null;

  const inUse = current !== 'random' && Number(current) === seed;
  if (inUse) {
    return (
      <Text style={styles.active}>
        {t('launch.sourceSeedActive', { seed })}
      </Text>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('launch.sourceSeedA11y', { seed })}
      onPress={() => onReuse(seed)}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        pressed && { backgroundColor: colors.surfacePressed },
      ]}
    >
      <Ionicons name="return-down-back-outline" size={14} color={colors.accent} />
      <Text style={styles.text}>{t('launch.sourceSeed', { seed })}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  active: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
});
