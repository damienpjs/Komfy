/**
 * Two-stage prompt field (multiline text):
 *  - Read mode: non-editable preview (never an accidental focus on scroll),
 *    collapsible past a few lines, with "Copy" + "Edit".
 *  - Edit mode: full-screen editor (Modal) that takes the whole height and
 *    rises above the keyboard — no longer constrained by the form card.
 * Editing opens ONLY via the pencil/button, never by tapping the text.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast } from '../store/toast';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

interface PromptFieldProps {
  /** Field label, reused as the editor title. */
  label: string;
  value: string;
  placeholder?: string;
  onChange: (text: string) => void;
}

/** Number of lines shown when collapsed. */
const COLLAPSED_LINES = 6;

export function PromptField({
  label,
  value,
  placeholder,
  onChange,
}: PromptFieldProps) {
  const { t } = useTranslation();
  const showToast = useToast((s) => s.show);
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Actual keyboard height: used as the editor's bottom padding so the last
  // line rises ABOVE the keyboard (the native pageSheet only half does it).
  // iOS only; Android handles it via adjustResize.
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const onFrame = Keyboard.addListener('keyboardWillChangeFrame', (e) =>
      setKeyboardHeight(e.endCoordinates.height),
    );
    const onHide = Keyboard.addListener('keyboardWillHide', () =>
      setKeyboardHeight(0),
    );
    return () => {
      onFrame.remove();
      onHide.remove();
    };
  }, []);

  const hasValue = value.trim().length > 0;
  const isLong =
    value.split('\n').length > COLLAPSED_LINES || value.length > 320;

  const openEditor = () => {
    setDraft(value);
    setEditing(true);
  };

  const save = () => {
    onChange(draft);
    setEditing(false);
  };

  const copy = async () => {
    await Clipboard.setStringAsync(value);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(t('prompt.copied'));
  };

  return (
    <View>
      <View style={styles.actions}>
        {hasValue && (
          <Pressable
            onPress={copy}
            hitSlop={8}
            style={({ pressed }) => [
              styles.actionBtn,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
          >
            <Ionicons name="copy-outline" size={15} color={colors.textMuted} />
            <Text style={styles.actionLabel}>{t('common.copy')}</Text>
          </Pressable>
        )}
        <Pressable
          onPress={openEditor}
          hitSlop={8}
          style={({ pressed }) => [
            styles.actionBtn,
            pressed && { backgroundColor: colors.surfacePressed },
          ]}
        >
          <Ionicons name="create-outline" size={15} color={colors.accent} />
          <Text style={[styles.actionLabel, { color: colors.accent }]}>
            {t('prompt.edit')}
          </Text>
        </Pressable>
      </View>

      <View style={styles.preview}>
        <Text
          style={[styles.previewText, !hasValue && styles.placeholder]}
          numberOfLines={expanded ? undefined : COLLAPSED_LINES}
        >
          {hasValue ? value : (placeholder ?? t('prompt.placeholder'))}
        </Text>
        {isLong && (
          <Pressable onPress={() => setExpanded((e) => !e)} hitSlop={8}>
            <Text style={styles.toggle}>
              {expanded ? t('prompt.collapse') : t('prompt.showAll')}
            </Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={editing}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setEditing(false)}
      >
        <View style={[styles.editor, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <Pressable
              onPress={() => setEditing(false)}
              hitSlop={12}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={styles.cancel}>{t('common.cancel')}</Text>
            </Pressable>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {label}
            </Text>
            <Pressable
              onPress={save}
              hitSlop={12}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={styles.save}>{t('common.save')}</Text>
            </Pressable>
          </View>

          <TextInput
            style={[
              styles.input,
              // Content can scroll above the keyboard: the last line is no
              // longer hidden (bottom padding = keyboard height).
              { paddingBottom: spacing.md + keyboardHeight },
            ]}
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            placeholderTextColor={colors.textDisabled}
            multiline
            autoFocus
            autoCapitalize="none"
            textAlignVertical="top"
            scrollEnabled
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  actionLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  preview: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  previewText: {
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    lineHeight: typography.sizes.sm * 1.4,
  },
  placeholder: {
    color: colors.textDisabled,
  },
  toggle: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
    paddingTop: spacing.xs,
  },
  editor: {
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
    textAlign: 'center',
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  cancel: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.md,
  },
  save: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.md,
    lineHeight: typography.sizes.md * 1.4,
    padding: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
});
