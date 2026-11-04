# 06 — COMPLETE ASSET, STATE FILE & API MANIFEST

> **SINGLE SOURCE OF TRUTH (PART 6/6):** Complete inventory of all source files, persistent JSON state caches, REST API endpoints, and CLI scripts in `C:\pokemon-drop-bot`.

---

## 1. Core TypeScript & JavaScript Source Files

| File Path | Lines | Role |
| :--- | :---: | :--- |
| `index.ts` (`index.js`) | 24 | PM2 daemon entrypoint for `pokemon-drop-bot`; boots pollers, MarketSync, MarketTape, and Digest schedulers. |
| `listener.ts` (`listener.js`) | 85 | Receives `RawRestockItem` via `processIncomingDrop()`, invokes `evaluateItem()`, and dispatches `sendAlert()`. |
| `src/config/configManager.ts` (`.js`) | 347 | Loads & merges `config/catalog.json` + `config/userPreferences.json` + `marketCache.json`; isolates UI preference saves from background syncs; serves unified `config/stores.json`. |
| `policies.ts` (`policies.js`) | 412 | Loads & hot-watches merged policies via `configManager.ts`, normalizes `booster.*(box\|display)` matchers, enforces `GLOBAL_JUNK_EXCLUSIONS`, dynamic `getMaxPlausiblePriceCeiling()`, `$/Pack` rip math, and `atomicWriteJson()`. |
| `evaluator.ts` (`evaluator.js`) | 1,290 | Evaluates drops against `WATCH_POLICIES`, honors pre-order sliders, applies `+$5/+$10` Close-Call Grace Cushion, runs Marketplace Scam Shield, scopes `alertState.json` to `${store}::${sku}`, and tags `storeOffersCache.json`. |
| `lgsPoller.ts` (`lgsPoller.js`) | 594 | Polls 90 active verified Shopify LGS storefronts from `config/stores.json`, resolves collection feeds, runs 2-tier pagination, detects OOS pre-drop staging, and writes `storeHealth.json`. |
| `vampirePoller.ts` (`vampirePoller.js`) | 1,019 | Polls Big-Box endpoints, `r/PKMNTCGDeals` RSS, and TCGPlayer verified-seller undercuts with Marketplace Scam & Shipping Trap Shield (`shipping > $35` or `>20%` and unverified 1-qty bait blocked). |
| `notifier.ts` (`notifier.js`) | 812 | Rate-limited FIFO Discord webhook queue (`1250ms` spacing), tactical embed builder, `dropsHistory.json` logger, and 4h Live Shelf Digest scheduler. |
| `marketComps.ts` (`marketComps.js`) | 457 | Live TCGPlayer + eBay Buy-It-Now comp scraper with trimmed-median sanity guards (`applySyncSanityGuard`). |
| `marketTape.ts` (`marketTape.js`) | 772 | 14-day NRT rolling sales velocity tracker, absorption ratio, 48h distributor wave detector, honey-hole store rankings, and weekly checkpoints. |
| `marketTelemetry.ts` (`marketTelemetry.js`) | 106 | Rolling price observation tracker for `marketCache.json`. |
| `src/marketSync.ts` (`src/marketSync.js`) | 168 | 6-hour background TCGPlayer market baseline synchronizer writing exclusively to `marketCache.json` (never touching `config/userPreferences.json`). |
| `server.js` | 2,200 | Express HTTP server (`Port 3000`) serving `public/index.html` (`/` & `/dashboard.html`), static Stadium modules, and all 22 REST API endpoints via `configManager.ts`. |
| `public/index.html` | 5,543 | Executive Sniper Command Center UI (trimmed down from `9,780` lines; `dashboard.html` root clone permanently deleted). |
| `public/css/stadium.css` | 353 | **HARD-FROZEN (`git diff = 0`)** — Logan's Battle Stadium stylesheet, animations, D20 die styles, bench cards, and drawers. |
| `public/js/stadium/stadium-data.js` | 819 | **HARD-FROZEN (`git diff = 0`)** — 18-type effectiveness matrix, signature moves, 3v3 preset decks, Champion Gauntlet boss roster, and 1,025 Pokédex/evolution lookup helpers. |
| `public/js/stadium/stadium-audio.js` | 121 | **HARD-FROZEN (`git diff = 0`)** — WebAudio API battle synthesizer + official PokeAPI cry audio player and mute toggle state. |
| `public/js/stadium/stadium-combat.js` | 1,376 | **HARD-FROZEN (`git diff = 0`)** — 3v3 squad state, D20 Action Point (AP) pool & banking rules, turn step tracker, AI turn controller, status effects, and stat-weighted damage calculations. |
| `public/js/stadium/stadium-ui.js` | 1,641 | **HARD-FROZEN (`git diff = 0`)** — Arena DOM rendering, 4 distinct visual attack animations, Trophy Vault drawer, Squad & Deck Builder drawer, and global `window.*` entrypoints. |

---

## 2. Persistent Configuration & Runtime JSON State Files

