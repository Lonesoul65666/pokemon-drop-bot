# 06 — COMPLETE ASSET, STATE FILE & API MANIFEST

> **SINGLE SOURCE OF TRUTH (PART 6/6):** Complete inventory of all source files, continuity/audit docs, persistent JSON state caches, REST API endpoints, and CLI scripts in `C:\pokemon-drop-bot`.

---

## 1. Core TypeScript, JavaScript & Continuity Files

| File Path | Lines | Role |
| :--- | :---: | :--- |
| `_nyx_state/01..06_*.md` | 6 files | Mandatory multi-agent bootloader, laws, Failure Graveyard (`02`), build snapshot (`03`), V6 roadmap (`04`), rolling 3-turn log (`05`), and manifest (`06`). |
| `_nyx_state/07_DEEP_SYSTEM_AND_COMMERCIAL_AUDIT.md` | 412 | Exhaustive forensic V6 system, checkout-latency, store-coverage, codebase-debt, and Pro SaaS commercialization audit. |
| `_nyx_state/08_ENGINE_DIAGNOSTIC_REPORT.md` | 307 | Bare-metal live engine autopsy + Pass 1 & Pass 2 post-fix live-wire verification addendums. |
| `index.ts` (`index.js`) | 25 | PM2 daemon entrypoint for `pokemon-drop-bot`; boots 90-store LGS poller, 15s Tier-1 Fast Poller, Big-Box poller, MarketSync, MarketTape, and 09:00/18:00 Roundup Digest scheduler. |
| `listener.ts` (`listener.js`) | 92 | Receives `RawRestockItem` via `processIncomingDrop()`, invokes `evaluateItem()`, and dispatches non-blocking `void sendAlert().catch(...)` in `0ms`. |
| `src/config/configManager.ts` (`.js`) | 339 | `< 350` lines; merges `config/catalog.json` + `config/userPreferences.json` + `marketCache.json` + live store-offer median (`computeLiveStoreOfferMedian`); Rule of 3 Family Completion slots & `amazonAsin` / `retailSearchQuery` propagation. |
| `src/engine/trendAdvisor.ts` (`.js`) | 327 | `< 350` lines; honest 14d/30d/60d/90d rolling metrics (`0` `Math.sin`), `sampleDaysCount` / `insufficientHistory`, Hard Ceiling Rule (`effectiveTargetCeiling = policyMaxBuy`), `BLEEDING DOWN`, `SUPPLY TIGHTENING`, & `ELASTIC_DIP`. |
| `src/engine/singlesSniper.ts` (`.js`) | 336 | `< 350` lines; Quiet Singles & Gyarados Offload Radar (`singlesCache.json`) with 500-key LRU cap (`pruneCompBenchmarksLru(500)`) and 100% silent alert rule (`singlesAlertsEnabled: false`). |
| `src/pollers/wafBrowserBridge.ts` (`.js`) | 316 | `< 350` lines; invisible System Chrome Playwright worker (`channel: 'chrome'`, `--headless=new`, `ignoreHTTPSErrors: true`, `0` visible windows, concurrency `1` mutex, passive `page.on('response')` JSON wire-tap, `75s–180s` jittered cooldowns in `data/wafSessionCookies.json`) + `ROUTER_TLS_FILTER` & Queue-It detectors. |
| `src/pollers/bigBoxAdapters.ts` (`.js`) | 342 | `< 350` lines; verified 1P JSON/hybrid parsers (`Target` RedSky passive XHR, `Walmart` `F55CDC31`, `Best Buy`, `Costco`, `Sam's Club`) returning `{ totalNodesFound, inStockOffers }` + `processIncomingDrop()` dispatcher. |
| `src/pollers/bigBoxDomParsers.ts` (`.js`) | 301 | `< 350` lines; split DOM shelf parsers for `GameStop`, `Amazon 1P ATVPDKIKX0DER`, `Barnes & Noble` Hydrogen, `Pokémon Center`, `Best Buy`, and `Costco`. |
| `src/pollers/bigBoxRetailPoller.ts` (`.js`) | 252 | `< 350` lines; honest 9-retailer Big-Box 1P poller enforcing `PARSER_BLIND_0_NODES` on `0`-node `200` responses + `runSinglePassBigBoxSweep()`. |
| `src/pollers/fastTier1Poller.ts` (`.js`) | 285 | `< 350` lines; 15-second Tier-1 Fast Shopify delta poller (`25` stores, `?limit=250` `updated_at desc`, `ETag`/`304`, O(1) unchanged-variant diffing, `?payment=shop_pay`, & CAD->USD FX). |
| `policies.ts` (`policies.js`) | 717 | Loads & hot-watches merged policies, enforces context-aware `isSingleCardOrNonSealed()` (unblocking `pack/promo/foil/single` on valid sealed containers while blocking 100% of singles/slabs/loose packs/partial-ETB traps), and `reloadWatchPolicies()`. |
| `evaluator.ts` (`evaluator.js`) | 1,941 | `mtimeMs`-synced `storeOffersCacheMem`, Rule of 3 Rip Hunt Mode, 1P Big-Box/PC Retail MSRP Flip Bypass, `buildShopifyDirectCartLinks()` (`?payment=shop_pay`), and `buildMobileRetailerLinks()` (Target/BestBuy/Walmart ATC). |
| `lgsPoller.ts` (`lgsPoller.js`) | 816 | Polls 90 active verified Shopify LGS storefronts from `config/stores.json`, applies `resolveShopifyFxMultiplier()` (`0.73` CAD->USD + `/cart.js` currency auto-detection), routes singles to `singlesSniper.ts`, and writes `storeHealth.json`. |
| `vampirePoller.ts` (`vampirePoller.js`) | 566 | Delegates Big-Box polling to `bigBoxRetailPoller.ts`, polls `r/PKMNTCGDeals` RSS, and runs TCGPlayer verified-seller undercut sweeps with Scam Shield. |
| `notifier.ts` (`notifier.js`) | 1,052 | **0ms Fire-Then-Enrich** alert pipeline (`priorityFront = true` instant send + background `getDualMarketComps()` `PATCH`), `?payment=shop_pay` + mobile retailer deep links, hard silent-singles guard, and 09:00/18:00 Roundup Digest. |
| `marketComps.ts` (`marketComps.js`) | 456 | Live TCGPlayer + eBay Buy-It-Now comp scraper with trimmed-median sanity guards (`applySyncSanityGuard`). |
| `marketTape.ts` (`marketTape.js`) | 804 | 14-day NRT rolling sales velocity tracker, absorption ratio, 48h distributor wave detector, honey-hole store rankings, and weekly checkpoints. |
| `marketTelemetry.ts` (`marketTelemetry.js`) | 127 | Rolling price observation tracker for `marketCache.json`. |
| `src/marketSync.ts` (`src/marketSync.js`) | 187 | 6-hour background TCGPlayer market baseline synchronizer writing exclusively to `marketCache.json`. |
| `server.js` | 2,934 | Express HTTP server (`Port 3000`) with `mtimeMs`-backed `readJsonCached()` & response memoization (`12.49ms` `/api/status`), zero split-brain `storeOffersCache.json` overwrites, and honest `/api/sku-history/:skuId`. |
| `public/index.html` | 6,302 | Executive Sniper Command Center UI with `?payment=shop_pay` `[CART 1X/2X/3X]` buttons, `$100/$200/$350/$500+` Capital Advisor Bar, instant `[WALL / DAD / LOGAN / 3/3]` pills, and `[SEND DIGEST NOW]`. |
| `public/css/stadium.css` | 353 | **HARD-FROZEN (`git diff = 0`)** — Logan's Battle Stadium stylesheet. |
| `public/js/stadium/stadium-data.js` | 819 | **HARD-FROZEN (`git diff = 0`)** — 18-type matrix, signature moves, 3v3 preset decks, boss roster, and 1,025 Pokédex helpers. |
| `public/js/stadium/stadium-audio.js` | 121 | **HARD-FROZEN (`git diff = 0`)** — WebAudio battle synthesizer + PokeAPI cry player. |
| `public/js/stadium/stadium-combat.js` | 1,376 | **HARD-FROZEN (`git diff = 0`)** — 3v3 squad state, D20 AP pool & banking rules, AI controller, and damage math. |
| `public/js/stadium/stadium-ui.js` | 1,641 | **HARD-FROZEN (`git diff = 0`)** — Arena DOM rendering, 4 attack animations, Trophy/Squad drawers, and `window.*` entrypoints. |

