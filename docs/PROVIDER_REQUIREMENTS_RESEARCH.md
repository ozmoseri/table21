# TABLE21 identity providers: owner checklist (researched 2026-11-01)

Scope: Google Identity Services (Sign in with Google, ID token flow) and Facebook Login for the Web (JS SDK), verified server-side by the TABLE21 Fastify server. Official docs only. Every item lists its source. Items marked UNVERIFIED could not be confirmed on an official page. Items marked INFERRED are conclusions drawn from official text that does not state them directly.

---

## GOOGLE

1. **Google account + Google Cloud project.** Create or select a Cloud Console project; you can reuse an existing project and web client ID.
   Source: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

2. **OAuth client ID, type "Web application".** "for Application type select Web application".
   Source: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

3. **Client secret: not needed for the GIS button / One Tap ID-token flow (INFERRED).** The setup page never mentions a secret, and the server verification guide only needs the client ID (`aud` must equal "one of your app's client IDs"). No page says explicitly "no secret required". The ID token is returned as a JWT in the `credential` field.
   Sources: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid , https://developers.google.com/identity/gsi/web/guides/verify-google-id-token , https://developers.google.com/identity/gsi/web/guides/migration

4. **Branding (OAuth consent screen / Google Auth Platform "Branding" page).**
   - App name (must accurately reflect the app).
   - User support email.
   - App logo: optional; shown on the Sign in with Google consent screen but "is not shown on One Tap dialog".
   - Authorized domains: "Your applications' links must be hosted on Authorized Domains."
   - Homepage link and Privacy Policy link, both hosted on an Authorized Domain.
   - Terms of Service link: optional, also on an Authorized Domain.
   - Scopes: "the default scope (email, profile, openid) is sufficient"; "you don't need to add any sensitive scopes."
   Source: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

5. **Authorized JavaScript origins.**
   - Format: scheme + fully qualified hostname only (e.g. `https://www.example.com`), no path/query/fragment/userinfo/wildcard.
   - HTTPS required: "JavaScript origins must use the HTTPS scheme, not plain HTTP. Localhost URIs (including localhost IP address URIs) are exempt from this rule."
   - Raw IPs forbidden: "Hosts cannot be raw IP addresses. Localhost IP addresses are exempted from this rule." So `http://10.0.0.27:3021` and `192.168.x.x` are NOT allowed.
   - Public TLD required: "Host TLDs (Top Level Domains) must belong to the public suffix list." (so `.lan`, `.local`, `.home` style names are not allowed, INFERRED from the public-suffix rule).
   - localhost for dev: "add both `http://localhost` and `http://localhost:<port_number>`".
   - Port: the origin match includes port ("The scheme, domain, and/or port ... may not match" in the `origin_mismatch` error), so register the exact port if non-default.
   - Local testing: set `Referrer-Policy: no-referrer-when-downgrade` for localhost testing; `strict-origin-when-cross-origin` recommended otherwise.
   Sources: https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow (JavaScript origin validation rules) , https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

6. **HTTPS for One Tap.** "Google One Tap can only be displayed in HTTPS domains." (The button is governed by the origin rules above: HTTPS unless localhost.)
   Source: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

7. **Redirect URIs (only if using `ux_mode: "redirect"` with `login_uri`).** Must be HTTPS (localhost exempt), "Hosts cannot be raw IP addresses", TLD on public suffix list, no fragment, no wildcards.
   Sources: https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation , https://developers.google.com/identity/gsi/web/reference/js-reference

8. **Publishing status / audience.**
   - Testing: "limited to up to 100 test users"; test-user authorizations "expire seven days from the time of consent".
   - In production: "available to any user with a Google Account."
   - Exception for openid/email/profile only: users "do not need to be in the trusted user list", "will not see a warning message", and authorizations "will not expire after 7 days" (covers Sign in with Google). Requesting any other scope removes the exception.
   Source: https://support.google.com/cloud/answer/15549945?hl=en

9. **App (scope) verification.** Not required for openid/email/profile: the unverified-app screen and 100-user cap apply to sensitive/restricted scopes (source above). Personal use (<100 users) and dev/test apps are also exempt from mandatory verification.
   Sources: https://support.google.com/cloud/answer/15549945?hl=en , https://support.google.com/cloud/answer/13464323?hl=en

10. **Brand verification (only to show logo / display name).** Required when the app is External, Published, and "You want your app to display a logo or display name on the OAuth consent screen." Needs a publicly accessible home page, a privacy policy on the same domain as the home page, and authorized-domain ownership verified in Google Search Console. Automated check takes minutes; manual review "usually takes 2-3 business days". Note: with FedCM One Tap in Chrome, the top-level Authorized domain is shown instead of the app name.
    Sources: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification , https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

