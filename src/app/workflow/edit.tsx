/**
 * Manifest editor for an imported workflow (long-press its card → Edit):
 * rename, remove/reorder fields, edit their labels, add fields from a graph
 * inspector (remaining literal inputs, kind picked by infer.fieldForInput),
 * add auto-detected LoRA fields (inferLorasCandidates), copy the manifest
 * JSON to share it (the import screen accepts it back on another phone).
 * Embedded workflows are code — not editable here.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useCustomWorkflows } from '../../store/customWorkflows';
import { useToast } from '../../store/toast';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../../theme/tokens';
import { fieldForInput, inferLorasCandidates } from '../../workflows/infer';
import type {
  LorasField,
  WorkflowField,
  WorkflowManifest,
} from '../../workflows/types';

/** Targets already covered by the fields ("nodeId/input" keys). */
function coveredInputs(fields: WorkflowField[]): Set<string> {
  const keys = new Set<string>();
  for (const field of fields) {
    switch (field.kind) {
      case 'text':
      case 'number':
      case 'seed':
      case 'image':
      case 'mask':
      case 'model':
        keys.add(`${field.target.nodeId}/${field.target.input}`);
        break;
      case 'dimensions':
        keys.add(`${field.widthTarget.nodeId}/${field.widthTarget.input}`);
        keys.add(`${field.heightTarget.nodeId}/${field.heightTarget.input}`);
        break;
      case 'select':
        for (const o of field.options)
          for (const p of o.patches)
            keys.add(`${p.target.nodeId}/${p.target.input}`);
        break;
      case 'loras':
      case 'persons':
        break;
    }
  }
  return keys;
}

/** One addable entry of the inspector. */
interface Candidate {
  nodeId: string;
  nodeTitle: string;
  input: string;
  preview: string;
  field: WorkflowField;
}

