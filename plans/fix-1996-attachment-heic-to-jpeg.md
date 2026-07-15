# fix #1996: convert HEIC / TIFF / BMP / AVIF attachments to JPEG at upload

## User prompt (JP)

> heicの画像だと 400になるんだけど、原因わかる？
> …
> 課題としてHEICからjpegに変換すると、位置情報などのメタ情報がきえるというのがあったんだけど、それもこのへんかんでなおる？
> …
> ではそれで

## Root cause

Claude Messages API only accepts `image/jpeg`, `image/png`, `image/gif`, `image/webp` for `type: "image"` content blocks. Anything else — HEIC, HEIF, TIFF, BMP, AVIF — is rejected with 400. The rejection happens upstream of the model, so no system-prompt / role-level fix can catch it.

The upload pipeline treats every `image/*` MIME as a native content block (`isImageMime` in `packages/client/src/mime.ts`), and the agent packs it as `type: "image"` (`server/agent/config.ts` `buildNativeBlock`) with the on-disk MIME as `media_type`. HEIC bytes then reach Claude verbatim → 400.

## Iteration note — sharp alone is insufficient for HEIC

Initial implementation used `sharp` for every conversion. First real HEIC upload showed sharp's prebuilt libvips ships without the HEVC (x265) codec for licensing reasons: `heif: Error while loading plugin: Support for this compression format has not been built in (11.6003)`. Fallback branch fired correctly (upload didn't fail); JPEG conversion didn't happen; Claude API returned 400 as before.

Fix: use `heic-convert` (npm package bundling WASM libheif, no platform codec dependency) for `image/heic` and `image/heif`. Keep sharp for TIFF / BMP / AVIF (libvips reads these natively without HEVC). Bounce through sharp on every path afterward so `.rotate()` bakes EXIF orientation into the final JPEG and quality is normalised.

Verified end-to-end against the actual failing HEIC from the user's workspace: 967 KB → 1190 KB in 1.8s, 2268×4032 baseline JPEG.

## Design

Follow the existing PPTX → PDF pattern in `server/api/routes/attachment.ts`:

1. Save original bytes as `<id>.<ext>` (HEIC / HEIF / TIFF / BMP / AVIF) so the user's file is preserved.
2. Convert to JPEG using `sharp` (already a dep; libvips includes libheif on the prebuilt binaries sharp ships).
3. Save JPEG companion as `<id>.jpg` via `saveCompanion` (same partition, shared id prefix).
4. Return `{ path: <jpeg>, originalPath: <original>, mimeType: "image/jpeg" }` so the LLM path is the JPEG.
5. On sharp / libheif failure → log a warn and return the original path unchanged (preserves current behaviour, doesn't fail the upload).

## Metadata preservation

Concern from the prior "HEIC → JPEG loses EXIF" experience: not applicable here because EXIF/GPS is already extracted from the ORIGINAL HEIC bytes by `capturePhotoLocation` hook in `server/workspace/photo-locations/index.ts` — the hook fires in `saveAttachment` BEFORE the JPEG conversion. The sidecar JSON at `data/locations/YYYY/MM/<id>.json` carries lat/lng/takenAt/orientation independent of the JPEG.

Hook order (verified in `attachment-store.ts` `saveAttachment` line 145-158):

```
saveAttachment(base64, "image/heic")
  → writeFileAtomic(<id>.heic)
  → runSaveAttachmentHooks()             ← EXIF hook reads .heic, writes sidecar
saveCompanion(<id>.heic, jpegBuf, ".jpg") ← NO hook re-fire; just writes bytes
```

Both files share the `<id>` prefix so the sidecar `<id>.json` colocates with them.

## Files added

### `server/utils/files/image-jpeg-convert.ts`
Small module mirroring `thumbnail-store.ts`'s pattern:
- Injectable `ConvertToJpeg = (input: Buffer) => Promise<Buffer>`.
- Dynamic import of `sharp` (avoids native-binary load in code paths that never convert / in test runs that inject a stub).
- Default `sharpConvertToJpeg` calls `sharp(input).rotate().jpeg({ quality: 90 }).toBuffer()` — `.rotate()` bakes in EXIF orientation so portrait phones aren't sideways.
- Exports `CLAUDE_UNSUPPORTED_IMAGE_MIMES` set — the switch list.

### `server/utils/files/image-jpeg-convert.test-support.ts` (or inline in tests)
Test stub factory.

## Files modified

### `server/api/routes/attachment.ts`
- Add a new branch `else if (CLAUDE_UNSUPPORTED_IMAGE_MIMES.has(parsed.mimeType))` between the PPTX branch and the default response.
- Call `sharpConvertToJpeg(base64Buffer)` — catch failures, log warn, fall through to returning the original path so the fallback path is observable but non-breaking.
- Response shape identical to PPTX case: `path` = JPEG, `originalPath` = original, `mimeType` = `"image/jpeg"`.

## Not changed

- `packages/client/src/mime.ts` `isImageMime` — still returns true for HEIC. That's correct for the frontend accept-list. The pipeline-level rejection has already been sidestepped by the upload-time conversion above.
- `server/agent/config.ts` — still packs native images as image blocks. The MIME arriving there is now `image/jpeg` (from the response), so Claude API accepts it.
- `ChatInput.vue` accept-list — still `image/*` prefix. No frontend UX change needed.
- SVG — needs viewport handling; separate follow-up.

## Test coverage

`test/routes/test_attachment_upload_heic.ts` (or extend existing attachment-store test):

- Uploading a stub HEIC (or MIME-only fixture — sharp is stubbed) returns `path` with `.jpg` and `originalPath` with `.heic`.
- The stub conversion is called exactly once with the raw buffer.
- On stub throwing, response falls back to `path === originalPath` (both `.heic`), `mimeType` unchanged; a warn is logged.
- EXIF hook still runs against the original `.heic` (verified by asserting the hook receives `image/heic` MIME).

## Verification

1. Local: `yarn dev`, drop an iPhone HEIC into a chat — expect the message to complete and the AI to describe the photo.
2. `~/mulmoclaude/data/attachments/YYYY/MM/<id>.heic` and `<id>.jpg` both exist.
3. `~/mulmoclaude/data/locations/YYYY/MM/<id>.json` exists with lat/lng.
4. `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test` — clean.
