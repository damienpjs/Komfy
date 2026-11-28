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
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGallery } from '../hooks/useGallery';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';
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
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const gallery = useGallery();
  const insets = useSafeAreaInsets();
  const crumbScroll = useRef<ScrollView>(null);

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
          <Text style={styles.headerTitle} accessibilityRole="header">
            {title ?? t('dirPicker.title')}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.headerBtn}>{t('common.cancel')}</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={crumbScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          // A deep path keeps its current folder (the end) in view.
          onContentSizeChange={() => crumbScroll.current?.scrollToEnd({ animated: false })}
          style={styles.crumbScroll}
          contentContainerStyle={styles.crumbs}
        >
          <Pressable
            onPress={() => setDir('')}
            disabled={dir === ''}
            style={styles.crumbHit}
            accessibilityRole="button"
          >
            <Text style={[styles.crumb, dir === '' && styles.crumbCurrent]}>
              {scope === 'all' ? t('gallery.root') : 'output'}
            </Text>
          </Pressable>
          {crumbs.map((crumb, i) => (
            <View key={`${crumb}-${i}`} style={styles.crumbGroup}>
              <Ionicons name="chevron-forward" size={14} color={colors.textDisabled} />
              <Pressable
                onPress={() => setDir(crumbs.slice(0, i + 1).join('/'))}
                disabled={i === crumbs.length - 1}
                style={styles.crumbHit}
                accessibilityRole="button"
              >
                <Text
                  style={[styles.crumb, i === crumbs.length - 1 && styles.crumbCurrent]}
                  numberOfLines={1}
                >
                  {crumb}
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>

        <FlatList
          data={dirs}
          keyExtractor={(e) => e.name}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => (
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.row,
                index === 0 && styles.rowFirst,
                index === dirs.length - 1 && styles.rowLast,
                index > 0 && styles.rowSeparated,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
              onPress={() => setDir(dir === '' ? item.name : `${dir}/${item.name}`)}
            >
              <Ionicons name="folder-outline" size={18} color={colors.textMuted} />
              <Text style={styles.rowName} numberOfLines={1}>
                {item.name}
              </Text>
              {item.kind === 'dir' && item.count > 0 && (
                <Text style={styles.rowCount}>{item.count}</Text>
              )}
              <Ionicons name="chevron-forward" size={16} color={colors.textDisabled} />
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>{t('dirPicker.noSubfolders')}</Text>}
        />

        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <View style={styles.newSubRow}>
            <Ionicons name="add" size={18} color={colors.textMuted} />
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
            accessibilityRole="button"
            accessibilityState={{ disabled: !validDest }}
          >
            <Text style={styles.confirmText} numberOfLines={1}>
              {confirmVerb ?? t('dirPicker.confirmVerb')}{' '}
              <Text style={styles.confirmPath}>
                {scope === 'all'
                  ? validDest
                    ? `${selection}/`
                    : '…'
                  : `output/${selection === '' ? '' : `${selection}/`}`}
              </Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Header: the media picker sheet's (MediaPickerSheet).
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
    flexShrink: 1,
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  headerBtn: {
    color: colors.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  // Breadcrumb: the Library's (GalleryBrowser).
  crumbScroll: {
    flexGrow: 0,
    paddingLeft: spacing.md - 6,
    paddingTop: spacing.xs,
  },
  crumbs: {
    alignItems: 'center',
    paddingRight: spacing.md,
  },
  crumbGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  crumbHit: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  crumb: {
    color: colors.accent,
    fontFamily: typography.uiMedium,
    fontSize: 15,
  },
  crumbCurrent: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
  },
  // Folder list: one grouped card, like the Settings sections.
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    minHeight: 52,
    paddingHorizontal: spacing.md - 2,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  rowFirst: {
    borderTopWidth: 1,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
  },
  rowLast: {
    borderBottomWidth: 1,
    borderBottomLeftRadius: radii.lg,
    borderBottomRightRadius: radii.lg,
  },
  rowSeparated: {
    borderTopWidth: 1,
  },
  rowName: {
    flex: 1,
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  rowCount: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  empty: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.bgElevated,
  },
  // Field: the rename dialog's (RenameDialog).
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
    minHeight: MIN_TOUCH_TARGET,
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  // Filled button: the ink slab (MediaPickerSheet's add button).
  confirmBtn: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radii.md,
    backgroundColor: colors.strong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  confirmBtnDisabled: {
    opacity: 0.4,
  },
  confirmText: {
    color: colors.onStrong,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  confirmPath: {
    fontFamily: typography.mono,
  },
}));
