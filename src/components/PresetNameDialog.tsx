/**
 * Small centred dialog asking for a preset name (save or rename).
 * Cross-platform stand-in for Alert.prompt, which only exists on iOS.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

/** Longest name kept: the bar chips truncate well before that anyway. */
const MAX_NAME = 60;

interface Props {
  visible: boolean;
  title: string;
  /** Pre-filled (and pre-selected) name. */
  initialName: string;
  /** Shown under the field; omitted = no note. */
  note?: string;
  onCancel: () => void;
  /** Called with the trimmed, non-empty name. Closing is the parent's job. */
  onSubmit: (name: string) => void;
}

export function PresetNameDialog({
  visible,
  title,
  initialName,
  note,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  // Each opening starts from the suggestion, not from the last draft.
  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  const trimmed = name.trim();
  const submit = () => {
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('presets.namePlaceholder')}
            placeholderTextColor={colors.textDisabled}
            maxLength={MAX_NAME}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          {note ? <Text style={styles.note}>{note}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [
                styles.btn,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
            >
              <Text style={styles.cancelText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!trimmed}
              style={({ pressed }) => [
                styles.btn,
                styles.saveBtn,
                pressed && { backgroundColor: colors.accentPressed },
                !trimmed && { opacity: 0.4 },
              ]}
            >
              <Text style={styles.saveText}>{t('common.save')}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  note: {
    color: colors.textMuted,
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
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtn: {
    backgroundColor: colors.accent,
  },
  cancelText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  saveText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