| File Path | Purpose & Schema Summary |
| :--- | :--- |
| `config/userPreferences.json` | **LOCKED PERSONAL VAULT (`800` lines):** Scott's untouchable per-SKU settings (`maxMarketBuyPrice`, `owned`, `inVault`, `active`) for all 131 SKUs + global toggles (`muteVaulted`, `wallHunterMode`, `liveDigestEnabled`). |
| `config/catalog.json` | **STATIC CATALOG (`3,096` lines):** Static SKU metadata for all 131 SKUs (`id`, `name`, `era`, `formFactor`, `packCount`, `msrpCeiling`, `releaseDate`, `matchers`, `targetTcin`, `walmartItemId`, `bestBuySku`, `pcSlug`, `tcgProductId`). |
| `config/stores.json` | **UNIFIED STORE REGISTRY (`1,215` lines):** Single registry merging `LGS_STORES` + `STORE_SHIPPING_RULES` (`90` active Shopify LGS stores + `1` disabled dead store `Lets Play TCG` + `9` Big-Box shipping profiles). |
| `policies.json` | Legacy read-only fallback target matrix (`131` SKUs) automatically kept in sync by `configManager.ts`. |
| `storeOffersCache.json` | Full in-stock shelf visibility cache (`497` offers across `66` SKUs from Shopify LGS + TCGPlayer, including `isFreshRestock` flags). |
| `storeHealth.json` | Per-store polling health, latency, `resolvedPath`, circuit breaker state for all 90 active Shopify stores + `__bigBoxHealth` (`northStar5`). |
| `marketCache.json` | Per-SKU rolling average, `estimatedMarketValue` baseline, lowest observed price, store, and timestamp (`131` SKUs). |
| `liveStock.json` | Currently in-stock items under buy trigger (`< 6h`), `__bestOffers` across all stores, and `__recentOos`. |
| `dropsHistory.json` | Last 25 Discord alert payloads (plus `[PRE-DROP STAGING RADAR]` events). |
| `alertState.json` | Per-`ruleId__retailer` deduplication memory (`lastPrice`, `lowestAlertedPrice`, `wasOutOfStockSinceLastAlert`, `lastDigestSentAt`). |
| `conqueredVault.json` | Gamified Trophy Plaque ledger (`Trophy #1`: `me-30th-celebration-etb-case` @ `$1,529.45`, `Trophy #2`: `me-chaos-rising-etb` @ `$51.00` MSRP catch). |
| `data/msrpTrophies.json` | Persistent Tier-A Retail MSRP Unicorn counter (`totalMsrpHits` + last 20 catches). |
| `salesHistory.json` | 14-day rolling sell-out velocity ledger for `marketTape.ts`. |
| `dailySnapshots.json` | Daily price history snapshots for 24H/7D/30D/90D charting. |
| `weeklyCheckpoints.json` | Sunday-to-Sunday weekly market tape checkpoints. |
| `botSettings.json` | Legacy dashboard settings fallback synced from `config/userPreferences.json`. |

---

## 3. Active REST API Endpoints (`server.js` on `http://localhost:3000`)
- `GET /api/status` — System health, `storeTelemetry`, `shelfSpread`, `nearMisses`, `bestCurrentOffers`, `msrpTrophies`, `totalConquered`.
- `GET /api/engine-room` — Full sensor matrix (`summary`, `northStar5` Big-Box sensors, `lgsStores` 90-store healthy shelf ledger).
- `GET /api/store-offers` — All cached in-stock offers from `storeOffersCache.json`.
- `GET /api/near-misses` — Offers within `+0.5%` to `+12.5%` over trigger with `recommendedTriggerBump`.
- `GET /api/shelf-spread` — Live distribution across `Under Trigger`, `Near Misses`, `Under Market`, and `At Retail MSRP`.
- `GET /api/sku-history/:skuId` — `24H / 7D / 30D / 90D` chart time-series, `allTimeLow`, `liveMarketplaceFloor`, and ranked `currentOffers`.
- `GET/POST /api/bounty-recon` — On-demand cross-store comparison & live Shopify/TCGPlayer/eBay sweep (`?skuId=`, `?query=`, `?format=`, `?store=`).
- `GET/POST /api/policies` — Reads merged policies or atomically saves user slider/owned updates to `config/userPreferences.json`.
- `GET /api/live-stock`, `GET /api/drops`, `GET /api/trophies`, `GET /api/telemetry`, `GET /api/store-health`.
- `GET /api/conquered-vault`, `POST /api/conquered-vault/claim`, `PATCH /api/conquered-vault/:id`.
- `GET /api/market-tape`, `GET /api/trends`, `POST /api/market-tape/checkpoint`.
- `GET/POST /api/settings`, `POST /api/reset-dedup`, `POST /api/send-digest`, `POST /api/test-alert`, `POST /api/live-comp`.

---

## 4. Operational Scripts & Watchdogs (`scripts/`)
- `scripts/dropbot-cli.ps1` — Portable PowerShell CLI (`dropbot save`, `dropbot undo`, `dropbot backup`, `dropbot next`).
- `scripts/install-dropbot-cli.ps1` — Installs the `dropbot` command into the current machine's PowerShell `$PROFILE`.
- `scripts/watchdog.vbs` & `scripts/watchdog.ps1` — Invisible 5-minute Windows Scheduled Task (`DropBot-PM2-Watchdog`) ensuring PM2 processes and Port 3000 stay online 24/7.
