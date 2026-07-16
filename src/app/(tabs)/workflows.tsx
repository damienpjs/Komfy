/** Workflows screen: card grid of the embedded workflows. */

import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../theme/tokens';
import { workflows } from '../../workflows';

export default function WorkflowsScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <FlatList
        data={workflows}
        keyExtractor={(w) => w.id}
        numColumns={2}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [
              styles.card,
              pressed && { backgroundColor: colors.surfacePressed },
            ]}
            onPress={() => router.push(`/workflow/${item.id}` as Href)}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={28} color={colors.accent} />
            </View>
            <Text style={styles.name} numberOfLines={2}>
              {t(item.name)}
            </Text>
            <Text style={styles.description} numberOfLines={2}>
              {t(item.description)}
            </Text>
          </Pressable>
        )}
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
