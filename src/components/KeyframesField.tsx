/**
 * Keyframes timeline (KeyframesField, LTX 2.5 keyframes → video).
 *
 * Three layers on one signature slab:
 *  - the source bar: the clip the frames come from (its frame count, and a
 *    warning with a one-tap fix when this render's length differs);
 *  - the track: the source's frames as a filmstrip, one pin per image (first
 *    and last at the edges), keyframe pins dragged frame by frame;
 *  - the storyboard: every image in order, with the stretch between two
 *    images in between (its optional prompt), each opening the edit sheet.
 *
 * Adding pictures (Photos or the Komfy gallery, several at once): with a
 * source clip, each one is looked up in it (GET /komfy/frame-match) and lands
 * on the frame it was grabbed from, a retouched face notwithstanding; a
 * picture of the first or last frames may replace that end image (asked).
 * Without a source, pictures fill the widest gaps.
 *
 * Lookups and uploads take seconds while the timeline stays editable: every
 * write after an await goes through `latest` (the value of the last render)
 * and touches only what that operation owns, and keyframes are followed by
 * their form-only id, never by an index the list may re-sort.
 *
 * The first/last images and their strengths are ordinary fields of the
 * manifest (KeyframesField.ends) drawn here instead of in the list.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createClient, type ComfyClient, type VideoInfo } from '../api/client';
import { useSettings } from '../store/settings';
import { useToast } from '../store/toast';
import { makeStyles, useTheme } from '../theme/theme';
import { MIN_TOUCH_TARGET, radii, signature, spacing, typography } from '../theme/tokens';
import { listingPath, loaderValue, parseAnnotated } from '../utils/annotated';
import { PICK_FOR_UPLOAD, uploadName } from '../utils/imageUpload';
import { isHeif } from '../utils/media';
import {
  clipFrames,
  DEFAULT_KEY_STRENGTH,
  durationFor,
  emptyKeyframes,
  frameSeconds,
  freeFrame,
  KEYFRAME_MIN_GAP,
  keyProblems,
  moveRange,
  newKeyId,
  sortKeys,
  type KeyProblem,
} from '../workflows/keyframes';
import { parseNumber } from '../workflows/patch';
import type {
  FieldValues,
  KeyframeValue,
  KeyframesField as KeyframesFieldDef,
  KeyframesValue,
} from '../workflows/types';
import { DotGrid } from './DotGrid';
import { MediaPickerSheet } from './MediaPickerSheet';

const TRACK_H = 52;
/** One row of pin badges above the track (two when pins crowd). */
const BADGE_H = 20;
/** Closer than this (pt), two pin badges go on alternate rows. */
const BADGE_MIN_DX = 22;
const PIN_HIT = MIN_TOUCH_TARGET;
/** Drag bubble width. */
const BUBBLE_W = 104;
const CARD_W = 108;
/** Portrait clips would make towering cards: their picture is cropped. */
const CARD_MAX_H = 128;
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Mean gray difference above which a picture is not from the source clip. */
const MATCH_MAX = 0.06;
/** A runner-up this close to the best match: the shot barely moves there. */
const APPROX_MARGIN = 0.003;
const STRENGTH_STEPS = [0.5, 0.7, 0.85, 1];

/** What the edit sheet is open on: an end image, or a keyframe by id. */
type Target = { kind: 'first' } | { kind: 'last' } | { kind: 'key'; id: string };

type LookUp = { frame: number; approximate: boolean } | 'unmatched' | 'failed' | null;

interface Props {
  field: KeyframesFieldDef;
  values: FieldValues;
  errors: Record<string, string>;
  onChange: (key: string, value: FieldValues[string]) => void;
}

function previewUrl(client: ComfyClient, value: string): string {
  const ref = parseAnnotated(value);
  return client.viewUrl(ref.filename, ref.subfolder, ref.type);
}

