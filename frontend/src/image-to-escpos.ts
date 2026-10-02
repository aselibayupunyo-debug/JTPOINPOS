/**
 * Konversi gambar (base64 PNG/JPEG) → ESC/POS raster bytes.
 *
 * Alur:
 *  1. `expo-image-manipulator` resize gambar ke target width (384 px untuk
 *     58mm, 576 px untuk 80mm) dan paksa output PNG agar bisa didekode JS.
 *  2. `upng-js` dekode PNG → RGBA pixel array.
 *  3. Threshold luminansi → monochrome bitmap 1-bit per piksel (packed MSB).
 *  4. Bungkus ke perintah `GS v 0` (raster image command) ESC/POS, siap
 *     dikirim ke printer thermal.
 */
import * as ImageManipulator from "expo-image-manipulator";
import UPNG from "upng-js";

const GS = 0x1d;

export type PaperWidth = "58mm" | "80mm";

export function targetWidthPx(paper: PaperWidth): number {
  // Resolusi standar printer thermal 203 DPI.
  // 58mm printable area ~48mm → 384 dots. 80mm printable area ~72mm → 576 dots.
  return paper === "80mm" ? 576 : 384;
}

function base64ToUint8(b64: string): Uint8Array {
  // Hermes punya `atob` global; aman untuk string ASCII (base64 selalu ASCII).
  // eslint-disable-next-line no-restricted-globals
  const bin = typeof atob !== "undefined" ? atob(b64) : "";
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Hasilkan ESC/POS raster bytes dari base64 image.
 * `logoBase64` boleh berupa raw base64 atau data URL (`data:image/...;base64,...`).
 * Return null jika gagal (format tidak didukung / modul tidak tersedia).
 */
export async function escposFromImageBase64(
  logoBase64: string,
  paper: PaperWidth,
): Promise<Uint8Array | null> {
  if (!logoBase64) return null;
  const target = targetWidthPx(paper);

  // 1. Normalisasi menjadi data URL untuk expo-image-manipulator
  const dataUrl = logoBase64.startsWith("data:")
    ? logoBase64
    : `data:image/png;base64,${logoBase64}`;

  // 2. Resize ke target width + konversi ke PNG
  let pngBase64: string;
  try {
    // SDK baru: ImageManipulator.manipulate(...) → saveAsync
    // SDK lama: ImageManipulator.manipulateAsync(uri, actions, saveOptions)
    const mod = ImageManipulator as any;
    if (typeof mod.manipulateAsync === "function") {
      const result = await mod.manipulateAsync(
        dataUrl,
        [{ resize: { width: target } }],
        { base64: true, format: mod.SaveFormat?.PNG ?? "png", compress: 1 },
      );
      pngBase64 = result.base64 as string;
    } else if (typeof mod.manipulate === "function") {
      const img = mod.manipulate(dataUrl);
      await img.resize({ width: target });
      const saved = await img.saveAsync({ base64: true, format: mod.SaveFormat?.PNG ?? "png", compress: 1 });
      pngBase64 = saved.base64 as string;
    } else {
      return null;
    }
    if (!pngBase64) return null;
  } catch {
    return null;
  }

  // 3. Decode PNG → RGBA pixels
  let img: { width: number; height: number; data: Uint8Array };
  try {
    const buf = base64ToUint8(pngBase64);
    const decoded = UPNG.decode(buf.buffer);
    const rgba = UPNG.toRGBA8(decoded)[0];
    img = {
      width: decoded.width,
      height: decoded.height,
      data: new Uint8Array(rgba),
    };
  } catch {
    return null;
  }

  // 4. Threshold ke monochrome (packed MSB, 8 pixel per byte)
  const w = img.width;
  const h = img.height;
  const widthBytes = Math.ceil(w / 8);
  const mono = new Uint8Array(widthBytes * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = img.data[idx] ?? 255;
      const g = img.data[idx + 1] ?? 255;
      const b = img.data[idx + 2] ?? 255;
      const a = img.data[idx + 3] ?? 255;
      // Transparan → putih
      if (a < 128) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < 160) {
        const bytePos = y * widthBytes + (x >> 3);
        mono[bytePos] |= 0x80 >> (x & 7);
      }
    }
  }

  // 5. Bungkus ke perintah ESC/POS GS v 0 (raster image)
  //    GS v 0 m xL xH yL yH <data...>
  //    m=0 (normal mode), xL/xH = widthBytes, yL/yH = h
  const header = new Uint8Array([
    GS, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    h & 0xff, (h >> 8) & 0xff,
  ]);

  // Opsional: center-kan logo dengan ESC a 1 sebelum raster, dan ESC a 0 sesudah
  const alignCenter = new Uint8Array([0x1b, 0x61, 0x01]);
  const alignLeft = new Uint8Array([0x1b, 0x61, 0x00]);
  const feed = new Uint8Array([0x0a]); // 1 line feed sesudah logo

  const total = alignCenter.length + header.length + mono.length + feed.length + alignLeft.length;
  const out = new Uint8Array(total);
  let p = 0;
  out.set(alignCenter, p); p += alignCenter.length;
  out.set(header, p); p += header.length;
  out.set(mono, p); p += mono.length;
  out.set(feed, p); p += feed.length;
  out.set(alignLeft, p);
  return out;
}
