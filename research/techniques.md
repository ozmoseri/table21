# TABLE21 techniques: card animation queues, server-to-client sync, mobile web platform notes

Context: TABLE21 keeps its existing design (DOM cards, Web Animations API, a client timeline, Socket.IO with an authoritative server and versioned snapshots). This note looks for lessons, not replacements. No code or assets were copied. All links accessed 2026-11-02.

---

## Open-source project 1: deck-of-cards

- Repo: https://github.com/deck-of-cards/deck-of-cards (accessed 2026-11-02). The npm package still points to the older path https://github.com/pakastin/deck-of-cards.
- Activity: GitHub showed 231 commits and about 3.1K stars, but the page did not display a last-commit date. npm registry: latest version 0.1.8 was published 2017-04-24, and the registry entry was last modified 2022-06-14 (https://registry.npmjs.org/deck-of-cards, accessed 2026-11-02). Treat it as **dormant**.
- **Code license:** dual. MIT (Copyright (c) 2015 Juha Lindstedt) if you do **not** use Chris Aguilar's card graphics, and LGPL-3.0 if you do. Source: https://raw.githubusercontent.com/deck-of-cards/deck-of-cards/master/LICENSE and README (accessed 2026-11-02).
- **Asset license (separate):** the card faces are "slightly modified" from Chris Aguilar's Vector Playing Card Graphics, which brings in LGPL-3.0. The README gives **no source or license for the card backs**, so treat them as **not licensed for reuse**. TABLE21 must not take any of its graphics. Our art stays original SVG/CSS. Source: README, https://raw.githubusercontent.com/deck-of-cards/deck-of-cards/master/README.md (accessed 2026-11-02).

### Technique (own words)
- **A serial action queue per target object.** Each action is a function that receives a "done" callback. When the queue is empty, enqueuing starts the action at once. Each completion removes the head and starts the next one. A wrapper turns ordinary methods into queued ones, so callers write sequential intent and the queue serializes it. Source: https://raw.githubusercontent.com/deck-of-cards/deck-of-cards/master/lib/queue.js (accessed 2026-11-02).
- **Staggered cascades:** one deck-level operation starts many card moves at once, each with delay = base + index x step. This produces the "dealt one after another" look without chaining callbacks. Source: README.
- **Positions as offsets from a centre point**, set per move (x, y, duration, ease, delay). It switched from CSS transitions to JS-driven animation in 0.1.3. Source: README changelog.
- **Z-order by reordering DOM nodes between actions.** The README's own to-do list marks this as something to replace. Source: README.

### Fit with TABLE21 (WAAPI + timeline)
- Good fit as a **concept**: a single queue with completion signals maps directly onto WAAPI's `finished` promise. Stagger maps onto WAAPI `delay`.
- Take away: queue at **table level**, not per card, so deal order across seats stays deterministic. Express a deal as one step with staggered children rather than N chained steps, which makes skip/finish one operation.
- Do **not** copy its z-order approach. Reordering DOM mid-animation can restart CSS state and causes layout work. Assign z-index or slot order when the step is enqueued.
- Do not adopt the library. It is dormant, JS-driven rather than WAAPI, and its assets are encumbered.

---

## Open-source project 2: Colyseus

- Repo: https://github.com/colyseus/colyseus (accessed 2026-11-02). It describes itself as an "Authoritative Multiplayer Framework for Node.js", about 7.5K stars.
- Activity: npm `colyseus` 0.18.10 was published 2026-10-22 (https://registry.npmjs.org/colyseus, accessed 2026-11-02). The project is **active**.
- **Code license:** MIT (repo sidebar and LICENSE link, accessed 2026-11-02).
- **Asset license:** the framework repo has no game art or sounds relevant to us. Nothing to reuse, and no asset license was found or needed.

### Technique (own words)
- The server holds the only game state. Changes go to clients as delta-compressed binary patches. Source: repo README.
- On the client, callbacks attach to that state. A per-property listener receives the **new and previous value**. Collection callbacks fire on add and remove. A change callback runs **after** the patch has been applied, so the client model is already at the new state when it fires. Source: "State Sync Callbacks", Colyseus docs v0.18, https://docs.colyseus.io/state/callbacks (accessed 2026-11-02).
- Collection-add callbacks **also fire for items that already exist** at first sync, replaying them. A client therefore has to tell "I just joined" apart from "this just happened". Source: same docs page.
- The docs give no explicit ordering guarantee between callback types and no animation guidance. Source: same docs page.

### Fit with TABLE21
- Good fit as a **pattern**, not as a dependency. Adopting it would replace our transport and authority layer, which is out of scope. A whole-state sync model also conflicts with our allowlist rule (`toPublicRound`, `RoomManager.snapshots`). The docs mention per-client "StateView" filtering, but we did not evaluate it.
- Lessons to apply to our versioned snapshots:
  1. **Animate from diffs, not from separate event messages.** Compare the new snapshot (version n) with the client's *displayed* snapshot and generate timeline steps such as card added to slot, hole card revealed, chips moved, result.
  2. **Keep two states on the client:** "latest authoritative" (applied at once, as Colyseus does) and "displayed" (advanced by the timeline). Input enabling and `expectedVersion` use the latest state. The view catches up.
  3. **Initial or recovery snapshots are replays, not events.** On join, reconnect, or a version gap greater than 1, finish the queue and snap to the layout with no deal animation. This matches the "replay on first sync" pitfall above.

---

## Platform technique notes

### 1. WAAPI skip and fast-forward
- `Animation.finish()` jumps to the end (to 0 if reversed). It throws `InvalidStateError` when the playback rate is 0, or when it is positive and the end time is infinite. Source: MDN, https://developer.mozilla.org/en-US/docs/Web/API/Animation/finish (accessed 2026-11-02).
- `updatePlaybackRate()` syncs with the current position before changing speed, which avoids the jump that direct `playbackRate` assignment can cause. The new rate takes effect once `ready` resolves. Baseline since March 2020. Source: MDN, https://developer.mozilla.org/en-US/docs/Web/API/Animation/updatePlaybackRate (accessed 2026-11-02). MDN browser-compat-data 8.1.8 lists Safari 13.1 and iOS Safari 13.4 (npm `@mdn/browser-compat-data` 8.1.8, data timestamp 2026-11-02, accessed 2026-11-02).
- Implication: queued animations must be finite (no infinite iterations), so "skip" can always call finish. The final visual state must not depend on a `fill` style that is later cancelled. Commit the end state to the element as part of step completion.

### 2. prefers-reduced-motion
- Values are `no-preference` and `reduce`. On iOS it is set in Settings > Accessibility > Motion > Reduce Motion. Baseline since January 2020. MDN frames it as remove, reduce or **replace** motion, with large scaling/panning as the main vestibular trigger. Its example swaps a scale animation for an opacity fade. Source: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion (accessed 2026-11-02).

### 3. Web Audio autoplay and AudioContext resume (incl. iOS Safari)
- Create or resume the context **inside a user gesture**. A context created outside one starts `suspended`. Check `state` and call `resume()` from a click/tap handler. Source: MDN Web Audio best practices, https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices (accessed 2026-11-02).
- Starting a Web Audio source outside user input counts as autoplay and is subject to autoplay rules. Source: MDN Autoplay guide, https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay (accessed 2026-11-02).
- `AudioContext.resume` is supported in iOS Safari since 9 (browser-compat-data 8.1.8).
- **Not verified here:** iOS-specific behaviour after a phone call, backgrounding or lock, such as an "interrupted" state. Plan: re-check `state` on `visibilitychange` and on the next tap. Device test = NOT_RUN.

### 4. navigator.audioSession type 'ambient'
- W3C Audio Session (Editor's Draft, 13 Nov 2024): `ambient` **mixes with other audio** and is not an exclusive type. `auto` is the default, and a page that only uses an AudioContext resolves to ambient. `playback` is exclusive and may pause other audio. Source: https://w3c.github.io/audio-session/ (accessed 2026-11-02).
- MDN marks it experimental. Source: https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type (accessed 2026-11-02). browser-compat-data 8.1.8: Safari and iOS Safari 16.4, **not** Chrome Android or Firefox Android.
- **Not verified:** whether `ambient` follows the iOS silent/ringer switch. Neither the spec nor MDN says so. Feature-detect and set it explicitly. Device test = NOT_RUN.

### 5. iOS PWA display, safe areas, viewport units
- Manifest `display`: iOS Safari supports `standalone` (11.3+). **`fullscreen` and `minimal-ui` are not supported on iOS Safari** (browser-compat-data 8.1.8, `manifests.webapp.display`). Use `standalone`.
- Safe areas: `viewport-fit=cover` makes the page cover the whole screen, then `env(safe-area-inset-*)` padding keeps controls clear of corners and the sensor housing. Provide fallbacks and use `max()` for a minimum margin. Source: WebKit blog, "Designing Websites for iPhone X", 2017, https://webkit.org/blog/7929/designing-websites-for-iphone-x/ (accessed 2026-11-02). Also MDN `env()`, https://developer.mozilla.org/en-US/docs/Web/CSS/env (accessed 2026-11-02). `env()` is supported on iOS Safari since 11.3 (browser-compat-data 8.1.8).
- Viewport units: `svh`/`lvh` are stable. `dvh` tracks the browser UI and its updates are throttled or debounced, not per frame. Source: web.dev, "The large, small, and dynamic viewport units" (Bramus, updated 2022-11-29), https://web.dev/blog/viewport-units (accessed 2026-11-02). `dvh` is supported on iOS Safari since 15.4 (browser-compat-data 8.1.8).
- Inference (not stated by the source): in a Safari tab, `dvh` can change while the toolbar animates, so pin the table's geometry to `svh` and use `100dvh` only for the outer shell.

### 6. navigator.vibrate
- Requires sticky user activation (call it from a tap handler). The device may not vibrate in silent or Do Not Disturb mode. Source: MDN, https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate (accessed 2026-11-02).
- browser-compat-data 8.1.8: **Safari and iOS Safari: not supported.** Chrome Android 32+ requires a user gesture since 60. Firefox Android returns true but does not vibrate (disabled for abuse reasons).

---

## Decisions
1. **Keep WAAPI and the existing timeline. Add one table-level serial queue.** A deal is one step with staggered child animations (delay = base + index x step). Skip = `finish()` on every running and queued animation, then commit the end state. Fast mode = `updatePlaybackRate()`. No infinite animations inside the queue. Z-order is set at enqueue time, never by DOM reordering.
2. **Diff-driven animation from versioned snapshots.** The client holds "latest authoritative" and "displayed" states. Steps come from the diff between them. On join, reconnect or a version gap > 1, finish the queue and snap without animation. The server never waits for client animations, and no hidden data is added to snapshots for animation's sake.
3. **Reduced motion is a first-class mode.** Follow `prefers-reduced-motion` (with live `change` listening) plus an in-app toggle. Card travel and scaling become short fades, and the round result summary is always text, so no information exists only in motion.
4. **Audio is opt-in and gesture-gated.** Create or resume the AudioContext on the first tap. Re-check state on `visibilitychange` and on the next tap. Where supported, set `navigator.audioSession.type = 'ambient'` so friends' music is not stopped. Behaviour with the iOS silent switch stays NOT_RUN until tested on a device.
5. **iOS PWA shell:** manifest `display: "standalone"` (never rely on fullscreen), `viewport-fit=cover`, `env(safe-area-inset-*)` with `max()` fallbacks on the action bar and top bar, table geometry on `svh`, outer shell `100dvh`. Physical iPhone/Android checks are reported as NOT_RUN until performed.
6. **Haptics and assets:** `navigator.vibrate` is a feature-detected, Android-only enhancement, triggered only from the player's own taps and never carrying meaning. No iOS haptics are claimed. No third-party card graphics (deck-of-cards faces are LGPL-3.0 and its backs have no stated license). TABLE21 art stays original SVG/CSS.
