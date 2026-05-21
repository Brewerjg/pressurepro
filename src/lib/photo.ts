// Client-side photo processing — compression, EXIF strip, thumbnail.
// Drawing to a <canvas> and re-encoding always strips EXIF (including GPS),
// which is important for lawn-care damage docs (no leaking the homeowner's
// home address to anyone who downloads a social-proof image).

const FULL_MAX = 2048;
const FULL_QUALITY = 0.88;
const THUMB_DEFAULT_MAX = 400;
const THUMB_QUALITY = 0.6;

/**
 * Compress a captured photo: resize to 2048 long edge, re-encode as JPEG.
 * This single operation also strips EXIF as a side effect of canvas re-encoding.
 */
export async function compressImage(file: File): Promise<File> {
  const img = await loadImageFromFile(file);
  const blob = await renderToBlob(img, FULL_MAX, FULL_QUALITY);
  return new File([blob], rename(file.name, ".jpg"), { type: "image/jpeg" });
}

/**
 * Explicitly EXIF-strip a file by re-encoding through canvas at full size.
 * Kept separate from compressImage for callers who already have a resized file
 * but want to be sure GPS tags are gone. In practice compressImage already
 * does this; stripExif is a no-op-on-top guarantee.
 */
export async function stripExif(file: File): Promise<File> {
  const img = await loadImageFromFile(file);
  // Preserve native dimensions but re-encode so EXIF is dropped.
  const blob = await renderToBlob(img, Math.max(img.width, img.height), FULL_QUALITY);
  return new File([blob], rename(file.name, ".jpg"), { type: "image/jpeg" });
}

/**
 * Generate a small thumbnail. Default 400px long edge — enough for grid cards
 * and the public gallery without bloating Supabase storage.
 */
export async function makeThumb(file: File, max = THUMB_DEFAULT_MAX): Promise<File> {
  const img = await loadImageFromFile(file);
  const blob = await renderToBlob(img, max, THUMB_QUALITY);
  return new File([blob], rename(file.name, ".thumb.jpg"), { type: "image/jpeg" });
}

function renderToBlob(img: HTMLImageElement, maxEdge: number, quality: number): Promise<Blob> {
  let { width, height } = img;
  const longEdge = Math.max(width, height);
  if (longEdge > maxEdge) {
    const scale = maxEdge / longEdge;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality,
    );
  });
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

function rename(original: string, ext: string): string {
  const dot = original.lastIndexOf(".");
  const base = dot >= 0 ? original.slice(0, dot) : original;
  return `${base}${ext}`;
}
