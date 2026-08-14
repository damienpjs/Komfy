/**
 * Minimal PNG encoder, pure JS — no native module, no zlib dependency.
 *
 * Komfy ships as a JS-only Expo Go bundle (README §Publishing), so the
 * usual canvas snapshot libraries (Skia, view-shot) are out of reach: the
 * hand-drawn inpaint mask has to be turned into a PNG here, in JS.
 *
 * Compression is skipped entirely — the deflate stream is written as
 * *stored* (uncompressed) blocks, which is a valid zlib stream every PNG
 * decoder accepts. A 1024×1024 grayscale mask lands around 1 MB, encoded in
 * a few milliseconds; the masks are small and short-lived (uploaded to
 * ComfyUI's input folder), so the size trade is worth the zero-dependency.
 *
 * Two color types are emitted, both 8-bit:
 *  - 1 channel (grayscale, PNG color type 0) — what gets uploaded and read
 *    back by LoadImageMask on the `red` channel;
 *  - 2 channels (gray + alpha, color type 4) — the on-screen overlay, where
 *    alpha carries the mask so unmasked pixels stay fully transparent.
 */

/** CRC-32 (IEEE) table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Adler-32 over the uncompressed data (zlib trailer). Chunked at 5552 bytes
 * — the largest run that cannot overflow the accumulators — so the modulo
 * is paid once per chunk instead of once per byte.
 */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  let i = 0;
  while (i < bytes.length) {
    const end = Math.min(i + 5552, bytes.length);
    for (; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return (((b << 16) | a) >>> 0) as number;
}

/** Largest payload a single stored deflate block can carry. */
const MAX_STORED_BLOCK = 65535;

/** Wraps raw bytes in a zlib stream made only of stored (BTYPE=00) blocks. */
function deflateStored(raw: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(raw.length / MAX_STORED_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let p = 0;
  // zlib header: CM=8 (deflate), CINFO=7 (32K window), FCHECK making the
  // 16-bit value a multiple of 31.
  out[p++] = 0x78;
  out[p++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const start = i * MAX_STORED_BLOCK;
    const len = Math.min(MAX_STORED_BLOCK, raw.length - start);
    // 3-bit block header (BFINAL + BTYPE=00); the 5 padding bits that round
    // it up to a byte are exactly what a stored block requires.
    out[p++] = i === blocks - 1 ? 1 : 0;
    out[p++] = len & 0xff;
    out[p++] = (len >>> 8) & 0xff;
    out[p++] = ~len & 0xff;
    out[p++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(start, start + len), p);
    p += len;
  }
  const sum = adler32(raw);
  out[p++] = (sum >>> 24) & 0xff;
  out[p++] = (sum >>> 16) & 0xff;
  out[p++] = (sum >>> 8) & 0xff;
  out[p++] = sum & 0xff;
  return out;
}

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64, written by hand: React Native guarantees neither `btoa` nor
 * `Buffer`. Chunked so the intermediate strings stay short instead of
 * growing one rope per 3 bytes.
 */
export function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let chunk = '';
  const remainder = bytes.length % 3;
  const main = bytes.length - remainder;
  for (let i = 0; i < main; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    chunk +=
      B64_ALPHABET[(v >>> 18) & 63] +
      B64_ALPHABET[(v >>> 12) & 63] +
      B64_ALPHABET[(v >>> 6) & 63] +
      B64_ALPHABET[v & 63];
    if (chunk.length >= 8192) {
      chunks.push(chunk);
      chunk = '';
    }
  }
  if (remainder === 1) {
    const v = bytes[main];
    chunk += `${B64_ALPHABET[v >>> 2]}${B64_ALPHABET[(v << 4) & 63]}==`;
  } else if (remainder === 2) {
    const v = (bytes[main] << 8) | bytes[main + 1];
    chunk +=
      `${B64_ALPHABET[v >>> 10]}${B64_ALPHABET[(v >>> 4) & 63]}` +
      `${B64_ALPHABET[(v << 2) & 63]}=`;
  }
  chunks.push(chunk);
  return chunks.join('');
}

function writeU32BE(out: Uint8Array, p: number, value: number): void {
  out[p] = (value >>> 24) & 0xff;
  out[p + 1] = (value >>> 16) & 0xff;
  out[p + 2] = (value >>> 8) & 0xff;
  out[p + 3] = value & 0xff;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG color type for a given channel count (8-bit samples). */
const COLOR_TYPE = { 1: 0, 2: 4 } as const;

/**
 * Encodes 8-bit samples as a PNG and returns it base64-encoded (ready for
 * a `data:` URI or a file write).
 *
 * `samples` is row-major, `channels` values per pixel, and must hold
 * exactly `width * height * channels` bytes.
 */
export function encodePng(
  samples: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 2,
): string {
  const expected = width * height * channels;
  if (samples.length !== expected) {
    throw new Error(
      `encodePng: expected ${expected} samples for ${width}×${height}×${channels}, got ${samples.length}`,
    );
  }

  // Scanlines, each prefixed with its filter byte (0 = None: the mask is
  // mostly flat runs, and filtering would only help a compressor we don't run).
  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 0;
    raw.set(samples.subarray(y * stride, (y + 1) * stride), dst + 1);
  }
  const zlib = deflateStored(raw);

  const size = 8 + (12 + 13) + (12 + zlib.length) + 12;
  const png = new Uint8Array(size);
  let p = 0;
  png.set(PNG_SIGNATURE, p);
  p += 8;

  const chunk = (type: string, length: number, fill: (at: number) => void) => {
    writeU32BE(png, p, length);
    p += 4;
    const typeStart = p;
    for (let i = 0; i < 4; i++) png[p++] = type.charCodeAt(i);
    fill(p);
    p += length;
    writeU32BE(png, p, crc32(png, typeStart, p));
    p += 4;
  };

  chunk('IHDR', 13, (at) => {
    writeU32BE(png, at, width);
    writeU32BE(png, at + 4, height);
    png[at + 8] = 8; // bit depth
    png[at + 9] = COLOR_TYPE[channels];
    png[at + 10] = 0; // compression: deflate
    png[at + 11] = 0; // filter method: adaptive
    png[at + 12] = 0; // interlace: none
  });
  chunk('IDAT', zlib.length, (at) => png.set(zlib, at));
  chunk('IEND', 0, () => {});

  return toBase64(png);
}
