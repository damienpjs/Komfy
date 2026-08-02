/**
 * Generalist model source for the launch form. A single row opens a
 * sectioned picker (Checkpoints / Diffusion models) fed by the server's
 * live enums. Choosing a checkpoint is enough — it carries its own CLIP and
 * VAE. Choosing a diffusion model reveals CLIP type + CLIP + VAE rows,
 * pre-filled by a best-effort name heuristic (modelCoupling) and freely
 * overridable. Degraded mode (no list): the row stays inert on the frozen
 * defaults. Nothing model-specific is hardcoded — every option comes from
 * the connected server (cf. modelSourceOptions).
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Modal,
  Pressable,
  SectionList,
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
import { loraDirName, loraDisplayName } from '../utils/pathTree';
import { guessClipType, guessCompanionFile } from '../workflows/modelCoupling';
import type { ModelSourceOptions } from '../workflows/requirements';
import type {
  ModelField as ModelFieldSpec,
  ModelSourceField as ModelSourceFieldSpec,
  ModelSourceValue,
} from '../workflows/types';
import { ModelField } from './ModelField';

interface Props {
  field: ModelSourceFieldSpec;
  value: ModelSourceValue;
  options: ModelSourceOptions;
  onChange: (value: ModelSourceValue) => void;
}

/** Minimal synthetic ModelField spec to reuse the file picker for a sub-row. */
function subField(label: string, def: string): ModelFieldSpec {
  return {
    kind: 'model',
    key: label,
    label,
    target: { nodeId: '', input: '' },
    default: def,
  };
}

