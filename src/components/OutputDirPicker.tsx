/**
 * Destination folder picker: navigation through the real tree (same data as
 * the gallery), "new subfolder" field, confirmation at the bottom.
 *
 * Two scopes:
 * - `'output'` (default): stays inside output/, returns an output-relative
 *   subfolder (used by the workflow SaveImage destination).
 * - `'all'`: navigates both roots (racine → output/input/…), returns a
 *   root-prefixed path (used by the gallery for input ↔ output moves and
 *   folder creation).
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useGallery } from '../hooks/useGallery';
import {
  colors,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '../theme/tokens';
import { listDirectory } from '../utils/pathTree';
import { sanitizeOutputDir } from '../workflows/patch';

/** Roots exposed by the `'all'` scope — a valid destination starts with one. */
const ROOTS = ['output', 'input'];

interface Props {
  visible: boolean;
  /**
   * Current folder, pre-navigated if it exists. Root-relative in `'output'`
   * scope, root-prefixed in `'all'` scope.
   */
  initial: string;
  onSelect: (dir: string) => void;
  onClose: () => void;
  /** Screen title (default: "Destination folder"). */
  title?: string;
  /** Confirm button verb (default: "Save to"). */
  confirmVerb?: string;
  /** Navigation scope — see the module header. Default `'output'`. */
  scope?: 'output' | 'all';
}

export function OutputDirPicker({
  visible,
  initial,
  onSelect,
  onClose,
  title,
  confirmVerb,
  scope = 'output',
}: Props) {
  const { t } = useTranslation();
  const gallery = useGallery();

  // `'output'` scope works on output-relative paths (strip the `output/`
  // prefix); `'all'` scope keeps the full prefixed paths.
  const { paths, extraDirs } = useMemo(() => {
    if (scope === 'all') {
      return { paths: gallery.paths, extraDirs: gallery.emptyDirs };
    }
    const strip = (list: string[]) =>
      list
        .filter((p) => p.startsWith('output/'))
        .map((p) => p.slice('output/'.length));
    return { paths: strip(gallery.paths), extraDirs: strip(gallery.emptyDirs) };
  }, [scope, gallery.paths, gallery.emptyDirs]);

  const [dir, setDir] = useState(() =>
    paths.some((p) => p.startsWith(`${initial}/`)) ? initial : '',
  );
  const [newSub, setNewSub] = useState('');

  const dirs = useMemo(
    () => listDirectory(paths, dir, extraDirs).filter((e) => e.kind === 'dir'),
    [paths, extraDirs, dir],
  );

  const crumbs = dir === '' ? [] : dir.split('/');
  const selection = sanitizeOutputDir(newSub ? `${dir}/${newSub}` : dir);

  // In `'all'` scope a destination must sit under a known root (the racine
  // level itself is not a valid target).
  const validDest =
    scope === 'output' || ROOTS.includes(selection.split('/')[0]);

  const confirm = () => {
    if (!validDest) return;
    onSelect(selection);
    setNewSub('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {title ?? t('dirPicker.title')}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </Pressable>
        </View>

        <View style={styles.breadcrumb}>
          {dir !== '' && (
            <Pressable
              onPress={() => setDir(crumbs.slice(0, -1).join('/'))}
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
            <Text style={[styles.crumb, dir === '' && styles.crumbCurrent]}>
              {scope === 'all' ? t('gallery.root') : 'output'}
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

        <FlatList
          data={dirs}
          keyExtractor={(e) => e.name}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
              onPress={() =>
                setDir(dir === '' ? item.name : `${dir}/${item.name}`)
              }
            >
              <Ionicons name="folder-outline" size={22} color={colors.warning} />
              <Text style={styles.rowName} numberOfLines={1}>
                {item.name}
              </Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.textDisabled}
              />
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>{t('dirPicker.noSubfolders')}</Text>
          }
        />

        <View style={styles.footer}>
          <View style={styles.newSubRow}>
            <Ionicons name="add-circle-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.newSubInput}
              value={newSub}
              onChangeText={setNewSub}
              placeholder={t('dirPicker.newSubfolder')}
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.confirmBtn,
              !validDest && styles.confirmBtnDisabled,
              pressed && { backgroundColor: colors.accentPressed },
            ]}
            onPress={confirm}
            disabled={!validDest}
          >
            <Text style={styles.confirmText}>
              {confirmVerb ?? t('dirPicker.confirmVerb')}{' '}
              {scope === 'all'
                ? validDest
                  ? `${selection}/`
                  : '…'
                : `output/${selection === '' ? '' : `${selection}/`}`}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
  cancel: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.md,
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
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET + 4,
    paddingHorizontal: spacing.xs,
  },
  rowName: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: 34,
  },
  empty: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    paddingVertical: spacing.md,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bgElevated,
  },
  newSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  newSubInput: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  confirmBtn: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
});
