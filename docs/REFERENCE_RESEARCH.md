# Reference research: social card game patterns for TABLE21

Accessed 2026-11-01. Public pages only. Purpose: understand what makes Zynga Poker's social layer feel rich, then design
ORIGINAL blackjack equivalents. Nothing here is a spec to copy: no logos, art, wording, sounds or code are reused.
Full source list with status: `docs/RESEARCH_SOURCES.md`.

## Evidence tags

| Tag | Meaning |
|---|---|
| OBSERVED | Seen directly in a screenshot or video frame I viewed. **No finding in this file is OBSERVED** (see method). |
| DOCUMENTED | Stated in an official or reputable public page I read (link given). |
| INFERRED | My reasoning from documented facts. Not a fact about the reference product. |
| NOT_VERIFIED | Unknown, unclear, or only implied. Do not build on it as fact. |

UI and marketing text are never evidence of server logic, shuffle, prize odds, economy tuning or A/B tests.
Where a help page states odds or RNG certification, that is the publisher's claim, tagged DOCUMENTED, not independently checked.

## Method and tool status

Updated 2026-11-01 after Oz approved connecting REA (no purchases, no paid components).

- **REA (morluto/rea) v6.8.0: installed and verified in Claude's cloud workspace, CLI mode.**
  - Lookup first: no existing REA install or MCP registration was found in this cloud session (no `rea` binary,
    nothing in Claude settings). Oz's computer could only be checked through the connected TABLE21 folder, and the
    computer's device shell is a VM without network, so an install there could not be checked or used.
  - Install: `npm install rea-agents@6.8.0` into an isolated scratch folder. No global install, no agent configuration
    changed (so nothing needed a backup), no Hopper/IDA/JEB or other commercial component installed. MIT licensed.
  - `rea doctor`: Node 22.23.4 and host healthy; native engines (Hopper, Ghidra, IDA) missing, which only matters for
    binary analysis and is not needed for web work.
  - **Verification on TABLE21 (PASS):** headless Chromium with a loopback CDP endpoint opened the TABLE21 lab page;
    `rea list-browser-targets` found it and `rea capture-web-screenshot` returned evidence
    `ev_63e342690fe0d40ced8ff77bc52090bd9d71c47abedcbaa8423c1796fa9496c4` with origin `http://127.0.0.1:3021`, a 500x701
    viewport and a PNG artifact (sha256 `e614d525...6fc6`). `rea analyze-javascript-application` on the built client was
    cancelled at a 180 s limit on this 2 vCPU machine (not a failure of REA itself; not rerun).
  - **Zynga with REA: BLOCKED.** This workspace's egress proxy refuses `www.zynga.com` and `www.zyngapoker.com`
    (`connect_rejected`), so REA could not open them here. Oz can allow those domains for Claude sessions (Settings >
    Capabilities) if REA captures of the public site are wanted later. The playable game needs a login, which was not
    used, so in-game screens stay out of reach either way.
- **Built-in browser on Oz's computer (public pages only, OBSERVED):** zyngapoker.com home, store.zyngapoker.com, the
  Daily Streak page and the 15th birthday news page were opened as an anonymous visitor; the cookie banner was answered
  with "Reject All". Nothing was signed in, bought, sent or downloaded. Observations are tagged OBSERVED below.
- **App Explorer (RevylAI/app-explorer): NOT run.** Per README it boots a **cloud device** through the Revyl CLI
  (requires `revyl auth login`, so an external account), uploads an APK/IPA, explores screens breadth-first and builds a
  navigation map with screenshots. License and pricing are not stated in the fetched README (NOT_VERIFIED). Out of bounds.
- **Web research:** WebSearch and WebFetch on about 35 public pages (Zynga official and corporate pages, help center,
  store listings, Apple and Google policy pages, Google Identity docs, Meta Graph API docs, web.dev, help pages of three
  other social card games). See RESEARCH_SOURCES.md.
- **Gaps:** no in-app screenshots or video frames of the reference game, so its table layout, gift animations and state
  transitions are NOT_VERIFIED. Meta `user_friends` entry was cut off. Israeli law on games of chance not researched.

### OBSERVED on public Zynga pages (2026-11-01, anonymous visitor)

