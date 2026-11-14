# Editor 2.0 — Phase 6 review

Phase 5 is live at https://unoword.app, commit `92538d951ca0e56df1404ae9989a4e9c562dd64f`.
Phase 6 is approved and deployed to https://unoword.app at commit `e2ad836`.
Vercel deployment `dpl_AQ1CSYDptppw4wxV539kSXTWBMCh` reached production READY.
[Phase 7 verification](../editor-2-phase-7/README.md) is authorized.

[Implementation plan](../../editor-2-phase-6-plan.md)

## Changes

Grouped formatting menus and writing-tool dialogs now use the existing shared motion
vocabulary: 180ms dropdown entry, 220ms panels, 260ms dialogs and 140ms exit.
Native popovers retain positioning and keyboard behavior; closing surfaces stop accepting
pointer input immediately. Display/overlay transitions progressively enhance supported browsers.
Find, outline, View and the selection toolbar have restrained surface entrances.
Control feedback and the truthful save-status dot use the shared 120ms token.
There are no artificial saving delays or looping status animations.

Each hydrated document receives one subtle opening cue, including when the paper element
is retained. Typing/saving do not replay it; input, Focus and project switches cancel
conflicting cues. Existing Focus FLIP and save-before-project-switch behavior remain.
Entering Focus from a formatting menu closes hidden menus and returns keyboard input
to the same editor, so one Escape exits Focus. Reduced motion disables the new effects,
including a live preference change and dialogs rendered outside the editor subtree.

Tiptap, authored JSON, autosave, session provenance, AI scope and backend remain unchanged.
No Supabase changes or migrations were needed.

## Preview

- [Desktop formatting](formatting-desktop.png)
- [Mobile formatting](formatting-mobile.png)
- [Find panel](find-desktop.png)
- [Statistics dialog](statistics-desktop.png)
- [Saving feedback](saving-desktop.png)
- [Interaction video, synthetic document](interaction-preview.webm)

## Verification

Production build, focused lint, branding and whitespace checks passed. Frontend unit tests:
25 passed across history, Markdown, document tools, media schema/serialization and session credit.
Browser checks completed:

- [Phase 6 interactions](results.json): 6 grouped scenarios.
- [Focus Mode](focus-results.json): 21 scenarios.
- [Rich formatting](formatting-results.json): 10 grouped scenarios.
- [Writing tools](writing-tools-results.json): 11 grouped scenarios.
- [Project switching](project-results.json): 15 grouped scenarios.
- [Editor/AI feedback](editor-feedback-results.json): 8 grouped scenarios, including WCAG checks.

Total: 71 browser scenarios/groups across six suites.

The formatting helper now checks native `:popover-open` state when reopening a menu,
rather than its visual presence during the exit transition. The initial parallel run
also missed a brief project-animation window; the serial rerun passed all 15 groups.
The legacy opening test checks the production duration/keyframes, persisted keyboard
input and absence of leftover animations, without requiring browser transport to
arrive within a 220ms wall-clock window. Its animation wait polls current animations
with a timeout: Chromium discarded a responsive transition while leaving a captured
`finished` promise unresolved. The complete editor/AI suite then passed with axe
enabled. No production animation duration was extended for tests.

All browser edits used isolated fixtures and synthetic documents, with the built production
frontend. Responsive checks cover 1440, 1024, 768, 390 and 320px Chromium viewports;
these are not physical-device or Safari/Firefox verification. Broad performance and final
cross-feature regression testing remain Phase 7.

Phase 5 deployment `dpl_DEn3xLxNjrvozZbEZfoirEiVg84N` reached production READY;
https://unoword.app/editor returned the deployed HTML bundle in a read-only check.
The deployment error/fatal query returned no records at verification time; this is not
a claim of continuous monitoring. Production documents were not modified for verification.
