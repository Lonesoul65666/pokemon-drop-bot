# 06 — COMPLETE ASSET, STATE FILE & API MANIFEST

> **SINGLE SOURCE OF TRUTH (PART 6/6):** Complete inventory of all source files, persistent JSON state caches, REST API endpoints, and CLI scripts in `C:\pokemon-drop-bot`.

---

## 1. Core TypeScript & JavaScript Source Files

| File Path | Lines | Role |
| :--- | :---: | :--- |
| `index.ts` (`index.js`) | 24 | PM2 daemon entrypoint for `pokemon-drop-bot`; boots pollers, MarketSync, MarketTape, and Digest schedulers. |
| `listener.ts` (`listener.js`) | 85 | Receives `RawRestockItem` via `processIncomingDrop()`, invokes `evaluateItem()`, and dispatches `sendAlert()`. |
| `policies.ts` (`policies.js`) | 410 | Loads & hot-watches `policies.json`, enforces `GLOBAL_JUNK_EXCLUSIONS`, form-factor firewalls, price ceilings, `$/Pack` rip math, and `atomicWriteJson()`. |
| `evaluator.ts` (`evaluator.js`) | 1,127 | Evaluates drops against `WATCH_POLICIES`, computes shipping/landed price, manages `storeOffersCache.json`, `liveStock.json`, `alertState.json`, and `data/msrpTrophies.json`. |
| `lgsPoller.ts` (`lgsPoller.js`) | 692 | Polls 91 verified Shopify LGS storefronts (`LGS_STORES`), resolves collection feeds, runs 2-tier pagination, detects OOS pre-drop staging, and writes `storeHealth.json`. |
| `vampirePoller.ts` (`vampirePoller.js`) | 996 | Polls Big-Box endpoints (`Pokémon Center`, `Target RedSky`, `Walmart`, `Costco`, `Best Buy`), `r/PKMNTCGDeals` RSS, and TCGPlayer verified-seller undercuts (with 2x priority on the 30 Needed Wall ETBs). |
| `notifier.ts` (`notifier.js`) | 814 | Rate-limited FIFO Discord webhook queue (`1250ms` spacing), tactical embed builder, `dropsHistory.json` logger, and 4h Live Shelf Digest scheduler. |
| `marketComps.ts` (`marketComps.js`) | 457 | Live TCGPlayer + eBay Buy-It-Now comp scraper with trimmed-median sanity guards (`applySyncSanityGuard`). |
| `marketTape.ts` (`marketTape.js`) | 772 | 14-day NRT rolling sales velocity tracker, absorption ratio, 48h distributor wave detector, honey-hole store rankings, and weekly checkpoints. |
| `marketTelemetry.ts` (`marketTelemetry.js`) | 106 | Rolling price observation tracker for `marketCache.json`. |
| `src/marketSync.ts` (`src/marketSync.js`) | 178 | 6-hour background TCGPlayer market baseline synchronizer updating `policies.json` (`estimatedMarketValue`) and `marketCache.json`. |
| `server.js` | 2,216 | Express HTTP server (`Port 3000`) serving the web UI and all 22 REST API endpoints. |
| `public/index.html` | 9,780 | Executive Sniper Command Center UI + Logan's 3v3 Pokédex Battle Stadium (`dashboard.html` is a 9,780-line root clone slated for removal in Step 1A). |

---

## 2. Persistent Runtime JSON State & Cache Files