| Page | What was visible | Use for TABLE21 |
|---|---|---|
| zyngapoker.com | Three feature pillars under the play button: "Lucky Bonus" (a slot-style machine spun daily for free chips), "Collections" (watches and rings shown off to opponents), "Challenges" (three daily goals with prizes). Footer states games are for adults, no real-money gambling, and that social casino success does not imply real gambling success. | Same three-pillar clarity on our home/club (free daily wheel, collection, three missions) with our own art; keep an adult-audience and no-cash disclaimer. |
| store.zyngapoker.com | Two currencies: Chips (wagering) and Gold (spins the "Mega Lucky Bonus"); seven chip tiers and six gold tiers, each requiring login; a "Daily Free Gift" once per 24 h; the web store advertises 20% more chips than in-app stores; FAQ on refunds. Prices only after login. | One currency only (coins), no premium currency; any future store must show fixed contents and come from a configured provider; never sell spins of a random machine. |
| store.zyngapoker.com/daily-streak | Seven daily rewards plus a final reward, all hidden until login; text says skipping a day forfeits previous rewards and the final reward. | Streaks pause instead of resetting rewards already earned; rewards visible before claiming. |
| zynga.com/corporate/zyngapoker15 | 2022 news: 21-day birthday event with daily surprises, Lucky Bonus spins, "unique table gifts", themed tables and limited watches tied to challenges; VIP tiers with exclusive chip packages. | Seasonal themed tables and cosmetic gifts fit; VIP tiers based on spending are left out. |

---

## Components

Format per component: entry point / actions / states / exit and return / errors / animation, then adaptation.

### 1. Lobby

- Entry: the Lobby is the hub; the game menu is "the 3 horizontal lines in the lower left corner of your Lobby screen",
  with a Profile section inside it. DOCUMENTED [avatar FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/22124-how-do-i-change-my-avatar-in-zynga-poker)
