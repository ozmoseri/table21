# Auth and friends (Stage C plan)

> **סיכום לעוז:** היום כל שחקן הוא אורח שנשמר בדפדפן אחד. התוכנית מוסיפה זהות קבועה עם התחברות דרך Google או Apple, ובהמשך גם Facebook.
> חיבור חשבונות יהיה רק בפעולה מפורשת שלך, ולעולם לא איחוד אוטומטי לפי כתובת מייל.
> יתרות מקומיות מתרגול או מ-LAN לא עוברות לחשבון.
> החברים עובדים קודם כל דרך קוד וקישור שלנו, בלי תלות ב-Facebook.
> כל זה מתוכנן בלבד, ודורש ממך חשבונות ספקים וכתובת HTTPS ציבורית.

Status: planned. Today: server-created guest identity, httpOnly session cookie, friend codes, groups.
Cross-device recovery is shown as unavailable in the UI and stays that way until this stage ships.

## Identity model

- `users.id` is the only stable internal identifier. Wallets, ledger, results, inventory and purchases reference it.
- Provider identities live in `auth_identities` (provider, subject) with unique (provider, subject). The provider subject
  (`sub`) identifies the person at that provider; the email is informational and may change.
- A guest is a full user without identities. Upgrading a guest = attaching the first identity to the same `users.id`
  (wallet and history stay).
- Signing in on a new device with a provider that is already linked loads that user. The current device's guest is not
  merged; it stays a separate guest (its online wallet is not moved). If the user wants to keep the guest's progress
  instead, the flow asks explicitly which account to keep. No automatic merge.
- Linking a second provider requires being signed in to the account and completing the second provider's flow. If that
  provider subject already belongs to another user, linking stops with an explanation (no silent merge, no wallet merge
  by email, even if both emails match).
- Local balances (solo, pass-and-play, LAN) are never imported on sign-in.

## Providers

### Google
- Client gets an ID token via Google Identity Services. Server verifies it: signature against Google's published keys,
  `aud` equals our client id, `iss` is `accounts.google.com` or `https://accounts.google.com`, `exp` in the future,
  then uses `sub` as the subject. Reference: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- CSRF protection per flow (double-submit `g_csrf_token` for redirect mode, or nonce for popup), no client secret in
  the client, no access tokens stored.

### Apple
- Sign in with Apple is planned next to Google and Facebook for the iOS app, so the login options meet the applicable
  App Review requirements (to re-check before submission). Server validates the identity token (signature, `aud`,
  `iss`, `exp`, nonce) and uses `sub`. Apple may hide the email (relay address).
- Account deletion must be possible inside the app and through a web path; explain which transaction records are kept
  for legal reasons.

### Facebook (VERIFY_BEFORE_BUILD)
- Login and friend discovery are separate capabilities. Plan only for "friends who already use TABLE21 and granted the
  relevant permission"; never assume access to a full friend list. Meta App Review and permission details could not be
  read during research (the developer pages returned errors) and must be verified at build time. No scraping or API
  workarounds.

## Friends, clubs, invites

- Friend codes and invite links (our own) are the primary mechanism and work without any provider.
- Invite link: `https://<host>/#/i/<token>`; token stored hashed, single-use or limited uses, expiry, revocable.
- Clubs reuse `groups` / `group_members` with roles (owner, member). Club leaderboard reuses the weekly ranking rules.
- Online status comes from active sockets (already implemented) and is visible only to friends and club members.
- No automatic messages to contacts; sharing uses the system share sheet chosen by the user.

## Blocks and safety

- `blocks(blocker_id, blocked_id)`: blocked users cannot send gifts or reactions to the blocker, cannot join the
  blocker's private room via code (they see "room not available"), and are hidden from friend suggestions.
- Display names: existing sanitization (NFKC, control characters, length) plus a planned word list for clubs.
- Reports and moderation tooling come before any free-text chat or profile photos.

## Sessions

- Rotate the session token on sign-in, identity linking and privilege changes; keep `rotated_from` for audit.
- Expiry and revocation (`expires_at`, `revoked_at`); sign out everywhere on account deletion or on request.
- Cookies stay httpOnly, SameSite=Lax, Secure on HTTPS.

## Test adapters

- A `test` provider exists only for automated tests. It is enabled by an environment flag that the production start
  script refuses (startup fails if both production mode and the test flag are set).
- No UI button may simulate a successful provider login in production builds.

## Acceptance tests (planned)

Linking two providers; same email with a different `sub` stays a different identity; wrong `aud`/`iss`/expired token
rejected; deletion removes identities and sessions; session rotation; local wallet never imported; blocked user cannot
gift, react or join; invite token expiry and revocation.
