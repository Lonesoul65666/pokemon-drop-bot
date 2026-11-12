# 06 — COMPLETE ASSET, STATE FILE & API MANIFEST

> **SINGLE SOURCE OF TRUTH (PART 6/6):** Complete inventory of all source files, continuity/audit docs, persistent JSON state caches, REST API endpoints, and CLI scripts in `C:\pokemon-drop-bot`.

---

## 1. Core TypeScript, JavaScript & Continuity Files

| File Path | Lines | Role |
| :--- | :---: | :--- |
| `_nyx_state/01..06_*.md` | 6 files | Mandatory multi-agent bootloader, laws, Failure Graveyard (`02`), build snapshot (`03`), V6 roadmap (`04`), rolling 3-turn log (`05`), and manifest (`06`). |
| `_nyx_state/07_DEEP_SYSTEM_AND_COMMERCIAL_AUDIT.md` | 412 | Exhaustive forensic V6 system, checkout-latency, store-coverage, codebase-debt, and Pro SaaS commercialization audit. |
| `_nyx_state/08_ENGINE_DIAGNOSTIC_REPORT.md` | 355 | Bare-metal live engine autopsy + Pass 1, Pass 2, Pass 3, & V6 Phase 2 live verification addendums. |
| `index.ts` (`index.js`) | 25 | PM2 daemon entrypoint for `pokemon-drop-bot`; boots 90-store LGS poller, 15s Tier-1 Fast Poller, Big-Box poller, Restock Wire, MarketSync, MarketTape, and Digest scheduler. |
| `listener.ts` (`listener.js`) | 259 | Receives `RawRestockItem` (`+ imageUrl`) via `processIncomingDrop()`, dispatches `0ms` `sendAlert()`, and polls rotating Webshare Proxy-Reddit. |
| `src/config/configManager.ts` (`.js`) | 339 | `< 350` lines; merges `config/catalog.json` + `config/userPreferences.json` + `marketCache.json` + live store-offer median (`computeLiveStoreOfferMedian`); Rule of 3 Family Completion slots & `amazonAsin` / `retailSearchQuery` propagation. |
| `src/engine/trendAdvisor.ts` (`.js`) | 329 | `< 350` lines; honest rolling metrics (`0` `Math.sin`), re-exports `watermarkHistory.ts`, Hard Ceiling Rule (`effectiveTargetCeiling = policyMaxBuy`), `BLEEDING DOWN`, `SUPPLY TIGHTENING`, & `ELASTIC_DIP`. |
| `src/engine/watermarkHistory.ts` (`.js`) | 236 | `< 300` lines; real `realDaysTracked` history age + earned-only `7d/15d/30d/60d/90d` shelf floor watermarks + optional verified TCGPlayer `infinite-api` quarter comp note. |
| `src/engine/purchaseMemory.ts` (`.js`) | 176 | `< 200` lines; mirrors `conqueredVault.json` -> `data/purchaseLedger.json` (`$1,529.45` 30th Case), computes `Last Paid` Victory/Defeat deltas, and enforces strict ETB-only `0/3`–`3/3` Wall formatting. |
| `src/notifications/discordEmbedBuilder.ts` (`.js`) | 263 | `< 340` lines; clean 5-line Discord embed builder, 1P-only `@here` Gold/Crimson theme (`0` `@everyone`), `0` `"At Target"`, single shipping string, and 7-layer box-art thumbnail preservation. |
| `src/engine/singlesSniper.ts` (`.js`) | 336 | `< 350` lines; Quiet Singles & Gyarados Offload Radar (`singlesCache.json`) with 500-key LRU cap (`pruneCompBenchmarksLru(500)`) and 100% silent alert rule (`singlesAlertsEnabled: false`). |
| `src/pollers/wafBrowserBridge.ts` (`.js`) | 317 | `< 350` lines; invisible System Chrome Playwright worker + 2-strike `6h` Home-IP WAF Shield (`HOME_IP_SHIELD_DOMAINS`, `WIRE_ARMED_IP_SHIELD` persisted in `data/wafSessionCookies.json`) + `ROUTER_TLS_FILTER` & Queue-It detectors. |
| `src/pollers/bigBoxAdapters.ts` (`.js`) | 315 | `< 350` lines; verified 1P JSON/hybrid parsers + `allowAboveMsrpSliderFallthrough` (GameStop) + 30m `claimBigBoxCrossChannelSignal()` deduplicator + `processIncomingDrop()` dispatcher. |
| `src/pollers/bigBoxDomParsers.ts` (`.js`) | 309 | `< 350` lines; split DOM shelf parsers for `GameStop` (`allowAboveMsrpSliderFallthrough: true`), `Amazon 1P ATVPDKIKX0DER`, `Barnes & Noble` Hydrogen, `Pokémon Center`, `Best Buy`, and `Costco`. |
| `src/pollers/bigBoxRetailPoller.ts` (`.js`) | 295 | `< 350` lines; 9-retailer Big-Box 1P poller emitting `WIRE_ARMED_IP_SHIELD`, Proxy-First `Amazon 1P`, Hybrid `Best Buy`, and `PARSER_BLIND_0_NODES` truth. |
| `src/pollers/bestBuyOfficialApi.ts` (`.js`) | 47 | `< 350` lines; optional Best Buy Official Products REST API (`BESTBUY_API_KEY`) poller with automatic Chrome DOM fallback. |
| `src/pollers/publicRestockWire.ts` (`.js`) | 338 | `< 350` lines; Bluesky Jetstream WebSocket (`jetstream2.us-east.bsky.network`) + `25s` AppView `getAuthorFeed` wire, `AbortSignal.timeout(5000)` native `fetch()` unshortener, canonical retail ATC builder, and `INSTANT_BUY_RESTOCK` vs `QUEUE_INVITE_DRAWING` classifier. |
| `src/pollers/fastTier1Poller.ts` (`.js`) | 285 | `< 350` lines; 15-second Tier-1 Fast Shopify delta poller (`25` stores, `?limit=250` `updated_at desc`, `ETag`/`304`, O(1) unchanged-variant diffing, `?payment=shop_pay`, & CAD->USD FX). |
| `policies.ts` (`policies.js`) | 717 | Loads & hot-watches merged policies, enforces context-aware `isSingleCardOrNonSealed()` (unblocking `pack/promo/foil/single` on valid sealed containers while blocking 100% of singles/slabs/loose packs/partial-ETB traps), and `reloadWatchPolicies()`. |
| `evaluator.ts` (`evaluator.js`) | 2,027 | `mtimeMs`-synced `storeOffersCacheMem`, 1P-only `isTierAMsrp`, worse-than-TCGPlayer & `FALLING_KNIFE_WAIT` LGS gates, `Math.max(5.00, last * 0.04)` cooldown step-down, and Shop Pay / mobile retail ATC links. |
| `lgsPoller.ts` (`lgsPoller.js`) | 992 | Polls 90 active verified Shopify LGS storefronts from `config/stores.json`, applies `resolveShopifyFxMultiplier()`, extracts `prod.images[0].src` box art, routes singles to `singlesSniper.ts`, and writes `storeHealth.json`. |
| `vampirePoller.ts` (`vampirePoller.js`) | 566 | Delegates Big-Box polling to `bigBoxRetailPoller.ts`, polls `r/PKMNTCGDeals` RSS, and runs TCGPlayer verified-seller undercut sweeps with Scam Shield. |
| `notifier.ts` (`notifier.js`) | 1,042 | **0ms Fire-Then-Enrich** w/ `buildCleanDiscordAlertEmbed()`, pre-send `getLiveTcgPlayerCompFast` LGS gate, preserved box-art thumbnails + local attachment fallback, `@here` Queue/Draw embeds, and Roundup Digest. |
| `marketComps.ts` (`marketComps.js`) | 430 | Live TCGPlayer + eBay Buy-It-Now comp scraper + `getLiveTcgPlayerCompFast` (`3200ms` bounded check + 10m cache) with trimmed-median sanity guards. |
| `marketTape.ts` (`marketTape.js`) | 718 | 95-day rolling price history & NRT sales velocity tracker (`NINETY_FIVE_DAYS_MS`), absorption ratio, 48h distributor wave detector, honey-hole store rankings, and weekly checkpoints. |
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
| `conqueredVault.json` | Gamified Trophy Plaque ledger (frozen seed/user trophies). |
| `data/purchaseLedger.json` | Non-destructive Commander cost-basis mirror synced via `atomicWriteJson` from `conqueredVault.json` (including Scott's `$1,529.45` `me-30th-celebration-etb-case`). |
| `data/msrpTrophies.json` | Persistent Tier-A Retail MSRP Unicorn counter. |
| `salesHistory.json`, `dailySnapshots.json`, `weeklyCheckpoints.json` | Real timestamped 95-day rolling price telemetry (`0` synthetic `Math.sin` points) powering earned `7d/15d/30d/60d/90d` watermarks. |

---

## 3. Active REST API Endpoints (`server.js` on `http://localhost:3000`)
- `GET /api/status` — `mtimeMs`-memoized (`12.49ms` warm) system health, `storeTelemetry`, `shelfSpread`, `nearMisses`, `bestCurrentOffers`, `nextBuyAdvisor`, `familyProgress`, `msrpTrophies`, `totalConquered`.
- `GET /api/advisor/next-buy` — Ranks Top 3 Smartest In-Stock Buys (`?budget=100|200|350|500`) where `completionCount < 3` alongside `bleedingWaitList` and `supplyTighteningList`.
- `POST /api/policies/:skuId/family-slots` — Updates `wallOwned`, `dadRipOwned`, `loganRipOwned`, `toggleAll`, or `autoPilotEnabled` in `config/userPreferences.json` and hot-reloads policies without mutating `storeOffersCache.json`.
- `POST /api/digest/send-now` (and `POST /api/send-digest`) — Immediately dispatches the 4-section **DropBot Market & Deal Roundup Digest** to Discord.
- `GET /api/singles` & `POST /api/singles/watchlist` — Quiet Singles & Gyarados Offload Radar search and watchlist management.
- `GET /api/engine-room` (`mtimeMs`-memoized, `25.55ms` warm), `GET /api/store-offers`, `GET /api/near-misses`, `GET /api/shelf-spread`, `GET /api/sku-history/:skuId` (honest `sampleDaysCount` & `insufficientHistory`), `GET/POST /api/bounty-recon`, `GET/POST /api/policies`, `GET /api/live-stock`, `GET /api/drops`, `GET /api/trophies`, `GET /api/conquered-vault`, `POST /api/conquered-vault/claim`, `PATCH /api/conquered-vault/:id`, `GET /api/market-tape`, `GET /api/trends`, `POST /api/market-tape/checkpoint`, `GET/POST /api/settings`, `POST /api/reset-dedup`, `POST /api/test-alert`.
