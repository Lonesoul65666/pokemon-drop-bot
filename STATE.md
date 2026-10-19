# pokemon-drop-bot — V4 Architecture & Multi-Agent State (`STATE.md`)

> **SINGLE SOURCE OF TRUTH:** Any AI agent (Claude, Gemini, or subagents) working in `C:\pokemon-drop-bot` MUST read this file first before inspecting or modifying code, and MUST append an entry to the **Last Touch Log** at the bottom before finishing a session or committing changes.

---

## 1. System Architecture & Runtime Topology

- **Repository Root:** `C:\pokemon-drop-bot` (Node.js, TypeScript compiled to CommonJS `.js`, Express, PM2, Windows native).
- **PM2 Processes:**
  1. `pokemon-drop-bot` (`index.js` / `index.ts`): Autonomous background market sniper, 31-store Shopify LGS poller, Big-Box TrackaLacker aggregator poller, Reddit `r/PKMNTCGDeals` poller, TCGPlayer verified-seller undercut poller, 6-hour TCGPlayer MarketSync baseline worker, 14-day Market Tape NRT engine, and 4-hour Discord Live Shelf Digest scheduler.
  2. `drop-bot-dashboard` (`server.js` on `http://localhost:3000`): Express REST API & Command Dashboard server serving `dashboard.html`, live stock, policies, market tape, MSRP trophies, conquered vault plaques, and on-demand Bounty Hunter recon.
- **Gateway & Proxy Routing:**
  - Uses direct-first HTTP requests with automatic fallback to `WEBSHARE_PROXY_URL` (`146.103.1.23:5556` via `HttpsProxyAgent` in `.env` — **NEVER expose raw proxy credentials or Discord webhook tokens in git**).
  - Bounded concurrency pool (`MAX_CONCURRENT_STORES = 8`, `8000ms` timeout) with a per-store circuit breaker (`storeHealth.json`: 3 consecutive failures trigger a 15-minute cooldown).

---

## 2. Core TypeScript & JavaScript Modules

- **`policies.ts` / `policies.js`:**
  - Loads and hot-watches `policies.json` (`WATCH_POLICIES`).
  - Enforces `GLOBAL_JUNK_EXCLUSIONS` (including `/open case/i`, `/open box/i`, `/opened case/i`, `/unsealed case/i`, `/loose boxes/i`), `BOOSTER_BOX_EXCLUSION_TERMS`, and `PC_EXCLUSIVE_EXCLUSION_TERMS`.
  - Provides `isValidSkuForFormFactor()`, `getMinPlausiblePriceFloor()`, `getMaxPlausiblePriceCeiling()`, `getPackCountForSku()`, `computeRipMetrics()`, and `atomicWriteJson()`.
- **`evaluator.ts` / `evaluator.js`:**
  - Evaluates incoming restock items (`evaluateItem()`) against `WATCH_POLICIES`.
  - **Landed Cost & Shipping Math:** Uses `STORE_SHIPPING_RULES` (`getStoreShippingProfile()`) to compute `landedPrice = dropPrice + estimatedShipping` and multi-unit free-shipping threshold notes (`qtyForFreeShip <= 4`).
  - **Pack Count & `$/Pack` Rip Math:** Computes `packCount` (`36` Booster Box, `216` Master Case, `9` ETB / `11` PC ETB, `90` ETB Case, `6` Booster Bundle), `pricePerPack` (`landedPrice / packCount`), and `isRipValueLeader` (`pricePerPack <= 4.25`).
  - **Pre-Release Bleed Tagging:** Checks `releaseDate` (e.g., `"2026-11-06"` on Mega Evolution: Delta Reign targets) and flags pre-release items with `isPreRelease: true` and `preReleaseStatusTag: "⏳ PRE-RELEASE BLEED (Wait for Launch Week)"`.
  - **MSRP = Defcon-1 Override & Trophy Counter:** Any deal hitting Tier-A True Retail MSRP (`landedPrice <= msrpCeiling * 1.08` with shipping `<= $6.99`) sets `isMsrpUnicorn: true`, bypasses `inVault` / `owned` + `muteVaulted` suppression, and logs the catch to `data/msrpTrophies.json`.
  - **"Rule of 3" Family Pack Cart Links:** Generates stock-aware `/cart/{variant_id}:1`, `:2`, and `:3` instant-checkout links for Shopify ETB drops (omitting `:2` or `:3` if known `inventory_quantity` is `< 2` or `< 3`).
