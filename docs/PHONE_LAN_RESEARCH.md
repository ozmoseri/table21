# Phone-only LAN (no computer, no internet): feasibility research

Status: DEFERRED / UNVERIFIED. Nothing is implemented beyond keeping the game engine transport-independent. Do not advertise this mode as available until it works on real target devices.

## Why the PWA cannot do it
A browser page cannot open a listening socket or advertise itself on the network. Every PWA mode needs some host that serves the page and the realtime channel. Without a computer, one phone must run native code.

## Options evaluated
| Option | iOS-iOS | Android-Android | iOS-Android | Notes |
|---|---|---|---|---|
| Capacitor host app + native WebSocket/TCP server plugin + Bonjour/mDNS | Plausible | Plausible | Plausible | Most portable. Capacitor is only the wrapper; the server and discovery need native plugin code |
| Apple Multipeer Connectivity | Yes | No | No | iOS only |
| Google Nearby Connections | Limited | Yes | No practical support | Android first |
| WebRTC data channels | Possible | Possible | Possible | Needs signaling; offline means a local host anyway or manual QR SDP exchange in both directions; NAT-free on LAN but fiddly UX |
| Phone hotspot | Not guaranteed | Not guaranteed | Not guaranteed | Client isolation and iOS Personal Hotspot behavior can block peer traffic; still needs a host app |

## Platform constraints
- iOS: listener via Network.framework (`NWListener`), discovery via `NWBrowser`/Bonjour. Requires `NSLocalNetworkUsageDescription` and `NSBonjourServices` in Info.plist, and the user must accept the local network prompt (Apple TN3179). A backgrounded or locked host app is suspended and its listener stops, so the host must stay in the foreground.
- Android: `NsdManager` for discovery and a socket server in the app; keep the host alive with a foreground service. Battery optimizations can still interfere.
- Cross-platform: Bonjour (iOS) and NSD (Android) both speak mDNS/DNS-SD, so discovery can interoperate; QR with `ip:port` is the reliable fallback.

## Trust model
The host phone is the authority for that session. It is not tamper-proof; results stay local and never feed any online ranking (same rule as computer-hosted LAN).

## Recommended path
1. Capacitor app wrapping the existing web client.
2. Host phone runs the same `@table21/game-engine` plus a minimal JS room authority with an embedded store (port of the server's command rules, single process).
3. Native plugin exposes a WebSocket server and Bonjour/NSD advertisement; joiners connect by QR (`ws://ip:port`) or discovery.
4. Spike first: a two-device echo test on each platform pair before porting room logic.

## What is needed
- Mac with Xcode; Apple ID (free Personal Team is enough for testing on own devices).
- Android Studio and SDK.
- At least 2 iPhones and 1 Android phone to cover iOS-iOS, Android-Android and iOS-Android.
- Time for a bounded spike (listener, permission prompt, discovery, background behavior, reconnect).

None of these are available in the current cloud workspace, so the spike has not been run.
