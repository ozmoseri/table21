# T07 product backlog (TABLE21)

Tags: [V] verified in code (file:line), [D] from docs, [P] proposal. Read-only pass, nothing in the repo changed.
Paths are relative to /home/claude/table21. No em dash used.

## 0. Findings that matter most

1. No coin sink exists in running code. LedgerKind has only grants, match_stack and stake_* / refund (apps/server/src/wallet.ts:5-13) [V]. Daily +300 coins, no sink, so balances only drift up; the "balance" board mostly measures claimed days [V+D: ECONOMY.md section 3 says the same].
2. Weekly "ranking" sorts by net coins (social.ts:219-235) [V]. It rewards the highest stake and luck, not skill or play. This is the one place the product is closest to "fair challenges" being unfair. Not a guardrail breach (it is labeled and needs 20 hands), but it is the cheapest real improvement.
3. Cosmetics run out fast. UNLOCKS = 3 card backs + 3 table themes, all unlocked by 150 hands (social.ts:9-16) [V]. ECONOMY sim assumes a casual friend plays about 510 hands a month [D]. So progression ends in roughly 1 month of casual play [P, derived].
4. Coach accuracy is in memory only and resets on reload (coach.ts:141-153) [V]. No skill tracking over sessions exists.
5. There is no push or notification code at all (grep pushManager / showNotification / web-push: 0 hits in apps/web/src and apps/server/src) [V]. "Friends online" on Home is fetched once on mount (Home.tsx:126-131) [V], not live.
6. store-contract.json does not exist; TEAM_PLAYBOOK.md:46 says it is created only when store work starts [V+D].

## 1. Current journeys (as built)