- **`notifier.ts` / `notifier.js`:**
  - Rate-limited FIFO Discord webhook queue (`enqueueDiscordWebhook()`, `1250ms` spacing, HTTP 429 backoff).
  - Formats Discord embeds with live TCGPlayer + eBay comps, `🚨💎 UNICORN RETAIL MSRP HIT 💎🚨` header + `0x00F0FF` diamond embed color + `@everyone` ping on Tier-A MSRP hits, Rule of 3 ETB cart links (`⚡ 1x Single`, `⚡ 2x Pair`, `⚡ 3x Family Pack (Free Ship Threshold)`), and auto-edits embeds to `❌ SOLD OUT` when stock clears.
- **`marketComps.ts` / `marketComps.js`:**
  - Scrapes live TCGPlayer seller listings and eBay Buy-It-Now comps with trimmed median sanity guards (`applySyncSanityGuard`) and open-case/open-box blocklists (`GLOBAL_JUNK_BLOCKLIST`, `MULTI_CASE_BLOCKLIST`).
- **`marketTape.ts` / `marketTape.js`:**
  - 14-day rolling NRT sales velocity tracker (`⚡ FLASH`, `🔥 FAST`, `🐢 SLOW`), absorption ratio, distributor wave detector (`>= 3` stores in 48h), honey-hole store rankings, Sunday-to-Sunday weekly checkpoints, and `$/Pack` metrics.
- **`lgsPoller.ts`, `vampirePoller.ts`, `src/marketSync.ts`:**
  - Continuous polling engines for 31 US Shopify LGS storefronts, TrackaLacker Big-Box offers, Reddit deals, TCGPlayer undercuts, and 6-hour baseline synchronization.
- **`server.js`:**
  - Express HTTP server (`PORT = 3000`) exposing all REST endpoints for the dashboard.

---

## 3. Active REST API Endpoints (`server.js` on Port 3000)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/status` | System health, `totalMsrpHits`, `msrpTrophies`, `totalConquered`, `collectorRank`, and `storeHealth`. |
| `GET` | `/api/policies` | All target policies enriched with `packCount`, `pricePerPack`, `isRipValueLeader`, `isPreRelease`, and `preReleaseStatusTag`. |
| `POST` | `/api/policies` | Atomically saves updated target policies (`policies.json`) and triggers hot-reload. |
| `GET` | `/api/live-stock` | Currently in-stock items under buy threshold (`< 6h` old) with landed cost, cart links, and `$/Pack` math. |
| `GET` | `/api/drops` | Last 25 alerted drops (`dropsHistory.json`) enriched with `packCount`, `pricePerPack`, and `isRipValueLeader`. |
| `GET` | `/api/trophies` | Persistent MSRP Unicorn counter (`totalMsrpHits` + last 20 retail MSRP catches from `data/msrpTrophies.json`). |
| `GET` | `/api/conquered-vault` | Returns all conquered trophy plaques (`conqueredVault.json`), `totalConquered`, `collectorRank`, and `ruleOf3Progress`. |
| `POST` | `/api/conquered-vault/claim` | One-click endpoint to snapshot a live deal or alert into `conqueredVault.json` and mark the SKU `owned: true`. |
| `PATCH` | `/api/conquered-vault/:id` | Updates `ruleOf3Status` pips (`ripped`, `onWall`, `subsidized`, `sealedCase`), `deliveryWindow`, `orderRef`, or `memoryNote`. |
| `GET/POST` | `/api/bounty-recon` | On-Demand Bounty Hunter recon (`?skuId=` or `?query=`). Ranks `top5LowestLanded` with `$/Pack` math and returns `bestSealedHold` (`#1 Best Sealed Hold`) and `cheapestPackRip` (`#1 Cheapest Pack Rip`). |
| `GET` | `/api/market-tape` | Full 14-day Market Tape analytics, target verdicts, honey-hole stores, sales history, and `msrpTrophies`. |
| `GET` | `/api/trends` | Alias/enriched Market Tape + MSRP Trophies payload. |
| `POST` | `/api/market-tape/checkpoint` | Forces an immediate weekly checkpoint snapshot. |
| `GET` | `/api/telemetry` | Raw rolling average and lowest observed price cache (`marketCache.json`). |
| `GET` | `/api/store-health` | Per-store polling health and circuit breaker state (`storeHealth.json`). |
| `GET/POST` | `/api/settings` | Reads/writes `botSettings.json` (e.g., `{ muteVaulted: boolean }`). |
| `POST` | `/api/reset-dedup` | Clears 4-hour alert deduplication memory (`alertState.json`). |
| `POST` | `/api/send-digest` | Forces an immediate 4-hour Live Shelf Digest card to Discord. |
| `POST` | `/api/test-alert` | Fires a sample Prismatic Evolutions ETB Discord alert. |
| `POST` | `/api/live-comp` | Fetches live dual market comps (TCGPlayer + eBay) and optionally pushes to Discord. |

---