export default function EditWorkflowScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const showToast = useToast((s) => s.show);
  const stored = useCustomWorkflows((s) =>
    s.manifests.find((m) => m.id === id),
  );

  const [name, setName] = useState(stored?.name ?? '');
  const [fields, setFields] = useState<WorkflowField[]>(stored?.fields ?? []);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  if (!stored) {
    return (
      <View style={styles.center}>
        <Text style={styles.helpText}>{t('editWf.notFound')}</Text>
      </View>
    );
  }

  const uniqueKey = (base: string): string => {
    const used = new Set(fields.map((f) => f.key));
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
    return key;
  };

  // Inspector entries: literal inputs not yet covered by a field, plus the
  // LoRA-field candidates whose source is not already used.
  const covered = coveredInputs(fields);
  const candidates: Candidate[] = [];
  for (const [nodeId, node] of Object.entries(stored.graph)) {
    const title = node._meta?.title ?? node.class_type;
    for (const [input, value] of Object.entries(node.inputs)) {
      if (covered.has(`${nodeId}/${input}`)) continue;
      if (stored.saveNodeId === nodeId && input === 'filename_prefix') continue;
      const field = fieldForInput(nodeId, input, value, uniqueKey(input));
      if (!field) continue;
      candidates.push({
        nodeId,
        nodeTitle: `${title} (#${nodeId})`,
        input,
        preview: String(value),
        field,
      });
    }
  }
  const usedLoraSources = new Set(
    fields
      .filter((f): f is LorasField => f.kind === 'loras')
      .map((f) => `${f.modelSource.nodeId}:${f.modelSource.output}`),
  );
  const loraCandidates = inferLorasCandidates(stored.graph).filter(
    (c) => !usedLoraSources.has(`${c.modelSource.nodeId}:${c.modelSource.output}`),
  );

  const addField = (field: WorkflowField) => {
    setFields((f) => [...f, { ...field, key: uniqueKey(field.key) }]);
    setInspectorOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const move = (index: number, dir: -1 | 1) => {
    setFields((f) => {
      const next = [...f];
      const j = index + dir;
      if (j < 0 || j >= next.length) return f;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const setLabel = (index: number, label: string) => {
    setFields((f) =>
      f.map((field, i) => (i === index ? { ...field, label } : field)),
    );
  };

  const save = () => {
    const manifest: WorkflowManifest = {
      ...stored,
      name: name.trim() || stored.name,
      fields,
    };
    useCustomWorkflows.getState().update(manifest);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(t('editWf.saved'));
    router.back();
  };

  const exportJson = async () => {
    await Clipboard.setStringAsync(
      JSON.stringify({ ...stored, name: name.trim() || stored.name, fields }),
    );
    showToast(t('editWf.copied'));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>{t('importWf.name')}</Text>
      <TextInput
        style={styles.nameInput}
        value={name}
        onChangeText={setName}
        placeholder={stored.name}
        placeholderTextColor={colors.textDisabled}
      />

      <Text style={styles.label}>{t('editWf.fields')}</Text>
      {fields.length === 0 && (
        <Text style={styles.helpText}>{t('importWf.noFields')}</Text>
      )}
      {fields.map((field, index) => (
        <View key={field.key} style={styles.fieldRow}>
          <View style={styles.fieldInfo}>
            <TextInput
              style={styles.fieldLabelInput}
              // Resolved for editing: saving turns it into a literal (WYSIWYG).
              defaultValue={t(field.label)}
              onEndEditing={(e) => setLabel(index, e.nativeEvent.text)}
            />
            <Text style={styles.fieldKind}>
              {field.kind}
              {'target' in field
                ? ` — #${field.target.nodeId}.${field.target.input}`
                : ''}
            </Text>
          </View>
          <Pressable
            hitSlop={8}
            disabled={index === 0}
            onPress={() => move(index, -1)}
            style={({ pressed }) => [
              index === 0 && { opacity: 0.3 },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons name="chevron-up" size={20} color={colors.textMuted} />
          </Pressable>
          <Pressable
            hitSlop={8}
            disabled={index === fields.length - 1}
            onPress={() => move(index, 1)}
            style={({ pressed }) => [
              index === fields.length - 1 && { opacity: 0.3 },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
          </Pressable>
          <Pressable
            hitSlop={8}
            onPress={() =>
              setFields((f) => f.filter((_, i) => i !== index))
            }
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Ionicons name="close-circle" size={20} color={colors.danger} />
          </Pressable>
        </View>
      ))}

      <Pressable
        style={({ pressed }) => [
          styles.addBtn,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
        onPress={() => setInspectorOpen(true)}
      >
        <Ionicons name="add" size={18} color={colors.accent} />
        <Text style={styles.addText}>{t('editWf.addField')}</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.primaryBtn,
          pressed && { backgroundColor: colors.accentPressed },
        ]}
        onPress={save}
      >
        <Text style={styles.primaryText}>{t('common.save')}</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.secondaryBtn,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
        onPress={exportJson}
      >
        <Ionicons name="copy-outline" size={16} color={colors.accent} />
        <Text style={styles.secondaryText}>{t('editWf.export')}</Text>
      </Pressable>

      <Modal
        visible={inspectorOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInspectorOpen(false)}
      >
        <View style={styles.inspector}>
          <View style={styles.inspectorHeader}>
            <Text style={styles.inspectorTitle}>{t('editWf.addField')}</Text>
            <Pressable
              onPress={() => setInspectorOpen(false)}
              hitSlop={12}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={styles.done}>{t('jobDetail.ok')}</Text>
            </Pressable>
          </View>
          <FlatList
            data={candidates}
            keyExtractor={(c) => `${c.nodeId}/${c.input}`}
            ListHeaderComponent={
              loraCandidates.length > 0 ? (
                <View>
                  {loraCandidates.map((c) => (
                    <Pressable
                      key={c.key}
                      style={({ pressed }) => [
                        styles.candidate,
                        pressed && { backgroundColor: colors.surfacePressed },
                      ]}
                      onPress={() => addField(c)}
                    >
                      <View style={styles.fieldInfo}>
                        <Text style={styles.candidateName}>
                          {t('editWf.addLoras')}
                        </Text>
                        <Text style={styles.fieldKind}>
                          loras — #{c.modelSource.nodeId} →{' '}
                          {c.modelTargets.map((tg) => `#${tg.nodeId}`).join(', ')}
                        </Text>
                      </View>
                      <Ionicons name="add" size={18} color={colors.accent} />
                    </Pressable>
                  ))}
                </View>
              ) : null
            }
            ListEmptyComponent={
              loraCandidates.length === 0 ? (
                <Text style={styles.helpText}>{t('editWf.noCandidates')}</Text>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.candidate,
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}
                onPress={() => addField(item.field)}
              >
                <View style={styles.fieldInfo}>
                  <Text style={styles.candidateName} numberOfLines={1}>
                    {item.nodeTitle}
                  </Text>
                  <Text style={styles.fieldKind} numberOfLines={1}>
                    {item.field.kind} — {item.input} = {item.preview || '""'}
                  </Text>
                </View>
                <Ionicons name="add" size={18} color={colors.accent} />
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  label: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  helpText: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    lineHeight: 20,
  },
  nameInput: {
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  fieldRow: {
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
  fieldInfo: {
    flex: 1,
    gap: 2,
  },
  fieldLabelInput: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
    padding: 0,
  },
  fieldKind: {
    color: colors.textDisabled,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  addText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  primaryText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  secondaryBtn: {
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
  secondaryText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  inspector: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  inspectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  inspectorTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  done: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  candidateName: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
