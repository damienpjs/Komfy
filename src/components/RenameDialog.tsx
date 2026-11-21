/**
 * Centred dialog renaming one Library item (folder, image or video) in
 * place. A file shows its extension as a fixed suffix: only the stem is
 * editable, so a rename can never drop it out of the gallery. Refusals
 * (invalid name, name taken, server error) appear under the field and the
 * dialog stays open, so the user can fix the name instead of starting over.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
import { nameProblem, splitExtension, type NameProblem } from '../utils/itemName';

export interface RenameTarget {
  /** Prefixed path (`output/sub/a.png`). */
  path: string;
  /** Current last segment of the path. */
  name: string;
  kind: 'dir' | 'image' | 'video';
}

interface Props {
  /** Item being renamed; null = closed. */
  target: RenameTarget | null;
  /** Names already used next to the item (itself excluded). */
  siblings: string[];
  onCancel: () => void;
  /**
   * Sends the full new name (extension included). Resolves to a message to
   * show under the field, or null once renamed: closing is the parent's job.
   */
  onSubmit: (name: string) => Promise<string | null>;
}

const PROBLEM_KEYS: Record<NameProblem, string> = {
  empty: 'gallery.renameEmpty',
  dot: 'gallery.renameDot',
  chars: 'gallery.renameChars',
  long: 'gallery.renameLong',
};

const TITLE_KEYS: Record<RenameTarget['kind'], string> = {
  dir: 'gallery.renameFolderTitle',
  image: 'gallery.renameImageTitle',
  video: 'gallery.renameVideoTitle',
};

export function RenameDialog({ target, siblings, onCancel, onSubmit }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [stem, ext] =
    target == null
      ? ['', '']
      : target.kind === 'dir'
        ? [target.name, '']
        : splitExtension(target.name);

  const [draft, setDraft] = useState(stem);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Each opening starts from the current name, not from the last draft.
  // Reset during render rather than in an effect: an effect would paint
  // the previous draft for a frame, and autoFocus would select that one.
  const [openedFor, setOpenedFor] = useState<RenameTarget | null>(null);
  if (target !== openedFor) {
    setOpenedFor(target);
    if (target) {
      setDraft(stem);
      setServerError(null);
      setBusy(false);
    }
  }

  const trimmed = draft.trim();
  const full = `${trimmed}${ext}`;
  // An empty stem would leave a bare ".png": report it as empty, not as a
  // leading dot.
  const problem = trimmed === '' ? 'empty' : nameProblem(full);
  const unchanged = target != null && full === target.name;
  const taken = !unchanged && siblings.includes(full);
  const message =
    serverError ??
    (problem
      ? t(PROBLEM_KEYS[problem])
      : taken
        ? t('gallery.renameExists', { name: full })
        : null);
  const canSubmit = !busy && !problem && !taken && !unchanged;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const error = await onSubmit(full);
    // On success the parent closed the dialog: nothing left to reset.
    if (error) {
      setServerError(error);
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={target != null}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>
            {target ? t(TITLE_KEYS[target.kind]) : ''}
          </Text>
          <View style={[styles.field, message != null && styles.fieldError]}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={(v) => {
                setDraft(v);
                setServerError(null);
              }}
              placeholder={t('gallery.renamePlaceholder')}
              placeholderTextColor={colors.textDisabled}
              autoFocus
              selectTextOnFocus
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel={t('gallery.renamePlaceholder')}
            />
            {ext !== '' && <Text style={styles.ext}>{ext}</Text>}
          </View>
          {message != null && (
            <Text
              style={styles.error}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {message}
            </Text>
          )}
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.btn,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy }}
              style={({ pressed }) => [
                styles.btn,
                styles.renameBtn,
                pressed && { backgroundColor: colors.accentPressed },
                !canSubmit && !busy && { opacity: 0.4 },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.onStrong} />
              ) : (
                <Text style={styles.renameText}>{t('gallery.rename')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.overlay,
  },
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.bgElevated,
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  fieldError: {
    borderColor: colors.danger,
  },
  input: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  ext: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  error: {
    color: colors.danger,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  btn: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameBtn: {
    backgroundColor: colors.strong,
  },
  cancelText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  renameText: {
    color: colors.onStrong,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
}));
