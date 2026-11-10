# UnoWord approved artwork

These WebP files are optimized from the owner's `Assets.zip` originals, with
transparent backgrounds preserved. No replacement artwork was generated.
`manifest.json` records the source filenames, dimensions and output sizes.
`studio-artwork.ts` imports the Phase 1 images through Vite for fingerprinted URLs.

Phase 1 uses `sidebar-landscape.webp` (600 × 1600), `landscape-master.webp`
(desktop) and `landscape-mobile.webp` (mobile/tablet). Text-safe overlays preserve
contrast. Headers use plain dark surfaces in dark mode; the dark sidebar art
works with both themes. The editor remains usable without decorative images.

The `covers`, `empty-states`, `prompts`, and `milestones` folders reserve supplied
artwork for later Home, Library and Progress phases. They are not eagerly
imported into the Phase 1 shell. Artwork never alters achievement thresholds,
entitlements, document content or AI permissions. The supplied six-cover contact
sheet is omitted from the app because its individual covers are already included.
