/**
 * Parser for the ComfyUI WebSocket binary preview frames
 * (preview of the running sampler — KSampler, detailers…).
 * Formats (verified in server.py / comfy_execution/progress.py 0.27):
 *  - event 1 (PREVIEW_IMAGE)              : [4o event][4o format 1=JPEG 2=PNG][image]
 *  - event 4 (PREVIEW_IMAGE_WITH_METADATA): [4B event][4B len][JSON meta][image]
 *    (sent when the client declares the `supports_preview_metadata` flag)
 * No DataView (Hermes trap): bytes are read directly.
 */

export interface WsPreview {
  /** data URI affichable telle quelle par expo-image. */
  dataUri: string;
  nodeId?: string;
  displayNodeId?: string;
  promptId?: string;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    parts.push(
      B64[a >> 2],
      B64[((a & 3) << 4) | (b >> 4)],
      i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=',
      i + 2 < bytes.length ? B64[c & 63] : '=',
    );
  }
  return parts.join('');
}

function utf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  // Fallback: the metadata JSON is ASCII (node/prompt ids).
  let out = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    out += String.fromCharCode(...bytes.subarray(i, i + 4096));
  }
  return out;
}

function toBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return new Uint8Array(data);
}

export function parsePreviewFrame(
  data: ArrayBuffer | Uint8Array,
): WsPreview | null {
  const bytes = toBytes(data);
  if (bytes.length < 8) return null;
  const readU32 = (pos: number) =>
    ((bytes[pos] << 24) |
      (bytes[pos + 1] << 16) |
      (bytes[pos + 2] << 8) |
      bytes[pos + 3]) >>>
    0;

  const event = readU32(0);

  if (event === 1) {
    // PREVIEW_IMAGE : format + image brute.
    const mime = readU32(4) === 2 ? 'image/png' : 'image/jpeg';
    const image = bytes.subarray(8);
    if (image.length === 0) return null;
    return { dataUri: `data:${mime};base64,${base64(image)}` };
  }

  if (event === 4) {
    // PREVIEW_IMAGE_WITH_METADATA : JSON (node_id, prompt_id…) + image.
    const metaLength = readU32(4);
    if (8 + metaLength > bytes.length) return null;
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(utf8(bytes.subarray(8, 8 + metaLength)));
    } catch {
      // unreadable meta: the image is still usable
    }
    const image = bytes.subarray(8 + metaLength);
    if (image.length === 0) return null;
    const mime =
      typeof meta.image_type === 'string' ? meta.image_type : 'image/jpeg';
    return {
      dataUri: `data:${mime};base64,${base64(image)}`,
      nodeId: typeof meta.node_id === 'string' ? meta.node_id : undefined,
      displayNodeId:
        typeof meta.display_node_id === 'string'
          ? meta.display_node_id
          : undefined,
      promptId:
        typeof meta.prompt_id === 'string' ? meta.prompt_id : undefined,
    };
  }

  return null; // other binary events: ignored
}
