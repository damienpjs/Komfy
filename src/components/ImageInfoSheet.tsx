/**
 * File details opened by the viewer's swipe-up gesture: name, folder,
 * dimensions (measured client-side — image load or the video track), duration
 * (videos), size and dates (from the komfy-listing listing), then the
 * generation recipe read from the file itself (PNG `prompt` chunk, /history
 * for the videos): model, prompts, seed, sampling, LoRAs — the same
 * GraphSummary block as the queue detail and the unknown-workflow sheet.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PromptGraph } from '../api/types';
import type { GalleryImage } from '../hooks/useGallery';
import { useRemix } from '../hooks/useRemix';
import { colors, spacing, typography } from '../theme/tokens';
import { formatBytes } from '../utils/format';
import { GraphSummary, Row } from './GraphSummary';

interface Props {
  /** Item to describe — null keeps the sheet closed. */
  image: GalleryImage | null;
  /** Pixel size measured on image load, when already known (images only). */
  dimensions?: { width: number; height: number };
  /** Clip duration in seconds, when known (videos only). */
  durationSec?: number;
  onClose: () => void;
}

/** Recipe of the displayed item: loaded once per sheet opening. */
function useRecipe(image: GalleryImage) {
  const remix = useRemix();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; graph: PromptGraph }
    | { status: 'none' }
    | { status: 'failed'; message: string }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    remix
      .graphOf(image)
      .then((graph) => {
        if (cancelled) return;
        setState(graph ? { status: 'ready', graph } : { status: 'none' });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          status: 'failed',
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
    // The body is mounted only while the sheet is open, and keyed on the
    // item: one read per opening, none in the background.
  }, [remix, image]);

  return state;
}

function InfoSheetBody({
  image,
  dimensions,
  durationSec,
  onClose,
}: Props & { image: GalleryImage }) {
  const { t, i18n } = useTranslation();
  const recipe = useRecipe(image);

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

          <View style={styles.separator} />
          <Text style={styles.section}>{t('viewer.detailsRecipe')}</Text>

          {recipe.status === 'loading' && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.note}>{t('viewer.readingRecipe')}</Text>
            </View>
          )}
          {recipe.status === 'ready' && <GraphSummary graph={recipe.graph} />}
          {recipe.status === 'none' && (
            <Text style={styles.note}>{t('gallery.noMetadataBody')}</Text>
          )}
          {recipe.status === 'failed' && (
            <Text style={styles.note}>
              {t('viewer.detailsRecipeFailed', { message: recipe.message })}
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function ImageInfoSheet({ image, ...rest }: Props) {
  // Keyed on the item: opening the sheet on another file remounts the body,
  // so its recipe state starts clean instead of showing the previous one.
  if (!image) return null;
  return <InfoSheetBody key={image.path} image={image} {...rest} />;
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
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing.sm,
  },
  section: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.md,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  note: {
    color: colors.textDisabled,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
    lineHeight: 18,
  },
});