---

## 2. Persistent Configuration & Runtime JSON State Files

| File Path | Purpose & Schema Summary |
| :--- | :--- |
| `config/userPreferences.json` | **LOCKED PERSONAL VAULT (`git diff = 0` during background runs):** Scott's untouchable per-SKU settings (`maxMarketBuyPrice`, `owned`, `inVault`, `wallOwned`, `dadRipOwned`, `loganRipOwned`, `autoPilotEnabled`, `active`) for all 131 SKUs + global toggles. |
| `config/catalog.json` | **STATIC CATALOG:** Static SKU metadata for all 131 SKUs (`id`, `name`, `era`, `formFactor`, `packCount`, `msrpCeiling`, `releaseDate`, `matchers`, `targetTcin`, `walmartItemId`, `bestBuySku`, `pcSlug`, `tcgProductId`). |
| `config/stores.json` | **UNIFIED STORE REGISTRY:** `90` active Shopify LGS stores (`12` tagged `currency: "CAD"`) + `1` disabled dead store (`Lets Play TCG`) + `9` Big-Box shipping profiles. |
| `singlesCache.json` | Quiet Singles & Slabs Offload cache (`>= $15`, 100% isolated from sealed alerts, bounded by strict 500-key LRU on `compBenchmarks`). |
| `storeOffersCache.json` | Poller-owned in-stock sealed shelf visibility cache across all 90 Shopify LGS stores + TCGPlayer (`mtimeMs`-synced before poller writes; never overwritten by `server.js`). |
| `storeHealth.json` | Per-store polling health, latency, `resolvedPath`, circuit breaker state, `__fastTier1Summary`, and `__bigBoxHealth`. |
| `marketCache.json` | Per-SKU rolling average, `estimatedMarketValue` baseline, lowest observed price, store, and timestamp (`131` SKUs). |
| `liveStock.json` | Currently in-stock sealed items under buy trigger (`< 6h`), `__bestOffers`, and `__recentOos`. |
| `dropsHistory.json` | Last 25 sealed Discord alert payloads. |
| `alertState.json` | Per-`${storeName}::${skuId}` deduplication memory. |
| `conqueredVault.json` | Gamified Trophy Plaque ledger. |
| `data/msrpTrophies.json` | Persistent Tier-A Retail MSRP Unicorn counter. |
| `salesHistory.json`, `dailySnapshots.json`, `weeklyCheckpoints.json` | Real timestamped rolling price telemetry (`0` synthetic `Math.sin` points). |

