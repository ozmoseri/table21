# Provider setup: what is missing to turn on Google and Facebook

> **סיכום לעוז:** הקוד להתחברות עם Google ו-Facebook כבר כתוב ונבדק מול מפתחות בדיקה מקומיים. מול Google ו-Facebook האמיתיים הוא לא נבדק.
> כדי להפעיל אותו חסרים דברים שרק אתה יכול לפתוח:
> - דומיין ציבורי עם HTTPS. כתובת כמו 10.0.0.27 בבית לא מתקבלת אצל אף אחד מהשניים.
> - דפי מדיניות פרטיות ותנאי שימוש ציבוריים.
> - חשבון מפתחים אצל כל ספק.
>
> עד שזה מוגדר, המשחק מציג את שניהם כ"לא הוגדר בשרת הזה" ואף כפתור לא נראה פעיל. בינתיים קודי שחזור וקוד חיבור בין מכשירים עובדים בלי שום ספק, גם ב-LAN.

Sources and quotes: `docs/PROVIDER_REQUIREMENTS_RESEARCH.md` (official Google, Meta and Apple pages, read 2026-11-01).
Nothing below was created or signed in to. No account, project or app exists yet.

## Status in the code (Stage C)

| Piece | State | Evidence |
|---|---|---|
| Google ID token verification (RS256, JWKS, `iss`, `aud`, `exp`, `iat`, `nonce`, `sub`) | Built, tested with a local RSA key standing in for Google | `apps/server/src/identity/jwt.ts`, `tests/integration/identity.test.ts` |
| Google button (GIS, popup mode, nonce) | Built, NOT_RUN against Google | `apps/web/src/providers.ts` |
| Facebook token check (`debug_token` with app token, `app_id`, `is_valid`, `expires_at`, `user_id`) | Built, tested with a stubbed Graph response | `providers.ts`, identity tests |
| Facebook JS SDK login (`public_profile` only) | Built, NOT_RUN against Facebook | `apps/web/src/providers.ts` |
| Apple | Planned only (needed if an iOS app offers Google/Facebook login, Guideline 4.8) | |
| CSP | Provider hosts are added only when that provider is configured | `apps/server/src/app.ts` |
| UI | `not_configured` / `planned` / "needs HTTPS" shown as plain text; no active button | e2e `account.spec.ts` |

## Google (Sign in with Google for Web)

What the owner must do, in order:

1. Google account and a Google Cloud project (an existing project can be reused).
2. Google Auth Platform "Branding": app name, user support email, authorized domain, home page link and privacy policy link hosted on that domain. Logo and Terms link are optional.
3. Audience: External. With only `openid email profile` (all we request) users do not need to be test users and there is no 7-day expiry, even before publishing.
4. Create an OAuth client ID, type "Web application". Authorized JavaScript origin: the exact public HTTPS origin, for example `https://table21.example` (scheme + host, port if not 443).
   - Not allowed: `http://` (except localhost), raw IPs such as `10.0.0.27`, hosts without a public suffix (`.lan`, `.local`).
5. Put the client ID in `T21_GOOGLE_CLIENT_ID` on the server (it is public, not a secret). No client secret is used by our flow (inferred: the official flow only uses the client ID).
6. Optional later: brand verification (needs Search Console domain ownership), only to show the logo and app name on Google's consent screen.

Cost: no official statement found (UNVERIFIED). Commonly no charge.

## Facebook (Facebook Login for the Web)

1. Facebook account, register as a Meta developer (phone and email confirmation).
2. Create an app with the use case "Authenticate and request data from users with Facebook Login". A business portfolio is optional for this case.
3. Facebook Login settings: "Login with JavaScript SDK" on, "Allowed Domains for JavaScript SDK" = the public domain, Valid OAuth Redirect URIs as required (Strict Mode).
4. HTTPS only. HTTP works only for `localhost` and only in Development mode, so it cannot serve phones on a LAN.
5. Before Live: Display Name, Contact Email, Terms of Service URL, App Icon, Category, App Purpose, a public privacy policy URL, and user data deletion (instructions URL or HTTPS deletion callback).
6. Development mode: only app roles (admin, developer, tester; up to 50 testers) can log in. Live mode for everyone else needs Advanced Access for `public_profile`; Meta's text says Advanced Access may require Business Verification (AMBIGUOUS, verify in the dashboard).
7. Server env: `T21_FACEBOOK_APP_ID` (public) and `T21_FACEBOOK_APP_SECRET` (server only; never in the repo or the client). Optional `T21_FACEBOOK_GRAPH_VERSION` (default `v26.0`, released 2026-07-29).
8. Friend discovery (`user_friends`) needs App Review and only returns friends who also use TABLE21 and granted it. Not requested. Our own invite links stay the primary path.

Facebook CSP hosts in the code (`connect.facebook.net`, `www.facebook.com`, `web.facebook.com`, `graph.facebook.com`) come from the SDK URLs; Meta publishes no official CSP list (UNVERIFIED). Cost: no official statement found (UNVERIFIED).

## What blocks the current LAN setup

`http://10.0.0.27:3021` fails both providers (plain HTTP and a raw IP). Minimum to enable either one:

1. A public domain on a public-suffix TLD served over HTTPS with a valid certificate (a hosted server, or a tunnel/reverse proxy). This is a deployment and needs Oz's explicit approval.
2. Public privacy policy and terms pages on that domain, and an account deletion page (the in-app deletion exists: Account > Delete account).
3. The provider settings above, entered by Oz in each provider's console.
4. Then set the env names and restart. Accounts created on the LAN host stay on the LAN host; a deployed server has its own separate database.

## Safety rules kept

- No automatic merge by email. A provider identity is `(provider, sub)`; the same email with another `sub` is another person.
- The test provider (`T21_TEST_AUTH=1`) is refused at startup in production, LAN mode or with `T21_PUBLIC_ORIGIN`, and its UI exists only in `VITE_LAB=1` test builds.
- No provider access tokens are stored. Only the subject, and an email when the provider sends one, used as a masked hint.
