import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import '../i18n';
import { queryClient } from '../api/queryClient';
import { useComfyWs } from '../api/ws';
import { ensureNotificationSetup } from '../notifications';
import { ScreenGround } from '../components/DotGrid';
import { HeaderBackButton } from '../components/HeaderBackButton';
import { HeaderTitle } from '../components/HeaderTitle';
import { SetupWizard } from '../components/SetupWizard';
import { ServerChip } from '../components/ServerChip';
import { Toast } from '../components/Toast';
import { VolumeBanner } from '../components/VolumeBanner';
import { useHealthCheck } from '../hooks/useHealthCheck';
import { useSettings } from '../store/settings';
import { applyPairing, parsePairingCode } from '../utils/pairing';
import { typography } from '../theme/tokens';
import { ThemeProvider, useTheme } from '../theme/theme';

SplashScreen.preventAutoHideAsync();

/** Mounted below the providers: global connections (WS + health probe). */
function AppShell() {
  const { colors } = useTheme();
  useComfyWs();
  useHealthCheck();
  const { t } = useTranslation();
  const hydrated = useSettings((s) => s.hydrated);
  const serverUrl = useSettings((s) => s.serverUrl);

  useEffect(() => {
    ensureNotificationSetup();
  }, []);

  // Pairing via an OS-opened komfy://setup?u=…&s=…&t=… deep link (standalone
  // builds; in Expo Go the in-app scanner is used instead). No-op for any other
  // URL. Prefills serverUrl + supervisor URL/token in one shot.
  const deepLink = Linking.useURL();
  useEffect(() => {
    if (!deepLink) return;
    const result = parsePairingCode(deepLink);
    if (result) applyPairing(result);
  }, [deepLink]);

  // Wait for AsyncStorage to rehydrate before deciding: otherwise a saved URL
  // would flash the wizard for one frame on cold start.
  if (!hydrated) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  // Mandatory server address (no fallback): gate the whole app on first launch
  // — and again if the URL is ever cleared — behind the setup wizard.
  if (!serverUrl) {
    return (
      <ScreenGround>
        <SetupWizard />
      </ScreenGround>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <VolumeBanner />
      <View style={{ flex: 1 }}>
        <Stack
          // Each screen, the tabs included, gets its own opaque dotted ground
          // (screens keep a transparent root).
          screenLayout={({ children }) => <ScreenGround>{children}</ScreenGround>}
          screenOptions={{
            // The header blends into the ground: same colour, no hairline.
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerTintColor: colors.text,
            headerTitleStyle: { fontFamily: typography.uiSemiBold },
            contentStyle: { backgroundColor: colors.bg },
            // Explicit back button ("Back" + 44 pt target) everywhere outside
            // the tabs: the native one showed "(tabs)" and missed taps.
            headerLeft: () => <HeaderBackButton />,
            headerTitle: (props) => <HeaderTitle {...props} />,
            // Server state in its own header slot (tap → Activity).
            headerRight: () => <ServerChip compact />,
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
          <Stack.Screen
            name="workflow/import"
            options={{ title: t('nav.importWorkflow') }}
          />
          <Stack.Screen
            name="workflow/edit"
            options={{ title: t('nav.editWorkflow') }}
          />
          <Stack.Screen name="prompts" options={{ title: t('nav.prompts') }} />
          <Stack.Screen name="ws-log" options={{ title: t('nav.wsLog') }} />
          <Stack.Screen
            name="comfy-console"
            options={{ title: t('nav.console') }}
          />
        </Stack>
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
        <ThemeProvider>
          <ThemedStatusBar />
          <AppShell />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

/** Light status bar text on the dark theme, dark text on the light one. */
function ThemedStatusBar() {
  const { name } = useTheme();
  return <StatusBar style={name === 'dark' ? 'light' : 'dark'} />;
}
