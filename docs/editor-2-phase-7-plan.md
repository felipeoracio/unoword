# Editor 2.0 — Phase 7 verification plan

Phase 6 is approved for deployment at `e2ad836`. Phase 7 is authorized on
`feature/editor-2-final-verification`; fixes remain local for review before release.

1. Verify the production deployment SHA, READY state, custom domain, public editor
   assets and read-only runtime observations. Do not edit live documents to test.
2. Rebuild the production frontend; run all frontend units/lint and backend editor,
   export/import, session, entitlement, origin, ownership and project-scope tests.
3. Run the canvas, rich-formatting, image/table, writing-tools, portable-document,
   motion, Focus, project-switching and general workspace browser suites serially.
   Retain actual per-job logs and results. Use synthetic API/IndexedDB fixtures.
4. Observe long-document typing/save behavior on desktop and narrow viewports,
   including 4x CPU slowdown and held AI responses. Report lab metrics honestly;
   these are not field INP, physical-device FPS or proof of leak absence.
5. Exercise real SQL/RLS/mutation contracts in disposable in-process PostgreSQL;
   inspect existing production Supabase health and policy metadata read-only.
   Preserve documents, historical activity and database schema.
6. Fix demonstrated editor regressions and rerun affected checks. Keep physical
   mobile, native IME, Safari/Firefox and live-provider limits explicit. No automatic
   release of Phase 7 fixes, pricing changes, new framework or backend project.
