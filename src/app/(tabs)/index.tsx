/**
 * Queue screen (home): running job card, pending job list (swipe-to-delete),
 * interrupt / clear queue, empty and error states.
 */

import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { CurrentJobCard } from '../../components/CurrentJobCard';
import { JobDetailSheet } from '../../components/JobDetailSheet';
import { PendingJobRow } from '../../components/PendingJobRow';
import { useState } from 'react';
import type { QueueEntry } from '../../api/types';
import { useQueue } from '../../hooks/useQueue';
import { useConnection } from '../../store/connection';
import { useExecution } from '../../store/execution';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../../theme/tokens';

export default function QueueScreen() {
  const { t } = useTranslation();
  const { query, interrupt, clearQueue, deleteItem } = useQueue();
  const online = useConnection((s) => s.online);
  const lastError = useExecution((s) => s.lastError);
  const clearError = useExecution((s) => s.clearError);

  const [selectedJob, setSelectedJob] = useState<QueueEntry | null>(null);
  const running = query.data?.queue_running ?? [];
  const pending = [...(query.data?.queue_pending ?? [])].sort(
    (a, b) => a[0] - b[0],
  );

  const confirmClear = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    Alert.alert(t('queue.clearTitle'), t('queue.clearBody', { count: pending.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('queue.clear'),
        style: 'destructive',
        onPress: () => clearQueue.mutate(),
      },
    ]);
  };

  // Server unreachable: full-page error state.
  if (online === false || (query.isError && !query.data)) {
    return (
      <View style={styles.centerBox}>
        <Text style={styles.errorTitle}>{t('queue.offlineTitle')}</Text>
        <Text style={styles.errorDetail}>{t('queue.offlineBody')}</Text>
        <Pressable
          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.7 }]}
          onPress={() => query.refetch()}
        >
          <Text style={styles.retryText}>{t('common.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {lastError && (
        <Pressable style={styles.errorBanner} onPress={clearError}>
          <Text style={styles.errorBannerTitle}>
            {t('queue.errorTitle', { node: lastError.nodeType })}
          </Text>
          <Text style={styles.errorBannerDetail} numberOfLines={2}>
            {lastError.message}
          </Text>
          <Text style={styles.errorBannerHint}>{t('queue.tapToDismiss')}</Text>
        </Pressable>
      )}

      <FlatList
        data={pending}
        keyExtractor={(e) => e[1]}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {running.length > 0 ? (
              <CurrentJobCard
                entry={running[0]}
                onInterrupt={() => interrupt.mutate()}
                interrupting={interrupt.isPending}
                onPress={setSelectedJob}
              />
            ) : (
              <View style={styles.idleCard}>
                <Text style={styles.idleText}>{t('queue.noRunning')}</Text>
              </View>
            )}

            <View style={styles.pendingHeader}>
              <Text style={styles.sectionTitle}>
                {t('queue.pendingSection')}
                {pending.length > 0 ? ` (${pending.length})` : ''}
              </Text>
              {pending.length > 0 && (
                <Pressable
                  onPress={confirmClear}
                  disabled={clearQueue.isPending}
                  style={({ pressed }) => pressed && { opacity: 0.7 }}
                >
                  <Text style={styles.clearText}>{t('queue.clearQueue')}</Text>
                </Pressable>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {query.isLoading ? t('common.loading') : t('queue.empty')}
          </Text>
        }
        renderItem={({ item, index }) => (
          <PendingJobRow
            entry={item}
            position={index + 1}
            onPress={setSelectedJob}
            onDelete={(id) => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              deleteItem.mutate(id);
            }}
          />
        )}
      />

      {selectedJob && (
        <JobDetailSheet
          entry={selectedJob}
          onClose={() => setSelectedJob(null)}
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
  listContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  headerBlock: {
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  idleCard: {
    backgroundColor: colors.bgElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  idleText: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  pendingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 24,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  clearText: {
    color: colors.danger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  emptyText: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  centerBox: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  errorTitle: {
    color: colors.danger,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.lg,
  },
  errorDetail: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  errorBanner: {
    backgroundColor: '#3a1a22', // darkened danger background on the violet base, derived from colors.danger
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  errorBannerTitle: {
    color: colors.danger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  errorBannerDetail: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  errorBannerHint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
});
