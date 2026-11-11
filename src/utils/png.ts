/**
 * Minimal PNG encoder, pure JS: no native module, no zlib dependency.
 *
 * Komfy ships as a JS-only Expo Go bundle (README §Publishing), so the
 * usual canvas snapshot libraries (Skia, view-shot) are out of reach: the
 * hand-drawn inpaint mask has to be turned into a PNG here, in JS.
 *
 * Compression is deliberately narrow: a single fixed-Huffman deflate block
 * whose only back-references are byte runs (distance 1). That is a valid
 * zlib stream every decoder accepts, and it is exactly the redundancy a
 * mask has: long flat runs of 0 and 255 with a short feathered ramp between
 * them. A 1024×768 mask goes from 769 KB (stored blocks) to a few tens of
 * KB, which is what crosses Tailscale on a phone connection. Rows are left
 * unfiltered (filter 0): a blank row is then one more run of zeros that
 * merges with its neighbours, which beats the Up filter on this content.
 *
 * Two formats are emitted, both one byte per pixel:
 *  - `gray` (color type 0): what gets uploaded and read back by
 *    LoadImageMask on the `red` channel;
 *  - `alpha` (color type 3): the on-screen overlay. A 256-entry palette of
 *    one colour whose tRNS alpha equals the index, so the sample *is* the
 *    alpha: unmasked pixels are fully transparent, the rest is the brush
 *    colour. Half the bytes of a gray+alpha image, for the same picture.
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
 * (the largest run that cannot overflow the accumulators), so the modulo
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
  return ((b << 16) | a) >>> 0;
}

/** Reverses the low `length` bits of `code` (Huffman codes go MSB first). */
function reverseBits(code: number, length: number): number {
  let out = 0;
  for (let i = 0; i < length; i++) {
    out = (out << 1) | ((code >>> i) & 1);
  }
  return out;
}

/**
 * Fixed literal/length code (RFC 1951 §3.2.6), stored bit-reversed so it
 * can be written LSB first like every other field of the stream.
 */
const LITLEN_CODE = new Uint16Array(288);
const LITLEN_BITS = new Uint8Array(288);
for (let sym = 0; sym < 288; sym++) {
  let code: number;
  let bits: number;
  if (sym < 144) {
    code = 0x30 + sym;
    bits = 8;
  } else if (sym < 256) {
    code = 0x190 + (sym - 144);
    bits = 9;
  } else if (sym < 280) {
    code = sym - 256;
    bits = 7;
  } else {
    code = 0xc0 + (sym - 280);
    bits = 8;
  }
  LITLEN_CODE[sym] = reverseBits(code, bits);
  LITLEN_BITS[sym] = bits;
}

/** Shortest and longest match deflate can express. */
const MIN_MATCH = 3;
const MAX_MATCH = 258;

/** Match length → length symbol, extra-bit count and extra-bit value. */
const LENGTH_SYM = new Uint16Array(MAX_MATCH + 1);
const LENGTH_EXTRA_BITS = new Uint8Array(MAX_MATCH + 1);
const LENGTH_EXTRA = new Uint8Array(MAX_MATCH + 1);
{
  const base = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
    67, 83, 99, 115, 131, 163, 195, 227, 258,
  ];
  const extra = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0,
  ];
  for (let s = 0; s < base.length; s++) {
    // 258 has its own code (285), although 284's extra bits could reach it.
    const last =
      s === base.length - 1
        ? MAX_MATCH
        : Math.min(base[s] + (1 << extra[s]) - 1, MAX_MATCH - 1);
    for (let len = base[s]; len <= last; len++) {
      LENGTH_SYM[len] = 257 + s;
      LENGTH_EXTRA_BITS[len] = extra[s];
      LENGTH_EXTRA[len] = len - base[s];
    }
  }
}

/** Distance 1 is distance code 0: five zero bits, no extra bits. */
const DISTANCE_1_BITS = 5;

/**
 * zlib stream (header, one fixed-Huffman block, Adler-32) of `raw`, where
 * every run of three or more repeats of the previous byte is a distance-1
 * back-reference and everything else a literal.
 */
