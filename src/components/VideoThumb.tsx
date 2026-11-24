/**
 * Picture of a video tile (Library grid, media picker): the clip's first
 * frame, decoded on the server (GET /komfy/thumb), under the small play
 * badge. When the server cannot make one (komfy-listing older than the
 * route, unreadable clip) the tile falls back to the film placeholder with
 * the file name, as before thumbnails existed.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { signature, spacing, typography } from '../theme/tokens';
import { makeStyles, useTheme } from '../theme/theme';

/**
 * Thumbnail height in px. A portrait clip cropped to a square cell keeps 3/4
 * of this as its width: 360 px covers a third of a phone screen at @3x.
 */
export const VIDEO_THUMB_HEIGHT = 480;

interface Props {
  /** GET /komfy/thumb URL, versioned with the clip's mtime. */
  uri: string;
  filename: string;
  /** Stable id of the clip (its listing path): a recycled cell starts blank. */
  recyclingKey: string;
}

export function VideoThumb({ uri, filename, recyclingKey }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  // The URL that failed, not a flag: a recycled cell given another clip
  // tries again.
  const [failed, setFailed] = useState<string | null>(null);

  return (
    <View style={styles.fill}>
      {failed === uri ? (
        <View style={styles.placeholder}>
          <Ionicons name="film-outline" size={26} color={colors.textMuted} />
          <Text style={styles.name} numberOfLines={1}>
            {filename}
          </Text>
        </View>
      ) : (
        <Image
          source={{ uri }}
          style={styles.fill}
          contentFit="cover"
          cachePolicy="disk"
          recyclingKey={recyclingKey}
          transition={100}
          onError={() => setFailed(uri)}
        />
      )}
      <View style={styles.playBadge}>
        <Ionicons name="play" size={12} color={signature.text} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
    backgroundColor: colors.bgElevated,
  },
  name: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
  },
  // The signature charcoal in both themes: it reads over any frame and
  // over the light placeholder alike.
  playBadge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: signature.bg,
  },
}));