| File Path | Purpose & Schema Summary |
| :--- | :--- |
| `policies.json` | 131 tracked sealed Pokémon SKUs (`id`, `name`, `era`, `formFactor`, `packCount`, `matchers[]`, `msrpCeiling`, `maxMarketBuyPrice`, `estimatedMarketValue`, `owned`, `releaseDate`). |
| `storeOffersCache.json` | Full in-stock shelf visibility cache (`497` offers across `66` SKUs from Shopify LGS + TCGPlayer, including `isFreshRestock` flags). |
| `storeHealth.json` | Per-store polling health, latency, `resolvedPath`, circuit breaker state for all 91 Shopify stores + `__bigBoxHealth` (`northStar5`). |
| `marketCache.json` | Per-SKU rolling average, lowest observed price, store, and timestamp (`131` SKUs). |
| `liveStock.json` | Currently in-stock items under buy trigger (`< 6h`), `__bestOffers` across all stores, and `__recentOos`. |
| `dropsHistory.json` | Last 25 Discord alert payloads (plus `[PRE-DROP STAGING RADAR]` events). |
| `alertState.json` | Per-`ruleId__retailer` deduplication memory (`lastPrice`, `lowestAlertedPrice`, `wasOutOfStockSinceLastAlert`, `lastDigestSentAt`). |
| `conqueredVault.json` | Gamified Trophy Plaque ledger (`Trophy #1`: `me-30th-celebration-etb-case` @ `$1,529.45`, `Trophy #2`: `me-chaos-rising-etb` @ `$51.00` MSRP catch). |
| `data/msrpTrophies.json` | Persistent Tier-A Retail MSRP Unicorn counter (`totalMsrpHits` + last 20 catches). |
| `salesHistory.json` | 14-day rolling sell-out velocity ledger for `marketTape.ts`. |
| `dailySnapshots.json` | Daily price history snapshots for 24H/7D/30D/90D charting. |
| `weeklyCheckpoints.json` | Sunday-to-Sunday weekly market tape checkpoints. |
| `botSettings.json` | User dashboard settings (`muteVaulted`, `wallHunterMode`, `liveDigestEnabled`, `lastDigestSentAt`). |

---

## 3. Active REST API Endpoints (`server.js` on `http://localhost:3000`)
- `GET /api/status` — System health, `storeTelemetry`, `shelfSpread`, `nearMisses`, `bestCurrentOffers`, `msrpTrophies`, `totalConquered`.
- `GET /api/engine-room` — Full 96-sensor matrix (`summary`, `northStar5` Big-Box sensors, `lgsStores` 91-store shelf ledger).
- `GET /api/store-offers` — All cached in-stock offers from `storeOffersCache.json`.
- `GET /api/near-misses` — Offers within `+0.5%` to `+12.5%` over trigger with `recommendedTriggerBump`.
- `GET /api/shelf-spread` — Live distribution across `Under Trigger`, `Near Misses`, `Under Market`, and `At Retail MSRP`.
- `GET /api/sku-history/:skuId` — `24H / 7D / 30D / 90D` chart time-series, `allTimeLow`, `liveMarketplaceFloor`, and ranked `currentOffers`.
- `GET/POST /api/bounty-recon` — On-demand cross-store comparison & live Shopify/TCGPlayer/eBay sweep (`?skuId=`, `?query=`, `?format=`, `?store=`).
- `GET/POST /api/policies` — Read or atomically save `policies.json`.
- `GET /api/live-stock`, `GET /api/drops`, `GET /api/trophies`, `GET /api/telemetry`, `GET /api/store-health`.
- `GET /api/conquered-vault`, `POST /api/conquered-vault/claim`, `PATCH /api/conquered-vault/:id`.
- `GET /api/market-tape`, `GET /api/trends`, `POST /api/market-tape/checkpoint`.
- `GET/POST /api/settings`, `POST /api/reset-dedup`, `POST /api/send-digest`, `POST /api/test-alert`, `POST /api/live-comp`.

---

## 4. Operational Scripts & Watchdogs (`scripts/`)
- `scripts/dropbot-cli.ps1` — Portable PowerShell CLI (`dropbot save`, `dropbot undo`, `dropbot backup`, `dropbot next`).
- `scripts/install-dropbot-cli.ps1` — Installs the `dropbot` command into the current machine's PowerShell `$PROFILE`.
- `scripts/watchdog.vbs` & `scripts/watchdog.ps1` — Invisible 5-minute Windows Scheduled Task (`DropBot-PM2-Watchdog`) ensuring PM2 processes and Port 3000 stay online 24/7.
