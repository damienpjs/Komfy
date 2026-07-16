/** Global toast display, above the tab bar. */

import { StyleSheet, Text, View } from 'react-native';
import { useToast } from '../store/toast';
import { colors, radii, spacing, typography } from '../theme/tokens';

export function Toast() {
  const message = useToast((s) => s.message);
  const kind = useToast((s) => s.kind);

  if (!message) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View
        style={[
          styles.toast,
          { borderColor: kind === 'success' ? colors.success : colors.danger },
        ]}
      >
        <Text
          style={[
            styles.text,
            { color: kind === 'success' ? colors.success : colors.danger },
          ]}
        >
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96, // above the tab bar
    alignItems: 'center',
    zIndex: 10,
  },
  toast: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderRadius: radii.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    maxWidth: '85%',
  },
  text: {
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
});
