/**
 * Create (home tab): the workflow catalogue. A search field, the workflows
 * launched recently, then the catalogue in sections (src/workflows/catalog):
 * one row per entry, a family (Repaint a zone, Video, Write a prompt) opening
 * on its last-used mode. Imported workflows follow, with the import row.
 *
 * A workflow whose requirements are missing on the server (custom nodes,
 * model files, cf. useAvailability) still opens: its row says what is
 * missing, POST /prompt stays the final judge.
 */

import * as Haptics from 'expo-haptics';
import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { WorkflowIcon, type WorkflowIconKey } from '../../components/WorkflowIcon';
import { useAvailability } from '../../hooks/useAvailability';
import { useCatalogPrefs } from '../../store/catalogPrefs';
import { useCustomWorkflows } from '../../store/customWorkflows';
import { showActionSheet } from '../../utils/actionSheet';
import { MIN_TOUCH_TARGET, radii, spacing, typography } from '../../theme/tokens';
import { makeStyles, useTheme } from '../../theme/theme';
import { CATALOG, entryOf, iconOf, type CatalogEntry } from '../../workflows/catalog';
import { getAnyWorkflow } from '../../workflows/registry';
import type { WorkflowAvailability } from '../../workflows/requirements';

/** First missing requirement, for the one-line warning of a row. */
function firstMissing(check: WorkflowAvailability): string | undefined {
  return check.missingNodes[0] ?? check.missingValues[0]?.value;
}

function missingCount(check: WorkflowAvailability): number {
  return (
    check.missingNodes.length + new Set(check.missingValues.map((v) => v.value)).size
  );
}