11. **Client library.** Load `https://accounts.google.com/gsi/client` on every page where sign-in can happen; "self-hosting or using an offline copy is not a supported use case".
    Source: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid

12. **CSP (optional but recommended).**
    - `script-src https://accounts.google.com/gsi/client`
    - `frame-src https://accounts.google.com/gsi/`
    - `connect-src https://accounts.google.com/gsi/` ("Avoid listing individual GIS URLs when using connect-src")
    - `style-src https://accounts.google.com/gsi/style`
    - `default-src https://accounts.google.com/gsi/` if default-src is the fallback
    - When FedCM is disabled: COOP `same-origin-allow-popups` (not plain `same-origin`) or popup communication breaks.
    - "Without proper CSP setup, the FedCM One Tap or Button wouldn't be displayed on the site."
    Sources: https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid , https://developers.google.com/identity/gsi/web/guides/fedcm-migration

13. **Server-side ID token verification.**
    - Signature against Google keys: JWK `https://www.googleapis.com/oauth2/v3/certs` (PEM `https://www.googleapis.com/oauth2/v1/certs`); keys rotate, honor `Cache-Control`. Preferred: read `jwks_uri` from `https://accounts.google.com/.well-known/openid-configuration`.
    - `aud` equals your client ID.
    - `iss` equals `accounts.google.com` or `https://accounts.google.com`.
    - `exp` not passed.
    - `hd` only if restricting to a Workspace domain.
    Sources: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token , https://developers.google.com/identity/openid-connect/openid-connect

14. **Nonce.** Supported: `nonce` is an `IdConfiguration` field of `google.accounts.id.initialize`, "a random string used by the ID token to prevent replay attacks." Server should check the `nonce` claim and accept it once.
    Sources: https://developers.google.com/identity/gsi/web/reference/js-reference , https://developers.google.com/identity/openid-connect/openid-connect

15. **g_csrf_token (redirect `ux_mode` only).** GIS sets `g_csrf_token` in both a cookie and the POST body; the server must compare them and reject if missing or mismatched. The ID token is in the `credential` field.
    Source: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

16. **FedCM (2025-2026).** No mandatory deadline stated; migration is mostly automatic through the GIS library (page updated 2026-02-10). `use_fedcm_for_prompt` is deprecated and ignored (One Tap uses FedCM already). `use_fedcm_for_button` is optional, default `false` (Chrome desktop M125+, Android M128+). Remove `isDisplayMoment()`/`isNotDisplayed()`/`getSkippedReason()` style calls and custom One Tap positioning. Cross-origin iframes need `allow="identity-credentials-get"`.
    Sources: https://developers.google.com/identity/gsi/web/guides/fedcm-migration , https://developers.google.com/identity/gsi/web/reference/js-reference

17. **Cost: UNVERIFIED.** No official Google page found stating Sign in with Google / OAuth client IDs are free. (Widely understood to be no-charge, but not confirmed from an official source in this research.)

---

## FACEBOOK

1. **Facebook account + Meta developer registration.** Register while logged into Facebook; Meta sends a confirmation code to the phone number and email you provide. No credit card or fee mentioned on the page (card requirement: UNVERIFIED, none stated).
   Source: https://developers.facebook.com/docs/development/register

2. **Create an app with the use case "Authenticate and request data from users with Facebook Login".** Flow: app name + contact email, select use case(s), business portfolio option, review requirements, go to dashboard. Facebook Login is incompatible with some other use cases.
   Source: https://developers.facebook.com/docs/development/create-an-app/

3. **Business portfolio: optional for this case.** Option "I don't want to connect a business portfolio yet." Required only "If your app will access data that you don't own or manage". "Meta may ask you to verify your business."
   Source: https://developers.facebook.com/docs/development/create-an-app/

4. **Facebook Login settings.**
   - "Login with JavaScript SDK" toggle = yes.
   - "Allowed Domains for JavaScript SDK": the domain of the page that hosts the SDK must match an entry.
   - "Valid OAuth Redirect URIs" (Strict Mode requires exact match).
   Sources: https://developers.facebook.com/docs/facebook-login/web , https://developers.facebook.com/docs/facebook-login/security

5. **HTTPS.** "Only https pages are supported for authentication actions with the Facebook JavaScript SDK." Enforce HTTPS "requires HTTPS for OAuth Redirects" and JS SDK token calls must come "only from HTTPS pages". Exception: HTTP with localhost is allowed "only while your app is still in development mode." Enforced on all apps since October 6, 2018.
   Sources: https://developers.facebook.com/docs/facebook-login/web , https://developers.facebook.com/docs/facebook-login/security , https://developers.facebook.com/blog/post/2018/06/08/enforce-https-facebook-login/

