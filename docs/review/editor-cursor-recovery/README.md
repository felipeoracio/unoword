# Earlier-sentence cursor recovery

## Reproduction

An autosave response can normalize formatting without changing authored prose.
For example, the actual backend document sanitizer canonicalizes a link's target
to `_blank`. The open editor compared the saved document with the live document
using `Node.eq()` and called `setContent()` for any difference, including such
formatting-only changes. That replaces the entire document and maps an earlier
selection to its end.

The production-bundle browser regression, using the real Python document
sanitizer with isolated HTTP fixtures, reproduced the jump before the fix:
selection expected at position 8, observed at position 122. The plain-text
control retained the caret. No customer credentials or live writing were used.

## Fix

Both same-document hydration paths now reconcile the saved document in place.
When prose and node structure match, only changed attributes/marks are applied,
with position-preserving transactions. Root metadata is handled explicitly.
The update is not a new authored edit or undo-history entry. Session credit and
paste provenance continue to follow their existing marks.

Genuine body updates replace only the differing range so ProseMirror can map
selections and history. A document identity change still hydrates the complete
new document and clears its transient history. The editor remains mounted.

## Executed checks

- Production frontend build: passed (TypeScript, branding/motion checks, client,
  SSR and public-page prerender).
- Frontend unit tests: 42 passed across 8 files, including five new saved-document
  reconciliation tests, existing session-credit tests and document-history tests.
- New browser regression: passed earlier-sentence typing, deletion, actual server
  normalization, autosave and undo/redo without cursor relocation or text loss.
- Full writing-workspace browser regression: passed authentication isolation,
  autosave/reopen, formatting, typed/pasted counts, document library operations,
  conflicts, coaching consent, import/export, Focus Mode, responsive EN/ES layouts,
  offline recovery and Free/Pro/Lifetime access checks.
- Whitespace checks: passed.
- Project-switching browser suite: all 15 grouped scenarios passed, including
  slow/failed saves, offline recovery, active/paused session attribution, long
  documents, mobile layouts, keyboard navigation and accessibility checks.
- Focused lint on the saved-document reconciliation module: passed.

The unit runner reports an existing Vite configuration deprecation warning.
No production deployment or database migration is included in this fix.

## Re-run

From the repository root after building the frontend:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_EXECUTABLE=/path/to/chromium \
FORMATTING_PYTHON=/path/to/backend/python node tests/editor-cursor.browser.cjs
```

`FORMATTING_PYTHON` must include the existing backend dependencies. The browser
wrapper serves the actual built frontend, while persistence/authentication use
isolated test data. Its saves invoke `lib.writing_document.clean_document`.
