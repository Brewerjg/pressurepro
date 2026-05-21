// Photo capture — native (Capacitor camera) vs. web (input[type=file]) branching.
//
// Returns a File so the rest of the upload pipeline (compress → thumb → upload)
// is platform-agnostic. The web branch lazily opens a hidden <input> and resolves
// when the user picks a photo, which is the simplest fallback that still triggers
// the OS camera UI on iOS Safari & Chrome Android via `capture="environment"`.

import { Capacitor } from "@capacitor/core";

export interface CapturePhotoOptions {
  /** Long-edge target hint for the native camera. Web ignores this. */
  width?: number;
  /** JPEG quality hint for the native camera (1-100). Web ignores this. */
  quality?: number;
  /** Save the original to the device gallery (native only). Default true. */
  saveToGallery?: boolean;
}

/**
 * Open the camera and return the captured photo as a File, or null if the
 * user cancelled. The caller is responsible for further processing
 * (compression, EXIF strip, thumbnail) — see src/lib/photo.ts.
 */
export async function capturePhoto(opts: CapturePhotoOptions = {}): Promise<File | null> {
  if (Capacitor.isNativePlatform()) {
    return captureNative(opts);
  }
  return captureWeb();
}

async function captureNative(opts: CapturePhotoOptions): Promise<File | null> {
  // Dynamic import keeps the native plugin out of the web bundle's critical
  // path and avoids "module not found" if the plugin isn't installed on a
  // given build target.
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  try {
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CameraSource.Camera,
      saveToGallery: opts.saveToGallery ?? true,
      quality: opts.quality ?? 80,
      width: opts.width ?? 2000,
    });
    if (!photo.base64String) return null;
    return base64ToFile(photo.base64String, photo.format || "jpeg");
  } catch (err) {
    // Camera.getPhoto rejects on user cancel — surface as null rather than throw.
    const msg = (err as Error)?.message?.toLowerCase() ?? "";
    if (msg.includes("cancel") || msg.includes("denied")) return null;
    throw err;
  }
}

function captureWeb(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    // `capture="environment"` triggers the rear-camera on mobile browsers and
    // is silently ignored on desktop (where the operator picks from a file
    // dialog, which is what we want).
    input.setAttribute("capture", "environment");
    input.style.position = "fixed";
    input.style.left = "-9999px";

    let settled = false;
    const finish = (value: File | null) => {
      if (settled) return;
      settled = true;
      try {
        document.body.removeChild(input);
      } catch {
        /* already removed */
      }
      resolve(value);
    };

    input.onchange = () => {
      const file = input.files?.[0];
      finish(file ?? null);
    };
    // Cancel detection on web is unreliable — many browsers don't fire any
    // event when the picker is dismissed. We listen for the window regaining
    // focus and check if a file was selected; if not after a tick, resolve null.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files || input.files.length === 0) {
          finish(null);
        }
      }, 500);
      window.removeEventListener("focus", onFocus);
    };
    window.addEventListener("focus", onFocus);

    document.body.appendChild(input);
    input.click();
  });
}

function base64ToFile(base64: string, format: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const type = `image/${format === "jpg" ? "jpeg" : format}`;
  return new File([bytes], `capture-${Date.now()}.${format}`, { type });
}
