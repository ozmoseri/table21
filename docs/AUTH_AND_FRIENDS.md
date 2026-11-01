# Auth and friends (Stage C)

> **סיכום לעוז:** שלב C בנוי ועובד בלי שום שירות חיצוני.
> - **שמירת אורח:** משתמש אורח יכול לשמור את החשבון עם 8 קודי שחזור, או לחבר מכשיר נוסף עם קוד חד-פעמי לעשר דקות.
> - **מכשירים וחשבון:** אפשר לראות את המכשירים המחוברים, לנתק אותם ולמחוק את החשבון.
> - **חברים:** קישורי הזמנה שלנו לחברים ולקבוצות, חסימה והסרת חבר.
> - **יתרות:** קוינס תרגול נשארים במכשיר, ושום התחברות לא מעבירה או מאחדת יתרות.
> - **Google ו-Facebook:** הקוד קיים, אבל הם יוצגו כ"לא הוגדר" עד שיהיו דומיין עם HTTPS והגדרות אצל הספקים. הפירוט ב-`docs/PROVIDER_SETUP.md`.

Status: built (server, client, tests). Google and Facebook are implemented but `not_configured` until the owner supplies
the provider settings and a public HTTPS origin. Apple is planned. LAN accounts live on the host computer only.

## What shipped

| Area | Endpoints | Notes |
|---|---|---|
| Sessions | `GET /api/auth/sessions`, `POST /api/auth/sessions/revoke`, `/revoke-others`, `/signout` | Public session id, 400-day expiry, revocation reason, `rotated_from`, device label (no full user agent). Revoked sessions lose their live socket. |
| Recovery codes | `POST /api/auth/recovery-codes`, `POST /api/auth/recover` | 8 codes `XXXX-XXXX-XXXX` (about 59 bits each), stored as SHA-256, single use, regenerating invalidates the old set, rate limited. |
| Device pairing | `POST /api/auth/pair`, `POST /api/auth/pair/redeem`, route `#/link/<code>` | One active code per account, 10 minutes, single use. |
| Providers | `GET /api/auth/providers`, `POST /api/auth/nonce`, `POST /api/auth/provider`, `POST /api/auth/unlink` | `intent: link` (guest upgrade, rotates the session) or `signin`. Nonce: httpOnly cookie + token claim, consumed only when the request completes. |
| Switch guard | 409 `confirm_switch` | Moving a device away from an unsaved guest with no other session needs `confirmSwitch: true`. The guest is never merged. |
| Sign-out guard | 409 `confirm_loss` | Signing out an unsaved guest on its only device needs `confirmLoss: true`. |
| Deletion | `POST /api/auth/delete` (confirm with the display name) | Refused while seated or dealing. Removes identities, codes, sessions, friendships, memberships, blocks, invites; anonymizes the profile; keeps ledger and hand results. |
| Invites | `POST/GET /api/invites`, `GET /api/invites/:token`, `POST /api/invites/:token/accept`, `POST /api/invites/:id/revoke`, route `#/i/<token>` | Token shown once, stored hashed; max uses, expiry, revocation; row lock so concurrent accepts never exceed `max_uses`; a user is counted once. |
| Blocks | `GET/POST /api/blocks`, `POST /api/blocks/remove`, `POST /api/friends/remove` | Both directions: friend codes, invites, gifts, reactions (filtered per recipient) and opening each other's rooms by code. Blocking removes the friendship. |
| Clubs | `POST /api/groups/:id/leave` | Owner leaving hands ownership to the longest-standing member. |

Schema: `apps/server/migrations/003_identity.sql` (runs automatically on start, also on an existing LAN database; existing
sessions keep working).

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

## Acceptance tests

Automated, all passing (see docs/TEST_REPORT.md): same email with a different `sub` stays a different identity; wrong
`aud`/`iss`/expired/bad signature/`alg`/`kid`/nonce rejected; nonce single use and bound to the browser cookie; session
rotation on link; switch and sign-out guards; recovery code single use and regeneration; pairing expiry; revoke other
devices (HTTP and socket); deletion; local practice coins never imported (extra fields ignored, ledger unchanged);
blocked user cannot gift, react, befriend, accept an invite or open the blocker's room; invite expiry, revocation and
concurrent max-use; test provider refused in production and LAN.

Not run: real Google or Facebook sign-in (no provider app exists), real phones, HTTPS deployment.
