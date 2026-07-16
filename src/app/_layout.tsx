import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import '../i18n';
import { queryClient } from '../api/queryClient';
import { useComfyWs } from '../api/ws';
import { ensureNotificationSetup } from '../notifications';
import { HeaderBackButton } from '../components/HeaderBackButton';
import { StatusDot } from '../components/StatusDot';
import { Toast } from '../components/Toast';
import { VolumeBanner } from '../components/VolumeBanner';
import { useHealthCheck } from '../hooks/useHealthCheck';
import { colors, spacing, typography } from '../theme/tokens';

SplashScreen.preventAutoHideAsync();

/** Mounted below the providers: global connections (WS + health probe). */
function AppShell() {
  useComfyWs();
  useHealthCheck();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  useEffect(() => {
    ensureNotificationSetup();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <VolumeBanner />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bgElevated },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: typography.uiSemiBold },
          contentStyle: { backgroundColor: colors.bg },
          // Explicit back button ("Back" + 44 pt target) everywhere outside
          // the tabs: the native one showed "(tabs)" and missed taps.
          headerLeft: () => <HeaderBackButton />,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="workflow/[id]"
          options={{ title: t('nav.workflow') }}
        />
        <Stack.Screen
          name="workflow/text-result"
          options={{ title: t('nav.textResult') }}
        />
        <Stack.Screen name="ws-log" options={{ title: t('nav.wsLog') }} />
      </Stack>
      {/* Single status dot, outside the native headers (identical rendering
          on every view, without the iOS "glass" capsule). */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: insets.top + 12,
          right: spacing.md,
          zIndex: 20,
        }}
      >
        <StatusDot />
      </View>
      <Toast />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <AppShell />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
