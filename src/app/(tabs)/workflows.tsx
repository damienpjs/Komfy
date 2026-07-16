/**
 * Workflows screen: card grid of the embedded workflows. Cards whose
 * requirements are missing on the connected server (custom nodes, model
 * files — cf. useAvailability) carry a warning badge; opening them shows
 * what is missing first (launch stays possible: POST /prompt is the final
 * judge).
 */

import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAvailability } from '../../hooks/useAvailability';
import { colors, radii, spacing, typography } from '../../theme/tokens';
import { workflows } from '../../workflows';
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

export default function WorkflowsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const availability = useAvailability();

  const open = (id: string) => router.push(`/workflow/${id}` as Href);

  return (
    <View style={styles.container}>
      <FlatList
        data={workflows}
        keyExtractor={(w) => w.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const check = availability?.[item.id];
          const unavailable = check != null && !check.ok;
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
