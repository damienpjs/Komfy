/**
 * Header of the four tabs: a large title on the dotted ground and the server
 * chip in its own slot on the right. When the volume banner owns the status
 * bar area, the header does not add the top inset a second time.
 */

import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles } from '../theme/theme';
import { spacing, typography } from '../theme/tokens';
import { ServerChip } from './ServerChip';
import { useVolumeBannerVisible } from './VolumeBanner';

/** `action`: the screen's own header button (headerRight), left of the chip. */
export function TabHeader({ title, action }: { title: string; action?: ReactNode }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const bannerVisible = useVolumeBannerVisible();
  return (
    <View style={[styles.wrap, { paddingTop: (bannerVisible ? 0 : insets.top) + spacing.xs }]}>
      <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>
        {action}
        <ServerChip />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: 30,
    letterSpacing: -0.5,
  },
}));
