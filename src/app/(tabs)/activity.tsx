/**
 * Activity tab: the running job on the banner surface, the last failure with
 * what to do about it, then the pending jobs (visible remove button, swipe
 * kept). Offline, the offline diagnostic replaces the feed: what answers,
 * what does not, and the likely cause.
 */

import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import type { QueueEntry } from '../../api/types';
import { CurrentJobCard } from '../../components/CurrentJobCard';
import { FailureCard } from '../../components/FailureCard';
import { JobDetailSheet } from '../../components/JobDetailSheet';
import { LivePreviewViewer } from '../../components/LivePreviewViewer';
import { OfflinePanel } from '../../components/OfflinePanel';
import { PendingJobRow } from '../../components/PendingJobRow';
import { jobInfo, useQueue } from '../../hooks/useQueue';
import { useConnection } from '../../store/connection';
import { useExecution } from '../../store/execution';
import { makeStyles } from '../../theme/theme';
import { radii, spacing, typography } from '../../theme/tokens';

export default function ActivityScreen() {
  const styles = useStyles();
  const { t } = useTranslation();
  const { query, interrupt, clearQueue, deleteItem } = useQueue();
  const online = useConnection((s) => s.online);
  const lastError = useExecution((s) => s.lastError);
  const clearError = useExecution((s) => s.clearError);

  const [selectedJob, setSelectedJob] = useState<QueueEntry | null>(null);
  const [livePreviewOpen, setLivePreviewOpen] = useState(false);
  const running = query.data?.queue_running ?? [];
  const pending = [...(query.data?.queue_pending ?? [])].sort((a, b) => a[0] - b[0]);
  const current = running[0];
  const currentInfo = current ? jobInfo(current[1], current[2]) : undefined;

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

  // Server unreachable: diagnostic instead of the feed.
  if (online === false || (query.isError && !query.data)) {
    return (
      <ScrollView contentContainerStyle={styles.listContent}>
        <OfflinePanel />
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={pending}
        keyExtractor={(e) => e[1]}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            {current ? (
              <CurrentJobCard
                entry={current}
                pendingCount={pending.length}
                onInterrupt={() => interrupt.mutate()}
                interrupting={interrupt.isPending}
                onPress={setSelectedJob}
                onPressPreview={() => setLivePreviewOpen(true)}
              />
            ) : (
              <View style={styles.idleCard}>
                <Text style={styles.idleText}>{t('queue.noRunning')}</Text>
              </View>
            )}

            {lastError && (
              <FailureCard
                error={lastError}
                pendingCount={pending.length}
                onDismiss={clearError}
              />
            )}

            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>
                {t('queue.pendingSection')}
                {pending.length > 0 ? ` · ${pending.length}` : ''}
              </Text>
              {pending.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  onPress={confirmClear}
                  disabled={clearQueue.isPending}
                  hitSlop={10}
                  style={({ pressed }) => pressed && { opacity: 0.6 }}
                >
                  <Text style={styles.clearText}>{t('queue.clearAll')}</Text>
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
            first={index === 0}
            last={index === pending.length - 1}
            onPress={setSelectedJob}
            onDelete={(id) => deleteItem.mutate(id)}
          />
        )}
      />

      {selectedJob && (
        <JobDetailSheet entry={selectedJob} onClose={() => setSelectedJob(null)} />
      )}

      {/* Mounted at screen level (not in the card): survives the job's end,
          so the viewer can show its "finished" state on the last frame. */}
      {livePreviewOpen && (
        <LivePreviewViewer
          title={currentInfo?.title}
          manifestId={currentInfo?.manifestId}
          pendingCount={pending.length}
          canInterrupt={!!current}
          interrupting={interrupt.isPending}
          onInterrupt={() => interrupt.mutate()}
          onClose={() => setLivePreviewOpen(false)}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
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
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  idleText: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    minHeight: 24,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  clearText: {
    color: colors.danger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  emptyText: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
}));
