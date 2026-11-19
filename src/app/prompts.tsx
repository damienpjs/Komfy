/**
 * Saved-prompts picker, pushed from a launch form's prompt field
 * (`?pick=<fieldKey>`), from the result screen or from the offline panel.
 *
 * The list itself is PromptLibrary — shared with the Library tab. Only what
 * a tap does lives here:
 *  - with `pick`: hand the text back through promptPick and pop back to the
 *    still-mounted form, which merges it into that field (no remount, other
 *    fields untouched);
 *  - without: "Use in…" lists the workflows with a prompt field, the chosen
 *    one opens prefilled.
 */

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { PromptLibrary } from '../components/PromptLibrary';
import { usePromptIn } from '../components/UseInSheet';
import { usePromptPick } from '../store/promptPick';

import { makeStyles } from '../theme/theme';

export default function PromptsScreen() {
  const styles = useStyles();
  const { pick } = useLocalSearchParams<{ pick?: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const promptIn = usePromptIn({ replace: true });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: t('nav.prompts') }} />
      <PromptLibrary
        onUse={(entry) => {
          if (!entry.text) return;
          if (pick) {
            usePromptPick.getState().set(entry.text, pick);
            router.back();
            return;
          }
          promptIn.open(entry.text);
        }}
      />
      {promptIn.sheet}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
  },
}));
