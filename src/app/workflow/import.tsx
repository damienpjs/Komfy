/**
 * Workflow import screen (runtime): API-format JSON pasted/handed over by
 * the gallery (importDraft store) → inferred manifest (infer.ts) → review
 * (name, detected fields with toggles, availability warnings, graph
 * summary) → saved to the customWorkflows store → launch screen.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FieldRow } from '../../components/FieldRow';
import { GraphSummary } from '../../components/GraphSummary';
import { IconPicker } from '../../components/IconPicker';
import type { WorkflowIconKey } from '../../components/WorkflowIcon';
import { useNodeInfo } from '../../hooks/useAvailability';
import { makeCustomId, useCustomWorkflows } from '../../store/customWorkflows';
import { useImportDraft } from '../../store/importDraft';
import { useToast } from '../../store/toast';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../../theme/tokens';
import { makeStyles, useTheme } from '../../theme/theme';
import {
  inferManifest,
  MAX_GRAPH_JSON_BYTES,
  parseGraph,
  parseManifest,
} from '../../workflows/infer';
import { allWorkflows } from '../../workflows/registry';
import { checkAvailability } from '../../workflows/requirements';
import type { WorkflowManifest } from '../../workflows/types';

export default function ImportWorkflowScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const showToast = useToast((s) => s.show);
  const nodeInfo = useNodeInfo();
  const draft = useImportDraft();

  const [json, setJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(draft.sourceName ?? '');
  const [icon, setIcon] = useState<WorkflowIconKey>('graph');
  // Review phase once a graph is parsed (from the gallery or the paste box).
  const [inferred, setInferred] = useState(() =>
    draft.graph ? inferManifest(draft.graph) : null,
  );
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((inferred?.fields ?? []).map((f) => [f.key, true])),
  );

  const analyze = (raw: string) => {
    try {
      const trimmed = raw.trim();
      if (trimmed.length > MAX_GRAPH_JSON_BYTES) {
        throw new Error('importWf.tooBig');
      }
      // Exported manifest (edit screen → copy JSON): fields already curated.
      let manifest = null;
      try {
        manifest = parseManifest(JSON.parse(trimmed));
      } catch {
        manifest = null;
      }
      const result = manifest
        ? {
            graph: manifest.graph,
            fields: manifest.fields,
            saveNodeId: manifest.saveNodeId,
            textNodeId: manifest.textNodeId,
          }
        : inferManifest(parseGraph(trimmed));
      if (manifest && name.trim() === '') setName(manifest.name);
      setInferred(result);
      setEnabled(Object.fromEntries(result.fields.map((f) => [f.key, true])));
      setError(null);
    } catch (e) {
      setError(t(e instanceof Error ? e.message : 'importWf.invalid'));
    }
  };

  const pasteFromClipboard = async () => {
    const text = await Clipboard.getStringAsync();
    setJson(text);
    if (text.trim() !== '') analyze(text);
  };

  const save = () => {
    if (!inferred) return;
    const taken = allWorkflows().map((w) => w.id);
    const finalName = name.trim() || t('importWf.defaultName');
    const manifest: WorkflowManifest = {
      id: makeCustomId(finalName, taken),
      name: finalName,
      description: t('importWf.defaultDescription'),
      icon,
      graph: inferred.graph,
      fields: inferred.fields.filter((f) => enabled[f.key]),
      saveNodeId: inferred.saveNodeId,
      textNodeId: inferred.textNodeId,
    };
    useCustomWorkflows.getState().add(manifest);
    draft.clear();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(t('importWf.imported'));
    router.replace(`/workflow/${manifest.id}` as Href);
  };

  // Availability of the graph as imported (frozen literals) — warnings only,
  // the import stays possible (POST /prompt is the final judge).
  const check =
    inferred && nodeInfo
      ? checkAvailability(
          {
            id: 'import-draft',
            name: '',
            description: '',
            icon: 'cube-outline',
            graph: inferred.graph,
            fields: inferred.fields.filter((f) => enabled[f.key]),
            saveNodeId: inferred.saveNodeId,
            textNodeId: inferred.textNodeId,
          },
          nodeInfo,
        )
      : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!inferred && (
        <>
          <Text style={styles.help}>{t('importWf.help')}</Text>
          <TextInput
            style={styles.jsonInput}
            value={json}
            onChangeText={setJson}
            placeholder="{ &quot;1&quot;: { &quot;class_type&quot;: … } }"
            placeholderTextColor={colors.textDisabled}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.row}>
            <Pressable
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
              onPress={pasteFromClipboard}
            >
              <Ionicons name="clipboard-outline" size={16} color={colors.accent} />
              <Text style={styles.secondaryText}>{t('importWf.paste')}</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                json.trim() === '' && { opacity: 0.4 },
                pressed && { backgroundColor: colors.accentPressed },
              ]}
              disabled={json.trim() === ''}
              onPress={() => analyze(json)}
            >
              <Text style={styles.primaryText}>{t('importWf.analyze')}</Text>
            </Pressable>
          </View>
          {error != null && <Text style={styles.error}>{error}</Text>}
        </>
      )}

      {inferred && (
        <>
          <Text style={styles.label}>{t('importWf.name')}</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            placeholder={t('importWf.defaultName')}
            placeholderTextColor={colors.textDisabled}
          />

          <IconPicker value={icon} onChange={setIcon} />

          <Text style={styles.label}>{t('importWf.fields')}</Text>
          {inferred.fields.length === 0 && (
            <Text style={styles.help}>{t('importWf.noFields')}</Text>
          )}
          {inferred.fields.length > 0 && (
            <View style={styles.fieldGroup}>
              {inferred.fields.map((field, index) => (
                <FieldRow
                  key={field.key}
                  first={index === 0}
                  title={t(field.label)}
                  kind={field.kind}
                >
                  <Switch
                    value={enabled[field.key] ?? true}
                    onValueChange={(v) => setEnabled((e) => ({ ...e, [field.key]: v }))}
                    trackColor={{ true: colors.accent, false: colors.field }}
                    thumbColor={colors.switchThumb}
                    accessibilityLabel={t(field.label)}
                  />
                </FieldRow>
              ))}
            </View>
          )}

          {check != null && !check.ok && (
            <View style={styles.warningBox}>
              <Ionicons name="alert-circle" size={16} color={colors.warning} />
              <Text style={styles.warningText}>
                {[
                  check.missingNodes.length > 0
                    ? t('availability.missingNodes', {
                        list: check.missingNodes.join('\n'),
                      })
                    : null,
                  check.missingValues.length > 0
                    ? t('availability.missingModels', {
                        list: [
                          ...new Set(check.missingValues.map((v) => v.value)),
                        ].join('\n'),
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join('\n\n')}
              </Text>
            </View>
          )}

          <GraphSummary graph={inferred.graph} />

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { backgroundColor: colors.accentPressed },
            ]}
            onPress={save}
          >
            <Ionicons name="download-outline" size={18} color={colors.onStrong} />
            <Text style={styles.primaryText}>{t('importWf.import')}</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.secondaryBtn,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            onPress={() => {
              setInferred(null);
              setJson('');
              setError(null);
              draft.clear();
            }}
          >
            <Text style={styles.secondaryText}>{t('importWf.startOver')}</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  help: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    lineHeight: 20,
  },
  jsonInput: {
    minHeight: 160,
    maxHeight: 280,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.strong,
  },
  primaryText: {
    flexShrink: 1,
    color: colors.onStrong,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  secondaryText: {
    flexShrink: 1,
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  error: {
    color: colors.danger,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  label: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
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
  fieldGroup: {
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  warningBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  warningText: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: 18,
  },
}));
