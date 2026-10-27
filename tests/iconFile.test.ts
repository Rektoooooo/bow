/**
 * WHY this file exists:
 *   macOS cannot decode .ico favicons made of 32-bit bitmaps (YouTube's), so we read them ourselves: the largest
 *   picture, rows the right way up, colours premultiplied like macOS's bitmaps.
 */
import { describe, expect, it } from "vitest";
import { isIconFile, readIconFile } from "../src/main/iconFile";
import { pickAccentColor } from "../src/shared/faviconColor";

/** A 32-bit bitmap picture (BITMAPINFOHEADER) of one colour, its top row a second colour. */
function makeBitmapPicture(size: number, color: [number, number, number, number], topRow: [number, number, number, number]): Uint8Array {
  const header = new Uint8Array(40);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, 40, true);
  headerView.setInt32(4, size, true);
  headerView.setInt32(8, size * 2, true);
  headerView.setUint16(12, 1, true);
  headerView.setUint16(14, 32, true);
  const pixels = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    // Stored bottom row first: the last stored row is the picture's top row.
    const rgba = row === size - 1 ? topRow : color;
    for (let column = 0; column < size; column += 1) {
      const offset = (row * size + column) * 4;
      pixels.set([rgba[2], rgba[1], rgba[0], rgba[3]], offset);
    }
  }
  const picture = new Uint8Array(header.length + pixels.length);
  picture.set(header, 0);
  picture.set(pixels, header.length);
  return picture;
}

/** An .ico holding the given pictures, each listed with its size. */
function makeIconFile(pictures: { size: number; data: Uint8Array }[]): Uint8Array {
  const directoryEnd = 6 + 16 * pictures.length;
  const total = directoryEnd + pictures.reduce((sum, picture) => sum + picture.data.length, 0);
  const file = new Uint8Array(total);
  const view = new DataView(file.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, pictures.length, true);
  let offset = directoryEnd;
  pictures.forEach((picture, index) => {
    const entry = 6 + index * 16;
    view.setUint8(entry, picture.size);
    view.setUint8(entry + 1, picture.size);
    view.setUint32(entry + 8, picture.data.length, true);
    view.setUint32(entry + 12, offset, true);
    file.set(picture.data, offset);
    offset += picture.data.length;
  });
  return file;
}

describe("reading an .ico favicon", () => {
  it("takes the largest picture, the right way up, and finds its colour", () => {
    const small = makeBitmapPicture(2, [0, 0, 255, 255], [0, 0, 255, 255]);
    const large = makeBitmapPicture(4, [255, 0, 51, 255], [255, 255, 255, 255]);
    const picture = readIconFile(makeIconFile([{ size: 2, data: small }, { size: 4, data: large }]));

    expect(picture?.kind).toBe("pixels");
    if (picture?.kind !== "pixels") {
      return;
    }
    expect(picture.width).toBe(4);
    // The top row (white) comes first: B, G, R, A.
    expect(Array.from(picture.pixels.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(pickAccentColor(picture.pixels, picture.width, picture.height)).toBe("#ff0033");
  });

  it("hands a PNG picture over as it is", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const picture = readIconFile(makeIconFile([{ size: 16, data: png }]));

    expect(picture?.kind).toBe("png");
  });

  it("is not fooled by other files", () => {
    expect(isIconFile(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe(false);
    expect(readIconFile(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
