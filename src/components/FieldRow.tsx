/**
 * One detected or kept field of an imported workflow, shared by the import
 * review and the edit screen: its label (text, or an input in edit), its kind
 * and graph target, and the row's actions on the right. Rows stack in one
 * grouped card; `first` drops the separator.
 */

import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { makeStyles } from '../theme/theme';
import { MIN_TOUCH_TARGET, spacing, typography } from '../theme/tokens';

interface Props {
  /** The label: a string, or an input when the label is editable. */
  title: ReactNode;
  /** Field kind and, when it has one, where it lands in the graph. */
  kind: string;
  first?: boolean;
  /** Switch or action buttons. */
  children?: ReactNode;
}

export function FieldRow({ title, kind, first, children }: Props) {
  const styles = useStyles();
  return (
    <View style={[styles.row, !first && styles.separated]}>
      <View style={styles.texts}>
        {typeof title === 'string' ? (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        <Text style={styles.kind} numberOfLines={1}>
          {kind}
        </Text>
      </View>
      {children != null && <View style={styles.actions}>{children}</View>}
    </View>
  );
}

/** 44 pt square action of a field row (reorder, remove). */
export function FieldRowAction({
  label,
  onPress,
  disabled,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        disabled && styles.disabled,
        pressed && { opacity: 0.6 },
      ]}
    >
      {children}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 60,
    paddingVertical: spacing.xs,
    paddingLeft: spacing.md - 2,
    paddingRight: spacing.xs,
  },
  separated: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  texts: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  kind: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  action: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.3,
  },
}));