---

## 3. Active REST API Endpoints (`server.js` on `http://localhost:3000`)
- `GET /api/status` — `mtimeMs`-memoized (`12.49ms` warm) system health, `storeTelemetry`, `shelfSpread`, `nearMisses`, `bestCurrentOffers`, `nextBuyAdvisor`, `familyProgress`, `msrpTrophies`, `totalConquered`.
- `GET /api/advisor/next-buy` — Ranks Top 3 Smartest In-Stock Buys (`?budget=100|200|350|500`) where `completionCount < 3` alongside `bleedingWaitList` and `supplyTighteningList`.
- `POST /api/policies/:skuId/family-slots` — Updates `wallOwned`, `dadRipOwned`, `loganRipOwned`, `toggleAll`, or `autoPilotEnabled` in `config/userPreferences.json` and hot-reloads policies without mutating `storeOffersCache.json`.
- `POST /api/digest/send-now` (and `POST /api/send-digest`) — Immediately dispatches the 4-section **DropBot Market & Deal Roundup Digest** to Discord.
- `GET /api/singles` & `POST /api/singles/watchlist` — Quiet Singles & Gyarados Offload Radar search and watchlist management.
- `GET /api/engine-room` (`mtimeMs`-memoized, `25.55ms` warm), `GET /api/store-offers`, `GET /api/near-misses`, `GET /api/shelf-spread`, `GET /api/sku-history/:skuId` (honest `sampleDaysCount` & `insufficientHistory`), `GET/POST /api/bounty-recon`, `GET/POST /api/policies`, `GET /api/live-stock`, `GET /api/drops`, `GET /api/trophies`, `GET /api/conquered-vault`, `POST /api/conquered-vault/claim`, `PATCH /api/conquered-vault/:id`, `GET /api/market-tape`, `GET /api/trends`, `POST /api/market-tape/checkpoint`, `GET/POST /api/settings`, `POST /api/reset-dedup`, `POST /api/test-alert`.