## 4. Critical Persistent JSON Files

All persistent JSON files are written via `atomicWriteJson()` (`.tmp` write + `fs.renameSync`) to prevent corruption:
- `policies.json`: Master target matrix (SKUs, matchers, `msrpCeiling`, `maxMarketBuyPrice`, `estimatedMarketValue`, `owned`, `releaseDate`).
- `conqueredVault.json`: Gamified Trophy Plaque ledger (seeded with Trophy #1: `me-30th-celebration-etb-case` from `Player One Services (Verified WPN)` @ `$1,529.45`, Order `8E2261C4-EEED7D-7D4DB`, and Trophy #2: `me-chaos-rising-etb` from `Cooperstown Cards (TCGPlayer Verified Seller)` @ `$51.00` MSRP catch, Order `B108C090-96CCFE-CA0AF`).
- `data/msrpTrophies.json`: Persistent Tier-A Retail MSRP Unicorn counter (`totalMsrpHits` and last 20 catches).
- `marketCache.json` / `salesHistory.json` / `dailySnapshots.json` / `weeklyCheckpoints.json` (`marketHistory.json` equivalents): Rolling price telemetry and 14-day Market Tape state.
- `liveStock.json`: Real-time in-stock shelf state and 4-hour recent OOS list.
- `dropsHistory.json`: Last 25 Discord alert payloads.
- `botSettings.json`: User dashboard preferences (`muteVaulted`).
- `alertState.json`: 4-hour per-rule/per-store deduplication memory.
- `storeHealth.json`: 31-store Shopify polling health & circuit breaker status.

---

## 5. Current Phase & Executive UI Architecture (V4 Step 2B — 100% Complete & Live on `http://localhost:3000`)

- **Current Phase:** **V4 Step 2B — 100% COMPLETE & VERIFIED LIVE (`http://localhost:3000`)**
  - Includes the **Executive Sidebar UI Overhaul**, **Collapsible Hero Battle Stage (`Arena: Open / Mini`)**, **1080p/2K/4K Responsive Layout**, **Diagonal Cartoon Scene-Wipe Transitions (`0.75s` `#sidebar-wipe-overlay`)**, and **Logan's Playable Pokédex Battle Stadium** (`#clash-cutin-overlay` in `Hold-Open` mode by default with Live Arcade HP Bars, 4 Clickable Attack Moves + Ultimate Signature Attacks, Web Audio API Synth SFX + `.ogg` Cries, Elemental Projectiles, Real 18-Type Damage/Crit Math, `Sim Full Battle`, `Random Battle`, `Full Heal`, inside-stadium `Evolve (+30% HP)` & `Shiny: ON/OFF`, and the Bottom 22-Pokémon All-Star Roster Dock + `#1–1025` Live Search).
- **Collapsible 4-Tab Sidebar Navigation (`COMMAND VIEWS` — Zero Emoji/Icon Clutter):**
  1. `Live Command`: Real-time radar, 3 Hero KPI cards (Vault & Portfolio Value, Active Sniper Radar, `Unicorn MSRP Trophy Counter`), Live Deal Feed with quick filters (`All Hits`, `Under Trigger`, `Sealed Cases`, `ETBs & Boxes`, `Best $/Pack`), Rule of 3 instant-cart buttons (`1x`, `2x`, `3x`), and 1-Click `Claim`, plus 3-column Market Intelligence Bento and collapsible 14-Day Market Ledger.
  2. `Bounty Hunter`: On-demand live recon interface powered by `/api/bounty-recon`, comparing Top 5 lowest landed options, `$/Pack` rip math (`RIP VALUE LEADER <= $4.25/pk`), `#1 Best Sealed Hold`, and `#1 Cheapest Pack Rip`.
  3. `Conquered Vault`: Gamified Conquered Vault & Trophy Plaque showcase powered by `/api/conquered-vault` (featuring Trophy #1 `30th Celebration 10-ETB Case` and Trophy #2 `Chaos Rising ETB @ $51.00 MSRP`, recreated Discord alert banners, interactive `ruleOf3Status` pips, editable memory notes, and Wall Display Checklist with case overlay badges).
  4. `Target Matrix`: Full 38-target policy configuration grid with `$/Pack` badges, Pre-Release Bleed warnings (`PRE-RELEASE BLEED`), Universal Calibrate presets, and admin controls.
- **Dynamic Pokédex Chameleon, Collapsible Hero Battle Stage & Logan's Playable Battle Stadium:**
  - Defaults to **Scott's Gyarados + Logan's Arcanine Tag-Team** over a **Royal Purple / Obsidian** executive theme (`#08070F`) with collinear diagonal polygon washes and `0.26` opacity official artwork watermarks shining through smoked-glass cards (`rgba(11, 10, 19, 0.36)`).
  - Supports interactive **Click-to-Evolve (`Stage X/N` recursive PokeAPI resolver for all 1,025 Pokémon) & Shiny toggle**, portal-mounted `Switch ▾` selector (`z-index: 99995`), `.ogg` cries (`0.35` volume), and full-screen playable turn-based / auto-sim battles inside `#clash-cutin-overlay`.

---

## 6. Last Touch Log

- **2026-10-18 | Agent: Gemini 4 Argon (via `agy`)**
  - **V4 Step 2B Final Checkpoint & GitHub Backup (`100% Complete & Verified Live on http://localhost:3000`):**
    - Recorded full completion of **V4 Step 2B** across `STATE.md`, `public/index.html`, `dashboard.html`, `server.js`, `conqueredVault.json`, and `data/msrpTrophies.json`: Executive Sidebar UI Overhaul, Collapsible Hero Battle Stage (`Arena: Open / Mini`), 1080p/2K/4K Responsive Layout, Diagonal Cartoon Scene-Wipe Transitions (`#sidebar-wipe-overlay`), and Logan's Playable Pokédex Battle Stadium with Live HP/Attacks/Auto-Sim/Roster Dock.
  - Completed V4 Step 2B.7 ("Logan's Interactive Pokédex Battle Stadium + Hold-Open Mode + Sidebar Cartoon Scene Wipe") in `public/index.html` (and synced `dashboard.html`):
    - **Hold-Open Battle Stadium Mode (`battleAutoClose: false` by Default):** `#clash-cutin-overlay` stays open indefinitely by default and never closes when clicking on the background, Pokémon, or stat cards. Added explicit top-right `✕ Exit Stadium (Esc)` button + `Auto-Close: OFF / 6s` toggle pill (`toggleBattleAutoClose`), and restricted keyboard dismissal to `Escape` only.
    - **Playable Turn-Based / Click-to-Attack Battle Stadium (`executeStadiumMove`, `TYPE_MOVE_POOL`, `getFourMovesForPokemon`):** Added arcade **Live HP Health Bars** (`HP: 348 / 348` transitioning Emerald Green ➔ Amber Yellow `<50%` ➔ Crimson Red `<20%`) with floating `-XX HP` damage popups and K.O. trophy celebration banner; **4 Clickable Attack Move Buttons** per Pokémon (pulling real moves from PokeAPI `/api/v2/pokemon/{id}` + 18-Type signature move pools including an Ultimate Signature Attack with `2x SUPER` / `0.5x RESIST` / `0x IMMUNE` tags); attacker lunge (`anim-lunge-right` / `anim-lunge-left`), elemental projectile bursts across the diagonal seam (`spawnElementalProjectile`), Web Audio API synth SFX (`playBattleSynthSfx('whoosh'|'impact'|'victory')`) + `.ogg` cries, defender flash/recoil (`anim-hit-recoil`), arena shake (`anim-arena-shake`), real Pokémon damage formula (`ATK`/`SPA` vs `DEF`/`SPD`, `15%` crit chance, 18-Type multiplier), Center VS Battle Announcer Log (`#stadiumBattleLogText`), `Sim Full Battle` (`toggleAutoSimBattle`), `Random Battle` (`triggerRandomStadiumBattle`), `Full Heal` (`resetBattleStadiumMatch`), and live inside-stadium `Evolve (+30% HP)` (`stadiumEvolvePokemon`) + `Shiny: ON/OFF` (`stadiumToggleShiny`).
    - **Bottom All-Star Roster Dock Inside the Battle Screen (`#stadiumDockRosterRow`):** Added a bottom horizontal roster dock inside `#clash-cutin-overlay` with `Tag Into: [Left: Slot 1] / [Right: Slot 2]`, 22 Hall of Fame mini-portraits (`HOF_ROSTER_BUTTONS`), and live `#1–1025` search (`#stadiumDockSearchInput` + `Tag In`).
    - **Diagonal Cartoon Shutter Wipe When Switching Sidebar Views (`#sidebar-wipe-overlay` + `switchMainView`):** Added a `0.75s` Cartoon Shutter Wipe (`0.32s` diagonal shutters slam together with spinning center Poké Ball + scene title pill, swap view at `0.34s`, shutters pull apart at `0.38s`) whenever switching between `Live Command`, `Bounty Hunter`, `Conquered Vault`, and `Target Matrix` while `Battle FX` is `ON`.
  - Completed V4 Step 2B.6 ("Portal-Mounted `Switch ▾` Pokémon Selector Popover, Dynamic `Stage X/N` Evolution Badge & Live Command Label Polish") in `public/index.html` (and synced `dashboard.html`):
    - **Fixed `Switch ▾` Pokémon Selector Stacking Context Bug (`#rosterPopover` + `#rosterPopoverBackdrop`):** Set `.premier-battle-stage` to `position: relative; z-index: 600; overflow: visible !important;` and KPI/Deal Feed containers to `position: relative; z-index: 10;`. Promoted `#rosterPopover` (`position: fixed; z-index: 99995;`) and click-outside `#rosterPopoverBackdrop` (`position: fixed; inset: 0; z-index: 99990;`) to direct children of `document.body`, dynamically positioned below the clicked `Switch ▾` button via `getBoundingClientRect()` with viewport edge clamping and auto-focus on `#pokeSearchInput`.
    - **Fixed Hardcoded `Stage 1` Badge on Evolved Pokémon (`updateSlotDOM`):** Dynamically computes the stage badge from the resolved evolution chain index (`Stage ${i + 1}/${N}` for multi-stage chains — e.g. `Stage 1/3` for Squirtle, `Stage 2/3` for Wartortle, `Stage 3/3` for Blastoise, `Stage 2/2` for Gyarados/Arcanine — and `Base Form` for single-stage non-evolving Pokémon).
    - **Cleaned Up Minor Text Wrapping & Duplicate Labels:** Stacked `SNIPER TELEMETRY` above `● 31/31 Stores Online` in the sidebar so it never wraps into a cramped 2-line column; changed KPI Card #2 (`Active Sniper Radar`) footer to `Proxy & Poller Engine` on the left and `● ARMED & NOMINAL` on the right; renamed the first top navbar toggle to `Arena: Open` / `Arena: Mini`; and streamlined the `LIVE DEAL FEED` header + quick filter pills onto a single uncrowded row.
  - Completed V4 Step 2B.5 ("3-Column Non-Overlapping Stat Battle Showcase, Zero-Icon Left Sidebar Tabs & Clean Live Deal Feed Subtitle") in `public/index.html` (and synced `dashboard.html`):
    - **Fixed Full-Screen Battle Overlay Overlap (`#clash-cutin-overlay`):** Rebuilt the center stat showcase as a non-overlapping 3-column CSS Grid (`display: grid; grid-template-columns: minmax(300px, 360px) 220px minmax(300px, 360px); gap: 24px; align-items: center; justify-content: center;`) so the Center `VS` Poké Ball + Matchup Pill sit inside their own dedicated `220px` center lane between the two Stat Cards—never overlapping the stat bars or numbers. Moved `#cutinBannerHeadline` (`MEWTWO VS CHARMELEON`) and `#cutinMatchupBadge` (`BALANCED ELEMENTAL CLASH`) into `.cutin-top-header` (`top: 48px`) above the stat cards, and moved the `Click Anywhere or Press Space / Esc to Dismiss` pill + `#cutinProgressBar` down to `.cutin-bottom-dismiss` (`bottom: 32px; left: 50%; transform: translateX(-50%);`) so 100% of both Stat Cards are completely unobstructed.
    - **Removed All Symbols/Icons from Left Sidebar `COMMAND VIEWS` Tabs + Stray `↗` Arrows:** Removed all left-side `<svg>` icons from `Live Command`, `Bounty Hunter`, `Conquered Vault`, and `Target Matrix` so they render only the clean text label on the left with the active left border accent bar and numeric/status pills (`6`, `RECON`, `2`, `131`) on the right. Stripped stray `↗` arrows from `2 Plaques Locked` and `Trophy #2`.
    - **Replaced Literal Prompt Text Subtitle Under `Live Deal Feed & Recent Discord Alert Hits`:** Replaced the literal prompt string with clean executive copy (`"Real-time restock & price-drop feed across 31 LGS, Big-Box, and verified marketplace feeds"`).
  - Completed V4 Step 2B.4 ("Responsive 1080p/2K/4K Scaling, Premier Collapsible Battle Stage, Flush Polygon Diagonal Seam, Click-to-Dismiss 6-Stat Battle Showcase & Deal Engine Polish") in `public/index.html` (and synced `dashboard.html`):
    - **Two-Tier Header + Collapsible Premier Hero Stage:** Rebuilt `.top-header` into a clean `56px` non-clipping executive navbar with a modern geometric hex crest + `DROPBOT` wordmark + `● 31 STORES ARMED` pill on the left and 6 compact controls on the right (`Stage: Open/Mini`, `Peek Art`, `Battle FX: ON/OFF`, `Cry Audio: ON/OFF`, `Auto-Checkout: OFF/ON`, `Sync Prices`). Promoted the Pokémon Tag-Team & Versus Arena into `#premierBattleStage` at the top of `<main>` featuring `108px x 108px` High-Res Official Artworks, `38px` animated `.gif` sprites, `20px` bold un-truncated Pokémon names, inline `BST / HP / ATK / SPD` stat summaries, non-overlapping `Switch ▾` / `Evolve` / `Stage 1` / `Shiny: ON/OFF` controls, a `58px` center Poké Ball `VS` Core with live multiplier verdict badge, and a `44px` `Stage: Mini` ribbon mode persisted in `localStorage`.
    - **Responsive 1080p / 16:10 / 2K / 4K Scaling Fixes:** Restructured KPI Card #1 (`Vault & Portfolio Value`) so `$2,356.15` (`clamp(1.65rem, 2.2vw, 2.35rem)`) sits on its own hero line with `Trophy Basis: $1,580.45` directly underneath and `2 Plaques Locked ↗` (`white-space: nowrap`). Upgraded KPI Card #2 (`Active Sniper Radar`) with clickable flex rows (`text-overflow: ellipsis`) + `-XX%` discount badges that jump directly to `Bounty Hunter`, and set `#liveDealFeedGrid` to `repeat(auto-fit, minmax(310px, 1fr))` inside a `max-width: 1920px` container.
    - **Flush Polygon Diagonal Seam & Click-to-Dismiss 6-Stat Pokédex Battle Screen:** Unified the Left/Right polygon shutters (`polygon(0 0, var(--seam-x1) 0, var(--seam-x2) 100%, 0 100%)` and `polygon(var(--seam-x1) 0, 100% 0, 100% 100%, var(--seam-x2) 100%)`) and SVG `<line>` energy beam to share identical `(X1%, X2%)` coordinates (`68%/46%` for Slot 1 advantage, `54%/32%` for Slot 2 advantage, `56%/44%` for Neutral `1x`). Upgraded `#clash-cutin-overlay` into a click/Space/Esc-to-dismiss (or 7s auto-dismiss with `#cutinProgressBar`) Full-Screen Stat Battle Showcase displaying `380px x 380px` renders alongside Official Pokédex 6-Stat Cards (`HP`, `ATK`, `DEF`, `SPA`, `SPD`, `SPE` bars, `Total BST`, `Abilities`, and offensive/defensive multipliers).
    - **More Translucent Smoked Glass Cards + Complete Spread Math & Quick Filters:** Lowered card opacity to `rgba(11, 10, 19, 0.36)` (`backdrop-filter: blur(6px)`), boosted background Pokémon watermark opacity to `0.26` (`500px x 500px`), added `Peek Art` mode (`0.05` card opacity on toggle), added Live Deal Feed quick filter pills (`All Hits`, `Under Trigger`, `Sealed Cases`, `ETBs & Boxes`, `Best $/Pack`), and added `-XX% Under Mkt (Save $XX)`, `$/Pack`, and `Trigger: $XXX` pills to every deal card.
  - Completed V4 Step 2B.3 ("Emoji/Wingding Purge, Single-Row 68px Command Header, Permanent Translucent Smoked-Glass Cards, 18-Type High-Ground Geometry & 2.4s Cartoon Wipe Cut-In") in `public/index.html` (and synced `dashboard.html`):
    - **Zero Emoji / Wingding Clutter & Clean Human Source Labels:** Stripped 100% of decorative emojis across the sidebar (`Live Command`, `Bounty Hunter`, `Conquered Vault`, `Target Matrix` with crisp single Lucide SVGs), KPI cards, buttons, badges, and JS-rendered strings (`stripEmojiClutter`). Added `formatHumanSourceLabel` to map raw internal strings like `TCGPLAYER_BASELINE` into clean human store/source labels (`Cooperstown Cards • TCGPlayer Verified`).
    - **Single-Row `68px` Top Command Header:** Locked `.top-header` (`height: 68px; flex-wrap: nowrap; padding: 0 20px;`) with a compact brand mark on the left, streamlined `52px`-height Tag-Team Battle Arena Pod (`max-width: 540px`) in the center, and a single-line segmented control bar (`Cut-In FX`, `Auto-Launch`, `Audio`, `Sweep Comps`) with `6px` glowing status indicator dots on the right.
    - **Permanent Smoked-Glass Translucency & Unobstructed Watermarks:** Set `.glass-card`, `.kpi-card`, `.deal-card`, `.bounty-card`, `.matrix-card`, `.machined-card`, `.machined-trophy-card`, and `.unicorn-holo-card` to permanent `rgba(12, 11, 20, 0.50)` with `backdrop-filter: blur(8px)`, and positioned `#bgWatermarkSlot1` (`left: 250px; top: 110px; width: 460px; height: 460px; opacity: 0.18; filter: saturate(1.25) contrast(1.1);`) and `#bgWatermarkSlot2` (`right: 30px; bottom: 40px; width: 460px; height: 460px; opacity: 0.18;`) so the Pokémon renders shine through the glass cards.
    - **18-Type Effectiveness Engine & 2.4s Retro Cartoon Wipe Cut-In (`TYPE_CHART_18` + `getTypeMatchup`):** Implemented the full 18-Type Pokémon matchup matrix driving both the ambient background diagonal angle and the `2.4s` full-screen Cut-In transition (`0.0s–0.50s` shutter wipe-in, `0.50s–1.70s` `1.2s` dramatic hold with `scale(1.0) -> scale(1.06)`, `1.70s–2.40s` wipe-out into background watermarks), supporting Case A (`Slot 1 > 1x` Top-Left `58%` High Ground at `125deg`), Case B (`Slot 2 > 1x` Top-Right `58%` High Ground at `55deg`), and Case C (`Neutral 1x` `50/50` clash with a Spinning Poké Ball Cartoon Iris-Wipe).
    - **Bounty Hunter Workspace Grid Overhaul:** Rebuilt Bounty Hunter with a single sleek horizontal toolbar, equal-height 3-column Spotlight Cards (`#1 Best Sealed Hold` & `#1 Cheapest Pack Rip`), and crisp 7-column horizontal grid rows for `Top 5 Lowest Landed Options`.
  - Completed V4 Step 2B.2 ("Universal 1,025-Pokémon Recursive Evolution Resolver & Full-Screen Diagonal Clash Cut-In Animation") in `public/index.html` (and synced `dashboard.html`):
    - **Universal 1,025-Pokémon Recursive Evolution Resolver (`resolveFullEvolutionChain`):** Added built-in chains for `Squirtle (7) ➔ Wartortle (8) ➔ Blastoise (9)`, `Charmander (4) ➔ Charmeleon (5) ➔ Charizard (6)`, and `Lillipup (506) ➔ Herdier (507) ➔ Stoutland (508)` alongside all Hall of Fame presets, plus an automatic recursive PokeAPI `evolution_chain` resolver & `localStorage` cache (`dropbot_v4_evo_chains_v2`) that resolves full multi-stage / branching evolution chains and fetches next-stage types/artwork on the fly for all 1,025 Pokémon.
    - **Separated `⚡ Evolve` & `✨ Shiny` Header Controls + Full-Name Header Layout:** Added distinct `#slot1EvolveBtn` / `#slot2EvolveBtn` (`⚡ Evolve` ➔ `🔄 Reset Base` for multi-stage chains, `MAX FORM` for single-stage apex Pokémon) and `#slot1ShinyBtn` / `#slot2ShinyBtn` (`✨ Shiny` / `✨ Shiny ON` at any evolution stage), and expanded `.battle-arena-pod` (`min-width: 610px`, `white-space: nowrap`) so names like `Sylveon` and `Charmeleon` never truncate.
    - **Full-Screen Diagonal Clash Cut-In Animation (`#clash-cutin-overlay`):** Built a hardware-accelerated (`z-index: 9999; pointer-events: none;`) 2-phase Battle Cut-In overlay that sweeps opposing `115deg` elemental slash banners + `420px` High-Res Official Artworks across the screen (`0.0s–0.35s`) with a center Poké Ball `VS` shockwave and arcade callout banner, then smoothly drifts/scales the two giant renders outward into the `0.11` opacity background watermarks (`0.85s–1.45s`) while the dashboard rises into focus. Added 1-click replay on the center Poké Ball `VS` emblem (`replayTagTeamClash()`) and a `🎬 Cut-In FX` toggle in the top header.
  - Completed V4 Step 2B.1 Visual & Layout Overhaul in `public/index.html` (and synced `dashboard.html`):
    - **Organic Diagonal Elemental Clash Atmosphere & Center Poké Ball VS Arena Header Pod:** Added 115-degree multi-layered diagonal elemental collision background over `#08070F` (`--slot1-primary-rgb` upper-left wash vs `--slot2-primary-rgb` lower-right counter-wash blended through Royal Purple with low-opacity `0.08` high-res official artwork watermarks `#bgWatermarkSlot1` and `#bgWatermarkSlot2`). Upgraded the header pod (`min-width: 530px`) with a center glowing SVG Poké Ball `VS` emblem, `68px x 68px` official high-res artwork (`#slot1HiResArt`, `#slot2HiResArt`), `32px` animated `.gif` sprites, and dynamic Shiny elemental aura shifts (e.g., Crimson Red Shiny Gyarados, Radiant Gold Shiny Arcanine).
    - **Sticky Left Sidebar & Eye-Level Telemetry:** Locked `#appSidebar` (`position: sticky; top: 76px; height: calc(100vh - 76px)`) with the Sniper Telemetry pod directly below the 4 navigation tabs at eye level, and fixed `.sidebar.collapsed` (`68px` width) so all text/badges hide cleanly (`display: none !important`) with centered hover-tooltip icons and a compact pulsing green status dot.
    - **Front Board Readability, KPI Card #2 Mini-Table & Overhauled 3-Column Live Deal Feed Cards:** Boosted text contrast (`#F8FAFC` / `#CBD5E1`) with directional clash specular top borders on the 3 Hero KPI cards, replaced KPI Card #2 (`Active Sniper Radar`) stacked pills with a 3-row Compact Telemetry Mini-Table, and rebuilt the Live Deal Feed cards (`min-height: 235px; grid-template-columns: 96px 1fr; gap: 16px`) with a `96px x 96px` radial-lit artwork well + format tag, `16px` bold white title, `26px` `JetBrains Mono` hero drop price, and a single non-wrapping bottom footer (`⚡ 1x | 2x | 3x` on left, `🏆 Claim` on right).
  - Completed V4 Step 2B ("DropBot Commander — Gyarados & Arcanine Executive UI Overhaul" + Trophy #2 Seed):
    - Seeded Trophy #2 (`trophy-2-chaos-rising-etb-msrp` — `Mega Evolution: Chaos Rising Elite Trainer Box` @ `$51.00` MSRP catch from `Cooperstown Cards`, Order `B108C090-96CCFE-CA0AF`, `ripped: true, onWall: true`) in `conqueredVault.json`, `data/msrpTrophies.json`, and `server.js`.
    - Built the full Machined Dark Mode Executive UI in `public/index.html` (and synced `dashboard.html`) with `Plus Jakarta Sans` + `JetBrains Mono` (`tabular-nums`), top-edge specular borders, collapsible 4-view sidebar (`📡 Live Command`, `🎯 Bounty Hunter`, `🏆 The Conquered Vault`, `⚙️ Target Matrix & Config`), and 1-click Trophy Claim modal.
    - Built the interactive **Dynamic Pokédex Chameleon & Tag-Team / Battle Header Engine** defaulting to Gyarados & Arcanine, featuring pre-loaded Scott & Logan Hall of Fame presets, live PokeAPI search (1–1,025), elemental CSS variable mapping, click-to-evolve / click-to-toggle-Shiny animations, and authentic Pokédex `.ogg` cries.
    - Verified `npx tsc --noEmit` (0 errors), restarted PM2 (`pokemon-drop-bot` & `drop-bot-dashboard`), and verified HTTP 200 across `http://localhost:3000`, `/api/conquered-vault`, and `/api/trophies`.

- **2026-10-17 | Agent: Gemini 4 Argon (via `agy`)**
  - Completed V4 Phase 2 & Step 2A Backend Upgrades:
    - Added `"open case"`, `"open box"`, `"opened case"`, `"unsealed case"`, and `"loose boxes"` firewall exclusions to `policies.ts` and `marketComps.ts`.
    - Added `releaseDate: "2026-11-06"` to Mega Evolution: Delta Reign targets in `policies.json` and wired `isPreRelease` + `"⏳ PRE-RELEASE BLEED (Wait for Launch Week)"` tagging across `evaluator.ts`, `notifier.ts`, `marketTape.ts`, and `server.js`.
    - Implemented Tier-A True Retail MSRP (`<= msrpCeiling * 1.08`) Defcon-1 Override bypassing `owned`/`inVault` + `muteVaulted`, added `🚨💎 UNICORN RETAIL MSRP HIT 💎🚨` (`0x00F0FF` + `@everyone`), and created persistent `data/msrpTrophies.json` (`GET /api/trophies`).
    - Implemented stock-aware "Rule of 3" Family Pack instant-cart links (`/cart/{variant_id}:1`, `:2`, `:3`) for Shopify ETB drops.
    - Built Pack Count & `$/Pack` Rip Math Engine (`getPackCountForSku`, `computeRipMetrics`, `isRipValueLeader <= $4.25/pk`) across all endpoints and fixed `"36-Pack"` vs `"6-Pack"` regex word-boundary precedence.
    - Seeded `conqueredVault.json` with Trophy #1 (`me-30th-celebration-etb-case` @ `$1,529.45` from Player One Services), marked `me-30th-celebration-etb-case` as `owned: true`, and exposed `GET /api/conquered-vault`, `POST /api/conquered-vault/claim`, `PATCH /api/conquered-vault/:id`, and `GET/POST /api/bounty-recon`.
    - Established multi-agent synchronization files (`STATE.md`, `CLAUDE.md`, `GEMINI.md`), verified `npx tsc --noEmit` (0 errors) and all HTTP 200 smoke tests.
