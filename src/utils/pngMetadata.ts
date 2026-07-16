/**
 * Minimal PNG parser: extracts the text chunks (tEXt, uncompressed iTXt)
 * without a native dependency. ComfyUI writes the API graph into the
 * `prompt` tEXt chunk (ASCII JSON — ensure_ascii), placed before IDAT: we
 * stop at the image data. See docs/api-notes.md §PNG metadata.
 *
 * ⚠️ No DataView: under Hermes, the arrayBuffer() returned by fetch can
 * fail the DataView constructor's brand check ("buffer must be an
 * ArrayBuffer"). Integers are read directly from the bytes.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Normalise ArrayBuffer / TypedArray / array-like en Uint8Array. */
function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(data);
}

/** Chunked latin-1 decoding (String.fromCharCode has an argument limit). */
function latin1(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  }
  return parts.join('');
}

/** Chunks texte du PNG, par keyword (ex. 'prompt', 'workflow'). */
export function parsePngText(
  data: ArrayBuffer | Uint8Array,
): Record<string, string> {
  const bytes = toBytes(data);
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new Error('Not a PNG file');
  }

  const readUint32 = (pos: number) =>
    ((bytes[pos] << 24) |
      (bytes[pos + 1] << 16) |
      (bytes[pos + 2] << 8) |
      bytes[pos + 3]) >>>
    0;

  const chunks: Record<string, string> = {};
  let pos = 8;

  while (pos + 8 <= bytes.length) {
    const length = readUint32(pos);
    const type = latin1(bytes.subarray(pos + 4, pos + 8));
    if (type === 'IDAT' || type === 'IEND') break;

    const chunkData = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === 'tEXt') {
      const nul = chunkData.indexOf(0);
      if (nul > 0) {
        chunks[latin1(chunkData.subarray(0, nul))] = latin1(
          chunkData.subarray(nul + 1),
        );
      }
    } else if (type === 'iTXt') {
      // keyword\0 compflag compmethod langtag\0 translated\0 texte(utf8)
      const nul = chunkData.indexOf(0);
      if (nul > 0 && chunkData[nul + 1] === 0) {
        let p = nul + 3;
        p = chunkData.indexOf(0, p) + 1; // fin langtag
        p = chunkData.indexOf(0, p) + 1; // fin translated keyword
        if (p > 0) {
          chunks[latin1(chunkData.subarray(0, nul))] = latin1(
            chunkData.subarray(p),
          );
        }
      }
    }
    pos += 12 + length; // length + type + data + crc
  }

  return chunks;
}