6. **Basic Settings required to switch to Live** (each marked "This field is required to switch your app to Live mode"): Display Name, Contact Email, Terms of Service URL, App Icon, Category, App Purpose.
   Source: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/basic-settings

7. **Privacy Policy URL.** Platform Terms 4.a: a privacy policy at an "active, publicly available, easily accessible (including by our crawlers), and non-geoblocked URL", which "must also be disclosed in the privacy policy field" of the App Dashboard settings. (Whether the dashboard blocks Live without it: UNVERIFIED; it is a Platform Terms obligation either way.)
   Source: https://developers.facebook.com/documentation/development/terms-and-policies/privacy-policy

8. **User data deletion.** "Apps that access user data must provide a way for users to request that their data be deleted." Provide either a Data Deletion Instructions URL or a Data Deletion Request callback URL in Basic Settings. Callback must be HTTPS, parse `signed_request` with HMAC-SHA256 using the app secret, and return `{ url, confirmation_code }`.
   Source: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback/

9. **App Domains / Site URL.** Not described as Live requirements on the pages fetched; the Facebook Login for Web guide relies on "Allowed Domains for JavaScript SDK" and redirect URIs instead. Exact role of App Domains / Site URL for current use-case apps: UNVERIFIED.

10. **Development vs Live mode.**
    - Development: apps "can only request permissions from role users". Roles that can use it: Administrator, Developer, Tester (plus invited "consumer testers"); Analytics Users cannot. Unlinked apps can have up to 50 testers. Testers must be your employees or have an agreement with you.
    - Live: "can request permissions from anyone, but only permissions approved through App Review". Switch via the App Mode toggle; only after development and App Review are complete.
    Sources: https://developers.facebook.com/docs/development/build-and-test/app-modes , https://developers.facebook.com/docs/development/build-and-test/app-roles

11. **public_profile and email.** "App Review is required for all permissions except for email and public_profile"; both "do not require app review and are automatically granted to all apps using Facebook Login." BUT for non-role users they need Advanced Access: newer Consumer apps are "automatically approved for Advanced Access for the email and public_profile permissions" yet "both permissions are set to Standard Access by default and must be manually switched to Advanced Access." Standard Access works only for role users.
    Sources: https://developers.facebook.com/docs/permissions , https://developers.facebook.com/docs/facebook-login/web , https://developers.facebook.com/docs/graph-api/overview/access-levels

12. **Business Verification: AMBIGUOUS / UNVERIFIED for public_profile + email.** Official text says "Business Verification is required to get Advanced Access" and "As of February 1, 2023 apps requesting advanced access for permissions may have to be connected to a verified business", with no explicit carve-out for email/public_profile. Not required if the app "will only be used by app users who have a role on the app itself". Whether a friends-only app switching email/public_profile to Advanced Access gets blocked by Business Verification could not be confirmed. Plan for: either keep friends as Testers (<=50) in Development mode, or be ready to complete Business Verification.
    Sources: https://developers.facebook.com/docs/graph-api/overview/access-levels , https://developers.facebook.com/docs/permissions , https://developers.facebook.com/docs/development/release/business-verification/

13. **user_friends.** Requires App Review (not one of the two exceptions). Returns "a list of a person's friends using that app": only friends who logged into the app with Facebook Login and did not decline `user_friends`. `summary.total_count` is the user's total friend count on Facebook. Advanced Access (and so possibly Business Verification) needed for non-role users per the access-level rules above.
    Sources: https://developers.facebook.com/docs/permissions , https://developers.facebook.com/docs/graph-api/reference/user/friends/

14. **Server-side verification.**
    - `GET https://graph.facebook.com/debug_token?input_token={user-token}&access_token={app-token}`; app access token via `grant_type=client_credentials`, or pass `app_id|app_secret` as `access_token`.
    - Check `data.is_valid`, `data.app_id` == your App ID, `data.user_id`, `data.expires_at`, `data.scopes`; also `data_access_expires_at`, `issued_at`, `granular_scopes`, `error`.
    - Then `GET /me?fields=id,name,email` with the user token. `id` is an App-Scoped User ID; `email` "will not be returned if no valid email address is available".
    - appsecret_proof: "a sha256 hash of your access token, using your app secret as the key" (HMAC-SHA256); "Require App Secret" toggle in App Settings > Advanced makes it mandatory.
    - App secret IS required server-side (for the app access token and appsecret_proof) and must never be in client code: "the App Secret or an App Access token should never be included in any code" shipped to clients.
    - Tokens obtained on the client may be shipped to the server "securely over HTTPS". Short-lived tokens ~1-2 hours; long-lived ~60 days.
    Sources: https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow , https://developers.facebook.com/docs/graph-api/reference/debug_token/ , https://developers.facebook.com/docs/facebook-login/guides/access-tokens , https://developers.facebook.com/docs/graph-api/securing-requests , https://developers.facebook.com/docs/facebook-login/security , https://developers.facebook.com/docs/graph-api/reference/user/

