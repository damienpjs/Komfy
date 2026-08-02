/**
 * Browsable list of the prompts produced by the text workflows: search,
 * reuse, pin, delete. Fed by the generatedPrompts store (recorded
 * automatically by the result screen), so it outlives that screen and app
 * restarts — and, being phone-local, works with the server off.
 *
 * What a tap *means* is the caller's business (`onUse`): the Library tab
 * opens text2img prefilled, the picker hands the text back to the form it
 * was opened from. Long press (or ⋯) = pin / copy / delete, the PresetBar
 * idiom.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { usePendingPromptCatchUp } from '../hooks/usePendingPrompts';
import {
  isPending,
  isResolved,
  useGeneratedPrompts,
  type GeneratedPromptEntry,
  type ResolvedPrompt,
} from '../store/generatedPrompts';
import { useToast } from '../store/toast';
import { showActionSheet } from '../utils/actionSheet';
import { formatAgo } from '../utils/format';
import { getAnyWorkflow } from '../workflows/registry';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

/** Lines of prompt shown per row before ellipsis. */
const PREVIEW_LINES = 3;

/** Entries below which the search box is not worth its space. */
const SEARCH_FROM = 5;

interface Props {
  /**
   * Tapping a row. Reuse differs per caller — see the module header. Only
   * ever called with a resolved entry: pending rows are not tappable, so
   * callers get a real text, never null.
   */
  onUse: (entry: ResolvedPrompt) => void;
}

export function PromptLibrary({ onUse }: Props) {
  const { t } = useTranslation();
  const showToast = useToast((s) => s.show);
  const entries = useGeneratedPrompts((s) => s.entries);
  const togglePin = useGeneratedPrompts((s) => s.togglePin);
  const remove = useGeneratedPrompts((s) => s.remove);
  const [search, setSearch] = useState('');

  // Jobs that finished while the app was closed have text waiting in
  // /history — fill them in now that the list is being looked at.
  usePendingPromptCatchUp();

  // Pinned first, each group by recency — same ordering as the PresetBar.
  const ordered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    // A pending entry has no text to match on — searching hides it.
    const list = needle
      ? entries.filter((e) => e.text?.toLowerCase().includes(needle))
      : entries;
    const pinned = list.filter((e) => e.pinned).sort((a, b) => b.at - a.at);
    const recents = list.filter((e) => !e.pinned).sort((a, b) => b.at - a.at);
    return [...pinned, ...recents];
  }, [entries, search]);

  const copy = async (entry: GeneratedPromptEntry) => {
    if (entry.text == null) return;
    await Clipboard.setStringAsync(entry.text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(t('prompt.copied'));
  };

  const openMenu = (entry: GeneratedPromptEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const waiting = isPending(entry);
    showActionSheet(waiting ? t('prompts.pending') : entry.text!.slice(0, 80), [
      // Nothing to pin or copy while the text is still on its way — but
      // forgetting the job must stay possible (e.g. it will never finish).
      ...(waiting
        ? []
        : [
            {
              label: entry.pinned ? t('common.unpin') : t('common.pin'),
              onPress: () => togglePin(entry.id),
            },
            { label: t('common.copy'), onPress: () => copy(entry) },
          ]),
      {
        label: t('common.delete'),
        destructive: true,
        onPress: () => remove(entry.id),
      },
    ]);
  };

  const sourceLabel = (entry: GeneratedPromptEntry) => {
    const wf = getAnyWorkflow(entry.workflowId);
    // Workflow since deleted/unimported: the raw id still says where it came
    // from, and the prompt itself stays usable.
    return wf ? t(wf.name) : entry.workflowId;
  };

  return (
    <FlatList
      data={ordered}
      keyExtractor={(e) => e.id}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        entries.length > SEARCH_FROM ? (
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={colors.textDisabled} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={t('prompts.search')}
              placeholderTextColor={colors.textDisabled}
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          </View>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons
            name={search ? 'search' : 'bookmark-outline'}
            size={28}
            color={colors.textDisabled}
          />
          <Text style={styles.emptyText}>
            {search ? t('prompts.noMatch') : t('prompts.empty')}
          </Text>
          {!search && (
            <Text style={styles.emptyHint}>{t('prompts.emptyHint')}</Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isPending(item) ? t('prompts.pending') : t('prompts.use')
          }
          style={({ pressed }) => [
            styles.row,
            item.pinned && styles.rowPinned,
            pressed && !isPending(item) && {
              backgroundColor: colors.surfacePressed,
            },
          ]}
          onPress={() => {
            if (!isResolved(item)) return; // no text to hand over yet
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onUse(item);
          }}
          onLongPress={() => openMenu(item)}
        >
          {isPending(item) ? (
            <View style={styles.pendingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.pendingText}>{t('prompts.pending')}</Text>
            </View>
          ) : (
            <Text style={styles.rowText} numberOfLines={PREVIEW_LINES}>
              {item.text}
            </Text>
          )}

          <View style={styles.metaRow}>
            {item.pinned && (
              <Ionicons name="star" size={11} color={colors.accent} />
            )}
            <Text style={styles.meta} numberOfLines={1}>
              {sourceLabel(item)} · {formatAgo(item.at, t)}
            </Text>

            <Pressable
              onPress={() => openMenu(item)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('prompts.more')}
              style={({ pressed }) => [
                styles.moreBtn,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={16}
                color={colors.textMuted}
              />
            </Pressable>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    gap: spacing.sm,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  row: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  rowPinned: {
    borderColor: colors.accent,
  },
  rowText: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
    lineHeight: 19,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pendingText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  meta: {
    flex: 1,
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  moreBtn: {
    borderRadius: radii.sm,
    padding: spacing.xs,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.md,
    textAlign: 'center',
  },
  emptyHint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
    maxWidth: 260,
  },
});
