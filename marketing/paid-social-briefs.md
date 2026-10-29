# UnoWord paid social creative briefs

Status: preparation only. No Meta campaigns, audiences, budgets, pixels, or ad accounts have been created or changed. These are copy and layout specifications, not generated advertising images.

## Brand and product promise

Headline: **Your Words. Your Voice. Your Story.**

Supporting headline: **Build Better Writing Habits. Break Through Writer's Block.**

Tagline: **Every idea starts with UnoWord.**

You do the writing. UnoWord helps you keep going. AI offers topics, questions, outlines, and structural guidance; never generated prose, sentence completions, or rewrites.

Use the existing logo, bright blue #0866FF, white, navy #0B1B4D, soft blue #EFF6FF, and readable sans-serif type. Keep the main headline prominent and one clear CTA. Illustrations must be labelled when fictional. Do not add invented customer results, testimonials, or countdowns.

## Campaign A — Free habit building

- Image headline: Your Words. Your Voice. Your Story.
- Supporting text: Build Your First 7-Day Writing Streak.
- Primary text: Every great writing habit starts somewhere. Track your words, set daily goals, and build your first seven-day writing streak with UnoWord—for free. Keep writing after Day 7. Your activity continues being recorded, and Pro can unlock your full qualifying streak.
- Meta headline: Start Your Writing Habit Free
- CTA: Sign Up
- Destination: https://unoword.vercel.app/account?mode=signup
- Visual: daily word goal, supported Chrome tracking, and seven habit markers. Do not depict the editor, formatting, documents, folders, personalized profile, or personalized AI as Free features.
- Qualification: signed-in progress metadata synchronizes across surfaces; offline metadata queues locally. Available older device history requires explicit synchronization. Missing historical records cannot be reconstructed.

## Campaign B — Pro Monthly

- Image headline: Your Words. Your Voice. Your Story.
- Supporting text: Your Complete Writing Companion.
- Primary text: Build better writing habits with UnoWord Pro. Get a dedicated writing editor, organized documents, unlimited writing streaks, and personalized AI guidance that helps you overcome writer's block. All for $20/month.
- Meta headline: UnoWord Pro — $20/Month
- CTA: Learn More
- Destination: https://unoword.vercel.app/account?plan=pro
- Visual: actual Pro editor and document navigation, a coaching question, and a clearly illustrative streak preview. Label paid features. Never show AI prose insertion.
- Trial: include “7-day free trial for eligible accounts” only when the public billing configuration and account eligibility support it. Explain the $20/month charge after the trial, payment method requirement, and cancellation terms. No promise of unlimited AI.

## Campaign C — Writer's block

- Image headline: Your Words. Your Voice. Your Story.
- Supporting text: Find Inspiration. Keep Writing.
- Primary text: Writer's block doesn't have to stop your progress. UnoWord Pro helps you discover what to write next with personalized suggestions and thoughtful guidance—without writing for you.
- Meta headline: Break Through Writer's Block
- CTA: Learn More
- Destination: https://unoword.vercel.app/#ai-companion
- Visual: a short reflective question, not a paragraph of generated writing. Keep the author’s blank canvas central. Clearly mark personalized guidance as Pro.

## Campaign D — Lifetime offer

- Image headline: Your Words. Your Voice. Your Story.
- Supporting text: Lifetime Pro — $100
- Offer label: First 25 Qualifying Purchasers
- Primary text: Your writing companion for life. Get the complete UnoWord Pro experience—including the writing editor, document organization, unlimited streaks, and personalized AI guidance—for one $100 payment. Limited to the first 25 qualifying purchasers.
- Meta headline: UnoWord Lifetime Access — $100
- CTA: Shop Now
- Destination: https://unoword.vercel.app/lifetime
- Visual: Pro editor/library illustration, one-time price, and the limited capacity label. Do not imply a separate or smaller AI plan.
- Terms: same applicable features and allowances as Monthly Pro; no recurring lifetime payment; 14-day refund window. Lifetime does not mean unlimited AI or storage. Refunded purchases do not reopen sold places.

## Placement specifications

| Placement | Canvas | Composition and safe areas |
| --- | --- | --- |
| Facebook / Instagram feed | 1080 × 1350 (4:5) | Logo in upper area, headline in upper third, one product illustration, short supporting text, CTA in lower area. Keep a 72px inset. |
| Square feed | 1080 × 1080 (1:1) | Stack logo, three-line headline, one benefit, CTA. Use a 64px inset; avoid shrinking full dashboard text. |
| Stories / Reels | 1080 × 1920 (9:16) | Keep essential content between y=250 and y=1570 to avoid platform chrome; verify current Meta previews. Use 90px horizontal insets, large type, one simple visual. |

Target headline size 72–104px, supporting text 36–48px, and CTA 36–44px. Never shrink legal terms into unreadable text; link clearly to full terms. Use actual screenshots only when the UI and entitlements match the final build. Preview on a physical phone before publication.

## Publication checklist for the owner

1. Deploy the migrations and tested application before promoting the revised offer.
2. Confirm public pricing and allowance versions at `/api/product`, including actual trial terms. Initial new-subscriber allowances are 10 suggestions/day, 200/calendar month, and 30 guidance/calendar month; do not reuse these numbers after a published configuration change without checking them.
3. Keep existing protected subscriber allowances intact.
4. Billing is currently sandbox/test with live approval off. Do not start a campaign promising real purchases until the owner explicitly approves live billing and live checkout is tested.
5. For Lifetime, check `/api/subscription/lifetime/offer`: `checkout_available`, `available`, `remaining`, and `purchased`. Remaining places must derive from verified paid orders. Do not advertise when sold out, unavailable, or only sandbox purchases are supported.
6. Leave existing analytics/Meta conversion configuration unchanged. No existing Meta pixel was found in the tracked frontend; this work does not invent one or claim conversion tracking is installed.
7. The owner must approve creative assets, final copy, audience, budget, and publication in Meta. These briefs do not authorize campaign publication.
