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

## 5. Executive UI Architecture (V4 Step 2B — Live in `public/index.html` & `dashboard.html`)

- **Collapsible 4-Tab Sidebar Navigation:**
  1. `📡 Live Command`: Real-time radar, 3 Hero KPI cards (Vault & Portfolio Value, Active Sniper Radar, `💎 Unicorn MSRP Trophy Counter`), Live Deal Feed with Rule of 3 instant-cart buttons (`⚡ 1x`, `⚡ 2x`, `⚡ 3x Family Pack`) and 1-Click `🏆 Claim Trophy`, plus 3-column Market Intelligence Bento and collapsible 14-Day Market Ledger.
  2. `🎯 Bounty Hunter`: On-demand live recon interface powered by `/api/bounty-recon`, comparing Top 5 lowest landed options, `$/Pack` rip math (`🔥 RIP VALUE LEADER <= $4.25/pk`), `#1 Best Sealed Hold`, and `#1 Cheapest Pack Rip`.
  3. `🏆 The Conquered Vault`: Gamified Conquered Vault & Trophy Plaque showcase powered by `/api/conquered-vault` (featuring Trophy #1 `30th Celebration 10-ETB Case` and Trophy #2 `Chaos Rising ETB @ $51.00 MSRP`, recreated Discord alert banners, interactive `ruleOf3Status` pips, editable memory notes, and Wall Display Checklist with case overlay badges).
  4. `⚙️ Target Matrix & Config`: Full 38-target policy configuration grid with `$/Pack` badges, Pre-Release Bleed warnings (`⏳ PRE-RELEASE BLEED`), Universal Calibrate presets, and admin controls.
- **Dynamic Pokédex Chameleon / Click-to-Evolve & Shiny Header Engine:**
  - Defaults to **Scott's Gyarados + Logan's Arcanine Tag-Team** over a **Royal Purple / Obsidian** executive theme (`#08070E` / `#110F1D`).
  - Supports interactive **Click-to-Evolve & Shiny toggle** across the Hall of Fame roster + live PokeAPI search (`1-1025`), dynamically shifting header sprites, `.ogg` cries (`0.35` volume), and `--accent-primary` / `--accent-secondary` elemental palettes.

---

## 6. Last Touch Log

- **2026-10-18 | Agent: Gemini 4 Argon (via `agy`)**
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
