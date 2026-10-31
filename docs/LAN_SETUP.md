# LAN play with a computer host

One computer runs the TABLE21 server; phones on the same Wi-Fi open it in the browser. No internet or cloud account is needed.

Status: implemented and dependency-isolation checked in the cloud workspace. Physical Wi-Fi play with real phones and the WAN-off test: NOT_RUN (no devices or home network available to Claude).

## Requirements
- Node.js 22.12+ and pnpm 10 on the host computer (`npm i -g pnpm@10`). PostgreSQL is not required.
- Host and phones on the same Wi-Fi network.

## Start
```bash
pnpm install          # once, while online
pnpm lan              # builds apps/web if dist is missing; add --rebuild to force
```
`scripts/lan.mjs` starts the server with `T21_DEPLOYMENT=lan`, `HOST=0.0.0.0`, `PORT=3021` (override with `PORT`), and an embedded database in `.data/lan` (`DATABASE_URL` is used instead if set). It prints every LAN IPv4 URL, for example `http://192.168.1.20:3021`, and a QR code in the terminal. The same address and QR are shown in the app at `#/lan`.

Remember: `localhost` on a phone means the phone itself. Phones must use the computer's LAN address.

## Offline check (manual, NOT_RUN)
1. Start `pnpm lan` while online, open the URL on two or three phones, create a room and join.
2. Disconnect the router's internet uplink (WAN) but keep Wi-Fi on.
3. Play a full round. All fonts, art and scripts are served by the host (CSP `'self'` only), so nothing should fail.

## Troubleshooting
- Firewall: allow incoming connections for Node on port 3021 (macOS: System Settings > Network > Firewall; Windows Defender Firewall: allow Node.js on private networks).
- AP / client isolation: guest networks and some mesh or hotel routers block device-to-device traffic. Use the main network or disable client isolation.
- Wrong interface: if several addresses are printed (VPN, Docker, Ethernet), use the one on the Wi-Fi subnet.
- iOS may show a local network prompt only for native apps; Safari does not need it.

## HTTPS (optional, for PWA install and offline caching on phones)
Basic play over `http://<ip>:3021` works without a service worker. Installing to the home screen with offline caching requires a secure context:
1. Create a certificate for the computer's LAN IP, for example with mkcert: `mkcert 192.168.1.20`.
2. Install and trust the mkcert root CA on each phone following Apple's and Android's official certificate-trust instructions. Do not click through certificate warnings; an untrusted certificate is not a secure setup.
3. Start with `T21_TLS_CERT=./192.168.1.20.pem T21_TLS_KEY=./192.168.1.20-key.pem pnpm lan` and open `https://192.168.1.20:3021`.

## Trust and rankings
LAN games use local guest identities and coins on the host's database. The host computer is trusted for that session; this mode is not tamper-proof and never feeds an online or global ranking.

## Phone-only LAN
Not available. See PHONE_LAN_RESEARCH.md.

## Windows quick start

Double-click `START-LAN-WINDOWS.cmd` (or run `powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-lan-windows.ps1"`).
It checks Node.js 22.12+, installs pnpm 10 if missing, runs `pnpm install --frozen-lockfile`, builds the client on first
run and starts the host. Every step stops with a message if it fails. Tools are started through `node` directly
(no `.cmd` shims), so folders with spaces work. The embedded database lives in `.data\lan`; a `DATABASE_URL`
set for other projects on the computer is ignored unless you pass `--postgres`.
Status: written for Windows but NOT yet run on a real Windows machine (verified on Linux, including a path with spaces).
