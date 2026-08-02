import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueue } from '../../hooks/useQueue';
import { useConnection } from '../../store/connection';
import { colors, typography } from '../../theme/tokens';

export default function TabsLayout() {
  const { t } = useTranslation();
  // "N pending" badge: queue if available, else the WS status message counter.
  const { query } = useQueue();
  const queueRemaining = useConnection((s) => s.queueRemaining);
  const pendingCount = query.data?.queue_pending.length ?? queueRemaining ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgElevated },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: typography.uiSemiBold },
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: {
          backgroundColor: colors.bgElevated,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: typography.uiMedium },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.queue'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="layers-outline" size={size} color={color} />
          ),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.accent,
            fontFamily: typography.uiSemiBold,
          },
        }}
      />
      <Tabs.Screen
        name="workflows"
        options={{
          title: t('tabs.workflows'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="color-wand-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: t('tabs.library'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="albums-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
