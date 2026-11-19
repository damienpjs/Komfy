/**
 * "Use in…": where a prompt goes. Lists every workflow with a prompt field
 * (Create order and names), so a prompt written for a video or an edit is
 * not forced into the text-to-image form. `usePromptIn` wraps the sheet and
 * the navigation for the three places that send a prompt.
 */

import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { makeStyles, useTheme } from '../theme/theme';
import { radii, spacing, typography } from '../theme/tokens';
import { promptTargets } from '../workflows/promptTargets';
import { WorkflowIcon } from './WorkflowIcon';

interface Props {
  visible: boolean;
  onPick: (manifestId: string) => void;
  onClose: () => void;
}

export function UseInSheet({ visible, onPick, onClose }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // Recomputed per opening: imported workflows can change between two.
  const targets = useMemo(() => (visible ? promptTargets() : []), [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={styles.grab} />
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            {t('prompts.useInTitle')}
          </Text>
          <Text style={styles.hint}>{t('prompts.useInHint')}</Text>
        </View>
        <FlatList
          data={targets}
          keyExtractor={(item) => item.manifestId}
          style={styles.list}
          contentContainerStyle={styles.group}
          renderItem={({ item, index }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPick(item.manifestId)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.rowSeparated,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.tile}>
                <WorkflowIcon
                  name={item.icon}
                  color={colors.accent}
                  knockout={colors.accentSoft}
                  size={22}
                />
              </View>
              <View style={styles.texts}>
                <Text style={styles.name} numberOfLines={1}>
                  {t(item.name)}
                </Text>
                {item.mode != null && (
                  <Text style={styles.mode} numberOfLines={1}>
                    {[t(item.mode), item.engine].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </View>
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Path
                  d="M9 6l6 6-6 6"
                  stroke={colors.textMuted}
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                />
              </Svg>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

/**
 * The sheet plus where it leads: `open(text)` shows it, a pick opens that
 * workflow with the prompt filled in. `replace` when the calling screen is a
 * dead end once the prompt left (the text result).
 */
export function usePromptIn({ replace = false }: { replace?: boolean } = {}) {
  const router = useRouter();
  const [text, setText] = useState<string | null>(null);

  const sheet = (
    <UseInSheet
      visible={text != null}
      onClose={() => setText(null)}
      onPick={(manifestId) => {
        const href = `/workflow/${manifestId}?prefill=${encodeURIComponent(
          JSON.stringify({ prompt: text }),
        )}` as Href;
        setText(null);
        if (replace) router.replace(href);
        else router.push(href);
      }}
    />
  );
  return { open: (prompt: string) => setText(prompt), sheet };
}

const useStyles = makeStyles((colors) => ({
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  sheet: {
    maxHeight: '80%',
    gap: spacing.md - 2,
    paddingHorizontal: spacing.md,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: colors.bgElevated,
  },
  grab: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginTop: spacing.sm,
    backgroundColor: colors.border,
  },
  head: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.lg,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    flexGrow: 0,
  },
  group: {
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    minHeight: 60,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md - 2,
  },
  rowSeparated: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surfacePressed,
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  mode: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
  },
}));
