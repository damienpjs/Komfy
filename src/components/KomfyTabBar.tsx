/**
 * Tab bar: the mini player docked on top (every tab but Activity), then the
 * four tabs. The active tab sits in a pill: yellow on charcoal, charcoal with
 * a yellow icon on paper (a small piece of the banner). Badge = the tab
 * option `tabBarBadge` (Activity: pending jobs).
 */

import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, useTheme } from '../theme/theme';
import { spacing, typography } from '../theme/tokens';
import { MiniPlayer } from './MiniPlayer';
import { TAB_ICONS } from './TabIcons';

export function KomfyTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const activeName = state.routes[state.index]?.name;

  return (
    <View>
      {activeName !== 'activity' && <MiniPlayer />}
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const Icon = TAB_ICONS[route.name];
          const label = options.title ?? route.name;
          const badge = options.tabBarBadge;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              Haptics.selectionAsync();
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={
                badge != null ? `${label}, ${badge}` : label
              }
              onPress={onPress}
              style={styles.tab}
            >
              <View style={[styles.pill, focused && styles.pillOn]}>
                {Icon && (
                  <Icon color={focused ? colors.onTabPill : colors.textMuted} />
                )}
              </View>
              {badge != null && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              )}
              <Text style={[styles.label, focused && styles.labelOn]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  bar: {
    flexDirection: 'row',
    paddingTop: spacing.xs + 2,
    paddingHorizontal: spacing.xs + 2,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    gap: 3,
  },
  pill: {
    width: 58,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillOn: {
    backgroundColor: colors.tabPill,
  },
  label: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: 11,
  },
  labelOn: {
    color: colors.text,
    fontFamily: typography.uiBold,
  },
  badge: {
    position: 'absolute',
    top: -2,
    left: '50%',
    marginLeft: 12,
    minWidth: 23,
    height: 23,
    paddingHorizontal: 5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    // Ring in the bar colour: keeps the badge apart from the active pill,
    // which is the same yellow on the dark theme.
    borderWidth: 2,
    borderColor: colors.bgElevated,
  },
  badgeText: {
    color: colors.onAccent,
    fontFamily: typography.uiBold,
    fontSize: 11,
  },
}));