/** Height of a card's picture for a clip of ratio `aspect`. */
function cardHeight(aspect: number): number {
  return Math.min(CARD_MAX_H, Math.round(CARD_W / Math.max(0.42, aspect)));
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * A frame number of a clip of `fromFrames` on a timeline of `toFrames`: the
 * same number when both have the same length, else the same relative spot.
 */
function mapFrame(frame: number, fromFrames: number, toFrames: number): number {
  if (fromFrames === toFrames || fromFrames < 2) return frame;
  return Math.round((frame / (fromFrames - 1)) * (toFrames - 1));
}

function frameLabel(frame: number, fps: number): string {
  return Number.isFinite(fps) && fps > 0 ? `${frame} · ${frameSeconds(frame, fps)}` : String(frame);
}

export function KeyframesField({ field, values, errors, onChange }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const serverUrl = useSettings((s) => s.serverUrl);
  const showToast = useToast((s) => s.show);
  const client = useMemo(() => createClient(serverUrl), [serverUrl]);

  const value = (values[field.key] as KeyframesValue | undefined) ?? emptyKeyframes();
  const keys = value.keys;
  const fps = parseNumber(values[field.fpsKey]);
  const frames = clipFrames(parseNumber(values[field.durationKey]), fps);
  const problems: (KeyProblem | null)[] =
    frames != null ? keyProblems(keys, frames) : keys.map(() => null);
  const firstImage = String(values[field.ends.first] ?? '');
  const lastImage = String(values[field.ends.last] ?? '');
  const strengthOf = (key: string) => {
    const n = parseNumber(values[key]);
    return Number.isFinite(n) ? n : 1;
  };

  // What async work reads after its awaits (never the closure's snapshot).
  const latest = useRef({ value, frames, firstImage, lastImage });
  latest.current = { value, frames, firstImage, lastImage };

  const writeValue = (update: (v: KeyframesValue) => KeyframesValue) => {
    const next = update(latest.current.value);
    const sorted = { ...next, keys: sortKeys(next.keys) };
    // Two writes in one tick must chain, not both start from the render.
    latest.current = { ...latest.current, value: sorted };
    onChange(field.key, sorted);
  };
  const writeKeys = (update: (keys: KeyframeValue[]) => KeyframeValue[]) =>
    writeValue((v) => ({ ...v, keys: update(v.keys) }));
  const patchKey = (id: string, patch: Partial<KeyframeValue>) =>
    writeKeys((ks) => ks.map((k) => (k.id === id ? { ...k, ...patch } : k)));

  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  useEffect(() => {
    setInfo(null);
    setInfoError(null);
    if (!value.source) return;
    let live = true;
    client
      .getVideoInfo(value.source)
      .then((i) => live && setInfo(i))
      .catch((e) => live && setInfoError(message(e)));
    return () => {
      live = false;
    };
  }, [client, value.source]);

  // Card and sheet ratio: the source clip's, else the first image's.
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const aspect = info ? info.width / info.height : (imageAspect ?? 4 / 3);

  /** Keyframe ids whose lookup was approximate (the shot barely moves). */
  const [approx, setApprox] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<Target | null>(null);
  const [focusPrompt, setFocusPrompt] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const busy = busyCount > 0;
  const [pickingSource, setPickingSource] = useState(false);
  /** Gallery sheet: adding keyframes, or replacing one image. */
  const [gallery, setGallery] = useState<
    { mode: 'add' } | { mode: 'replace'; target: Target } | null
  >(null);

  async function withBusy<T>(work: () => Promise<T>): Promise<T> {
    setBusyCount((c) => c + 1);
    try {
      return await work();
    } finally {
      setBusyCount((c) => c - 1);
    }
  }

  const room = field.maxKeys - keys.length;
  // With a source, a picture may land on an end image: allow two more.
  const pickLimit = Math.max(1, room + (value.source ? 2 : 0));

  // ---- Picking and uploading ------------------------------------------

  /**
   * Photos picked and uploaded. A single pick explains a refusal at once;
   * a batch counts them for its summary instead of stacking alerts.
   */
  const pickPhotos = async (limit: number): Promise<{ names: string[]; failed: number }> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('imageInput.accessDenied'), t('imageInput.accessDeniedBody'));
      return { names: [], failed: 0 };
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      ...PICK_FOR_UPLOAD,
      allowsMultipleSelection: limit > 1,
      selectionLimit: limit,
      orderedSelection: true,
    });
    if (result.canceled || result.assets.length === 0) return { names: [], failed: 0 };
    const single = result.assets.length === 1;
    return withBusy(async () => {
      const names: string[] = [];
      let failed = 0;
      for (const asset of result.assets) {
        if (isHeif(asset.fileName ?? asset.uri, asset.mimeType)) {
          if (single) Alert.alert(t('imageInput.heic'), t('imageInput.heicBody'));
          failed++;
          continue;
        }
        if (asset.fileSize != null && asset.fileSize > MAX_UPLOAD_BYTES) {
          if (single) {
            Alert.alert(
              t('imageInput.tooLarge'),
              t('imageInput.tooLargeBody', {
                size: (asset.fileSize / 1024 / 1024).toFixed(1),
                limit: MAX_UPLOAD_BYTES / 1024 / 1024,
              }),
            );
          }
          failed++;
          continue;
        }
        const name = uploadName(asset, 'komfy_key', 'jpg');
        try {
          names.push((await client.uploadImage(asset.uri, name)).name);
        } catch (e) {
          if (single) showToast(t('keyframes.uploadFailed', { message: message(e) }), 'error');
          failed++;
        }
      }
      return { names, failed };
    });
  };

  /** Where a picture sits in the source clip, on this render's timeline. */
  const lookUp = async (image: string): Promise<LookUp> => {
    const { value: v, frames: n } = latest.current;
    if (!v.source || n == null) return null;
    try {
      const m = await client.matchFrame(v.source, image);
      if (m.distance > MATCH_MAX) return 'unmatched';
      return {
        frame: mapFrame(m.frame, m.frames, n),
        approximate: m.runnerUp != null && m.runnerUp - m.distance < APPROX_MARGIN,
      };
    } catch {
      return 'failed';
    }
  };

  const confirmEnd = (kind: 'first' | 'last') =>
    new Promise<boolean>((resolve) =>
      Alert.alert(
        t(kind === 'first' ? 'keyframes.replaceFirst' : 'keyframes.replaceLast'),
        t(kind === 'first' ? 'keyframes.replaceFirstBody' : 'keyframes.replaceLastBody'),
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('keyframes.replace'), onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      ),
    );

  /** Pins pictures on the timeline; `failedBefore` = refused or failed uploads. */
  const placeImages = (names: string[], failedBefore = 0) =>
    withBusy(async () => {
      if (latest.current.frames == null) {
        showToast(t('keyframes.needsDuration'), 'error');
        return;
      }
      const added: KeyframeValue[] = [];
      const approxIds: string[] = [];
      const ends: { first: string | null; last: string | null } = { first: null, last: null };
      let unmatched = 0;
      let lookupFailed = 0;
      let dropped = 0;
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const found = await lookUp(name);
        const n = latest.current.frames;
        if (n == null) {
          dropped += names.length - i;
          break;
        }
        let frame: number | null = null;
        if (found === 'unmatched') unmatched++;
        else if (found === 'failed') lookupFailed++;
        else if (found) {
          // A picture of the first or last frames can only be that end image
          // (a keyframe there would crowd it).
          if (found.frame < KEYFRAME_MIN_GAP) {
            ends.first = name;
            continue;
          }
          if (found.frame > n - 1 - KEYFRAME_MIN_GAP) {
            ends.last = name;
            continue;
          }
          frame = found.frame;
        }
        const existing = [...latest.current.value.keys, ...added];
        frame ??= freeFrame(existing, n);
        if (existing.length >= field.maxKeys || frame == null) {
          dropped++;
          continue;
        }
        const id = newKeyId();
        if (found && typeof found === 'object' && found.approximate) approxIds.push(id);
        added.push({ id, image: name, frame, strength: DEFAULT_KEY_STRENGTH, prompt: '' });
      }
      if (added.length > 0) writeKeys((ks) => [...ks, ...added]);
      if (approxIds.length > 0) setApprox((s) => new Set([...s, ...approxIds]));

      const placed = sortKeys(added).map((k) => t('keyframes.frameN', { frame: k.frame }));
      // Replacing an end image is asked first (no undo): a picture made from
      // the first image itself also matches frame 0. An empty end just fills.
      for (const kind of ['first', 'last'] as const) {
        const image = ends[kind];
        if (!image) continue;
        const existing = kind === 'first' ? latest.current.firstImage : latest.current.lastImage;
        if (existing === '' || (await confirmEnd(kind))) {
          onChange(kind === 'first' ? field.ends.first : field.ends.last, image);
          placed.unshift(t(`keyframes.${kind}`));
        }
      }

      const parts: string[] = [];
      if (placed.length > 0) {
        parts.push(t('keyframes.placed', { count: placed.length, frames: placed.join(', ') }));
      }
      if (unmatched > 0) parts.push(t('keyframes.notInSource', { count: unmatched }));
      if (lookupFailed > 0) parts.push(t('keyframes.lookupFailed', { count: lookupFailed }));
      if (dropped > 0) parts.push(t('keyframes.dropped', { count: dropped, max: field.maxKeys }));
      if (failedBefore > 0) parts.push(t('keyframes.uploadsFailed', { count: failedBefore }));
      if (parts.length === 0) return;
      const trouble = lookupFailed + dropped + failedBefore > 0;
      Haptics.notificationAsync(
        trouble ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
      ).catch(() => {});
      showToast(parts.join('. '), trouble ? 'error' : 'success');
    });

  const addFrom = () => {
    if (room <= 0 && !value.source) {
      showToast(t('keyframes.tooMany', { count: field.maxKeys }), 'error');
      return;
    }
    Alert.alert(t('keyframes.addFrom'), undefined, [
      {
        text: t('keyframes.fromPhotos'),
        onPress: async () => {
          const { names, failed } = await pickPhotos(pickLimit);
          if (names.length > 0 || failed > 0) await placeImages(names, failed);
        },
      },
      { text: t('keyframes.fromGallery'), onPress: () => setGallery({ mode: 'add' }) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  // ---- Editing one image -----------------------------------------------

  const replaceImage = (target: Target, image: string) => {
    if (target.kind === 'first') onChange(field.ends.first, image);
    else if (target.kind === 'last') onChange(field.ends.last, image);
    else {
      patchKey(target.id, { image });
      setApprox((s) => {
        const next = new Set(s);
        next.delete(target.id);
        return next;
      });
    }
  };

  const replaceFrom = (target: Target) => {
    Alert.alert(t('keyframes.replace'), undefined, [
      {
        text: t('keyframes.fromPhotos'),
        onPress: async () => {
          const {
            names: [name],
          } = await pickPhotos(1);
          if (name) replaceImage(target, name);
        },
      },
      { text: t('keyframes.fromGallery'), onPress: () => setGallery({ mode: 'replace', target }) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const rematch = (id: string) =>
    withBusy(async () => {
      const key = latest.current.value.keys.find((k) => k.id === id);
      if (!key) return;
      const found = await lookUp(key.image);
      if (found === 'failed') {
        showToast(t('keyframes.lookupFailed', { count: 1 }), 'error');
        return;
      }
      if (found === 'unmatched') {
        showToast(t('keyframes.notInSource', { count: 1 }), 'error');
        return;
      }
      if (!found) return;
      // A key removed meanwhile is left alone (the map finds nothing).
      patchKey(id, { frame: found.frame });
      setApprox((s) => {
        const next = new Set(s);
        if (found.approximate) next.add(id);
        else next.delete(id);
        return next;
      });
      Haptics.selectionAsync().catch(() => {});
    });

  const removeKey = (id: string) => {
    setEditing(null);
    writeKeys((ks) => ks.filter((k) => k.id !== id));
  };

  const open = (target: Target, prompt = false) => {
    setFocusPrompt(prompt);
    setEditing(target);
    Haptics.selectionAsync().catch(() => {});
  };

  // An empty end image: straight to the pickers, no empty sheet first.
  const openEnd = (kind: 'first' | 'last') => {
    if ((kind === 'first' ? firstImage : lastImage) === '') replaceFrom({ kind });
    else open({ kind });
  };

  /** The image a target holds now ('' = none). */
  const imageOf = (target: Target) =>
    target.kind === 'first'
      ? firstImage
      : target.kind === 'last'
        ? lastImage
        : (keys.find((k) => k.id === target.id)?.image ?? '');

  // Replacing from the gallery: stacked over the edit sheet when it is open
  // (a modal can only be presented from the top one), on its own otherwise.
  const replacing = gallery?.mode === 'replace' ? imageOf(gallery.target) : '';
  const replaceSheet = (here: boolean) => (
    <MediaPickerSheet
      visible={here && gallery?.mode === 'replace'}
      kind="image"
      title={t('mediaPicker.chooseImage')}
      current={replacing !== '' ? listingPath(replacing) : null}
      onClose={() => setGallery(null)}
      onPick={([path]) => {
        const target = gallery?.mode === 'replace' ? gallery.target : null;
        setGallery(null);
        if (path && target) replaceImage(target, loaderValue(path));
      }}
    />
  );

  // ---- Render ----------------------------------------------------------

  const mismatch = info != null && frames != null && info.frames !== frames && info.fps != null;
  const matchSource = () => {
    if (!info?.fps || frames == null) return;
    // Keys sit on this render's timeline: keep them at the same moment of
    // the clip once it takes the source's length.
    writeKeys((ks) => ks.map((k) => ({ ...k, frame: mapFrame(k.frame, frames, info.frames) })));
    onChange(field.durationKey, durationFor(info.frames, info.fps));
    onChange(field.fpsKey, Math.round(info.fps));
    Haptics.selectionAsync().catch(() => {});
  };

  const endProblem = {
    first: !!errors[field.ends.first],
    last: !!errors[field.ends.last],
  };
  const h = cardHeight(aspect);

  return (
    <View style={styles.wrap}>
      <View style={styles.slab}>
        <DotGrid color={signature.dot} spacing={14} />

        <SourceBar
          source={value.source}
          info={info}
          infoError={infoError}
          frames={frames}
          fps={fps}
          onPick={() => setPickingSource(true)}
          onClear={() => writeValue((v) => ({ ...v, source: null }))}
        />

        {mismatch && (
          <View style={styles.mismatch}>
            <Ionicons name="alert-circle" size={16} color={signature.warningText} />
            <Text style={styles.mismatchText}>
              {t('keyframes.mismatch', { source: info.frames, render: frames })}
            </Text>
            <Pressable
              onPress={matchSource}
              hitSlop={{ top: 6, bottom: 6 }}
              style={({ pressed }) => [styles.mismatchBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              <Text style={styles.mismatchBtnText}>{t('keyframes.matchSource')}</Text>
            </Pressable>
          </View>
        )}

        {frames == null ? (
          <Text style={styles.noDuration}>{t('keyframes.needsDuration')}</Text>
        ) : (
          <Track
            frames={frames}
            fps={fps}
            keys={keys}
            problems={problems}
            endProblem={endProblem}
            filmstrip={
              value.source && info
                ? (count) => client.filmstripUrl(value.source!, count, TRACK_H * 2, info.mtime)
                : null
            }
            aspect={aspect}
            editing={editing}
            onOpen={(target) => (target.kind === 'key' ? open(target) : openEnd(target.kind))}
            onMove={(id, frame) => patchKey(id, { frame })}
          />
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.board}
        >
          <Card
            client={client}
            image={firstImage}
            title={t('keyframes.first')}
            meta={frames != null ? frameLabel(0, fps) : ''}
            aspect={aspect}
            strength={strengthOf(field.ends.firstStrength)}
            selected={editing?.kind === 'first'}
            problem={endProblem.first}
            onPress={() => openEnd('first')}
            onAspect={setImageAspect}
          />
          {keys.length > 0 ? (
            <Stretch
              height={h}
              prompt={value.opening}
              name={t('keyframes.first')}
              onPress={() => open({ kind: 'first' }, true)}
            />
          ) : (
            // Without keyframes the only stretch is the whole clip: the main
            // prompt's job, so no stretch prompt to offer.
            <View style={[styles.stretch, { height: h }]}>
              <View style={[styles.stretchLine, { top: h / 2 }]} />
            </View>
          )}
          {keys.map((key, i) => (
            <View key={key.id} style={styles.boardItem}>
              <Card
                client={client}
                image={key.image}
                title={t('keyframes.key', { n: i + 1 })}
                meta={frameLabel(key.frame, fps)}
                aspect={aspect}
                strength={key.strength}
                selected={editing?.kind === 'key' && editing.id === key.id}
                problem={problems[i] != null}
                approximate={approx.has(key.id)}
                onPress={() => open({ kind: 'key', id: key.id })}
              />
              <Stretch
                height={h}
                prompt={key.prompt}
                name={t('keyframes.key', { n: i + 1 })}
                onPress={() => open({ kind: 'key', id: key.id }, true)}
              />
            </View>
          ))}
          <Card
            client={client}
            image={lastImage}
            title={t('keyframes.last')}
            meta={frames != null ? frameLabel(frames - 1, fps) : ''}
            aspect={aspect}
            strength={strengthOf(field.ends.lastStrength)}
            selected={editing?.kind === 'last'}
            problem={endProblem.last}
            onPress={() => openEnd('last')}
          />
        </ScrollView>

        <Pressable
          onPress={addFrom}
          disabled={busy}
          style={({ pressed }) => [
            styles.addBtn,
            pressed && { backgroundColor: signature.track },
            busy && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityState={{ busy, disabled: busy }}
        >
          {busy ? (
            <>
              <ActivityIndicator size="small" color={signature.accent} />
              <Text style={styles.addText}>{t('keyframes.placing')}</Text>
            </>
          ) : (
            <>
              <Ionicons name="add" size={18} color={signature.accent} />
              <Text style={styles.addText}>{t('keyframes.add')}</Text>
              <Text style={styles.addCount}>
                {keys.length}/{field.maxKeys}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {[field.ends.first, field.ends.last].map((k) =>
        errors[k] ? (
          <Text key={k} style={styles.error}>
            {t('keyframes.endError', {
              name: t(k === field.ends.first ? 'keyframes.first' : 'keyframes.last'),
              error: errors[k],
            })}
          </Text>
        ) : null,
      )}

      <KeyframeSheet
        target={editing}
        focusPrompt={focusPrompt}
        client={client}
        source={value.source}
        sourceInfo={info}
        frames={frames}
        fps={fps}
        aspect={aspect}
        keys={keys}
        problems={problems}
        approx={approx}
        busy={busy}
        first={{ image: firstImage, strength: strengthOf(field.ends.firstStrength) }}
        last={{ image: lastImage, strength: strengthOf(field.ends.lastStrength) }}
        opening={value.opening}
        onClose={() => setEditing(null)}
        onReplace={replaceFrom}
        onClearEnd={(kind) => onChange(kind === 'first' ? field.ends.first : field.ends.last, '')}
        onEndStrength={(kind, s) =>
          onChange(kind === 'first' ? field.ends.firstStrength : field.ends.lastStrength, s)
        }
        onOpening={(opening) => writeValue((v) => ({ ...v, opening }))}
        onKey={patchKey}
        onRematch={rematch}
        onRemove={removeKey}
        gallery={replaceSheet(editing != null)}
      />
      {replaceSheet(editing == null)}

      <MediaPickerSheet
        visible={gallery?.mode === 'add'}
        kind="image"
        title={t('mediaPicker.chooseImages')}
        limit={pickLimit}
        onClose={() => setGallery(null)}
        onPick={(paths) => {
          setGallery(null);
          placeImages(paths.map(loaderValue));
        }}
      />

      <MediaPickerSheet
        visible={pickingSource}
        kind="video"
        title={t('keyframes.source')}
        current={value.source}
        onClose={() => setPickingSource(false)}
        onPick={([path]) => {
          setPickingSource(false);
          if (path) writeValue((v) => ({ ...v, source: path }));
        }}
      />
    </View>
  );
}

// --------------------------------------------------------------------------
// Source bar
// --------------------------------------------------------------------------

function SourceBar({
  source,
  info,
  infoError,
  frames,
  fps,
  onPick,
  onClear,
}: {
  source: string | null;
  info: VideoInfo | null;
  infoError: string | null;
  frames: number | null;
  fps: number;
  onPick: () => void;
  onClear: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const clip =
    frames != null && Number.isFinite(fps) && fps > 0
      ? t('keyframes.clipInfo', { seconds: ((frames - 1) / fps).toFixed(2), frames })
      : null;

  if (!source) {
    return (
      <View style={styles.sourceRow}>
        <Pressable
          onPress={onPick}
          style={({ pressed }) => [styles.sourceEmpty, pressed && { backgroundColor: signature.track }]}
          accessibilityRole="button"
        >
          <Ionicons name="film-outline" size={18} color={signature.accent} />
          <View style={styles.sourceTexts}>
            <Text style={styles.sourceAdd}>{t('keyframes.sourceAdd')}</Text>
            <Text style={styles.sourceHint}>{t('keyframes.sourceHint')}</Text>
          </View>
        </Pressable>
        {clip && <Text style={styles.clipInfo}>{clip}</Text>}
      </View>
    );
  }
  const name = source.slice(source.lastIndexOf('/') + 1);
  return (
    <View style={styles.sourceRow}>
      <Pressable
        onPress={onPick}
        style={({ pressed }) => [styles.sourceChip, pressed && { backgroundColor: signature.track }]}
        accessibilityRole="button"
        accessibilityLabel={`${t('keyframes.source')}: ${name}`}
      >
        <Ionicons name="film" size={16} color={signature.accent} />
        <View style={styles.sourceTexts}>
          <Text style={styles.sourceName} numberOfLines={1}>
            {name}
          </Text>
          <Text
            style={[styles.sourceMeta, infoError != null && { color: signature.dangerText }]}
            numberOfLines={2}
          >
            {infoError != null
              ? t('keyframes.sourceUnreadable', { message: infoError })
              : info
                ? t('keyframes.sourceInfo', { frames: info.frames, fps: info.fps ?? '?' })
                : t('common.loading')}
          </Text>
        </View>
      </Pressable>
      <Pressable
        onPress={onClear}
        style={({ pressed }) => [styles.iconBtn, pressed && { backgroundColor: signature.track }]}
        accessibilityRole="button"
        accessibilityLabel={t('keyframes.detachSource')}
      >
        <Ionicons name="close" size={18} color={signature.textMuted} />
      </Pressable>
      {clip && <Text style={styles.clipInfo}>{clip}</Text>}
    </View>
  );
}

// --------------------------------------------------------------------------
// Track
// --------------------------------------------------------------------------

function Track({
  frames,
  fps,
  keys,
  problems,
  endProblem,
  filmstrip,
  aspect,
  editing,
  onOpen,
  onMove,
}: {
  frames: number;
  fps: number;
  keys: KeyframeValue[];
  problems: (KeyProblem | null)[];
  endProblem: { first: boolean; last: boolean };
  filmstrip: ((count: number) => string) | null;
  aspect: number;
  editing: Target | null;
  onOpen: (target: Target) => void;
  onMove: (id: string, frame: number) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  // Pins past the end (the clip got shorter) stay on the track, at its edge.
  const x = (frame: number) =>
    frames > 1 ? Math.min(1, Math.max(0, frame / (frames - 1))) * width : 0;

  // Badges of pins closer than a badge go on alternate rows.
  const rows = useMemo(() => {
    const out: number[] = [];
    keys.forEach((k, i) => {
      const crowded = i > 0 && x(k.frame) - x(keys[i - 1].frame) < BADGE_MIN_DX;
      out.push(crowded && out[i - 1] === 0 ? 1 : 0);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, frames, width]);
  const band = (rows.some((r) => r === 1) ? 2 : 1) * BADGE_H;

  // One tile per slot the width holds, at the clip's ratio.
  const tiles = width > 0 ? Math.max(1, Math.min(48, Math.round(width / (TRACK_H * aspect)))) : 0;
  const ticks = useMemo(() => {
    if (!(fps > 0) || width === 0) return [];
    const total = (frames - 1) / fps;
    const step = total <= 6 ? 1 : total <= 12 ? 2 : 5;
    const out: number[] = [];
    for (let s = 0; s <= total + 1e-6; s += step) out.push(s);
    return out;
  }, [frames, fps, width]);

  return (
    <View style={styles.trackBlock}>
      <View
        style={[styles.trackArea, { height: band + TRACK_H }]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <View style={[styles.track, { top: band }]}>
          {filmstrip && tiles > 0 ? (
            <Image
              source={{ uri: filmstrip(tiles) }}
              style={styles.filmstrip}
              contentFit="fill"
              cachePolicy="memory-disk"
              transition={150}
            />
          ) : null}
        </View>

        {width > 0 && (
          <>
            <EndPin
              left={0}
              band={band}
              problem={endProblem.first}
              selected={editing?.kind === 'first'}
              label={t('keyframes.first')}
              onPress={() => onOpen({ kind: 'first' })}
            />
            <EndPin
              left={width}
              band={band}
              problem={endProblem.last}
              selected={editing?.kind === 'last'}
              label={t('keyframes.last')}
              onPress={() => onOpen({ kind: 'last' })}
            />
            {keys.map((key, i) => (
              <KeyPin
                key={key.id}
                number={i + 1}
                frame={key.frame}
                range={moveRange(keys, i, frames)}
                frames={frames}
                fps={fps}
                width={width}
                band={band}
                row={rows[i] ?? 0}
                problem={problems[i] != null}
                selected={editing?.kind === 'key' && editing.id === key.id}
                onTap={() => onOpen({ kind: 'key', id: key.id })}
                onCommit={(f) => onMove(key.id, f)}
              />
            ))}
          </>
        )}
      </View>
      <View style={styles.ruler}>
        {ticks.map((s) => (
          <View key={s} style={[styles.tick, { left: x(s * fps) }]}>
            <View style={styles.tickMark} />
            <Text style={styles.tickLabel}>{`${s}s`}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function EndPin({
  left,
  band,
  problem,
  selected,
  label,
  onPress,
}: {
  left: number;
  band: number;
  problem: boolean;
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const color = problem ? signature.danger : selected ? signature.accent : signature.text;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pin, { left: left - PIN_HIT / 2, height: band + TRACK_H }]}
      accessibilityRole="button"
      accessibilityLabel={t('keyframes.edit', { name: label })}
    >
      <View style={[styles.endBar, { top: band - 2, backgroundColor: color }]} />
    </Pressable>
  );
}

function KeyPin({
  number,
  frame,
  range,
  frames,
  fps,
  width,
  band,
  row,
  problem,
  selected,
  onTap,
  onCommit,
}: {
  number: number;
  frame: number;
  range: { min: number; max: number };
  frames: number;
  fps: number;
  width: number;
  band: number;
  row: number;
  problem: boolean;
  selected: boolean;
  onTap: () => void;
  onCommit: (frame: number) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const [drag, setDrag] = useState<number | null>(null);
  // The gesture is built once: it reads the latest props through this ref.
  const live = useRef({ frame, range, frames, width, onTap, onCommit });
  live.current = { frame, range, frames, width, onTap, onCommit };
  const start = useRef(frame);
  const dragged = useRef<number | null>(null);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onStart(() => {
        const { frame: f, range: r } = live.current;
        // A pin past the end starts from where it is drawn, the edge.
        start.current = Math.min(r.max, Math.max(r.min, f));
        dragged.current = start.current;
        setDrag(start.current);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      })
      .onUpdate((e) => {
        const { frames: n, width: w, range: r } = live.current;
        const perPoint = (n - 1) / Math.max(1, w);
        const next = Math.min(r.max, Math.max(r.min, Math.round(start.current + e.translationX * perPoint)));
        if (next === dragged.current) return;
        dragged.current = next;
        // A detent on every latent frame (8 pixel frames) and at the limits.
        if (next % 8 === 0 || next === r.min || next === r.max) {
          Haptics.selectionAsync().catch(() => {});
        }
        setDrag(next);
      })
      .onFinalize(() => {
        const landed = dragged.current;
        dragged.current = null;
        if (landed != null && landed !== live.current.frame) live.current.onCommit(landed);
        setDrag(null);
      });
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((_e, success) => {
        if (success) live.current.onTap();
      });
    // Race: a still finger is a tap at once, a moving one becomes a drag.
    return Gesture.Race(pan, tap);
  }, []);

  const shown = drag ?? frame;
  const left = Math.min(1, Math.max(0, shown / Math.max(1, frames - 1))) * width;
  const active = selected || drag != null;
  const color = problem ? signature.danger : active ? signature.accent : signature.text;
  // Keep the bubble inside the track's width.
  const half = BUBBLE_W / 2;
  const shift = left < half ? half - left : left > width - half ? width - half - left : 0;

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[styles.pin, { left: left - PIN_HIT / 2, height: band + TRACK_H, zIndex: active ? 3 : 2 }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${t('keyframes.key', { n: number })}, ${t('keyframes.frameN', { frame })}`}
        accessibilityHint={t('keyframes.drag')}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
        onAccessibilityAction={(e) => {
          const action = e.nativeEvent.actionName;
          if (action === 'activate') {
            onTap();
            return;
          }
          const next = Math.min(range.max, Math.max(range.min, frame + (action === 'increment' ? 1 : -1)));
          if (next !== frame) onCommit(next);
        }}
      >
        <View
          style={[
            styles.pinLine,
            { top: row * BADGE_H + BADGE_H - 4, backgroundColor: color },
          ]}
        />
        <View
          style={[
            styles.badge,
            { top: row * BADGE_H },
            active && { backgroundColor: signature.accent, borderColor: signature.accent },
            problem && { backgroundColor: signature.dangerFill, borderColor: signature.danger },
          ]}
        >
          <Text style={[styles.badgeText, active && !problem && { color: signature.bg }]}>
            {number}
          </Text>
        </View>
        {drag != null && (
          <View
            style={[styles.bubble, { left: PIN_HIT / 2 - half + shift, width: BUBBLE_W }]}
            pointerEvents="none"
          >
            <Text style={styles.bubbleText}>{frameLabel(drag, fps)}</Text>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

// --------------------------------------------------------------------------
// Storyboard
// --------------------------------------------------------------------------

function Card({
  client,
  image,
  title,
  meta,
  aspect,
  strength,
  selected,
  problem,
  approximate,
  onPress,
  onAspect,
}: {
  client: ComfyClient;
  image: string;
  title: string;
  meta: string;
  aspect: number;
  strength: number;
  selected: boolean;
  problem: boolean;
  approximate?: boolean;
  onPress: () => void;
  onAspect?: (aspect: number) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const label = [
    t('keyframes.edit', { name: title }),
    meta,
    image === '' ? t('keyframes.pickImage') : '',
    approximate ? t('keyframes.approximate') : '',
    problem ? t('keyframes.needsFix') : '',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        style={[
          styles.cardImage,
          { height: cardHeight(aspect) },
          selected && styles.cardSelected,
          problem && styles.cardProblem,
        ]}
      >
        {image ? (
          <Image
            source={{ uri: previewUrl(client, image) }}
            style={styles.fill}
            contentFit="cover"
            cachePolicy="disk"
            recyclingKey={image}
            transition={120}
            onLoad={(e) => onAspect?.(e.source.width / e.source.height)}
          />
        ) : (
          <View style={styles.cardEmpty}>
            <Ionicons name="image-outline" size={20} color={signature.accent} />
            <Text style={styles.cardEmptyText}>{t('keyframes.pickImage')}</Text>
          </View>
        )}
        {approximate && (
          <View style={styles.cardBadgeLeft}>
            <Text style={styles.cardBadgeText}>≈</Text>
          </View>
        )}
        {image !== '' && strength < 1 && (
          <View style={styles.cardBadgeRight}>
            <Text style={styles.cardBadgeText}>{strength.toFixed(2)}</Text>
          </View>
        )}
      </View>
      <Text style={styles.cardTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.cardMeta} numberOfLines={1}>
        {meta}
      </Text>
    </Pressable>
  );
}

/** The stretch between two images: a link with its prompt state. */
function Stretch({
  height,
  prompt,
  name,
  onPress,
}: {
  height: number;
  prompt: string;
  name: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation();
  const filled = prompt.trim() !== '';
  return (
    <Pressable
      onPress={onPress}
      style={[styles.stretch, { height }]}
      accessibilityRole="button"
      accessibilityLabel={t('keyframes.stretchA11y', { name })}
      accessibilityValue={filled ? { text: prompt } : undefined}
    >
      <View style={[styles.stretchLine, { top: height / 2 }]} />
      <View style={[styles.stretchDot, filled && styles.stretchDotFilled]}>
        <Ionicons
          name={filled ? 'chatbubble' : 'chatbubble-outline'}
          size={12}
          color={filled ? signature.bg : signature.textMuted}
        />
      </View>
    </Pressable>
  );
}

// --------------------------------------------------------------------------
// Edit sheet
// --------------------------------------------------------------------------

function KeyframeSheet({
  target,
  focusPrompt,
  client,
  source,
  sourceInfo,
  frames,
  fps,
  aspect,
  keys,
  problems,
  approx,
  busy,
  first,
  last,
  opening,
  onClose,
  onReplace,
  onClearEnd,
  onEndStrength,
  onOpening,
  onKey,
  onRematch,
  onRemove,
  gallery,
}: {
  target: Target | null;
  focusPrompt: boolean;
  client: ComfyClient;
  source: string | null;
  sourceInfo: VideoInfo | null;
  frames: number | null;
  fps: number;
  aspect: number;
  keys: KeyframeValue[];
  problems: (KeyProblem | null)[];
  approx: Set<string>;
  busy: boolean;
  first: { image: string; strength: number };
  last: { image: string; strength: number };
  opening: string;
  onClose: () => void;
  onReplace: (target: Target) => void;
  onClearEnd: (kind: 'first' | 'last') => void;
  onEndStrength: (kind: 'first' | 'last', strength: number) => void;
  onOpening: (text: string) => void;
  onKey: (id: string, patch: Partial<KeyframeValue>) => void;
  onRematch: (id: string) => void;
  onRemove: (id: string) => void;
  gallery: ReactNode;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => setShowOriginal(false), [target]);

  // While the sheet slides out, keep showing what it showed: the target, and
  // the keyframe itself when it was just removed.
  const lastTarget = useRef<Target | null>(null);
  const lastKey = useRef<KeyframeValue | null>(null);
  if (target) lastTarget.current = target;
  const shown = target ?? lastTarget.current;
  if (!shown) return null;
  const index = shown.kind === 'key' ? keys.findIndex((k) => k.id === shown.id) : -1;
  if (index >= 0) lastKey.current = keys[index];
  const key = shown.kind === 'key' ? (index >= 0 ? keys[index] : target ? null : lastKey.current) : null;
  if (shown.kind === 'key' && !key) return null;

  const end = shown.kind === 'first' ? first : shown.kind === 'last' ? last : null;
  const image = key ? key.image : end!.image;
  const strength = key ? key.strength : end!.strength;
  const frame = key ? key.frame : shown.kind === 'first' ? 0 : frames != null ? frames - 1 : null;
  const number = index >= 0 ? index + 1 : 0;
  const title =
    shown.kind === 'key'
      ? t('keyframes.key', { n: number })
      : t(shown.kind === 'first' ? 'keyframes.first' : 'keyframes.last');
  const hasFps = Number.isFinite(fps) && fps > 0;
  const range = key && index >= 0 && frames != null ? moveRange(keys, index, frames) : null;
  const problem = index >= 0 ? problems[index] : null;

  // The original frame at this position, decoded by the server.
  const sourceFrame =
    source && sourceInfo?.fps && frame != null && frames != null
      ? Math.min(sourceInfo.frames - 1, mapFrame(frame, frames, sourceInfo.frames))
      : null;
  const originalUrl =
    sourceFrame != null && source && sourceInfo?.fps
      ? client.frameUrl(source, (sourceFrame + 0.5) / sourceInfo.fps, sourceInfo.mtime)
      : null;

  const step = (delta: number) => {
    if (!key || !range) return;
    // A keyframe outside its range (the clip got shorter) snaps back in.
    const next = Math.min(range.max, Math.max(range.min, key.frame + delta));
    if (next !== key.frame) {
      onKey(key.id, { frame: next });
      Haptics.selectionAsync().catch(() => {});
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  };

  const setStrength = (raw: number) => {
    const s = Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
    if (key) onKey(key.id, { strength: s });
    else if (shown.kind !== 'key') onEndStrength(shown.kind, s);
    Haptics.selectionAsync().catch(() => {});
  };

  // No stretch after the last image; none from the first one without
  // keyframes (it would be the whole clip, the main prompt's job).
  const prompt =
    shown.kind === 'last' || (shown.kind === 'first' && keys.length === 0)
      ? null
      : key
        ? key.prompt
        : opening;

  return (
    <Modal visible={target != null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        <View
          style={[
            styles.sheet,
            styles.sheetShrink,
            {
              maxHeight: windowHeight - insets.top - spacing.md,
              paddingBottom: insets.bottom + spacing.sm,
            },
          ]}
        >
          <View style={styles.grab} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitles}>
              <Text style={styles.sheetTitle} accessibilityRole="header">
                {title}
              </Text>
              {frame != null && (
                <Text style={styles.sheetMeta}>
                  {hasFps
                    ? t('keyframes.frameAt', { frame, time: frameSeconds(frame, fps) })
                    : t('keyframes.frameN', { frame })}
                </Text>
              )}
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              <Text style={styles.doneText}>{t('common.done')}</Text>
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <View
              style={[
                styles.preview,
                {
                  aspectRatio: Math.min(2.4, Math.max(0.42, aspect)),
                  maxHeight: windowHeight * 0.35,
                },
              ]}
            >
              {showOriginal && originalUrl ? (
                <Image source={{ uri: originalUrl }} style={styles.fill} contentFit="contain" transition={120} />
              ) : image ? (
                // recyclingKey: moving from one image to the next clears the
                // view instead of showing the previous picture until the new
                // one arrives.
                <Image
                  source={{ uri: previewUrl(client, image) }}
                  style={styles.fill}
                  contentFit="contain"
                  recyclingKey={image}
                  transition={120}
                />
              ) : (
                <Pressable
                  style={styles.previewEmpty}
                  onPress={() => onReplace(shown)}
                  accessibilityRole="button"
                >
                  <Ionicons name="image-outline" size={28} color={signature.accent} />
                  <Text style={styles.previewEmptyText}>{t('keyframes.pickImage')}</Text>
                </Pressable>
              )}
              {busy && (
                <View style={styles.previewBusy} pointerEvents="none">
                  <ActivityIndicator color={signature.accent} />
                </View>
              )}
            </View>

            {originalUrl && image !== '' && (
              <View style={styles.segment}>
                {[false, true].map((original) => (
                  <Pressable
                    key={String(original)}
                    onPress={() => setShowOriginal(original)}
                    style={[styles.segmentItem, showOriginal === original && styles.segmentOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: showOriginal === original }}
                  >
                    <Text style={[styles.segmentText, showOriginal === original && styles.segmentTextOn]}>
                      {t(original ? 'keyframes.original' : 'keyframes.picture')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {key && approx.has(key.id) && (
              <Text style={styles.note}>{t('keyframes.approximateHint')}</Text>
            )}
            {problem && key && (
              <Text style={styles.problem}>
                {t(`keyframes.problem.${problem}`, {
                  n: number,
                  frame: key.frame,
                  last: frames != null ? frames - 1 : '',
                })}
              </Text>
            )}

            <View style={styles.actionsRow}>
              <SheetButton
                icon="swap-horizontal"
                label={t('keyframes.replace')}
                onPress={() => onReplace(shown)}
                busy={busy}
              />
              {key && source && (
                <SheetButton
                  icon="locate-outline"
                  label={t('keyframes.rematch')}
                  onPress={() => onRematch(key.id)}
                  busy={busy}
                />
              )}
            </View>

            {key && range && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{t('keyframes.position')}</Text>
                <View style={styles.stepper}>
                  {[-8, -1].map((d) => (
                    <StepButton key={d} label={String(d)} onPress={() => step(d)} />
                  ))}
                  <View style={styles.stepValue}>
                    <Text style={styles.stepFrame}>{key.frame}</Text>
                    {hasFps && <Text style={styles.stepTime}>{frameSeconds(key.frame, fps)}</Text>}
                  </View>
                  {[1, 8].map((d) => (
                    <StepButton key={d} label={`+${d}`} onPress={() => step(d)} />
                  ))}
                </View>
              </View>
            )}

            {image !== '' && (
              <View style={styles.section}>
                <View style={styles.strengthHead}>
                  <Text style={[styles.sectionLabel, styles.grow]}>{t('keyframes.strength')}</Text>
                  <StepButton label="−" onPress={() => setStrength(strength - 0.05)} />
                  <Text style={styles.strengthValue}>{strength.toFixed(2)}</Text>
                  <StepButton label="+" onPress={() => setStrength(strength + 0.05)} />
                </View>
                <View style={styles.segment}>
                  {STRENGTH_STEPS.map((s) => {
                    const on = Math.abs(strength - s) < 0.001;
                    return (
                      <Pressable
                        key={s}
                        onPress={() => setStrength(s)}
                        style={[styles.segmentItem, on && styles.segmentOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.segmentMono, on && styles.segmentTextOn]}>{s.toFixed(2)}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.hint}>{t('keyframes.strengthHint')}</Text>
              </View>
            )}

            {prompt != null && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{t('keyframes.stretch')}</Text>
                <TextInput
                  style={styles.promptInput}
                  value={prompt}
                  onChangeText={(text) => (key ? onKey(key.id, { prompt: text }) : onOpening(text))}
                  onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300)}
                  placeholder={t('keyframes.stretchPlaceholder')}
                  placeholderTextColor={colors.textDisabled}
                  multiline
                  autoFocus={focusPrompt}
                  textAlignVertical="top"
                />
                <Text style={styles.hint}>{t('keyframes.stretchHint')}</Text>
              </View>
            )}

            {key ? (
              <Pressable
                onPress={() => onRemove(key.id)}
                style={({ pressed }) => [styles.removeBtn, pressed && { backgroundColor: colors.dangerSoft }]}
                accessibilityRole="button"
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
                <Text style={styles.removeText}>{t('keyframes.removeKey')}</Text>
              </Pressable>
            ) : (
              image !== '' &&
              shown.kind !== 'key' && (
                <Pressable
                  onPress={() => onClearEnd(shown.kind)}
                  style={({ pressed }) => [styles.removeBtn, pressed && { backgroundColor: colors.dangerSoft }]}
                  accessibilityRole="button"
                >
                  <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
                  <Text style={styles.removeText}>{t('keyframes.clearImage')}</Text>
                </Pressable>
              )
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      {gallery}
    </Modal>
  );
}

function SheetButton({
  icon,
  label,
  onPress,
  busy,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.sheetBtn,
        pressed && { backgroundColor: colors.surfacePressed },
        busy && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Ionicons name={icon} size={18} color={colors.accent} />
      )}
      <Text style={styles.sheetBtnText}>{label}</Text>
    </Pressable>
  );
}

function StepButton({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.stepBtn, pressed && { backgroundColor: colors.surfacePressed }]}
      accessibilityRole="button"
    >
      <Text style={styles.stepBtnText}>{label}</Text>
    </Pressable>
  );
}

// --------------------------------------------------------------------------
// Styles
// --------------------------------------------------------------------------

const useStyles = makeStyles((colors) => ({
  wrap: {
    gap: spacing.sm,
  },
  // The signature slab: charcoal and dot grid in both themes, like the
  // launch bar and the mini player. Everything on it uses `signature`.
  slab: {
    backgroundColor: signature.bg,
    borderColor: signature.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sourceEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexBasis: '100%',
    minHeight: MIN_TOUCH_TARGET,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: signature.chipBorder,
  },
  sourceChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: signature.chip,
    borderWidth: 1,
    borderColor: signature.chipBorder,
  },
  sourceTexts: {
    flex: 1,
    gap: 2,
  },
  sourceAdd: {
    color: signature.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  sourceHint: {
    color: signature.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  sourceName: {
    color: signature.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  sourceMeta: {
    color: signature.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  clipInfo: {
    flexBasis: '100%',
    color: signature.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  iconBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mismatch: {
    marginHorizontal: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: signature.warningFill,
  },
  mismatchText: {
    flex: 1,
    minWidth: 180,
    color: signature.warningText,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  mismatchBtn: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: signature.warningText,
  },
  mismatchBtnText: {
    color: signature.warningText,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
  },
  noDuration: {
    paddingHorizontal: spacing.md,
    color: signature.warningText,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  // Track: the pins hang over it, their badges in the band above.
  trackBlock: {
    paddingHorizontal: spacing.md + PIN_HIT / 2,
  },
  trackArea: {
    position: 'relative',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: TRACK_H,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: signature.track,
  },
  filmstrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    opacity: 0.75,
  },
  pin: {
    position: 'absolute',
    top: 0,
    width: PIN_HIT,
    alignItems: 'center',
  },
  endBar: {
    position: 'absolute',
    width: 4,
    height: TRACK_H + 4,
    borderRadius: 2,
  },
  badge: {
    position: 'absolute',
    minWidth: 18,
    height: BADGE_H - 4,
    paddingHorizontal: 4,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: signature.chip,
    borderWidth: 1,
    borderColor: signature.chipBorder,
  },
  badgeText: {
    color: signature.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
    lineHeight: BADGE_H - 6,
  },
  pinLine: {
    position: 'absolute',
    bottom: 0,
    width: 2,
    borderRadius: 1,
  },
  bubble: {
    position: 'absolute',
    top: -30,
    alignItems: 'center',
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: signature.accent,
  },
  bubbleText: {
    color: signature.bg,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  ruler: {
    height: 18,
    marginTop: 4,
  },
  tick: {
    position: 'absolute',
    top: 0,
    alignItems: 'flex-start',
  },
  tickMark: {
    width: 1,
    height: 5,
    backgroundColor: signature.textMuted,
  },
  tickLabel: {
    marginTop: 1,
    marginLeft: -2,
    color: signature.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  // Storyboard
  board: {
    paddingHorizontal: spacing.md,
    alignItems: 'flex-start',
  },
  boardItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  card: {
    width: CARD_W,
    gap: 2,
  },
  cardImage: {
    width: CARD_W,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: signature.chip,
    borderWidth: 1,
    borderColor: signature.chipBorder,
    marginBottom: 4,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: signature.accent,
  },
  cardProblem: {
    borderWidth: 2,
    borderColor: signature.danger,
  },
  cardEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 4,
  },
  cardEmptyText: {
    color: signature.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
    textAlign: 'center',
  },
  cardBadgeLeft: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 5,
    borderRadius: 4,
    backgroundColor: signature.warningFill,
  },
  cardBadgeRight: {
    position: 'absolute',
    top: 4,
    right: 4,
    paddingHorizontal: 4,
    borderRadius: 4,
    backgroundColor: signature.bg,
  },
  cardBadgeText: {
    color: signature.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  cardTitle: {
    color: signature.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.xs,
  },
  cardMeta: {
    color: signature.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  stretch: {
    width: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stretchLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: signature.chipBorder,
  },
  stretchDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: signature.bg,
    borderWidth: 1,
    borderColor: signature.chipBorder,
  },
  stretchDotFilled: {
    backgroundColor: signature.accent,
    borderColor: signature.accent,
  },
  addBtn: {
    marginHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: signature.chipBorder,
    backgroundColor: signature.chip,
  },
  addText: {
    color: signature.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  addCount: {
    color: signature.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  error: {
    color: colors.danger,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  grow: {
    flex: 1,
  },
  // Sheets (themed, like the app's other sheets)
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing.sm,
  },
  // With the keyboard up the scrim gives way first, then the sheet shrinks
  // and its content scrolls.
  sheetShrink: {
    flexShrink: 1,
  },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  sheetTitles: {
    flex: 1,
    gap: 2,
  },
  sheetTitle: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.lg,
  },
  sheetMeta: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  doneBtn: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.strong,
  },
  doneText: {
    color: colors.onStrong,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  sheetScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  preview: {
    width: '100%',
    alignSelf: 'center',
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: signature.bg,
  },
  previewEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  previewEmptyText: {
    color: signature.accent,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  previewBusy: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  segment: {
    flexDirection: 'row',
    padding: 3,
    gap: 3,
    borderRadius: radii.md,
    backgroundColor: colors.field,
  },
  segmentItem: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET - 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  segmentOn: {
    backgroundColor: colors.surface,
  },
  segmentText: {
    color: colors.textMuted,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  segmentMono: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  segmentTextOn: {
    color: colors.text,
  },
  note: {
    color: colors.warning,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  problem: {
    color: colors.danger,
    fontFamily: typography.ui,
    fontSize: typography.sizes.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sheetBtn: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sheetBtnText: {
    color: colors.text,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.text,
    fontFamily: typography.uiSemiBold,
    fontSize: typography.sizes.sm,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBtn: {
    minWidth: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stepBtnText: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.sm,
  },
  stepValue: {
    flex: 1,
    alignItems: 'center',
  },
  stepFrame: {
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xl,
  },
  stepTime: {
    color: colors.textMuted,
    fontFamily: typography.mono,
    fontSize: typography.sizes.xs,
  },
  strengthHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  strengthValue: {
    minWidth: 44,
    textAlign: 'center',
    color: colors.text,
    fontFamily: typography.mono,
    fontSize: typography.sizes.md,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.ui,
    fontSize: typography.sizes.xs,
  },
  promptInput: {
    minHeight: 88,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.field,
    color: colors.text,
    fontFamily: typography.ui,
    fontSize: typography.sizes.md,
  },
  removeBtn: {
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
  },
  removeText: {
    color: colors.danger,
    fontFamily: typography.uiMedium,
    fontSize: typography.sizes.sm,
  },
}));
