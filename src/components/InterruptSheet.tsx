/**
 * Confirmation before interrupting the running job, from the Activity card
 * or the live preview. Interrupting is never one tap: the sheet names the
 * job and what happens to the queue, and "Continue" sits at the bottom, where
 * the trigger was in the preview, so a double tap keeps the job running.
 */

import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';
import { iconOf } from '../workflows/catalog';
import { makeStyles, useTheme } from '../theme/theme';
import { radii, spacing, typography, type ThemeName } from '../theme/tokens';
import { WorkflowIcon } from './WorkflowIcon';

interface Props {
  visible: boolean;
  title: string;
  /** Matched manifest, for its icon (graph icon otherwise). */
  manifestId?: string;
  /** "Step 5 / 8 · 62 % · ~0:48 left", or the elapsed time. */
  progress?: string;
  pendingCount: number;
  onConfirm: () => void;
  onClose: () => void;
  /** Forced palette (the live preview is always dark). */
  theme?: ThemeName;
}

export function InterruptSheet({
  visible,
  title,
  manifestId,
  progress,
  pendingCount,
  onConfirm,
  onClose,
  theme,
}: Props) {
  const styles = useStyles(theme);
  const { colors } = useTheme(theme);
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('job.keepRunning')}
      />
      <View
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}
        accessibilityRole="alert"
        accessibilityLabel={t('job.interruptTitle')}
      >
        <View style={styles.texts}>
          <Text style={styles.title}>{t('job.interruptTitle')}</Text>
          <Text style={styles.body}>
            {pendingCount > 0
              ? t('job.interruptSheetBody', { count: pendingCount })
              : t('job.interruptSheetBodyNone')}
          </Text>
        </View>

        <View style={styles.jobRow}>
          <View style={styles.tile}>
            <WorkflowIcon
              name={manifestId ? iconOf(manifestId) : 'graph'}
              color={colors.accent}
              knockout={colors.accentSoft}
              size={24}
            />
          </View>
          <View style={styles.jobTexts}>
            <Text style={styles.jobTitle} numberOfLines={1}>
              {title}
            </Text>
            {progress != null && (
              <Text style={styles.jobProgress} numberOfLines={1}>
                {progress}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              onConfirm();
            }}
            style={({ pressed }) => [styles.btn, styles.stopBtn, pressed && styles.stopPressed]}
          >
            <Svg width={18} height={18} viewBox="0 0 24 24">
              <Rect x={6} y={6} width={12} height={12} rx={2.5} fill={colors.onDanger} />
            </Svg>
            <Text style={styles.stopText}>{t('job.interruptConfirm')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.btn, styles.keepBtn, pressed && styles.keepPressed]}
          >
            <Text style={styles.keepText}>{t('job.keepRunning')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  sheet: {
    gap: spacing.md + 2,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: colors.bgElevated,
  },
  texts: {
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: 21,
    lineHeight: 27,
  },
  body: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 15,
    lineHeight: 22,
  },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    minHeight: 60,
    padding: spacing.sm + 2,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tile: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  jobTexts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  jobTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  jobProgress: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
  },
  actions: {
    gap: spacing.sm + 2,
  },
  btn: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md + 2,
  },
  stopBtn: {
    backgroundColor: colors.danger,
  },
  stopPressed: {
    backgroundColor: colors.dangerPressed,
  },
  stopText: {
    color: colors.onDanger,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  keepBtn: {
    backgroundColor: colors.field,
  },
  keepPressed: {
    backgroundColor: colors.surfacePressed,
  },
  keepText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
}));
