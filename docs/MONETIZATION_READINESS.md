# Monetization readiness (Stage E plan)

> **סיכום לעוז:** זה תכנון בלבד. אין חיובים, אין חשבונות סליקה ואין מנויים.
> הסדר המוצע: קודם חבילות עיצוב עם תוכן קבוע, אחר כך קוינס בכמות קבועה, אחר כך מסלול עונה חד-פעמי, ופרסומות רק בסוף ורק בבחירת השחקן.
> לפני מכירה אמיתית צריך ספקי תשלום, חשבונות בחנויות, דירוג גיל ובדיקה משפטית.
> חנות הדגמה תסומן בבירור ולא תגבה כסף.
> כל מספר הכנסה כאן הוא דוגמה חשבונאית, לא תחזית.

Status: NOT approved for real sales. Per the decision log in docs/PRODUCT_ROADMAP.md, the "no purchases" rule in
CLAUDE.md stays in force for running code. This document prepares the design so a later, explicit approval can proceed safely.

## Store order

1. Fixed-content cosmetic bundles (for example: one card back, one frame and one chip set in the same theme). Contents listed before purchase.
2. Fixed coin amounts (no random contents).
3. One-time season pass per season (not an auto-renewing subscription by default). Late purchase grants tiers already
   earned according to a documented rule. Purchased coins never expire at season end.
4. Later and optional: opt-in rewarded ads between hands only, with server-side reward verification, caps and no-fill
   handling, never ads for real-money gambling, always a free way to keep playing.

Never sold: better odds, extra or illegal cards, a friendlier dealer, random paid items (excluded from the first store),
coins that can be cashed out or transferred.

## Platform rules (to re-verify before launch, not legal advice)

- Native apps: StoreKit (iOS) and Google Play Billing (Android) are the default for digital goods, with regional
  exceptions checked at the time. Do not wrap a web checkout in a WebView and assume it is allowed.
- Apple's age rating table currently treats frequent simulated gambling as an 18+ category; fill in the real
  questionnaires, check target markets, and get a legal review for social casino before selling.
- Paid random items require odds disclosure under store policies; the first store has none.
- A payment provider used by a fashion store must not be assumed to accept a social casino merchant category; choose a
  web provider only after it confirms the business and markets.
- Sources: docs/RESEARCH_SOURCES.md.

## PurchaseService design

- Client starts a purchase with the platform SDK; the server never trusts a client "success" screen.
- Server verifies every transaction with the provider (App Store Server API / Play Developer API / web provider webhook
  signature), checks product id, price tier and that the purchase belongs to the signed-in user.
- Idempotency: `purchases` unique on (provider, provider_transaction_id); coin credit uses
  `ledger.idem_key = 'purchase:<provider>:<transaction id>'`.
- States: pending -> purchased -> (consumed | refunded | revoked), or canceled. Pending is visible to the user and safe
  to retry. Callbacks can arrive late, twice or out of order; transitions are monotonic and recorded with the raw status.
- Acknowledge or consume per provider rules only after the credit is committed.
- App closed after payment: on next launch and on server notifications, reconciliation grants the entitlement exactly once.
- Restore: non-consumables and passes are restored as entitlements; coins are never re-credited by restore; the wallet
  is synced from the server.
- Refunds: a counter-entry in the ledger (`purchase_refund`). If coins were already spent, apply the documented policy
  (debit to zero and record the shortfall, revoke cosmetics from that bundle); the wallet never goes negative.
- Purchased vs granted coins are distinguished by `ledger.currency_origin` even though one balance is shown.

## Demo store

A demo store may exist in development builds only, labeled "הדגמה, ללא חיוב" on every screen, using a `test` provider
that never contacts a payment service and never produces receipts. It is disabled in production builds.

## Business measurement (planned)

Activation to first hand, invites that led to a friend playing, friends who played together, D1/D7/D30, session
stability, active and paying users, net revenue after fees and refunds, server and content costs. Cohorts by a
documented definition; small friend groups do not support strong conclusions.

**Example arithmetic, not a forecast:** 1,000 monthly active users x 3% paying x 40 NIS per paying user per month =
1,200 NIS gross receipts, before taxes, store fees, refunds, hosting, content, support and marketing.

## Readiness checklist

| Item | Status | Who unblocks |
|---|---|---|
| Oz approval to start real sales | NOT_STARTED | Oz |
| Legal review: social casino in target markets, terms, privacy policy | NOT_STARTED | Oz + lawyer |
| Age rating questionnaires (Apple, Google) | BLOCKED (needs store accounts) | Oz |
| Apple Developer Program membership | NOT_STARTED | Oz |
| Google Play Console account | NOT_STARTED | Oz |
| Web payment provider that accepts this category | NOT_STARTED | Oz |
| Public HTTPS hosting and production database | NOT_STARTED | Oz approval of a host |
| Recoverable accounts (Stage C) | NOT_STARTED | Claude, after provider credentials |
| Ledger extensions and entitlements (Stages D/E) | NOT_STARTED | Claude |
| PurchaseService with sandbox verification | BLOCKED (needs sandbox accounts) | Oz, then Claude |
| Sandbox test matrix (docs/QA_MATRIX.md area 9) | BLOCKED | depends on the above |
| Refund and support policy text | NOT_STARTED | Oz |
| Rewarded ads provider and server-side verification | NOT_STARTED (deferred) | Oz |
