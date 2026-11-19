# Cursor fix production release

- URL: https://unoword.app
- Target: production
- Status: READY, production domains assigned without alias error
- Commit: 7b308bd61c5ec0099b4ea8ee906319c723b841b8
- Deployment: dpl_4T6ssyirS2r7GN6k8Czt5uDGh2iR
- Framework: Vercel Services (Vite frontend/FastAPI backend)
- Build duration: approximately 47 seconds

## Production verification

The served WritingEditor-BQKgBYWT.js asset matches the tested local production
build byte-for-byte and includes the saved-document reconciliation logic.
The editor route returns HTTP 200. Readiness returns HTTP 200 with both the
session database and Data API checks OK. Google sign-in configuration is enabled.
See production-probes.json for sanitized observations.

The new deployment's runtime error/fatal scan over the latest five-minute window
returned no matching groups. This is a point-in-time scan, not continuous
monitoring. Log-drain configuration and independent alert delivery were not
assessed or changed. No live customer account or private document was accessed.

Deployment used the existing GitHub main → Vercel production integration, after
explicit user approval. No database migrations or marketing-demo files were
included. Existing editor tabs need a refresh after pending writing is saved to
load the new frontend bundle.
