/**
 * Icon of an imported workflow, picked from the workflow icon set so it
 * reads like the embedded ones on the Create screen. A horizontal strip of
 * tiles; the chosen one is outlined.
 */

import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { makeStyles, useTheme } from '../theme/theme';
import { spacing, typography } from '../theme/tokens';
import { PICKABLE_ICONS, WorkflowIcon, type WorkflowIconKey } from './WorkflowIcon';

interface Props {
  value: WorkflowIconKey;
  onChange: (icon: WorkflowIconKey) => void;
}

export function IconPicker({ value, onChange }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('importWf.icon')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        accessibilityRole="radiogroup"
      >
        {PICKABLE_ICONS.map((icon) => {
          const on = icon === value;
          return (
            <Pressable
              key={icon}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={icon}
              onPress={() => {
                Haptics.selectionAsync();
                onChange(icon);
              }}
              style={[styles.tile, on && styles.tileOn]}
            >
              <WorkflowIcon
                name={icon}
                color={colors.accent}
                knockout={colors.accentSoft}
                size={26}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    gap: spacing.sm,
  },
  label: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  strip: {
    gap: spacing.sm,
  },
  tile: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileOn: {
    borderColor: colors.accent,
  },
}));