function deflateRuns(raw: Uint8Array): Uint8Array {
  // Worst case: every byte a 9-bit literal, plus header, block bits, EOB
  // and trailer.
  const out = new Uint8Array(2 + Math.ceil((raw.length * 9) / 8) + 16);
  let p = 0;
  // zlib header: CM=8 (deflate), CINFO=7 (32K window), FCHECK making the
  // 16-bit value a multiple of 31.
  out[p++] = 0x78;
  out[p++] = 0x01;

  let bitBuf = 0;
  let bitCount = 0;
  const put = (value: number, bits: number) => {
    bitBuf |= value << bitCount;
    bitCount += bits;
    while (bitCount >= 8) {
      out[p++] = bitBuf & 0xff;
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  put(1, 1); // BFINAL
  put(1, 2); // BTYPE = 01, fixed Huffman

  const n = raw.length;
  let i = 0;
  while (i < n) {
    if (i > 0) {
      const v = raw[i - 1];
      const max = Math.min(MAX_MATCH, n - i);
      let len = 0;
      while (len < max && raw[i + len] === v) len++;
      if (len >= MIN_MATCH) {
        const sym = LENGTH_SYM[len];
        put(LITLEN_CODE[sym], LITLEN_BITS[sym]);
        if (LENGTH_EXTRA_BITS[len] > 0) {
          put(LENGTH_EXTRA[len], LENGTH_EXTRA_BITS[len]);
        }
        put(0, DISTANCE_1_BITS);
        i += len;
        continue;
      }
    }
    const lit = raw[i++];
    put(LITLEN_CODE[lit], LITLEN_BITS[lit]);
  }
  put(LITLEN_CODE[256], LITLEN_BITS[256]); // end of block
  if (bitCount > 0) put(0, 8 - bitCount);

  const sum = adler32(raw);
  out[p++] = (sum >>> 24) & 0xff;
  out[p++] = (sum >>> 16) & 0xff;
  out[p++] = (sum >>> 8) & 0xff;
  out[p++] = sum & 0xff;
  return out.subarray(0, p);
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

export type PngFormat = 'gray' | 'alpha';

/** Alpha = index (tRNS) for `alpha`. */
const ALPHA_RAMP = Uint8Array.from({ length: 256 }, (_, i) => i);
/** One-colour palette (PLTE) for `alpha`, rebuilt only when the colour changes. */
let palette = new Uint8Array(256 * 3).fill(255);
let paletteKey = 0xffffff;

function solidPalette([r, g, b]: [number, number, number]): Uint8Array {
  const key = (r << 16) | (g << 8) | b;
  if (key !== paletteKey) {
    palette = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      palette[i * 3] = r;
      palette[i * 3 + 1] = g;
      palette[i * 3 + 2] = b;
    }
    paletteKey = key;
  }
  return palette;
}

/**
 * Encodes one byte per pixel as a PNG and returns it base64-encoded (ready
 * for a `data:` URI or a file write).
 *
 * `samples` is row-major and must hold exactly `width * height` bytes.
 * `color` (0..255 each) is the `alpha` format's colour, white by default.
 */
export function encodePng(
  samples: Uint8Array,
  width: number,
  height: number,
  format: PngFormat,
  color: [number, number, number] = [255, 255, 255],
): string {
  const expected = width * height;
  if (samples.length !== expected) {
    throw new Error(
      `encodePng: expected ${expected} samples for ${width}×${height}, got ${samples.length}`,
    );
  }

  // Scanlines, each prefixed with its filter byte (0 = None).
  const raw = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw.set(samples.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const zlib = deflateRuns(raw);

  const plte = format === 'alpha' ? solidPalette(color) : null;
  const size =
    8 +
    (12 + 13) +
    (plte ? 12 + plte.length + 12 + ALPHA_RAMP.length : 0) +
    (12 + zlib.length) +
    12;
  const png = new Uint8Array(size);
  let p = 0;
  png.set(PNG_SIGNATURE, p);
  p += 8;

  const chunk = (type: string, data: Uint8Array) => {
    writeU32BE(png, p, data.length);
    p += 4;
    const typeStart = p;
    for (let i = 0; i < 4; i++) png[p++] = type.charCodeAt(i);
    png.set(data, p);
    p += data.length;
    writeU32BE(png, p, crc32(png, typeStart, p));
    p += 4;
  };

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = plte ? 3 : 0; // color type: indexed / grayscale
  // compression, filter method and interlace all 0.
  chunk('IHDR', ihdr);
  if (plte) {
    chunk('PLTE', plte);
    chunk('tRNS', ALPHA_RAMP);
  }
  chunk('IDAT', zlib);
  chunk('IEND', new Uint8Array(0));

  return toBase64(png);
}
