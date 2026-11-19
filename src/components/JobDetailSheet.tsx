/**
 * Detail of a queued job (tap on the running card or a pending row):
 * prompt, seed, steps, LoRAs with strength, model, dimensions…
 * + "Create a variant" when the graph matches an embedded workflow.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import type { QueueEntry } from '../api/types';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { remixHref } from '../utils/remixHref';
import { matchGraph } from '../workflows/match';
import { allWorkflows } from '../workflows/registry';
import { GraphSummary, Row } from './GraphSummary';

interface Props {
  entry: QueueEntry | null;
  onClose: () => void;
}

export function JobDetailSheet({ entry, onClose }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  if (!entry) return null;

  const [number, promptId, graph] = entry;
  const match = matchGraph(graph, allWorkflows());

  const remix = () => {
    if (match.status !== 'match') return;
    onClose();
    router.push(remixHref(match.manifestId, match.values, match.sourceSeeds));
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('jobDetail.title', { number })}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.done}>{t('jobDetail.ok')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Row label="prompt_id" value={promptId} mono />

          <GraphSummary graph={graph} />

          {match.status === 'match' ? (
            <Pressable
              style={({ pressed }) => [
                styles.remixBtn,
                pressed && { backgroundColor: colors.accentPressed },
              ]}
              onPress={remix}
            >
              <Ionicons name="color-wand-outline" size={18} color={colors.onStrong} />
              <Text style={styles.remixText}>{t('gallery.remixAction')}</Text>
            </Pressable>
          ) : (
            <Text style={styles.unknownNote}>
              {t('jobDetail.unknownWorkflow')}
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  done: {
    color: colors.accent,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.md,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  remixBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    backgroundColor: colors.strong,
    marginTop: spacing.sm,
  },
  remixText: {
    color: colors.onStrong,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  unknownNote: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
}));
