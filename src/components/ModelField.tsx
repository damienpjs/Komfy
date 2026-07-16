/**
 * Model field for the launch form: a row showing the chosen file (name +
 * folder chip) opening a searchable single-select picker fed by the
 * server's installed files (object_info enum — cf. modelFieldOptions).
 * Degraded mode (no list): the row is inert and keeps the frozen default;
 * a value absent from the loaded list shows a warning (the server would
 * reject it at POST /prompt).
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  Modal,
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
import { loraDirName, loraDisplayName } from '../utils/pathTree';
import type { ModelField as ModelFieldSpec } from '../workflows/types';

interface Props {
  field: ModelFieldSpec;
  value: string;
  /** Server-side files (undefined = list unavailable → row inert). */
  options: string[] | undefined;
  onChange: (value: string) => void;
}

export function ModelField({ field, value, options, onChange }: Props) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const hasList = options != null && options.length > 0;
  const missing = hasList && !options.includes(value);
  const needle = search.trim().toLowerCase();
  const shown = hasList
    ? needle === ''
      ? options
      : options.filter((o) => o.toLowerCase().includes(needle))
    : [];

  return (
    <View style={styles.wrap}>
      <Pressable
        style={({ pressed }) => [
          styles.row,
          pressed && hasList && { backgroundColor: colors.surfacePressed },
          !hasList && { opacity: 0.6 },
        ]}
        disabled={!hasList}
        onPress={() => {
          setSearch('');
          setPickerOpen(true);
        }}
      >
        <View style={styles.rowTitleWrap}>
          <Text style={styles.rowName} numberOfLines={1}>
            {loraDisplayName(value)}
          </Text>
          {loraDirName(value) !== '' && (
            <View style={styles.dirChip}>
              <Ionicons
                name="folder-outline"
                size={11}
                color={colors.textMuted}
              />
              <Text style={styles.dirChipText} numberOfLines={1}>
                {loraDirName(value)}
              </Text>
            </View>
          )}
        </View>
        {missing && (
          <Ionicons name="alert-circle" size={18} color={colors.warning} />
        )}
        {hasList && (
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        )}
      </Pressable>
      {missing && (
        <Text style={styles.missingText}>{t('model.missing')}</Text>
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
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={colors.textDisabled}
                />
              </Pressable>
            )}
          </View>

          <FlatList
            data={shown}
            keyExtractor={(o) => o}
            ListEmptyComponent={
              <Text style={styles.emptyText}>{t('model.noResult')}</Text>
            }
            renderItem={({ item }) => {
              const selected = item === value;
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.option,
                    pressed && { backgroundColor: colors.surfacePressed },
                  ]}
                  onPress={() => {
                    onChange(item);
                    setPickerOpen(false);
                  }}
                >
                  <View style={styles.rowTitleWrap}>
                    <Text
                      style={[
                        styles.rowName,
                        selected && { color: colors.brand },
                      ]}
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
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={colors.brand}
                    />
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
