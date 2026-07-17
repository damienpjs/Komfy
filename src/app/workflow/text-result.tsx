/**
 * Result screen for a text workflow (e.g. Image → Prompt): polls
 * /history/{promptId} until the `nodeId` node's text shows up (ShowText's
 * ui.text), then displays it with "Use as prompt" (prefills the t2i) and
 * "Copy" actions. Execution failures surface through the history entry's
 * status.status_str (the WS is not required).
 */

import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createClient } from '../../api/client';
import { useGeneratedPrompts } from '../../store/generatedPrompts';
import { useSettings } from '../../store/settings';
import { useToast } from '../../store/toast';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../../theme/tokens';

const POLL_MS = 2000;

export default function TextResultScreen() {
  const { promptId, nodeId, workflowId } = useLocalSearchParams<{
    promptId: string;
    nodeId: string;
    workflowId: string;
  }>();
  const router = useRouter();
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const showToast = useToast((s) => s.show);

  const { data: entry, error: queryError } = useQuery({
    queryKey: ['textResult', promptId],
    queryFn: () => createClient(serverUrl).getHistoryItem(promptId!),
    select: (res) => res[promptId!] ?? null,
    enabled: !!promptId && !!serverUrl,
    // Poll until the job shows up as completed in the history.
    refetchInterval: (query) =>
      query.state.data?.[promptId!]?.status?.completed != null
        ? false
        : POLL_MS,
  });

  const text = nodeId
    ? entry?.outputs?.[nodeId]?.text?.join('\n').trim()
    : undefined;
  const failed =
    entry != null && entry.status?.status_str === 'error' && !text;

  // The text only lives in the server's /history (wiped on restart) and this
  // screen is `replace`-navigated to, so leaving it used to lose the prompt
  // for good: bank it as soon as it lands. `record` dedupes on promptId, so
  // the poll's re-renders record one entry per job.
  useEffect(() => {
    if (!text || !promptId || !workflowId) return;
    useGeneratedPrompts.getState().record({ text, workflowId, promptId });
  }, [text, promptId, workflowId]);

  const usePrompt = () => {
    if (!text) return;
    router.replace(
      `/workflow/krea2-text2img?prefill=${encodeURIComponent(
        JSON.stringify({ prompt: text }),
      )}` as Href,
    );
  };

  const copy = async () => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    showToast(t('textResult.copied'));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('nav.textResult') }} />

      {!entry && !queryError && (
        <View style={styles.pending}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.pendingText}>{t('textResult.analyzing')}</Text>
          <Text style={styles.pendingHint}>{t('textResult.pendingHint')}</Text>
        </View>
      )}

      {!!queryError && (
        <Text style={styles.errorText}>
          {t('textResult.serverError', {
            message: String(
              queryError instanceof Error ? queryError.message : queryError,
            ),
          })}
        </Text>
      )}

      {failed && <Text style={styles.errorText}>{t('textResult.failed')}</Text>}

      {!!text && (
        <>
          <View style={styles.resultBox}>
            <Text style={styles.resultText} selectable>
              {text}
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { backgroundColor: colors.accentPressed },
            ]}
            onPress={usePrompt}
          >
            <Ionicons name="color-wand-outline" size={18} color={colors.text} />
            <Text style={styles.primaryText}>{t('textResult.usePrompt')}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            onPress={copy}
          >
            <Ionicons name="copy-outline" size={18} color={colors.accent} />
            <Text style={styles.secondaryText}>{t('common.copy')}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  pending: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  pendingText: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.md,
  },
  pendingHint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
  },
  resultBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  resultText: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    lineHeight: 20,
  },
  errorText: {
    color: colors.danger,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  primaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET + 4,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.md,
  },
  secondaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
});
