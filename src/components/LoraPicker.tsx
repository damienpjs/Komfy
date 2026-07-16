/**
 * File-manager-style LoRA explorer, as a modal sheet: folder navigation
 * (breadcrumb, back), recursive search, tap selection (toggle, checkmark on
 * already-selected LoRAs).
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLoras } from '../hooks/useLoras';
import {
  listDirectory,
  loraDirName,
  loraDisplayName,
  searchLoras,
  type LoraEntry,
} from '../utils/pathTree';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';

interface Props {
  visible: boolean;
  /** Already-selected paths (shown checked, tap = removal). */
  selected: string[];
  onToggle: (path: string) => void;
  onClose: () => void;
}

export function LoraPicker({ visible, selected, onToggle, onClose }: Props) {
  const { t } = useTranslation();
  const loras = useLoras();
  const [dir, setDir] = useState('');
  const [search, setSearch] = useState('');

  const searching = search.trim().length > 0;
  const entries: LoraEntry[] = loras.data
    ? searching
      ? searchLoras(loras.data, search)
      : listDirectory(loras.data, dir)
    : [];

  const crumbs = dir === '' ? [] : dir.split('/');

  const goUp = () => setDir(crumbs.slice(0, -1).join('/'));

  const renderEntry = ({ item }: { item: LoraEntry }) => {
    if (item.kind === 'dir') {
      return (
        <Pressable
          style={({ pressed }) => [
            styles.row,
            pressed && { backgroundColor: colors.surfacePressed },
          ]}
          onPress={() => setDir(dir === '' ? item.name : `${dir}/${item.name}`)}
        >
          <Ionicons name="folder-outline" size={22} color={colors.warning} />
          <Text style={styles.rowName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.rowMeta}>{item.count}</Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textDisabled}
          />
        </Pressable>
      );
    }
    const isSelected = selected.includes(item.path);
    return (
      <Pressable
        style={({ pressed }) => [
          styles.row,
          pressed && { backgroundColor: colors.surfacePressed },
        ]}
        onPress={() => onToggle(item.path)}
      >
        <Ionicons
          name={isSelected ? 'checkmark-circle' : 'document-outline'}
          size={22}
          color={isSelected ? colors.accent : colors.textMuted}
        />
        <View style={styles.rowText}>
          <Text
            style={[styles.rowName, isSelected && { color: colors.accent }]}
            numberOfLines={1}
          >
            {loraDisplayName(item.path)}
          </Text>
          {searching && loraDirName(item.path) !== '' && (
            <Text style={styles.rowPath} numberOfLines={1}>
              {loraDirName(item.path)}/
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('lora.add')}</Text>
          <Pressable
            onPress={onClose}
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
            placeholder={t('lora.search')}
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

        {!searching && (
          <View style={styles.breadcrumb}>
            {dir !== '' && (
              <Pressable
                onPress={goUp}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.upBtn,
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}
              >
                <Ionicons name="chevron-back" size={18} color={colors.accent} />
              </Pressable>
            )}
            <Pressable onPress={() => setDir('')} hitSlop={8}>
              <Text
                style={[
                  styles.crumb,
                  dir === '' && styles.crumbCurrent,
                ]}
              >
                LoRAs
              </Text>
            </Pressable>
            {crumbs.map((crumb, i) => (
              <View key={`${crumb}-${i}`} style={styles.crumbGroup}>
                <Text style={styles.crumbSep}>/</Text>
                <Pressable
                  onPress={() => setDir(crumbs.slice(0, i + 1).join('/'))}
                  hitSlop={8}
                >
                  <Text
                    style={[
                      styles.crumb,
                      i === crumbs.length - 1 && styles.crumbCurrent,
                    ]}
                  >
                    {crumb}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {loras.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : loras.isError ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{t('lora.listError')}</Text>
          </View>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(e) => (e.kind === 'dir' ? `d:${e.name}` : e.path)}
            renderItem={renderEntry}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {searching ? t('lora.noResults') : t('lora.emptyDir')}
              </Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  done: {
    color: colors.accent,
    fontFamily: typography.uiBold,
    fontSize: typography.sizes.md,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  upBtn: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  crumbGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  crumb: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  crumbCurrent: {
    color: colors.text,
  },
  crumbSep: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET + 4,
    paddingHorizontal: spacing.xs,
  },
  rowText: {
    flex: 1,
    gap: 1,
  },
  rowName: {
    flexShrink: 1,
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  rowPath: {
    color: colors.textDisabled,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  rowMeta: {
    color: colors.textDisabled,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    marginLeft: 'auto',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 34,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errorText: {
    color: colors.danger,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },
  emptyText: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
