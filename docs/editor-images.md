# Images in the writing editor

Use **Add image** (the picture icon in the formatting toolbar), choose a PNG,
JPEG or WebP file, optionally edit its description, and select **Insert image**.
The image is placed after the current paragraph without replacing selected
writing. Select an image and press Backspace/Delete to remove it; Undo restores
it. Images scale to the writing canvas on mobile and desktop.

Images are embedded in the existing private document JSON. They autosave,
synchronize, duplicate and remain available with offline documents through the
same account-scoped revision/IndexedDB workflow. No public image hosting,
external-image URL fetch, new storage bucket or database migration is needed.
The existing Pro editor entitlement and owner access checks remain in force.
Images and descriptions are not sent to an AI provider by insertion.

Input files are limited to 10 MB and 40 megapixels. The browser re-encodes and
resizes them to at most 1600px on the longest side and 192 KiB per stored image.
The existing 1 MiB document JSON limit still applies; insertion checks capacity
before altering the document and explains when a smaller image is needed.
SVG, HTML disguised as an image, remote/file URLs, invalid bytes, spoofed MIME
and oversized embedded images are rejected by backend validation. Pillow is
explicitly pinned; decoding and DOCX raster import are bounded. External DOCX
image relationships are never fetched.

Formatting/copy/export behavior:

- Copy body includes images in its HTML clipboard representation where supported.
- Markdown export embeds image data; importing supported embedded Markdown images
  preserves them. External image URLs are stripped without loading them.
- DOCX and PDF exports contain embedded raster images. DOCX import normalizes
  supported embedded images and keeps descriptions where available.
- Plain text exports remain text-only.
- Adding an image does not start a writing session or add tracked words. Alt text
  and encoded image bytes are excluded from body text and AI writing context.
- Completed documents remain read-only; their images can still be viewed/copied.

Validation performed:

- Production build and TypeScript compilation passed. Lint has only four existing
  UI/admin warnings; branding and whitespace checks passed.
- 63 selected backend tests passed, including save/reopen, source/MIME/dimension
  validation, metadata sanitization, no image/alt word-count pollution, Markdown,
  real DOCX/PDF image embedding and DOCX image import.
- Dedicated production-bundle Chromium tests passed for upload, alt text,
  resizing/compression, save/reopen, removal/Undo, SVG/oversize rejection,
  offline insertion/reload/reconnect, rich clipboard and Markdown round-trip,
  external-image stripping, image-only session isolation, completed-document
  gating, English/Spanish, dark-mode accessibility and 320–1440px layouts.
- The full editor browser regression passed for authentication, formatting,
  counts, folders/library, conflicts, AI consent, import/export, offline recovery,
  Free editor denial and verified Monthly/Lifetime access.

Files: new `frontend/src/lib/document-image.ts` and
`backend/lib/writing_image.py`; editor UI/styles, clipboard and Markdown helpers,
existing backend document sanitizer/import/export helpers, backend requirements,
and workspace backend/browser tests. Billing and extension behavior are unchanged.

Screenshots are in `/workspace/.onboarding/unoword/editor-images/`.

## Production verification — November 2, 2026

Merged [PR #8](https://github.com/felipeoracio/unoword/pull/8) and deployed through
Vercel successfully (`5fb3badcec3e8ba96eb8b107a42cdbc120c15db0`). No database
migration or extension update was required.

The actual production editor passed file selection, description entry,
automatic WebP conversion, autosave/reopen, offline addition/reload/reconnect
with three intact embedded images, formatted body copying and responsive
320/390/768/1440px layouts. No JavaScript exceptions or new writing-activity
records occurred. Production API checks verified private image persistence,
external image URL rejection and embedded Markdown/DOCX/PDF exports, including
WebP images uploaded through the real browser.

Only a disposable fictional QA document was changed and then removed. Existing
documents, preferences, word/time totals and streaks match their pre-check
values. No AI generation or billing calls occurred. The test browser filtered
the library to that disposable document and suppressed first-device preference
migration for the existing QA account.

Sanitized results and a production screenshot are in
`/workspace/.onboarding/unoword/editor-images/production-results.json` and
`/workspace/.onboarding/unoword/editor-images/production-editor-images.png`.
