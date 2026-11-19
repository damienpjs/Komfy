/**
 * Tabs: Create (home), Activity, Library, Settings. The dotted ground comes
 * from the root stack (screens stay transparent), the header is the large
 * tab title with the server chip, and the tab bar carries the mini player.
 */

import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { KomfyTabBar } from '../../components/KomfyTabBar';
import { TabHeader } from '../../components/TabHeader';
import { useQueue } from '../../hooks/useQueue';
import { useConnection } from '../../store/connection';

export default function TabsLayout() {
  const { t } = useTranslation();
  // "N pending" badge: queue if available, else the WS status message counter.
  const { query } = useQueue();
  const queueRemaining = useConnection((s) => s.queueRemaining);
  const pendingCount = query.data?.queue_pending.length ?? queueRemaining ?? 0;

  return (
    <Tabs
      tabBar={(props) => <KomfyTabBar {...props} />}
      screenOptions={{
        header: ({ options }) => <TabHeader title={options.title ?? ''} />,
        sceneStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.create') }} />
      <Tabs.Screen
        name="activity"
        options={{
          title: t('tabs.activity'),
          tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
        }}
      />
      <Tabs.Screen name="library" options={{ title: t('tabs.library') }} />
      <Tabs.Screen name="settings" options={{ title: t('tabs.settings') }} />
    </Tabs>
  );
}