| Journey | Steps | Friction | Evidence |
|---|---|---|---|
| First open | Onboarding: language toggle, name (max 20), avatar grid, Start. POST /api/session creates a guest with a 2,000-coin welcome grant, then pending deep link or Home. | No intro, no first hand guidance; Guide (#/guide) is not linked from Home [V: Home.tsx has no guide link]. Server asleep: offline note + only practice / pass-and-play offered. | Onboarding.tsx:32-54, 96-110; auth.ts:66, 97-99 |
| Guest to saved account | Home shows "save account" row only for guests. Account screen: 8 recovery codes (shown once, copy/download), pair link valid 10 min for a second device, Google/Facebook linking. | Providers need public HTTPS; today shows "not configured / needs HTTPS". Recovery codes are the only live path, which is heavy for casual friends. Switching accounts warns the guest wallet is not carried over. | Home.tsx:220-225; Account.tsx:32-102, 133-141, 209-213; accounts.ts:7-8; PRD "no cross-device recovery in v1" [D] |
| Play with friends: create | Home "play with friends" opens a sheet: casual or friends-night match, dealer auto/human, turn time, match stack 500/1000/2000, then Open. Idempotent retry. | Many choices before first table (4 setting groups). | Home.tsx:10-93 |
| Invite / join | In-room share sheet: code chip, QR, navigator.share or copy link. Join by typing code on Home (4+ chars). Invite link `#/i/<token>` for friend or club (Invite.tsx) with name-first flow that preserves the deep link. | Invitee must type a name before seeing anything; no "friend is waiting at table X" signal outside the link; room code typed manually. | Room.tsx:28-61, 320; Home.tsx:181-204; Invite.tsx:28-80; Onboarding.tsx:40-48 |
| Reconnect | Socket.IO reconnect shows a "reconnecting" banner and hydrates instead of replaying animations; Home shows a "back to room" card when a seat is in an open room. | Resume card appears only after /api/me loads; no notification when the table moves on without you. | Room.tsx:175; net.ts:16, 36-39; social.ts:31-33, 44; Home.tsx:167-174 |
| Practice / coach | Home practice row opens local table (separate local coins, auto refill +1000 coins when under 10 coins, no cooldown). Coach is on in practice, off in rooms by default; tip button, why-sheet, bust-risk meter, verdict toast, session accuracy line. | Accuracy and any history die on reload. Coach in rooms is private per device, so in friends-night matches one player can have tips on and the others do not [P concern; not verified whether match mode disables it]. | local.ts:92-98; Coach.tsx:102-139; coach.ts:141-153; prefs.ts:20-24; COACH.md |
| Daily grant | Home grant strip (one tap) or Club > Rewards: 300 coins once per Asia/Jerusalem date, PK-enforced; rescue 500 coins when under min stake, once per 6 h. | Claim is manual, one tap; missed days cost nothing (good). Rescue strip appears right after a bust, neutral wording not verified. | Home.tsx:236-243; social.ts:63-96; Rewards.tsx:20-46 |
| Club / leaderboard | Club tabs: ranking, rewards, collection. Ranking needs a group (create / join by code / club invite). Boards: weekly net (min 20 hands), balance, session. | Empty state forces a trip to Friends first. Weekly board = net coins (see finding 2). | Club.tsx:13-31; Leaderboard.tsx:29-41, 51-76; social.ts:209-243 |
| Gifts / reactions | Tap a seat avatar: 6 gifts, 8 preset reactions, per-player and global mute. Server-checked, idempotent, 6 s / 30 per hour limits, 45 s expiry, zero ledger rows. | Only in online rooms (none in solo / pass-and-play). Nothing ties gifts to progress or memory (they vanish). | gifts.ts:5, 28-66; SOCIAL_FEATURES.md [D] |

## 2. Economy map (as built)

### Sources and sinks (ledger kinds)

| Kind | Direction | Trigger | Scope | Evidence |
|---|---|---|---|---|
| grant_welcome | source +2,000 coins | once at guest creation | casual | auth.ts:66, 97-99 [V] |
| grant_daily | source +300 | claim, once per Jerusalem date | casual | social.ts:63-78 [V] |
| grant_rescue | source +500 | balance under min stake, 6 h cooldown | casual | social.ts:81-96 [V] |
| match_stack | source (separate wallet) | friends-night start, 500/1000/2000 | `match:<id>` | rooms.ts:551-552 [V] |
| stake_reserve / stake_release / stake_return | move within wallet | bet, unbet, settle | casual or match | rooms.ts:435-437, 492, 565, 643 [V] |
| refund | move | voided round | same | rooms.ts:680 [V] |
| grant_ad, adjustment | allowed by SQL check, unused | ads disabled | n/a | 001_init.sql:36-38; ads.ts:14 [V]. Note `grant_ad` and `adjustment` are in the SQL check but not in the TS LedgerKind union, so adding either needs a type change. |
| Game result | net source/sink | house edge, about 0.5% [D] | casual | settle at rooms.ts:635+ [V] |
| Sinks | none | no purchase kind exists | n/a | wallet.ts:5-13 [V] |

### Separation and unlocks

| Item | State | Evidence |
|---|---|---|
| Practice vs online | Separate: local coins in the browser, never sent to the server or ranked | local.ts:30 comment, refill at 92 [V] |
| Friends-night vs casual | Separate wallet scope per match; no sweep back to casual found in rooms.ts grep (only a credit at 552) [V, absence by grep] |
| Hand stats and unlocks | Count all rows in hand_results for the user, no mode filter; unlock = hands >= requirement (0/25/100 backs, 0/50/150 themes) | social.ts:99-121 [V] |
| Level | levelFor(hands) only; no XP table, levels do not unlock anything (unlocks read hands directly) | social.ts:18-23, 121 [V] |
| Gifts | cost nothing, no inventory | gifts.ts [V] |

### Guardrail check

| Guardrail | Status | Note |
|---|---|---|
| Fictional coins, no cash value | OK [V] | No purchase code; coinsNote shown on Home, Invite, Onboarding. |
| No transfers between players | OK [V] | Gifts have no ledger rows; no transfer endpoint found in wallet.ts / social.ts. |
| No fake players | OK [V] | Private rooms only; bots not shipped [D: NEXT_STEPS open item 3 says bots are optional and must be labeled]. |
| No odds changes | OK [D+V] | Rules independent of wallet; no wallet read in the coach. |
| No loss shown as win | Mostly OK [V] | Weekly board shows signed value with pos/neg classes (Leaderboard.tsx:76). Keep it. |
| No pressure after a loss | Watch | Rescue is free and optional, no store exists. Any future "low balance" prompt must not link to a purchase [P]. |
| No punitive streaks | OK [V] | Daily grant has no streak; missed days lose nothing. |
| Fairness of competition | Weak spot | Net-coin weekly ranking is stake-weighted (finding 2). Also the balance board mostly shows claim days (finding 1). |
| Inflation | Drift | No sinks; ECONOMY sim says balances grow [D]. Acceptable for a friends circle while rankings do not use balance. |

## 3. Backlog (ranked)

Cost: S = under 1 day, M = 1-3 days, L = more. All items keep server authority, commandId and expectedVersion, integer half-coin units.

| # | Item | Value for Oz + friends | Cost | Depends on | Guardrail risk | Acceptance criteria |
|---|---|---|---|---|---|---|
| 1 | Game-night loop: live friends presence, "table is open" card for friends, one-tap join, evening recap. Replaces push for now. | High. It is the missing "my friend is at a table, join" moment; recap is already planned in SOCIAL_FEATURES.md [D]. | M | Socket presence (server already knows `online` per user, social.ts:31 style callback [V]); no new account. | Recap must not reveal hole cards or shoe; no shaming of losers. | Friend opens Home and sees a live (no reload) "X is at a table" within 5 s; tap joins by code; recap lists hands, best win, rounds played using settled data only; test that recap payload has no card uids; no new ledger rows. |
| 2 | Friend invites and notifications (real push) | Medium-high, but only after a public HTTPS host. | L | Public host (needs Oz approval, ROADMAP stage C/F [D]), installed PWA on iOS (16.4+ for web push, claim from general platform knowledge, not verified here), VAPID keys. No Firebase unless shown necessary (role file). | No marketing pushes, no "come back" nags, nothing after a loss; opt-in per type. | Opt-in prompt only from the player's tap; only two push types (friend invited you, table opened); quiet hours; unsubscribe works; zero pushes in tests when disabled. Out of reach until host is chosen. |
| 3 | Coach progression: persist decision history, per-situation accuracy, "weak spots" drill in practice | High for the stated goal of a sense of improvement; cheap if local-first. | S (local, IndexedDB) / M (server sync) | coach.ts advise() and recordDecision already exist [V]; prefs store is IndexedDB [D COACH.md]. | Rooms: never show an opponent's accuracy; no coin reward for accuracy (would reward slow/coached play); no loss-framing. | Accuracy survives reload and is split by hard/soft/pair and dealer up card; practice shows "3 weakest spots" after 30 decisions; reset button; no data leaves device in phase 1; unit test that aggregation uses only the advice already computed. |
| 4 | Stake-fair weekly ranking | Medium-high. Fixes finding 2 at low cost. | S-M | social.ts:209-243 query; hand_results already has stake_units and net_units [V]. | None if labeled; do not change odds or payouts. | Weekly board offers "net in stakes per hand" (sum net / sum stake) or "hands won %" with sample size; eligibility stays at min hands; board label explains the metric; old coin board kept as a toggle; integration test for two players with different stakes ranked fairly. |
| 5 | Cosmetic progression (hand-based first, no coins) | Medium. Current set ends at 150 hands (finding 3). | M (art) | UNLOCKS list (social.ts:9) and updateProfile checks [V]; original SVG/CSS art only (no paid generation, CLAUDE.md). | Cosmetics must be visual only; never gated by money. | 3-4 more backs/themes plus 2-3 avatar frames or titles, each unlocked by hands or by a friend-based milestone (e.g. 5 tables with friends, not by volume alone); locked items show requirement; `updateProfile` rejects locked ids; items render at 320 px. |
| 6 | Missions / goals | Medium. Gives direction for a small group; risks volume farming. | M-L | New table, ledger kind `mission_reward` (not in TS union), XP model (none today) [V]. ECONOMY drafts 3 per day, 300-450 coins [D]. | Highest of the free items: "play N hands" can push volume; coin rewards worsen inflation (finding 1). Avoid losing/stake/streak goals. | Prefer rewards in XP or cosmetics, not coins (deviation from ECONOMY draft, needs Oz approval). Goals are cooperative or social (play with a friend, send a reaction, try a coach lesson); no goal depends on result or stake; missed day loses nothing; claim idempotent via ledger idem_key if coins are ever used; concurrency test for two devices. |
| 7 | Onboarding first hand (guided practice with coach on, Guide link on Home) | Medium. Friends who do not know blackjack. | S | Guide.tsx and coach exist [V] | None | New guest sees a "first hand" prompt once; skippable; never blocks create or join; Guide reachable from Home in 1 tap. |
| 8 | Economy health report (read-only query script over ledger and hand_results) | Medium for decisions on 5, 6, 9-12. | S | ECONOMY says rerun the sim "with telemetry from real play" [D] | None | Script outputs coins in/out per kind, active days, hands per user per week; no per-user data in logs. |
| 9 | Wheel (OUT OF CURRENT SHIPMENT SCOPE) | Low. ECONOMY draft: EV about 150 coins replacing part of daily [D]. | M | Ledger `reward_claim`, versioned visible prize table, Stage D, Oz approval of table [D]. | Variable-reward mechanic; must replace not add; prize table visible; no extra spin for a loss or for money. | Prize table shown before spin; server draws, one claim per day by idem key; EV equals the documented figure in a test; clock-change and double-device tests. |
| 10 | Scratch card (OUT OF SCOPE) | Low. One-time welcome item per ROADMAP stage D [D]. | S-M | Same as wheel. | Same as wheel | One per user, server-decided, idempotent, odds table shown. |
| 11 | Store (OUT OF SCOPE) | Near zero for a private friends circle; only useful if the product leaves it. | L | **store-contract.json must exist first** (not present [V]); no invented product ids. Stage C accounts, public HTTPS, payment provider, store accounts, legal review [D]. CLAUDE.md forbids purchases in running code. | Highest: pressure after loss, social casino regulation, age rating. | Only after explicit Oz approval of a specific step; contract file lists product ids that come from the provider, never made up; demo store labeled and charges nothing; sandbox tests in MONETIZATION_READINESS.md. |
| 12 | Battle pass / season track (OUT OF SCOPE) | Low-medium; needs content volume. | L | XP, missions (6), cosmetics (5), then store (11) if paid. | Punitive streaks / FOMO; no pay-to-skip in early phase | Free 20-tier track only first; missed weeks never lock content; tier rewards cosmetic or XP only. |

Ranking note: items 9-12 are deliberately last. Items 3, 4, 7 are the cheapest honest improvements; 1 is the biggest value.

## 4. Top 3 for the next round

1. **Game-night loop (item 1)**: a live "friend is at a table" card with one-tap join and a recap, because it fixes the biggest social gap (typed codes, no live presence) without needing push, a host or an account.
2. **Coach progression, local-first (item 3, with 7 if time)**: persisted accuracy and weak spots give a real sense of improvement at S cost, using code that already exists, with no coins and nothing visible to other players.
3. **Stake-fair weekly ranking (item 4)**: the current board is stake-weighted net coins, so one cheap query change makes the friends competition honest and keeps all guardrails.

## 5. Questions that need Oz

- Missions: OK to reward XP / cosmetics instead of the drafted 100-200 coins, given no sinks exist? [P]
- Coach in friends-night matches: allow, show a "coach on" flag, or turn it off in match mode? [P]
- Host choice for friends on other networks (blocks push, accounts, pilot): still open in NEXT_STEPS [D].
