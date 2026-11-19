/**
 * Field help text that does not drown the form: two lines, then "More" to
 * unfold the rest. Short hints render whole, without the toggle.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text } from 'react-native';
import { makeStyles } from '../theme/theme';
import { typography } from '../theme/tokens';

/** Below this length a hint fits in two lines on a phone: no toggle. */
const SHORT_HINT = 110;

export function FieldHint({ text }: { text: string }) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const long = text.length > SHORT_HINT;

  if (!long) return <Text style={styles.hint}>{text}</Text>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityHint={open ? t('launch.hintLess') : t('launch.hintMore')}
      onPress={() => setOpen((o) => !o)}
      hitSlop={{ top: 4, bottom: 4 }}
    >
      <Text style={styles.hint} numberOfLines={open ? undefined : 2}>
        {text}
      </Text>
      <Text style={styles.toggle}>
        {open ? t('launch.hintLess') : t('launch.hintMore')}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  toggle: {
    marginTop: 2,
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: 13,
  },
}));
