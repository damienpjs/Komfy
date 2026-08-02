/**
 * Library tab: everything that is "mine" — the images the server produced
 * (Images) and the prompts the text workflows generated (Prompts).
 *
 * The two halves only look alike. Images are server files fetched over
 * Tailscale; prompts are phone-local (AsyncStorage), readable with the server
 * off. That is why this shell holds the segment and each half keeps its own
 * data source and its own empty/error states, instead of the prompts being
 * faked as a third root inside the gallery's file tree: GalleryBrowser
 * bails out early when the server is unreachable, and everything below such
 * a bail-out disappears with it.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GalleryBrowser } from '../../components/GalleryBrowser';
import { PromptLibrary } from '../../components/PromptLibrary';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../../theme/tokens';

type Segment = 'images' | 'prompts';

const SEGMENTS: { key: Segment; label: string; icon: 'images' | 'bookmark' }[] =
  [
    { key: 'images', label: 'library.images', icon: 'images' },
    { key: 'prompts', label: 'library.prompts', icon: 'bookmark' },
  ];

export default function LibraryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>('images');

  return (
    <View style={styles.container}>
      <View style={styles.segmentBar}>
        {SEGMENTS.map((s) => {
          const active = segment === s.key;
          return (
            <Pressable
              key={s.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.segment,
                active && styles.segmentActive,
                pressed && !active && { backgroundColor: colors.surfacePressed },
              ]}
              onPress={() => {
                if (active) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSegment(s.key);
              }}
            >
              <Ionicons
                name={active ? s.icon : (`${s.icon}-outline` as const)}
                size={15}
                color={active ? colors.text : colors.textMuted}
              />
              <Text
                style={[styles.segmentLabel, active && styles.segmentLabelActive]}
              >
                {t(s.label)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {segment === 'images' ? (
        <GalleryBrowser />
      ) : (
        <PromptLibrary
          onUse={(entry) =>
            router.push(
              `/workflow/krea2-text2img?prefill=${encodeURIComponent(
                JSON.stringify({ prompt: entry.text }),
              )}` as Href,
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  segmentBar: {
    flexDirection: 'row',
    gap: spacing.xs,
    margin: spacing.md,
    marginBottom: 0,
    padding: 3,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET - 8,
    borderRadius: radii.sm,
  },
  segmentActive: {
    backgroundColor: colors.bgElevated,
  },
  segmentLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  segmentLabelActive: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
  },
});
