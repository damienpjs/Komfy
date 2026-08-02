/**
 * Simple file details opened by the viewer's swipe-up gesture: name, folder,
 * dimensions (measured client-side — image load or the video track), duration
 * (videos), size and dates (from the komfy-listing listing). Nothing
 * workflow-related here — the recipe lives behind the "variant" flow
 * (RemixSheet).
 */

import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { GalleryImage } from '../hooks/useGallery';
import { colors, spacing, typography } from '../theme/tokens';
import { formatBytes } from '../utils/format';
import { Row } from './GraphSummary';

interface Props {
  /** Item to describe — null keeps the sheet closed. */
  image: GalleryImage | null;
  /** Pixel size measured on image load, when already known (images only). */
  dimensions?: { width: number; height: number };
  /** Clip duration in seconds, when known (videos only). */
  durationSec?: number;
  onClose: () => void;
}

export function ImageInfoSheet({ image, dimensions, durationSec, onClose }: Props) {
  const { t, i18n } = useTranslation();
  if (!image) return null;

  const date = (epochS?: number) =>
    epochS
      ? new Date(epochS * 1000).toLocaleString(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : undefined;

  const clock = (sec?: number) => {
    if (sec == null || !Number.isFinite(sec)) return undefined;
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      // Match the viewer's orientations: a nested iOS Modal otherwise forces
      // the whole stack back to portrait.
      supportedOrientations={[
        'portrait',
        'portrait-upside-down',
        'landscape',
        'landscape-left',
        'landscape-right',
      ]}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('viewer.detailsTitle')}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <Text style={styles.done}>{t('common.close')}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <Row label={t('viewer.detailsName')} value={image.filename} mono />
          <Row
            label={t('viewer.detailsFolder')}
            value={image.subfolder ? `${image.root}/${image.subfolder}` : image.root}
            mono
          />
          <Row
            label={t('viewer.detailsDimensions')}
            value={
              dimensions
                ? `${dimensions.width} × ${dimensions.height} px`
                : undefined
            }
          />
          {image.isVideo && (
            <Row
              label={t('viewer.detailsDuration')}
              value={clock(durationSec)}
            />
          )}
          <Row
            label={t('viewer.detailsSize')}
            value={image.size != null ? formatBytes(image.size) : undefined}
          />
          <Row label={t('viewer.detailsCreated')} value={date(image.ctime)} />
          <Row label={t('viewer.detailsModified')} value={date(image.mtime)} />
          {image.size == null && (
            <Text style={styles.needsExt}>{t('viewer.detailsNeedsExt')}</Text>
          )}
        </ScrollView>
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
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  needsExt: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    marginTop: spacing.sm,
  },
});
