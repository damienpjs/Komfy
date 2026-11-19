/**
 * Generic rendering of an API graph's "recipe" (best-effort extraction via
 * describeJob): model, copyable prompts, seed, sampling, dimensions, LoRAs,
 * node count. Shared between the queue job detail (JobDetailSheet) and the
 * unknown-workflow image sheet (RemixSheet).
 */

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { PromptGraph } from '../api/types';
import { useToast } from '../store/toast';
import { radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { describeJob } from '../utils/describeJob';
import { loraDirName, loraDisplayName } from '../utils/pathTree';

export interface RowAction {
  label: string;
  a11y?: string;
  onPress: () => void;
  busy?: boolean;
}

export function Row({
  label,
  value,
  mono,
  action,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  /** Text button at the end of the row (e.g. reuse the seed). */
  action?: RowAction;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (value == null || value === '') return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} selectable>
        {value}
      </Text>
      {action && (
        <Pressable
          onPress={action.onPress}
          disabled={action.busy}
          accessibilityRole="button"
          accessibilityLabel={action.a11y ?? action.label}
          hitSlop={8}
          style={({ pressed }) => [styles.rowAction, pressed && { opacity: 0.6 }]}
        >
          {action.busy ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={styles.copyText}>{action.label}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

/** Header of a prompt block: label + dedicated copy button. */
function PromptBlock({
  label,
  value,
  muted,
  onCopy,
}: {
  label: string;
  value: string;
  muted?: boolean;
  onCopy: (text: string, label: string) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.block}>
      <View style={styles.blockHeader}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Pressable
          onPress={() => onCopy(value, label)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('graph.copyA11y', { label: label.toLowerCase() })}
          style={({ pressed }) => [styles.copyBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="copy-outline" size={14} color={colors.accent} />
          <Text style={styles.copyText}>{t('common.copy')}</Text>
        </Pressable>
      </View>
      <Text style={[styles.promptText, muted && { color: colors.textMuted }]} selectable>
        {value}
      </Text>
    </View>
  );
}

/** Parameter rows extracted from the graph (no container: place inside a
 *  parent that handles spacing, e.g. a ScrollView `gap`). */
export function GraphSummary({
  graph,
  seedAction,
}: {
  graph: PromptGraph;
  /** Offered on the seed row (the gallery: open a variant with this seed). */
  seedAction?: RowAction;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const showToast = useToast((s) => s.show);
  const job = describeJob(graph);

  const copy = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(t('graph.copied', { label }));
  };

  return (
    <>
      <Row label={t('graph.model')} value={job.model} mono />

      {job.positive != null && (
        <PromptBlock label={t('graph.prompt')} value={job.positive} onCopy={copy} />
      )}
      {job.negative != null && job.negative !== '' && (
        <PromptBlock
          label={t('graph.negative')}
          value={job.negative}
          muted
          onCopy={copy}
        />
      )}

      <Row
        label={t('graph.seed')}
        value={job.seed != null ? String(job.seed) : undefined}
        mono
        action={seedAction}
      />
      <Row
        label={t('graph.sampling')}
        value={
          job.steps != null
            ? `${job.steps} steps · CFG ${job.cfg ?? '?'} · ${job.sampler ?? '?'}/${job.scheduler ?? '?'}`
            : undefined
        }
      />
      <Row
        label={t('graph.dimensions')}
        value={job.width != null ? `${job.width} × ${job.height}` : undefined}
        mono
      />

      {job.loras.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.rowLabel}>
            {t('graph.loras', { count: job.loras.length })}
          </Text>
          {job.loras.map((lora, i) => (
            <View key={`${lora.name}-${i}`} style={styles.loraRow}>
              <Text style={styles.loraName} numberOfLines={1}>
                {loraDisplayName(lora.name)}
                {loraDirName(lora.name) !== '' && (
                  <Text style={styles.loraDir}>  {loraDirName(lora.name)}/</Text>
                )}
              </Text>
              <Text style={styles.loraStrength}>×{lora.strength.toFixed(2)}</Text>
            </View>
          ))}
        </View>
      )}

      <Row label={t('graph.nodes')} value={String(job.nodeCount)} mono />
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    gap: spacing.xs,
  },
  rowAction: {
    position: 'absolute',
    top: -10,
    right: 0,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  block: {
    gap: spacing.xs,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  copyText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
  },
  rowLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  rowValue: {
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  mono: {
    fontFamily: typography.mono,
  },
  promptText: {
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    lineHeight: 20,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  loraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  loraName: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  loraDir: {
    color: colors.textDisabled,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  loraStrength: {
    color: colors.accent,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
}));
