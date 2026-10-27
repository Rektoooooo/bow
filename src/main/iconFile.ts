/**
 * WHY this file exists:
 *   Many sites still serve a Windows .ico as their favicon (YouTube's holds 32-bit bitmaps), and macOS's image decoder
 *   (nativeImage) returns nothing for those. The selected Favorite's colour needs the icon's pixels, so this reads an
 *   .ico itself: its largest picture, either a PNG inside it (decoded by the caller) or a 32-bit bitmap.
 *
 * Data source:
 *   The bytes of an icon file. Pure: no Electron, no files.
 *
 * Data flow:
 *   faviconAccents.ts fetched an icon → isIconFile() → readIconFile() → PNG bytes (nativeImage) or BGRA pixels
 *   → shared/faviconColor.ts pickAccentColor()
 */

/** The .ico header: reserved 0, type 1 (icon), then the number of pictures. Format by Microsoft. */
const ICON_HEADER_BYTES = 6;
const ICON_ENTRY_BYTES = 16;
const ICON_TYPE = 1;

/** A dimension stored as 0 means 256 pixels. */
const FULL_DIMENSION = 256;

/** The bitmap header inside an .ico picture (BITMAPINFOHEADER), and the only depth read here. */
const BITMAP_HEADER_BYTES = 40;
const SUPPORTED_BITS_PER_PIXEL = 32;
const BYTES_PER_PIXEL = 4;
const ALPHA_OFFSET = 3;
const CHANNEL_MAX = 255;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** One picture of an icon: PNG bytes to decode, or pixels already read (BGRA, premultiplied, top row first). */
export type IconPicture = { kind: "png"; bytes: Uint8Array } | { kind: "pixels"; width: number; height: number; pixels: Uint8Array };

interface IconEntry {
  size: number;
  offset: number;
  length: number;
}

/**
 * True when the bytes are an .ico file.
 */
export function isIconFile(bytes: Uint8Array): boolean {
  if (bytes.length < ICON_HEADER_BYTES) {
    return false;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint16(0, true) === 0 && view.getUint16(2, true) === ICON_TYPE && view.getUint16(4, true) > 0;
}

/**
 * The directory entries of an .ico that lie inside the file.
 */
function readEntries(bytes: Uint8Array): IconEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4, true);
  const entries: IconEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = ICON_HEADER_BYTES + index * ICON_ENTRY_BYTES;
    if (start + ICON_ENTRY_BYTES > bytes.length) {
      break;
    }
    const width = view.getUint8(start) === 0 ? FULL_DIMENSION : view.getUint8(start);
    const length = view.getUint32(start + 8, true);
    const offset = view.getUint32(start + 12, true);
    if (offset + length <= bytes.length) {
      entries.push({ size: width, offset: offset, length: length });
    }
  }
  return entries;
}

/**
 * True when a picture's bytes are a PNG.
 */
function isPng(data: Uint8Array): boolean {
  return PNG_SIGNATURE.every((value, index) => data[index] === value);
}

/**
 * Copies one BGRA pixel with straight alpha as a premultiplied one (how macOS hands out bitmaps).
 */
function copyPremultipliedPixel(source: Uint8Array, sourceOffset: number, target: Uint8Array, targetOffset: number): void {
  const alpha = source[sourceOffset + ALPHA_OFFSET] ?? 0;
  for (let channel = 0; channel < ALPHA_OFFSET; channel += 1) {
    const straight = source[sourceOffset + channel] ?? 0;
    target[targetOffset + channel] = Math.round((straight * alpha) / CHANNEL_MAX);
  }
  target[targetOffset + ALPHA_OFFSET] = alpha;
}

/**
 * Reads a 32-bit bitmap picture: rows stored bottom first, colours with straight alpha. Null for other depths.
 */
function readBitmap(data: Uint8Array): IconPicture | null {
  if (data.length < BITMAP_HEADER_BYTES) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const headerSize = view.getUint32(0, true);
  const width = view.getInt32(4, true);
  // The stored height counts the colour rows and the transparency mask rows below them.
  const height = Math.abs(view.getInt32(8, true)) / 2;
  const bitsPerPixel = view.getUint16(14, true);
  const rowBytes = width * BYTES_PER_PIXEL;
  if (bitsPerPixel !== SUPPORTED_BITS_PER_PIXEL || width <= 0 || height <= 0 || headerSize + rowBytes * height > data.length) {
    return null;
  }
  const pixels = new Uint8Array(rowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = headerSize + (height - 1 - row) * rowBytes;
    for (let column = 0; column < rowBytes; column += BYTES_PER_PIXEL) {
      copyPremultipliedPixel(data, sourceStart + column, pixels, row * rowBytes + column);
    }
  }
  return { kind: "pixels", width: width, height: height, pixels: pixels };
}

/**
 * The largest picture of an .ico file, or null when it has none this can read.
 * Example: YouTube's favicon.ico (32 and 48 px bitmaps) → the 48 px picture's pixels
 */
export function readIconFile(bytes: Uint8Array): IconPicture | null {
  if (!isIconFile(bytes)) {
    return null;
  }
  const entries = readEntries(bytes);
  const largestFirst = [...entries].sort((first, second) => second.size - first.size);
  for (const entry of largestFirst) {
    const data = bytes.subarray(entry.offset, entry.offset + entry.length);
    if (isPng(data)) {
      return { kind: "png", bytes: data };
    }
    const bitmap = readBitmap(data);
    if (bitmap !== null) {
      return bitmap;
    }
  }
  return null;
}
