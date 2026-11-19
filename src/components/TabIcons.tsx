/**
 * Tab bar icons (24 pt grid, 1.8 stroke), drawn to match the workflow icon
 * set rather than borrowed from a font: Create, Activity, Library, Settings.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';

interface IconProps {
  color: string;
  size?: number;
}

const stroke = (color: string) => ({
  stroke: color,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

export function CreateIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={4} y={4} width={16} height={16} rx={5} {...stroke(color)} />
      <Path d="M12 8.5v7M8.5 12h7" {...stroke(color)} />
    </Svg>
  );
}

export function ActivityIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3 12h4l2.5-6 5 12 2.5-6H21" {...stroke(color)} />
    </Svg>
  );
}

export function LibraryIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={8} width={14} height={12} rx={2} {...stroke(color)} />
      <Path d="M7 5h11a3 3 0 0 1 3 3v9" {...stroke(color)} />
    </Svg>
  );
}

export function SettingsIcon({ color, size = 24 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 7h9M17 7h3M4 17h3M11 17h9" {...stroke(color)} />
      <Circle cx={15} cy={7} r={2} {...stroke(color)} />
      <Circle cx={9} cy={17} r={2} {...stroke(color)} />
    </Svg>
  );
}

export const TAB_ICONS: Record<string, (props: IconProps) => React.JSX.Element> = {
  index: CreateIcon,
  activity: ActivityIcon,
  library: LibraryIcon,
  settings: SettingsIcon,
};
