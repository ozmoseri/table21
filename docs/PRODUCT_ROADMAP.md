# Product roadmap: TABLE21 Social Club

> **סיכום לעוז:** התוכנית מחולקת לשישה שלבים, A עד F.
> A ו-B (שולחן, חפיסה, אנימציות, מתנות ותגובות) נבנים עכשיו בענף `upgrade/social-club`.
> C עד F (חשבונות, פרסים ומשימות, חנות, פיילוט) מתוכננים בלבד.
> אין חיובים אמיתיים, חשבונות חדשים, שירותים בתשלום או קרדיטים בלי אישור נפרד ממך.
> לכל שלב מפורט מה צריך ממך: חשבונות, ספקים, בדיקה משפטית ומכשירים.

Source of scope: Oz's V2 instructions of 2026-11-01 ("TABLE21 Social Club"). The inspiration is the social richness
and polish level of a large social poker game; all branding, art, wording and code in TABLE21 are original.
Reference findings live in docs/REFERENCE_RESEARCH.md (public sources only).

## Decision log

| Date | Decision | By |
|---|---|---|
| 2026-11-01 | Scope expanded: research and plan coin sales and a future store, plus gifts, missions, daily wheel, scratch card, clubs and a season pass. **No real charges, payment accounts, paid services, subscriptions or generation credits are approved.** The "fictional coins only: no purchases" rule in CLAUDE.md stays in force for running code until Oz gives a later, explicit approval for a specific store step. | Oz |
| 2026-11-01 | Product boundaries kept: no cash-out, no tangible prizes, no coin transfers between players, no trading market, no crypto. A gift is a visual gesture with no value. | Oz |
| 2026-11-01 | Stage A/B on branch `upgrade/social-club`; `main` stays the version Oz runs on Windows until the branch passes tests and is merged. | Claude |
| 2026-11-01 | Navigation: Home, Friends, Club, Profile. Missions, rankings and collection inside Club; settings via Profile. A Shop tab appears only in Stage E as a labeled demo. | Claude, per V2 doc |
| 2026-11-01 | The REA tool named in the V2 doc is not connected in this session; research uses public sources. | Claude (reported to Oz) |

## Stages

### A. Table, deck and design tokens (in progress, this branch)
- Scope: layouts for 1, 3 and 6 players with stable seats on an arc; 4-hand split display (active hand large,
  others as numbered chips); original deck with code-drawn ranks and suits, original court marks, TABLE21 mark on backs;
  design tokens; new navigation. No engine rewrite. Windows LAN fix preserved.
- Exit: Playwright screenshots for 1/3/6 players and a 4-split hand at 320, 360, 390 px and landscape;
  no overflow; existing unit, integration and e2e suites still pass.
- Needs Oz: nothing.

### B. Presentation and social layer (in progress, this branch)
- Scope: TablePresentationController (hydrate, live, resync), staggered deal, hole flip, chip motion, sound after the
  visual sequence, cancellation; 6 free gifts and 8 preset reactions, server-authoritative, rate-limited, idempotent,
  muteable; see docs/SOCIAL_FEATURES.md and docs/MOTION_SPEC.md.
- Exit: gift and reaction integration tests (duplicate, rate limit, non-member, departed user, expiry), e2e with two
  browsers, animation regression checks (12-14 card deal, refresh mid-round, new local session).
- Needs Oz: a real two-phone round on the LAN host to judge motion quality.

### C. Identity, friends and invites (planned)
- Scope: stable internal user ids with provider identities (Google, Apple, later Facebook login), safe guest upgrade,
  explicit account linking, blocks, account deletion, session rotation, invite links. See docs/AUTH_AND_FRIENDS.md.
- Without credentials: build against clearly labeled test adapters that are disabled in production builds.
- Exit: identity integration tests (linking, same email with different provider subject, wrong token, deletion, no
  local wallet import).
- Needs Oz: Google Cloud OAuth client, Apple Developer membership (for Sign in with Apple and iOS), Meta app (optional),
  a public HTTPS host. Each is a separate approval.

### D. Rewards, missions and collection (planned)
- Scope: ledger extensions, one-time reward claims, free daily wheel with a versioned visible prize table, free welcome
  scratch card, 3 daily missions, XP and levels, cosmetic inventory, a free 20-tier season track draft.
  Local rewards never count online. See docs/ECONOMY.md and docs/DATA_MODEL_PLAN.md.
- Exit: concurrency tests (two devices, two simultaneous claims, local clock change, disconnect after the prize is saved,
  prize table version change), mission idempotency, no XP duplication.
- Needs Oz: approval of prize tables and mission rewards after reviewing the simulator.

### E. Store and pass in a sandbox (planned, no charges)
- Scope: catalog, entitlements, PurchaseService with server verification against provider sandboxes, a demo store that is
  clearly labeled and never charges. See docs/MONETIZATION_READINESS.md.
- Exit: sandbox purchase tests (pending, cancel, duplicate and late callbacks, app closed after payment, wrong product,
  refund after use, restore without duplicate coins).
- Needs Oz: decision to proceed, payment provider and app store accounts, legal review for social casino in target
  markets, age rating questionnaires. Real sales only after all of these.

### F. Small adult pilot and measurement (planned)
- Scope: private pilot with friends (18+), metrics (activation to first hand, invites that became play, D1/D7/D30,
  session stability, refunds and costs), fixes. Native apps, rewarded ads and commercial distribution are separate
  milestones, not labels on the PWA.
- Needs Oz: hosting approval, devices, pilot group, privacy policy and terms.

## Dependencies

```
A -> B -> (C, D in parallel) -> E -> F
C is required before any store (purchases must belong to a recoverable account).
D's ledger extensions are required before E.
Public HTTPS hosting is required before C can use real providers and before F.
```

## Out of scope until explicitly approved

Real-money purchases, subscriptions, paid hosting, ads SDKs, sending messages to contacts, public matchmaking,
free-text chat, voice, paid lucky items, and any reuse of another company's art, logos, sounds or code.
