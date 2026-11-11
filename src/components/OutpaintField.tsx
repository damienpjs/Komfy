/**
 * Form row of the outpaint field: a diagram of the expanded canvas, the
 * live figures, one-tap templates, and the full-screen editor behind it.
 *
 * The row owns the link between the value and the picture: it measures the
 * source (the value is in source pixels, and the patcher needs the real size
 * to plan the working resolution) and reconciles the value whenever the size
 * it was set for differs. A new photo re-applies the template, or rescales
 * manual paddings; a remix read at working resolution is converted here too
 * (cf. outpaint.reconcileSource).
 */

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image as RNImage,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { createClient } from '../api/client';
import { useSettings } from '../store/settings';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import { reconcileSource } from '../workflows/outpaint';
import type { OutpaintField as OutpaintFieldDef, OutpaintValue } from '../workflows/types';
import {
  OutpaintDiagram,
  OutpaintEditor,
  OutpaintReadout,
  OutpaintTemplates,
} from './OutpaintEditor';

interface Props {
  field: OutpaintFieldDef;
  value: OutpaintValue;
  onChange: (value: OutpaintValue) => void;
  /** Server-side filename of the source image ('' = not picked yet). */
  sourceFilename: string;
}

export function OutpaintField({ field, value, onChange, sourceFilename }: Props) {
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [sizeFailed, setSizeFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const sourceUrl =
    sourceFilename === ''
      ? ''
      : createClient(serverUrl).viewUrl(sourceFilename, '', 'input');

  // Real pixel size of the source, as decoded (EXIF orientation applied, as
  // LoadImage does on the server).
  useEffect(() => {
    if (sourceUrl === '') {
      setSize(null);
      return;
    }
    let cancelled = false;
    setSize(null);
    setSizeFailed(false);
    RNImage.getSize(
      sourceUrl,
      (width, height) => {
        if (!cancelled) setSize({ width, height });
      },
      () => {
        if (!cancelled) setSizeFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sourceUrl]);

  // Value set for another size (new photo, preset, remix): bring it in line.
  useEffect(() => {
    if (!size) return;
    const next = reconcileSource(value, size.width, size.height);
    if (next !== value) onChange(next);
    // onChange is recreated on each parent render; size and value drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, value]);

  if (sourceFilename === '') {
    return (
      <View style={[styles.placeholder, styles.disabled]}>
        <Ionicons name="expand-outline" size={20} color={colors.textDisabled} />
        <Text style={styles.disabledText}>{t('outpaint.needsSource')}</Text>
      </View>
    );
  }

  const ready =
    size != null &&
    value.sourceWidth === size.width &&
    value.sourceHeight === size.height &&
    !value.pendingScale;

  if (!ready) {
    return (
      <View style={styles.placeholder}>
        {sizeFailed ? (
          <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
        ) : (
          <ActivityIndicator color={colors.accentStrong} />
        )}
        <Text style={styles.disabledText}>
          {t(sizeFailed ? 'outpaint.sizeFailed' : 'outpaint.measuring')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setEditing(true)}
        accessibilityRole="button"
        accessibilityLabel={t('outpaint.edit')}
        style={({ pressed }) => pressed && { opacity: 0.8 }}
      >
        <OutpaintDiagram value={value} sourceUrl={sourceUrl} height={180} />
      </Pressable>

      <OutpaintReadout value={value} />

      <OutpaintTemplates value={value} onChange={onChange} scroll />

      <Pressable
        onPress={() => setEditing(true)}
        style={({ pressed }) => [
          styles.editBtn,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
        accessibilityRole="button"
      >
        <Ionicons name="resize-outline" size={18} color={colors.text} />
        <Text style={styles.editText}>{t('outpaint.edit')}</Text>
      </Pressable>

      <OutpaintEditor
        visible={editing}
        sourceUrl={sourceUrl}
        value={value}
        budgets={field.budgets}
        onCancel={() => setEditing(false)}
        onDone={(v) => {
          setEditing(false);
          onChange(v);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  placeholder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 72,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  disabled: {
    backgroundColor: colors.bgElevated,
  },
  disabledText: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  editBtn: {
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
  editText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