- Actions: quick seat ("Join a table in seconds"), cash tables at stake levels, 9-seat and 5-seat tables, Sit n Go,
  Spin and Win, Omaha, multi-table tournaments, rotating weekly events (Cash Clash, Ladder of Loot, Quest for the Chest),
  Poker Dash. DOCUMENTED [App Store](https://apps.apple.com/us/app/zynga-poker-texas-holdem-game/id354902315),
  [zyngaplay about](https://www.zyngaplay.com/casino/zynga-poker/about), [APK mirror 22.70.728](https://apkmirror.com/apk/zynga/zynga-poker-texas-holdem/zynga-poker-texas-holdem-22-70-728-release)
- States: lobby surfaces many time-limited events at once (watch events, passes, weekly events). INFERRED from the
  volume of concurrent events in What's New notes.
- Exit/return, errors, layout, animation: NOT_VERIFIED.
- **Adapt for TABLE21:** a calm Home with one primary action ("open a room" / "join with code"), then at most three
  secondary cards (daily gift, current mission, friends online). Private rooms first.
- **Leave out:** stake-tier ladders that push players upward, event clutter, quick-seat with strangers, public tables.

### 2. Table and seats

- Seats: 9-seat and 5-seat cash tables; 5-seat described as "a faster poker experience"; fast or slow speed settings;
  multi-tabling added in a 2026 version. DOCUMENTED [zyngaplay about](https://www.zyngaplay.com/casino/zynga-poker/about),
  [BusinessWire 2021-11-19](https://www.businesswire.com/news/home/20211119005467/en), [App Store](https://apps.apple.com/us/app/zynga-poker-texas-holdem-game/id354902315)
- Profile is reachable from another player's seat; the profile has a Report button "in the lower right corner".
  DOCUMENTED [report FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/20707-how-do-i-report-someone-in-zynga-poker)
- Fairness: publisher states its RNG is certified and "every undealt card has an equal probability of being drawn".
  DOCUMENTED claim [RNG FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/2112-are-cards-randomly-dealt-in-zynga-poker).
  Server implementation NOT_VERIFIED.
- Errors and seat states (sitting out, reconnect): NOT_VERIFIED.
- **Adapt:** up to 5 seats around a dealer arc (blackjack is player vs dealer, so fewer seats keep cards readable on a
  phone). Seat tap opens the existing avatar tray (profile, gift, reaction, mute, later report/block). A plain
  "How shuffling works" page describing the server shoe (no claims of certification we do not have).
- **Leave out:** multi-tabling, stranger seating, any certification claim.

### 3. Chip stacks and bet selection

- Reference UI for bet selection, chip denominations and stack visuals: NOT_VERIFIED (nothing public describes it).
- Performance evidence for animation: animate `transform` and `opacity`, avoid `top`/`left` and layout-triggering
  properties, use `will-change` sparingly and only when a problem is seen. DOCUMENTED [web.dev animations guide](https://web.dev/articles/animations-guide)
- **Adapt (INFERRED design):** chip rail with 4 to 5 denominations sized to the room's min/max; tap adds, long-press or
  a clear button removes; "repeat last bet" only within table limits; stacks render from integer half-coin units
  (no floats). Chip flight to the betting spot and payout flight back use `transform` only; honor `prefers-reduced-motion`
  (web.dev page does not cover it, so this is our own rule).
- **Leave out:** "max bet" shortcuts, auto-raise, any nudge to bet more after a loss.

### 4. Profile

- Avatars are equipped from Profile > Avatars > Equip; Guest accounts cannot upload images.
  DOCUMENTED [avatar FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/22124-how-do-i-change-my-avatar-in-zynga-poker)
- Collectible watches and rings are shown "to show off to opponents". DOCUMENTED [zyngapoker.com](https://www.zyngapoker.com/)
- Profile hosts the Report flow (category dropdown, optional detail, submit). DOCUMENTED [report FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/20707-how-do-i-report-someone-in-zynga-poker)
- Other game: received gifts add "heart points" that stay on the recipient's profile. DOCUMENTED
  [Governor of Poker 3](https://orangegames.helpshift.com/hc/en/4-governor-of-poker-3/faq/363-poker-gifts)
- **Adapt:** profile card = original SVG avatar, display name, featured collectible (one card back or felt), friendly
  stats (rounds played together, blackjacks, longest friends night), count of gifts received as warmth, not wealth.
- **Leave out:** balance or chip-rank as the headline stat, photo uploads (moderation not ready), VIP tier badges.

### 5. Table gifts

- Zynga Poker offers "unique table gifts" as event daily rewards, "exclusive table gifts" in a 2026 update, and
  "free player gifts" during a birthday event. DOCUMENTED [zyngapoker15](https://www.zynga.com/corporate/zyngapoker15),
  [App Store](https://apps.apple.com/us/app/zynga-poker-texas-holdem-game/id354902315),
  [APK mirror 22.86.1361](https://apkmirror.com/apk/zynga/zynga-poker-texas-holdem/zynga-poker-texas-holdem-22-86-1361-release).
  Exact send flow, cost and display time in Zynga Poker: NOT_VERIFIED.
- Governor of Poker 3 (other game): gifts are "decorative items" to show respect; sent from a present box next to a
  player, to one PLAYER or the whole TABLE (cost multiplied by players); a player holds one gift at a time, a new one
  replaces it; gifts disappear when leaving the room; categories Bling / Tease / Treat. DOCUMENTED
  [Governor of Poker 3 FAQ](https://orangegames.helpshift.com/hc/en/4-governor-of-poker-3/faq/363-poker-gifts)
- Big Fish Casino (other game): gifts bought with Gold include chips for another player and fun items (drinks, pets,
  emotes). DOCUMENTED [Big Fish gifts](https://intercom.help/BigFishCasino/en/articles/11272258-what-are-gifts)
- **Adapt:** keep current Stage B design (free, visual only, 45 s, rate limited, server event id). Add "one for the
  table" (same gift to all seated players, single server event). One visible gift slot per seat, newest replaces oldest.
  Gift tray grouped by mood: thanks, cheer, celebrate, gentle joke.
- **Leave out:** gifts that carry coins, wealth-display gifts priced to show off, "tease losing players" category,
  gifts to non-present players.

### 6. Reactions and emotes

- Emotes are earned through game modes and as season rewards (with card faces) in Poker Suits / Challenge Pass seasons;
  "new emotes" ship in updates. DOCUMENTED [zyngaplay about](https://www.zyngaplay.com/casino/zynga-poker/about),
  [APK mirror 22.62.554](https://apkmirror.com/apk/zynga/zynga-poker-texas-holdem/zynga-poker-texas-holdem-22-62-554-release)
- Chat can be restricted for accounts with "unusual activity". DOCUMENTED [chat FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/16931-why-can-t-i-chat-with-other-players)
- Emote visuals, duration, cooldowns: NOT_VERIFIED.
- **Adapt:** 8 free presets today (already built); unlockable extra reactions as cosmetic rewards; reactions never
  auto-fire after a loss; cooldown stays server-side.
- **Leave out:** free text chat and voice until report/block/moderation exist; mocking emotes.

### 7. Shop

- In-app purchases listed: chip and gold "Stack", "Case", "Vault" bundles from $0.99 to $99.99, plus a $0.99 scratcher.
  DOCUMENTED [App Store](https://apps.apple.com/us/app/zynga-poker-texas-holdem-game/id354902315)
- "The Bonus Wheel can be spun after you make a purchase"; odds shown as an image table. DOCUMENTED
  [Bonus Wheel FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/12614-bonus-wheel)
- VIP Points come from buying chips or gold and from leveling; 7 tiers raise purchase bonuses (25% to 400%) and Lucky
  Bonus (10% to 100%). DOCUMENTED [VIP Center FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/22566-what-is-the-vip-center)
- Google Play rates the app with "In-Game Purchases (Includes Random Items)". DOCUMENTED [Google Play listing](https://play.google.com/store/apps/details?id=com.zynga.livepoker&hl=en_US)
- **Adapt:** none now. No store. If one ever exists: cosmetics only, fixed price, no random paid items, no coin packs.
- **Leave out:** coin purchases, post-purchase wheels, spend-based VIP tiers, purchase bonus multipliers, sweepstakes.

### 8. Daily bonus and streak

- Daily Streak: Day 1 to Day 7 plus a Final Reward; you must log in; skipping a day forfeits earlier rewards and the
  Final Reward. Reset time and post-cycle behavior not stated. DOCUMENTED [daily-streak](https://store.zyngapoker.com/daily-streak)
- Lucky Bonus wheel: free spin "every 2 hours"; Mega Lucky Bonus costs gold; a published probability table lists each
  result's percentage. DOCUMENTED [Lucky Bonus FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/12613-lucky-bonus-mega-lucky-bonus).
  Whether the listed percentages sum to 100%: NOT_VERIFIED (extracted text suggested ~87%, possibly incomplete).
- Daily Bonus Vault opens once per day after a set number of hands. DOCUMENTED [Rose's Rewards FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/19523-what-are-rose-s-rewards)
- **Adapt:** one free daily wheel or scratch card, once per calendar day (Asia/Jerusalem), result decided and stored on
  the server, prize table with exact odds visible before the spin, fictional coins only. Streak is soft: a missed day
  pauses progress, it does not wipe earned rewards.
- **Leave out:** paid spins, 2-hour re-engagement timers, loss-of-progress penalties, "play N hands to unlock".

### 9. Missions (daily goals)

- "Complete your three daily goals and earn prizes!" DOCUMENTED [zyngapoker.com](https://www.zyngapoker.com/)
- Big Fish Casino (other game): Challenges and "Lucky List" tasks such as spinning, betting and winning earn points;
  finishing one replaces it. DOCUMENTED [Big Fish Prize Pass](https://intercom.help/BigFishCasino/en/articles/11272262-prize-pass)
- **Adapt:** three daily missions, social or neutral: play 5 rounds with a friend, send a thank-you gift, host a room,
  get a natural blackjack (pure luck, any stake), finish a friends night. Reward: season points or cosmetics.
- **Leave out:** "bet X", "win X coins", "double down N times", "play at higher stakes", anything rewarding losses.

### 10. Season / challenge pass

- Haunted Hold'em Challenge Pass: 28 days, chip prizes and exclusive watches (Oct 5 to Nov 2, 2026). DOCUMENTED
  [Zynga Halloween 2026](https://www.zynga.com/corporate/zynga-halloween-in-game-updates-2026/)
- Challenge Pass introduced with "rewards worth up to 10x the value"; seasons of Poker Suits and Challenge Pass recur.
  DOCUMENTED [APK mirror 22.43.97](https://apkmirror.com/apk/zynga/zynga-poker-texas-holdem/zynga-poker-texas-holdem-22-43-97-release)
- Big Fish Prize Pass: 14 days, free track plus paid Premium track (up to 50 prizes), progress resets at expiry,
  premium must be re-bought each pass. DOCUMENTED [Big Fish Prize Pass](https://intercom.help/BigFishCasino/en/articles/11272262-prize-pass)
- Zynga Poker premium tier details: NOT_VERIFIED.
- **Adapt:** a free-only "Season track" of about 28 days, points from missions, rewards are cosmetics (card backs,
  felts, reaction packs); anything earned stays forever.
- **Leave out:** paid premium track, "10x value" framing, resets that destroy earned items, coin jackpots at the end.

### 11. Collectibles and collections

- Watches and rings to display; limited-edition watches; Poker Album; multi-location "watch events" (e.g. Jet Set);
  Halloween "House of Shadows" watch. DOCUMENTED [zyngapoker.com](https://www.zyngapoker.com/),
  [App Store](https://apps.apple.com/us/app/zynga-poker-texas-holdem-game/id354902315),
  [APK mirror 22.62.554](https://apkmirror.com/apk/zynga/zynga-poker-texas-holdem/zynga-poker-texas-holdem-22-62-554-release),
  [Zynga Halloween 2026](https://www.zynga.com/corporate/zynga-halloween-in-game-updates-2026/)
- Card faces as rewards. DOCUMENTED (same APK mirror note).
- Sibling Zynga games use sticker albums (18 pages) for collection events. DOCUMENTED [Zynga Halloween 2026](https://www.zynga.com/corporate/zynga-halloween-in-game-updates-2026/)
- **Adapt:** a "Collection" screen of original SVG sets (card backs, felts, dealer buttons, chip skins); one featured
  item shows on profile and seat; sets earned through missions, season track and friends milestones, never purchased
  randomly; duplicates impossible by design.
- **Leave out:** random packs, trading, scarcity pressure, items that change odds or payouts.

### 12. Friends and invites

- Referral: share a code; invitee must be new on that device; both redeem each other's codes; both receive chips.
  DOCUMENTED [referral FAQ](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/faq/21381-how-do-i-refer-friends-to-zynga-poker)
- "Buddy Bonus": "Having more buddies now means bigger rewards and massive multipliers every time you spin!"
  DOCUMENTED [Google Play listing](https://play.google.com/store/apps/details?id=com.zynga.livepoker&hl=en_US)
- Poker Legends (other game): unique Buddy Code, invite buddies to private tables, buddies can send chips.
  DOCUMENTED [Poker Legends buddies](https://helpdesk.dynamicnext.com/support/solutions/articles/4000222003-buddies)
- Zynga has help topics on the Facebook Canvas sunset (titles only read). DOCUMENTED [help index](https://zyngasupport.helpshift.com/hc/en/27-zynga-poker/)
- Facebook `/user/friends` returns only friends who used the app via Facebook Login and granted `user_friends`;
  the page carries a note about a change after Graph API v3.2 (exact scope NOT_VERIFIED). DOCUMENTED [Graph API user/friends](https://developers.facebook.com/docs/graph-api/reference/user/friends/)
- Google sign-in: verify ID token signature, `aud`, `iss`, `exp` (and `hd` only if restricting domains); store `sub`,
  not email, as the identifier. DOCUMENTED [Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- **Adapt:** friend code + shareable room link; friends list with "in a room now" and one-tap join; invite rewards are
  cosmetic and granted only after the friend actually plays a round with you.
- **Leave out:** coin rewards that scale with friend count, sending coins to friends, contact-book scraping,
  automatic posts or messages.

---

## TABLE21 screen map

- Onboarding (name, original avatar, rules of fictional coins)
- Home (lobby)
  - Open private room / Join with code or link
  - Daily gift card -> Daily wheel or scratch (odds table, server result)
  - Missions card (3 daily) -> Missions
  - Friends online strip -> one-tap join
  - Local play (solo, pass-and-play) / LAN host
- Room (table)
  - Seats (up to 5) -> avatar tray: profile peek, gift, reaction, mute, later report/block
  - Chip rail and bet spot -> deal -> hit / stand / double / split (rules per `docs/RULES.md`)
  - Room menu: invite link, house rules, how shuffling works, leave
  - End of night summary
- Friends: list, add by code, invites, later blocks
- Profile: avatar, featured collectible, friendly stats, gifts received
  - Collection: sets, featured item picker
- Rewards: daily wheel history, Season track, missions
- Leaderboard: friends only, non-monetary stats
- Settings: language, sound, reduced motion, mute gifts/reactions, account deletion, legal and "no real money" notice
- (Not now) Store

## Decisions

1. Private rooms with friends are the default and only online mode; no public tables, no bots shown as people.
2. Coins are fictional: no cash-out, no prizes, no redemption, no transfers or coin gifts between players.
3. Gifts and reactions are visual gestures only, server-validated, rate limited, mutable, with one visible gift per seat.
4. Daily wheel or scratch is free, once per day, result computed and persisted server-side before any animation, and
   the full odds table is visible before playing.
5. Streaks pause, they never wipe earned rewards; no countdown pressure shorter than a day.
6. Missions reward social or neutral play; none reward losing, betting more, doubling, splitting or higher stakes.
7. Season track is free-only and cosmetic; anything earned is permanent.
8. Collectibles are deterministic (earned, no random packs, no duplicates) and never affect rules, odds or payouts.
9. Invite rewards are cosmetic, granted once the invited friend plays a round in the same room; nothing scales with
   friend count.
10. Profile celebrates time together (rounds, nights, gifts received), not balance or rank.
11. Animations use `transform` and `opacity`, respect reduced motion, and never block or delay action buttons.
12. No store until a policy review is done; if added, cosmetics only at fixed prices via platform billing.

## Policy notes for a future store

**Not legal advice.** Store rules change; re-read every source and get qualified review (including Israeli law on games
of chance, not researched here) before any launch or monetization.

- **Apple age rating** (DOCUMENTED [Apple age ratings](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions)):
  "Simulated Gambling" is "Betting or wagering without using real money or in-game currency that can be exchanged for
  real money"; Infrequent maps to 13+, Frequent to 18+. "Gambling" (real money or exchangeable currency) is 18+.
  Loot Boxes listed at 9+; Contests Infrequent 4+, Frequent 13+. Australia differs. Zynga Poker is 18+ with Frequent
  Simulated Gambling ([App Store](https://apps.apple.com/us/app/zynga-poker-texas-holdem-game/id354902315)).
  INFERRED: a blackjack table game will likely be Frequent Simulated Gambling, so plan for 18+.
- **Apple payments** (DOCUMENTED [Guidelines](https://developer.apple.com/app-store/review/guidelines/)): 3.1.1 in-game
  currencies and unlocks must use in-app purchase; purchased currencies "may not expire"; randomized paid items "must
  disclose the odds of receiving each type of item to customers prior to purchase"; gifting of IAP items is allowed but
  refundable only to the purchaser and not exchangeable. 5.3.3 no IAP credit for real money gaming; 5.3.4 real money
  gaming needs licensing, geo-restriction and a free app.
- **Apple sign-in** (DOCUMENTED, same page): 4.8 apps using third-party or social login for the primary account must
  also offer an equivalent login option that limits data to name and email, allows a private email, and does not collect
  interactions for ads without consent. The fetched text describes the features and does not name Sign in with Apple
  explicitly (NOT_VERIFIED whether the current text names it).
- **Apple account deletion** (DOCUMENTED, same page): 5.1.1(v) "If your app supports account creation, you must also
  offer account deletion within the app."
- **Google Play payments** (DOCUMENTED [Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)):
  Play billing required for items "such as virtual currencies"; randomized items require clear odds disclosure before
  purchase; billing is excluded for online gambling.
- **Google Play gambling and families** (DOCUMENTED [Real-Money Gambling, Games, and Contests](https://support.google.com/googleplay/android-developer/answer/9877032),
  [Families policies](https://support.google.com/googleplay/android-developer/answer/9893335?hl=en)): real or simulated
  gambling violates the Families policy, so the app must not target children or mixed audiences; gambling-ad rules
  reference under-18 restrictions. Zynga Poker on Play is rated 18+ with "Simulated Gambling" and "In-Game Purchases
  (Includes Random Items)" and states it "does not offer real money gambling or an opportunity to win real money or
  prizes" ([Play listing](https://play.google.com/store/apps/details?id=com.zynga.livepoker&hl=en_US)).
  TABLE21 should write its own equivalent notice in Hebrew, not copy this wording.
- **Web sign-in hygiene** (DOCUMENTED [Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)):
  CSRF cookie check, signature, `aud`, `iss`, `exp`; key by `sub`.
