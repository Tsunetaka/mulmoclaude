// Upload-time conversion of image MIME types Claude's Messages API
// refuses (HEIC / HEIF / TIFF / BMP / AVIF) into JPEG, so the
// downstream `type: "image"` content block Claude expects a
// `media_type` from a fixed allowlist can be filled without a 400.
// See `server/api/routes/attachment.ts` for the wiring: original
// bytes stay on disk as `<id>.<ext>`; the JPEG lands as a
// `<id>.jpg` companion; the UI shows the original filename while
// the LLM sees the JPEG.
//
// Two decoders are used depending on the source MIME:
//   - HEIC / HEIF: `heic-convert` (bundles WASM libheif, so HEVC
//     codec presence doesn't depend on the platform's `sharp`
//     libvips build — the previous sharp-only implementation hit
//     "Support for this compression format has not been built in"
//     on macOS ARM64 because sharp's prebuilt libvips ships without
//     x265 for licensing).
//   - TIFF / BMP / AVIF: `sharp` (libvips reads these natively; no
//     HEVC codec required).
//
// Both paths finish with a `sharp(...).rotate().jpeg({ quality: 90 })`
// pass so EXIF orientation is baked in (portrait phone photos)
// and the final quality is consistent regardless of decoder path.
//
// Dependencies are loaded via `await import(...)` so tests can inject
// their own converter and never touch the native binary (`sharp`) or
// the WASM decoder (`heic-convert`). Pattern mirrors
// `thumbnail-store.ts`'s `ResizeToJpeg` DI seam, with `sourceMime`
// added to the signature so the injected converter can branch too.

/** Convert an image buffer to JPEG bytes. Receives the source MIME
 *  so implementations can pick the right decoder (HEIC / HEIF need
 *  WASM libheif; the rest go through sharp / libvips). Injected so
 *  tests exercise the route wiring without native binaries. */
export type ConvertToJpeg = (input: Buffer, sourceMime: string) => Promise<Buffer>;

// JPEG quality for upload-time conversion. Higher than the thumbnail
// path (72) because these are the bytes the LLM will read — we want
// receipts / documents to stay legible. 90 keeps a typical iPhone
// HEIC around 1-2 MB after conversion, still well inside Claude's
// per-image size ceiling.
const UPLOAD_JPEG_QUALITY = 90;

// Image MIME types that arrive from uploads / the browser's file
// picker but that Claude's Messages API refuses on the
// `image.source.media_type` field. Anything in this set gets rasterized
// to JPEG at upload time so the pipeline downstream can send it as a
// native image content block.
//
// Explicitly EXCLUDED (Claude accepts natively): image/jpeg,
// image/png, image/gif, image/webp.
// Explicitly OUT OF SCOPE (needs viewport picking): image/svg+xml.
export const CLAUDE_UNSUPPORTED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  // iOS Photos default capture format — very common in real uploads.
  "image/heic",
  "image/heif",
  // Scanner / camera raw outputs.
  "image/tiff",
  "image/bmp",
  // Newer capture format shipping on Android / Samsung.
  "image/avif",
]);

const HEIF_LIKE_MIMES: ReadonlySet<string> = new Set(["image/heic", "image/heif"]);

/** Decode the source bytes into a format sharp can consume. For
 *  HEIC / HEIF the WASM `heic-convert` produces an intermediate JPEG
 *  (max quality to avoid double-lossy artefacts before sharp's own
 *  re-encode). For everything else the raw input is returned — sharp
 *  reads TIFF / BMP / AVIF natively. */
async function decodeForSharp(input: Buffer, sourceMime: string): Promise<Buffer> {
  if (!HEIF_LIKE_MIMES.has(sourceMime)) return input;
  const heicConvert = (await import("heic-convert")).default;
  // `format: "JPEG"` returns an ArrayBuffer of JPEG bytes. `quality: 1`
  // (0..1 scale — NOT 0..100) minimises the intermediate's own lossy
  // step before sharp re-encodes to UPLOAD_JPEG_QUALITY below.
  const out = await heicConvert({ buffer: input, format: "JPEG", quality: 1 });
  return Buffer.from(out);
}

/** Production default: `heic-convert` for HEIC / HEIF (WASM libheif,
 *  no platform codec dependency), sharp for everything else, then a
 *  sharp roundtrip on every path to bake in EXIF orientation and
 *  normalise the final JPEG quality. Throws on decoder failure — the
 *  caller decides whether to fall back or surface the error. */
export const sharpConvertToJpeg: ConvertToJpeg = async (input, sourceMime) => {
  const intermediate = await decodeForSharp(input, sourceMime);
  const sharp = (await import("sharp")).default;
  return sharp(intermediate).rotate().jpeg({ quality: UPLOAD_JPEG_QUALITY }).toBuffer();
};
