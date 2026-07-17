/**
 * "Recipe" sheet for an image whose graph matches no embedded workflow
 * (Remix v2): generic parameters extracted from the metadata (GraphSummary —
 * copyable prompts, seed, model…) + requeue of the graph as-is with new
 * seeds. Replaces the old binary Alert.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PromptGraph } from '../api/types';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import { GraphSummary } from './GraphSummary';

export interface RemixSheetState {
  filename: string;
  graph: PromptGraph;
}

interface Props {
  state: RemixSheetState | null;
  onClose: () => void;
  /** Requeues the graph (new seeds); closing stays the parent's job. */
  onRequeue: (graph: PromptGraph) => Promise<void>;
  /** Imports the graph as a custom workflow (closing = parent's job). */
  onImport: (graph: PromptGraph, filename: string) => void;
}

export function RemixSheet({ state, onClose, onRequeue, onImport }: Props) {
  const { t } = useTranslation();
  // Anti double-tap during the POST /prompt.
  const [queuing, setQueuing] = useState(false);
  if (!state) return null;

  const requeue = async () => {
    setQueuing(true);
    try {
      await onRequeue(state.graph);
    } finally {
      setQueuing(false);
    }
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
          <Text style={styles.headerTitle} numberOfLines={1}>
            {state.filename}
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
          <Text style={styles.unknownNote}>{t('remix.unknownNote')}</Text>

          <GraphSummary graph={state.graph} />

          <Pressable
            style={({ pressed }) => [
              styles.requeueBtn,
              queuing && { opacity: 0.5 },
              pressed && { backgroundColor: colors.accentPressed },
            ]}
            disabled={queuing}
            onPress={requeue}
          >
            <Ionicons name="shuffle-outline" size={18} color={colors.text} />
            <Text style={styles.requeueText}>{t('remix.requeue')}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.importBtn,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            onPress={() => onImport(state.graph, state.filename)}
          >
            <Ionicons name="download-outline" size={18} color={colors.accent} />
            <Text style={styles.importText}>{t('remix.import')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    flex: 1,
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
  unknownNote: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: 18,
  },
  requeueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },
  requeueText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  importText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
