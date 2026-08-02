/**
 * Saved-prompts picker, pushed from a launch form's prompt field
 * (`?pick=<fieldKey>`) or from the result screen.
 *
 * The list itself is PromptLibrary — shared with the Library tab. Only what
 * a tap does lives here:
 *  - with `pick`: hand the text back through promptPick and pop back to the
 *    still-mounted form, which merges it into that field (no remount, other
 *    fields untouched);
 *  - without: open text2img prefilled, like the result screen's own
 *    "Use as prompt".
 */

import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { PromptLibrary } from '../components/PromptLibrary';
import { usePromptPick } from '../store/promptPick';
import { colors } from '../theme/tokens';

export default function PromptsScreen() {
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: t('nav.prompts') }} />
      <PromptLibrary
        onUse={(entry) => {
          if (pick) {
            usePromptPick.getState().set(entry.text, pick);
            router.back();
            return;
          }
          router.replace(
            `/workflow/krea2-text2img?prefill=${encodeURIComponent(
              JSON.stringify({ prompt: entry.text }),
            )}` as Href,
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
