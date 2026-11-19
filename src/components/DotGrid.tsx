/**
 * The banner's dot grid: a regular lattice of small dots drawn with one SVG
 * pattern, so the cost does not grow with the area. Sits behind content
 * (absolute fill, never catches touches).
 */

import { useId, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Pattern, Rect } from 'react-native-svg';
import { useTheme } from '../theme/theme';
import { dotGrid } from '../theme/tokens';

/**
 * Opaque themed ground with the dot grid, behind a whole screen. Mounted by
 * the navigators (screenLayout), so screens keep a transparent root.
 */
export function ScreenGround({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <DotGrid color={colors.dot} />
      {children}
    </View>
  );
}

interface Props {
  color: string;
  spacing?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function DotGrid({
  color,
  spacing = dotGrid.spacing,
  radius = dotGrid.radius,
  style,
}: Props) {
  // useId returns ":r1:"-style ids; colons do not survive url(#…) on every
  // platform, so keep alphanumerics only.
  const patternId = `dots${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern
            id={patternId}
            width={spacing}
            height={spacing}
            patternUnits="userSpaceOnUse"
          >
            <Circle cx={spacing / 2} cy={spacing / 2} r={radius} fill={color} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </Svg>
    </View>
  );
}
