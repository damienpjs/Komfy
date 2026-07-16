import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, spacing, typography } from '../theme/tokens';

/**
 * Explicit "Back" button for the screens outside the tabs.
 *
 * Replaces the native button whose label showed the route name "(tabs)"
 * and responded intermittently. Reliable navigation via router.back() with
 * a fallback to the tabs when the stack is empty.
 *
 * The frame hugs the chevron + label as tightly as possible: on iOS 26 the
 * navigation bar's "glass" capsule is drawn around the button frame, so any
 * extra padding/height would show as empty space. The 44 pt touch target is
 * guaranteed by hitSlop (grows the tap area without growing the bubble).
 */
export function HeaderBackButton() {
  const router = useRouter();
  const { t } = useTranslation();

  const onPress = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={{ top: 14, bottom: 14, left: 12, right: 24 }}
      accessibilityRole="button"
      accessibilityLabel={t('nav.back')}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.55 }]}
    >
      <Ionicons name="chevron-back" size={24} color={colors.accent} />
      <Text style={styles.label}>{t('nav.back')}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    // No minHeight/vertical padding: the iOS glass capsule hugs the frame,
    // so keep it as tight as possible (touch target via hitSlop).
    paddingRight: spacing.xs,
  },
  label: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.md,
    marginLeft: -2,
  },
});