15. **Limited Login (native iOS/Unity only, not for web).** OIDC token with JWKS `https://limited.facebook.com/.well-known/oauth/openid/jwks/` and discovery `https://limited.facebook.com/.well-known/openid-configuration/`; nonce is "reflected in the return token". The official "Validating the Token" page FAILED TO LOAD (client error twice), so `iss`/`aud` values and the explicit iOS-only statement are UNVERIFIED.
    Sources: https://developers.facebook.com/documentation/facebook-login/ios/limited-login/token.md , https://developers.facebook.com/docs/facebook-login/limited-login/token/validating/ (failed)

16. **SDK + Graph API version.** SDK: `https://connect.facebook.net/en_US/sdk.js` with `FB.init({ appId, xfbml, version })`; quickstart example uses `v25.0`, Login guide text says "most recent version: v24.0" (stale). Changelog: v26.0 introduced July 29, 2026 (latest, available until TBD); v25.0 until July 29, 2028; v24.0 until February 18, 2028; v23.0 until October 8, 2027; v22.0 until May 20, 2027; v21.0 until January 21, 2027. Recommendation: pin v26.0 (or v25.0) for both SDK and server calls. No Login-specific changes noted in the changelog.
    Sources: https://developers.facebook.com/docs/javascript/quickstart , https://developers.facebook.com/docs/facebook-login/web , https://developers.facebook.com/docs/graph-api/changelog

17. **CSP domains for the Facebook SDK: UNVERIFIED.** No official CSP list found.

18. **Cost: UNVERIFIED.** No official page found stating Facebook Login is free; registration page mentions no fee.

---

## APPLE

1. **App Store Review Guideline 4.8 Login Services (current wording).** "Apps that use a third-party or social login service (such as Facebook Login, Google Sign-In, Log in with X, Sign In with LinkedIn, Login with Amazon, or WeChat Login) to set up or authenticate the user's primary account with the app must also offer as an equivalent option another login service" that limits data collection to name and email, lets users keep their email private, and does not collect interactions for advertising without consent. Exceptions: the app exclusively uses the company's own account system; alternative app marketplace login; education/enterprise/business accounts; government or industry-backed eID; clients for a specific third-party service. Note: the current text no longer names "Sign in with Apple" as mandatory; any login service meeting the three privacy features qualifies. This only applies to apps distributed through the App Store; a PWA served from the web is not subject to it.
   Source: https://developer.apple.com/app-store/review/guidelines/#login-services

---

## What blocks a LAN `http://10.0.0.27:3021` setup

| Blocker | Google | Facebook |
|---|---|---|
| Plain HTTP | Blocked: origins must be HTTPS (localhost exempt); One Tap only on HTTPS. | Blocked: JS SDK auth "Only https pages"; HTTP allowed only for localhost and only in Development mode. |
| Raw private IP (10.x / 192.168.x) | Blocked: "Hosts cannot be raw IP addresses" (localhost IPs exempt). | No official rule found on raw IPs; HTTPS requirement blocks it anyway. Allowed Domains must match the page domain. |
| No public domain | Blocked: TLD must be on the public suffix list; branding links must be on Authorized Domains; brand verification needs Search Console domain ownership. | Privacy policy must be a publicly reachable, crawlable URL; data deletion callback must be HTTPS. |
| Friends without app roles | Fine with openid/email/profile even in Testing (exception). | Development mode: only role users (Testers, max 50 unlinked). Live for non-role users needs Advanced Access for email/public_profile, possibly Business Verification. |
| Secrets | Client ID only (INFERRED no secret). | App Secret required on server (debug_token / appsecret_proof / deletion callback). |

**Bottom line:** neither provider can work from `http://10.0.0.27:3021`. Minimum to enable both: a public domain on a public-suffix TLD served over HTTPS (for example via a tunnel or reverse proxy with a valid certificate), a public privacy policy page and terms page on that domain, and a data deletion instructions page or callback. `http://localhost:<port>` works for Google dev testing and for Facebook in Development mode only, which does not help phones on the LAN. Until configured, the UI should show both as "not configured" (no client ID / no app ID in server config).
