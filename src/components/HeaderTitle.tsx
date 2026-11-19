import { Text } from 'react-native';
import { typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';

/**
 * Stack header title. The server chip now lives in headerRight, so the
 * native bar lays the title out between the back button and the chip by
 * itself; a long workflow name shrinks to 80 % before being truncated.
 */
export function HeaderTitle({
  children,
  tintColor,
}: {
  children: string;
  tintColor?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
      style={[styles.title, { color: tintColor ?? colors.text }]}
    >
      {children}
    </Text>
  );
}

const useStyles = makeStyles(() => ({
  title: {
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.headerTitle,
  },
}));
