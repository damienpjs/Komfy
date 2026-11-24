"""Keyframes between the first and the last image of an LTX 2.5 render.

The `keyframes` input of KomfyLTX25MLX is a JSON object:

    {"opening": "what happens from the first image on",
     "keys": [{"image": "a.png", "frame": 48, "strength": 1.0,
               "prompt": "what happens from this keyframe on"}]}

Every key becomes one more `--image PATH FRAME STRENGTH guide` anchor (the
CLI's VideoConditionByKeyframeIndex: a keyframe at any pixel frame), so one
render passes through all of them. `frame` is a pixel frame index of the
output clip, the one the viewer's frame grabber reports, which is why a
rebuild must keep the source's duration and frame rate.

The prompts are optional. When at least one is set, each stretch of the
timeline (first image to the next keyframe, keyframe to keyframe, last
keyframe to the end) becomes one Prompt Relay segment (`--segment TEXT LEN`),
LEN in latent frames: the global prompt still applies everywhere, the local
one only to its stretch. Relay segments must tile the whole timeline and the
CLI refuses an empty one, so a stretch without a prompt gets NEUTRAL_BEAT.

Pure functions, no ComfyUI import: tested on their own.
"""

import json

# Pixel frames between two anchors. The VAE packs 8 pixel frames into one
# latent frame (frame 0 alone in the first): two anchors at least 8 frames
# apart never share a latent frame, so every stretch keeps a length >= 1.
MIN_GAP = 8
# More guides than this cost more than they hold (each adds a latent frame of
# tokens) and point to a malformed value rather than a real timeline.
MAX_KEYS = 32
# Text of a stretch left without a prompt. It must say something (an empty
# local prompt has no token to gate), and continuity is what a keyframe
# rebuild wants anyway.
NEUTRAL_BEAT = "The same continuous shot goes on, without a cut."


class Keyframe:
    __slots__ = ("image", "frame", "strength", "prompt")

    def __init__(self, image, frame, strength, prompt):
        self.image = image
        self.frame = frame
        self.strength = strength
        self.prompt = prompt


def parse(text):
    """`keyframes` input → (opening prompt, keys sorted by frame), or None
    when the input is empty. Raises ValueError on a malformed value."""
    text = (text or "").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except ValueError as e:
        raise ValueError(f"keyframes is not valid JSON: {e}") from None
    if not isinstance(data, dict):
        raise ValueError('keyframes must be a JSON object: {"opening": "...", "keys": [...]}')
    opening = data.get("opening", "")
    raw = data.get("keys", [])
    if not isinstance(opening, str) or not isinstance(raw, list):
        raise ValueError('keyframes: "opening" must be a string and "keys" a list')
    if len(raw) > MAX_KEYS:
        raise ValueError(f"keyframes: {len(raw)} keys, {MAX_KEYS} at most")
    keys = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError(f"keyframes: bad key {item!r}")
        image = item.get("image")
        frame = item.get("frame")
        strength = item.get("strength", 1.0)
        prompt = item.get("prompt", "")
        if not isinstance(image, str) or not image.strip():
            raise ValueError("keyframes: a key has no image")
        # bool is an int in Python: refuse it explicitly.
        if isinstance(frame, bool) or not isinstance(frame, int) or frame < 1:
            raise ValueError(f"keyframes: frame {frame!r} must be an integer >= 1")
        if isinstance(strength, bool) or not isinstance(strength, (int, float)) or not 0 <= strength <= 1:
            raise ValueError(f"keyframes: strength {strength!r} must be between 0 and 1")
        if not isinstance(prompt, str):
            raise ValueError("keyframes: a key's prompt must be a string")
        keys.append(Keyframe(image.strip(), frame, float(strength), prompt.strip()))
    keys.sort(key=lambda k: k.frame)
    return opening.strip(), keys


def check(keys, frames, has_last):
    """Raises ValueError, in words the app can show as is, when a key falls
    outside a clip of `frames` frames or too close to another anchor."""
    end = frames - 1
    for n, key in enumerate(keys, 1):
        if key.frame > end:
            raise ValueError(
                f"Keyframe {n} sits at frame {key.frame}, past the end of the clip "
                f"({frames} frames at this duration and frame rate)")
    anchors = [(0, "the first image")]
    anchors += [(k.frame, f"keyframe {n}") for n, k in enumerate(keys, 1)]
    if has_last:
        anchors.append((end, "the last image"))
    for (a, a_name), (b, b_name) in zip(anchors, anchors[1:]):
        if b - a < MIN_GAP:
            raise ValueError(
                f"{b_name[0].upper()}{b_name[1:]} (frame {b}) is {b - a} frame(s) after "
                f"{a_name} (frame {a}): keep at least {MIN_GAP} frames between two images")


def latent_index(frame):
    """Latent frame holding pixel frame `frame` (0 alone, then 8 per latent)."""
    return (frame + 7) // 8


def segments(opening, keys, frames):
    """Prompt Relay segments [(text, latent length)] covering the clip, or []
    when no stretch has a prompt of its own."""
    texts = [opening] + [k.prompt for k in keys]
    if not any(texts):
        return []
    total = (frames - 1) // 8 + 1
    starts = [0] + [latent_index(k.frame) for k in keys]
    ends = starts[1:] + [total]
    out = []
    for text, start, stop in zip(texts, starts, ends):
        if stop <= start:
            # check() keeps anchors MIN_GAP apart, so this is a caller bug.
            raise ValueError(f"keyframes: empty stretch at latent frame {start}")
        out.append((text or NEUTRAL_BEAT, stop - start))
    return out
