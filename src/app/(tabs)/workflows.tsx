/**
 * Workflows screen: card grid of the embedded + imported workflows, plus an
 * import card (paste an API-format graph). Cards whose requirements are
 * missing on the connected server (custom nodes, model files — cf.
 * useAvailability) carry a warning badge; opening them shows what is
 * missing first (launch stays possible: POST /prompt is the final judge).
 * Imported workflows: "cube" chip, long-press to delete.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAvailability } from '../../hooks/useAvailability';
import { useCustomWorkflows } from '../../store/customWorkflows';
import { showActionSheet } from '../../utils/actionSheet';
import { colors, radii, spacing, typography } from '../../theme/tokens';
import { useWorkflows } from '../../workflows/registry';
import type { WorkflowAvailability } from '../../workflows/requirements';

function availabilityMessage(
  t: TFunction,
  check: WorkflowAvailability,
): string {
  const parts: string[] = [];
  if (check.missingNodes.length > 0) {
    parts.push(
      t('availability.missingNodes', { list: check.missingNodes.join('\n') }),
    );
  }
  if (check.missingValues.length > 0) {
    const values = [...new Set(check.missingValues.map((v) => v.value))];
    parts.push(t('availability.missingModels', { list: values.join('\n') }));
  }
  return parts.join('\n\n');
}

/** Sentinel appended to the grid: the "import a workflow" card. */
const IMPORT_CARD_ID = '__import__';

export default function WorkflowsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const availability = useAvailability();
  const workflows = useWorkflows();
  // Select the stable array reference — deriving (map/filter) inside a
  // zustand selector returns a fresh object every render → infinite loop.
  const customs = useCustomWorkflows((s) => s.manifests);

  const open = (id: string) => router.push(`/workflow/${id}` as Href);

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
          Alert.alert(
            t('importWf.deleteTitle'),
            t('importWf.deleteBody', { name }),
            [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('common.delete'),
                style: 'destructive',
                onPress: () => useCustomWorkflows.getState().remove(id),
              },
            ],
          ),
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={[...workflows, IMPORT_CARD_ID]}
        keyExtractor={(w) => (typeof w === 'string' ? w : w.id)}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          if (typeof item === 'string') {
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.card,
                  styles.importCard,
                  pressed && { backgroundColor: colors.surfacePressed },
                ]}
                onPress={() => router.push('/workflow/import' as Href)}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name="add" size={28} color={colors.accent} />
                </View>
                <Text style={styles.name} numberOfLines={2}>
                  {t('importWf.card')}
                </Text>
                <Text style={styles.description} numberOfLines={2}>
                  {t('importWf.cardDescription')}
                </Text>
              </Pressable>
            );
          }
          const check = availability?.[item.id];
          const unavailable = check != null && !check.ok;
          const isCustom = customs.some((m) => m.id === item.id);
          return (
            <Pressable
              style={({ pressed }) => [
                styles.card,
                pressed && { backgroundColor: colors.surfacePressed },
              ]}
              onPress={() => {
                if (unavailable) {
                  Alert.alert(
                    t('availability.title'),
                    availabilityMessage(t, check),
                    [
                      { text: t('common.cancel'), style: 'cancel' },
                      {
                        text: t('availability.openAnyway'),
                        onPress: () => open(item.id),
                      },
                    ],
                  );
                } else {
                  open(item.id);
                }
              }}
              onLongPress={
                isCustom ? () => customMenu(item.id, t(item.name)) : undefined
              }
            >
              <View style={styles.iconWrap}>
                <Ionicons name={item.icon} size={28} color={colors.accent} />
              </View>
              {unavailable && (
                <Ionicons
                  name="alert-circle"
                  size={20}
                  color={colors.warning}
                  style={styles.badge}
                  accessibilityLabel={t('availability.title')}
                />
              )}
              {isCustom && !unavailable && (
                <Ionicons
                  name="cube-outline"
                  size={16}
                  color={colors.textMuted}
                  style={styles.badge}
                  accessibilityLabel={t('importWf.customBadge')}
                />
              )}
              <Text style={styles.name} numberOfLines={2}>
                {t(item.name)}
              </Text>
              <Text style={styles.description} numberOfLines={2}>
                {t(item.description)}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  listContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
    minHeight: 140,
  },
  importCard: {
    borderStyle: 'dashed',
    backgroundColor: colors.bg,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  name: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  description: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
});