/** Lower-case, accents stripped: "Créer" matches "creer". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function entryMatches(entry: CatalogEntry, query: string, t: TFunction): boolean {
  const haystack = [
    t(entry.name),
    t(entry.description),
    entry.engine,
    ...entry.members.map((m) => t(m.mode)),
  ].join(' ');
  return fold(haystack).includes(query);
}

export default function CreateScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const availability = useAvailability();
  // Select stable references: deriving inside a zustand selector returns a
  // fresh object every render (infinite loop).
  const customs = useCustomWorkflows((s) => s.manifests);
  const recent = useCatalogPrefs((s) => s.recent);
  const lastMember = useCatalogPrefs((s) => s.lastMember);
  const [query, setQuery] = useState('');
  const folded = fold(query.trim());

  const open = (manifestId: string) =>
    router.push(`/workflow/${manifestId}` as Href);

  /** The manifest an entry opens on: last mode used, else the first. */
  const targetOf = (entry: CatalogEntry): string => {
    const remembered = lastMember[entry.key];
    return entry.members.some((m) => m.manifestId === remembered)
      ? remembered
      : entry.members[0].manifestId;
  };

  const sections = useMemo(
    () =>
      CATALOG.map((section) => ({
        ...section,
        entries: folded
          ? section.entries.filter((e) => entryMatches(e, folded, t))
          : section.entries,
      })).filter((s) => s.entries.length > 0),
    [folded, t],
  );
  const visibleCustoms = folded
    ? customs.filter((m) => fold(`${t(m.name)} ${t(m.description)}`).includes(folded))
    : customs;
  const recentIds = folded
    ? []
    : recent.filter((id) => getAnyWorkflow(id) != null).slice(0, 4);

  const customMenu = (id: string, name: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showActionSheet(name, [
      {
        label: t('importWf.edit'),
        onPress: () => router.push(`/workflow/edit?id=${id}` as Href),
      },
      {
        label: t('common.delete'),
        destructive: true,
        onPress: () =>
          Alert.alert(t('importWf.deleteTitle'), t('importWf.deleteBody', { name }), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: () => useCustomWorkflows.getState().remove(id),
            },
          ]),
      },
    ]);
  };

  const renderRow = (opts: {
    key: string;
    manifestId: string;
    icon: WorkflowIconKey;
    name: string;
    description: string;
    engine?: string;
    onLongPress?: () => void;
  }) => {
    const check = availability?.[opts.manifestId];
    const unavailable = check != null && !check.ok;
    const missing = unavailable ? firstMissing(check) : undefined;
    return (
      <Pressable
        key={opts.key}
        accessibilityRole="button"
        accessibilityHint={missing ? t('catalog.missing', { item: missing }) : undefined}
        onPress={() => open(opts.manifestId)}
        onLongPress={opts.onLongPress}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={[styles.tile, unavailable && styles.tileOff]}>
          <WorkflowIcon
            name={opts.icon}
            color={unavailable ? colors.textDisabled : colors.accent}
            knockout={unavailable ? colors.field : colors.accentSoft}
          />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowName} numberOfLines={1}>
            {opts.name}
          </Text>
          <Text
            style={[styles.rowDesc, missing != null && { color: colors.warning }]}
            numberOfLines={1}
          >
            {missing != null ? t('catalog.missing', { item: missing }) : opts.description}
          </Text>
        </View>
        {unavailable && check ? (
          <Text style={[styles.tag, styles.tagWarn]}>
            {t('catalog.missingTag', { count: missingCount(check) })}
          </Text>
        ) : opts.engine ? (
          <Text style={styles.tag}>{opts.engine}</Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <View style={styles.search}>
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Circle cx={11} cy={11} r={6.5} stroke={colors.textDisabled} strokeWidth={1.8} fill="none" />
          <Path d="M20 20l-4.2-4.2" stroke={colors.textDisabled} strokeWidth={1.8} strokeLinecap="round" />
        </Svg>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t('catalog.searchPlaceholder')}
          placeholderTextColor={colors.textDisabled}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
          accessibilityLabel={t('catalog.searchPlaceholder')}
        />
      </View>

      {recentIds.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, styles.sectionFirst]}>{t('catalog.recent')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
            style={styles.recentScroll}
          >
            {recentIds.map((id) => {
              const manifest = getAnyWorkflow(id);
              const entry = entryOf(id);
              const member = entry?.members.find((m) => m.manifestId === id);
              if (!manifest) return null;
              const sub =
                entry && entry.members.length > 1 && member
                  ? [t(member.mode), member.engine].filter(Boolean).join(' · ')
                  : (entry?.engine ?? t('importWf.customBadge'));
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  onPress={() => open(id)}
                  style={({ pressed }) => [styles.recentCard, pressed && styles.rowPressed]}
                >
                  <View style={[styles.tile, styles.tileSmall]}>
                    <WorkflowIcon name={iconOf(id)} color={colors.accent} knockout={colors.accentSoft} size={24} />
                  </View>
                  <View style={styles.recentText}>
                    <Text style={styles.recentName} numberOfLines={1}>
                      {entry ? t(entry.name) : t(manifest.name)}
                    </Text>
                    <Text style={styles.recentSub} numberOfLines={1}>
                      {sub}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}

      {sections.map((section, index) => (
        <View key={section.key}>
          <Text
            style={[
              styles.sectionTitle,
              index === 0 && recentIds.length === 0 && styles.sectionFirst,
            ]}
          >
            {t(section.title)}
          </Text>
          <View style={styles.group}>
            {section.entries.map((entry) =>
              renderRow({
                key: entry.key,
                manifestId: targetOf(entry),
                icon: entry.icon,
                name: t(entry.name),
                description: t(entry.description),
                engine: entry.engine,
              }),
            )}
          </View>
        </View>
      ))}

      {(visibleCustoms.length > 0 || !folded) && (
        <View>
          <Text style={styles.sectionTitle}>{t('catalog.sections.imported')}</Text>
          <View style={styles.group}>
            {visibleCustoms.map((m) =>
              renderRow({
                key: m.id,
                manifestId: m.id,
                icon: 'graph',
                name: t(m.name),
                description: t(m.description),
                onLongPress: () => customMenu(m.id, t(m.name)),
              }),
            )}
            {!folded && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/workflow/import' as Href)}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <View style={styles.tile}>
                  <WorkflowIcon name="import" color={colors.accent} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowName}>{t('catalog.importName')}</Text>
                  <Text style={styles.rowDesc} numberOfLines={1}>
                    {t('importWf.cardDescription')}
                  </Text>
                </View>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {folded !== '' && sections.length === 0 && visibleCustoms.length === 0 && (
        <Text style={styles.empty}>{t('catalog.noResult')}</Text>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md - 2,
    borderRadius: radii.md,
    backgroundColor: colors.field,
  },
  searchInput: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: 15,
  },
  sectionTitle: {
    marginTop: spacing.lg - 2,
    marginBottom: spacing.sm,
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  sectionFirst: {
    marginTop: spacing.md,
  },
  recentScroll: {
    marginHorizontal: -spacing.md,
  },
  recentRow: {
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  recentCard: {
    width: 172,
    padding: spacing.md - 2,
    gap: spacing.md - 4,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recentText: {
    gap: 3,
  },
  recentName: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  recentSub: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  group: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md - 4,
    minHeight: 64,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md - 2,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: -1,
  },
  rowPressed: {
    backgroundColor: colors.surfacePressed,
  },
  tile: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  tileSmall: {
    width: 36,
    height: 36,
    borderRadius: 10,
  },
  tileOff: {
    backgroundColor: colors.field,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowName: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: 15,
  },
  rowDesc: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: 13,
  },
  tag: {
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: colors.field,
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: 11,
  },
  tagWarn: {
    backgroundColor: colors.warningSoft,
    color: colors.warning,
  },
  empty: {
    marginTop: spacing.xl,
    textAlign: 'center',
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
}));