export function ModelSourceField({ field, value, options, onChange }: Props) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { checkpoints, diffusionModels, clipTypes, clips, vaes } = options;
  const isCheckpoint = value.mode === 'checkpoint';
  const current = isCheckpoint ? value.checkpoint : value.unet;
  const activeList = isCheckpoint ? checkpoints : diffusionModels;
  const hasAnyList =
    (checkpoints?.length ?? 0) > 0 || (diffusionModels?.length ?? 0) > 0;
  const missing =
    activeList != null && activeList.length > 0 && !activeList.includes(current);

  const selectCheckpoint = (name: string) => {
    onChange({ ...value, mode: 'checkpoint', checkpoint: name });
    setPickerOpen(false);
  };

  const selectDiffusion = (name: string) => {
    // Auto-couple from the server's own lists — a guess, freely overridable.
    const clipType = guessClipType(name, clipTypes) ?? value.clipType;
    const clip = guessCompanionFile(name, clipType, clips) ?? value.clip;
    const vae = guessCompanionFile(name, clipType, vaes) ?? value.vae;
    onChange({ ...value, mode: 'diffusion', unet: name, clipType, clip, vae });
    setPickerOpen(false);
  };

  const needle = search.trim().toLowerCase();
  const filter = (list: string[] | undefined) =>
    (list ?? []).filter(
      (o) => needle === '' || o.toLowerCase().includes(needle),
    );
  const sections = [
    {
      title: t('wf.modelSource.checkpoints'),
      mode: 'checkpoint' as const,
      data: filter(checkpoints),
    },
    {
      title: t('wf.modelSource.diffusion'),
      mode: 'diffusion' as const,
      data: filter(diffusionModels),
    },
  ].filter((s) => s.data.length > 0);

  return (
    <View style={styles.wrap}>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          pressed && hasAnyList && { backgroundColor: colors.surfacePressed },
          !hasAnyList && { opacity: 0.6 },
        ]}
        disabled={!hasAnyList}
        onPress={() => {
          setSearch('');
          setPickerOpen(true);
        }}
      >
        <View style={styles.modeBadge}>
          <Ionicons
            name={isCheckpoint ? 'cube-outline' : 'layers-outline'}
            size={11}
            color={colors.accent}
          />
          <Text style={styles.modeBadgeText}>
            {isCheckpoint
              ? t('wf.modelSource.checkpointBadge')
              : t('wf.modelSource.diffusionBadge')}
          </Text>
        </View>
        <View style={styles.rowTitleWrap}>
          <Text style={styles.rowName} numberOfLines={1}>
            {loraDisplayName(current)}
          </Text>
          {loraDirName(current) !== '' && (
            <View style={styles.dirChip}>
              <Ionicons name="folder-outline" size={11} color={colors.textMuted} />
              <Text style={styles.dirChipText} numberOfLines={1}>
                {loraDirName(current)}
              </Text>
            </View>
          )}
        </View>
        {missing && (
          <Ionicons name="alert-circle" size={18} color={colors.warning} />
        )}
        {hasAnyList && (
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        )}
      </Pressable>
      {missing && <Text style={styles.missingText}>{t('model.missing')}</Text>}

      {/* Diffusion model: reveal the CLIP encoder + VAE it needs. */}
      {!isCheckpoint && (
        <View style={styles.subGroup}>
          <Text style={styles.subHint}>{t('wf.modelSource.diffusionHint')}</Text>
          <Text style={styles.subLabel}>{t('wf.modelSource.clipType')}</Text>
          <ModelField
            field={subField('wf.modelSource.clipType', field.defaultClipType)}
            value={value.clipType}
            options={clipTypes}
            onChange={(v) => onChange({ ...value, clipType: v })}
          />
          <Text style={styles.subLabel}>CLIP</Text>
          <ModelField
            field={subField('CLIP', field.defaultClip)}
            value={value.clip}
            options={clips}
            onChange={(v) => onChange({ ...value, clip: v })}
          />
          <Text style={styles.subLabel}>VAE</Text>
          <ModelField
            field={subField('VAE', field.defaultVae)}
            value={value.vae}
            options={vaes}
            onChange={(v) => onChange({ ...value, vae: v })}
          />
        </View>
      )}

      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{t(field.label)}</Text>
            <Pressable
              onPress={() => setPickerOpen(false)}
              hitSlop={12}
              style={({ pressed }) => pressed && { opacity: 0.6 }}
            >
              <Text style={styles.done}>{t('jobDetail.ok')}</Text>
            </Pressable>
          </View>

          <View style={styles.searchWrap}>
            <Ionicons name="search" size={16} color={colors.textDisabled} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={t('model.search')}
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {search !== '' && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={colors.textDisabled} />
              </Pressable>
            )}
          </View>

          <SectionList
            sections={sections}
            keyExtractor={(item, i) => `${item}:${i}`}
            stickySectionHeadersEnabled={false}
            ListEmptyComponent={
              <Text style={styles.emptyText}>{t('model.noResult')}</Text>
            }
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title}</Text>
            )}
            renderItem={({ item, section }) => {
              const selected = section.mode === value.mode && item === current;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.option,
                    pressed && { backgroundColor: colors.surfacePressed },
                  ]}
                  onPress={() =>
                    section.mode === 'checkpoint'
                      ? selectCheckpoint(item)
                      : selectDiffusion(item)
                  }
                >
                  <View style={styles.rowTitleWrap}>
                    <Text
                      style={[styles.rowName, selected && { color: colors.brand }]}
                      numberOfLines={1}
                    >
                      {loraDisplayName(item)}
                    </Text>
                    {loraDirName(item) !== '' && (
                      <View style={styles.dirChip}>
                        <Ionicons
                          name="folder-outline"
                          size={11}
                          color={colors.textMuted}
                        />
                        <Text style={styles.dirChipText} numberOfLines={1}>
                          {loraDirName(item)}
                        </Text>
                      </View>
                    )}
                  </View>
                  {selected && (
                    <Ionicons name="checkmark" size={18} color={colors.brand} />
                  )}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgElevated,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  modeBadgeText: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
  },
  rowTitleWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  rowName: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  dirChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.bgElevated,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  dirChipText: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  missingText: {
    color: colors.warning,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  subGroup: {
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingLeft: spacing.md,
    borderLeftColor: colors.border,
    borderLeftWidth: 2,
  },
  subHint: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    marginBottom: spacing.xs,
  },
  subLabel: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.xs,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  headerTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  done: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET - 8,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    paddingVertical: spacing.sm,
  },
  sectionHeader: {
    color: colors.textMuted,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptyText: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    padding: spacing.lg,
  },
});
