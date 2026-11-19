/**
 * Global toast, above the tab bar, the mini player and the launch bar: a
 * dark slab (same in both themes) with a state icon, the message and, when
 * given, one action in yellow.
 */

import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useToast } from '../store/toast';
import { makeStyles } from '../theme/theme';
import { radii, signature, spacing, typography } from '../theme/tokens';

export function Toast() {
  const styles = useStyles();
  const message = useToast((s) => s.message);
  const kind = useToast((s) => s.kind);
  const action = useToast((s) => s.action);

  if (!message) return null;
  const iconColor = kind === 'success' ? signature.success : signature.danger;

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <View
        style={styles.toast}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Path
            d={kind === 'success' ? 'M5 12.5l4.5 4.5L19 7' : 'M7 7l10 10M17 7L7 17'}
            stroke={iconColor}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </Svg>
        <Text style={styles.text}>{message}</Text>
        {action && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              useToast.getState().hide();
              action.onPress();
            }}
            style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.actionText}>{action.label}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: {
    position: 'absolute',
    left: spacing.md - 4,
    right: spacing.md - 4,
    bottom: 160, // above the tab bar + mini player, and the launch bar
    alignItems: 'center',
    zIndex: 10,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    minHeight: 52,
    maxWidth: '100%',
    paddingLeft: spacing.md - 2,
    paddingRight: spacing.xs + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radii.md + 2,
    backgroundColor: signature.bg,
    borderWidth: 1,
    borderColor: signature.border,
  },
  text: {
    flexShrink: 1,
    color: signature.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  action: {
    minHeight: 40,
    minWidth: 44,
    paddingHorizontal: spacing.md - 4,
    justifyContent: 'center',
    borderRadius: radii.sm + 2,
  },
  actionText: {
    color: signature.accent,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.sm,
  },
}));
