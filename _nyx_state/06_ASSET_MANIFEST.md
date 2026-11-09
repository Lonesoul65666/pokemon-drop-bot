# 06 — COMPLETE ASSET, STATE FILE & API MANIFEST

> **SINGLE SOURCE OF TRUTH (PART 6/6):** Complete inventory of all source files, persistent JSON state caches, REST API endpoints, and CLI scripts in `C:\pokemon-drop-bot`.

---

## 1. Core TypeScript & JavaScript Source Files

| File Path | Lines | Role |
| :--- | :---: | :--- |
| `index.ts` (`index.js`) | 29 | PM2 daemon entrypoint for `pokemon-drop-bot`; boots 90-store LGS poller, 15s Tier-1 Fast Poller, Big-Box poller, MarketSync, MarketTape, and 09:00/18:00 Roundup Digest scheduler. |
| `listener.ts` (`listener.js`) | 85 | Receives `RawRestockItem` via `processIncomingDrop()`, invokes `evaluateItem()`, and dispatches `sendAlert()`. |
| `src/config/configManager.ts` (`.js`) | 335 | `< 350` lines; merges `config/catalog.json` + `config/userPreferences.json` + `marketCache.json` + live store-offer median (`computeLiveStoreOfferMedian`); Rule of 3 Family Completion slots (`wallOwned`, `dadRipOwned`, `loganRipOwned`, `autoPilotEnabled`) & `updateSkuFamilySlotsFromUi()`. |
| `src/engine/trendAdvisor.ts` (`.js`) | 312 | `< 350` lines; 14d/30d/60d/90d Rolling Market Analytics, `getLiveStoreOfferMedian()`, `computeAutoPilotTarget()`, `BLEEDING DOWN`, `SUPPLY TIGHTENING`, & `ELASTIC_DIP`. |
| `src/engine/singlesSniper.ts` (`.js`) | 323 | `< 350` lines; Quiet Singles & Gyarados Offload Radar (`singlesCache.json`) with 100% silent alert rule enforced (`singlesAlertsEnabled: false`). |
| `src/pollers/wafBrowserBridge.ts` (`.js`) | 231 | `< 250` lines; 100% invisible (`headless: true`, `--headless=new`, `--disable-gpu`, `--no-startup-window`) WAF session bridge with `150s` cycle, persistent cookies in `data/wafSessionCookies.json`, and Queue-It waiting room detector (`◈ ⟦ POKÉMON CENTER QUEUE ACTIVE — ENTER LINE NOW ⟧`). |
| `src/pollers/bigBoxRetailPoller.ts` (`.js`) | 296 | `< 350` lines; Honest 7-retailer Big-Box 1P poller (Target RedSky 1P, Walmart, Best Buy, Pokémon Center, Costco, Sam's Club, GameStop) integrated with `wafBrowserBridge.ts`. |
| `src/pollers/fastTier1Poller.ts` (`.js`) | 336 | `< 350` lines; 15-second Tier-1 Fast Shopify restock delta poller (`26` Tier-1 stores, `?limit=50`). |
| `policies.ts` (`policies.js`) | 485 | Loads & hot-watches merged policies, enforces `isSingleCardOrNonSealed()` + positive sealed container gate, dynamic `getMaxPlausiblePriceCeiling()`, and `reloadWatchPolicies()`. |
| `evaluator.ts` (`evaluator.js`) | 1,355 | Evaluates drops against `WATCH_POLICIES`, Rule of 3 Rip Hunt Mode (`1/3` & `2/3` + `◈ ⟦ RIP PAIR READY (QTY 2+) ⟧`), `3/3 COMPLETE` mute, 1P Big-Box/PC Retail MSRP Flip Bypass, and `buildShopifyDirectCartLinks()`. |
| `lgsPoller.ts` (`lgsPoller.js`) | 612 | Polls 90 active verified Shopify LGS storefronts from `config/stores.json`, routes singles to `singlesSniper.ts`, and writes `storeHealth.json`. |
| `vampirePoller.ts` (`vampirePoller.js`) | 780 | Delegates Big-Box polling to `bigBoxRetailPoller.ts`, polls `r/PKMNTCGDeals` RSS, and runs TCGPlayer verified-seller undercut sweeps with Scam Shield. |
| `notifier.ts` (`notifier.js`) | 915 | Hard silent-singles guard, rate-limited FIFO Discord webhook queue, `[CART 1X] / [CART 2X] / [CART 3X]` links, and twice-daily (`09:00` & `18:00`) 4-section Market & Deal Roundup Digest. |
| `marketComps.ts` (`marketComps.js`) | 457 | Live TCGPlayer + eBay Buy-It-Now comp scraper with trimmed-median sanity guards (`applySyncSanityGuard`). |
| `marketTape.ts` (`marketTape.js`) | 772 | 14-day NRT rolling sales velocity tracker, absorption ratio, 48h distributor wave detector, honey-hole store rankings, and weekly checkpoints. |
| `marketTelemetry.ts` (`marketTelemetry.js`) | 106 | Rolling price observation tracker for `marketCache.json`. |
| `src/marketSync.ts` (`src/marketSync.js`) | 168 | 6-hour background TCGPlayer market baseline synchronizer writing exclusively to `marketCache.json`. |
| `server.js` | 2,610 | Express HTTP server (`Port 3000`) serving `public/index.html`, static Stadium modules, and 27 REST API endpoints. |
| `public/index.html` | 6,095 | Executive Sniper Command Center UI with `[SEND DIGEST NOW]`, `$100/$200/$350/$500+` Capital Advisor Bar, interactive `[WALL] [DAD RIP] [LOGAN RIP] [3/3 ALL]` pills, and `[CART 1X/2X/3X]` buttons. |
| `public/css/stadium.css` | 353 | **HARD-FROZEN (`git diff = 0`)** — Logan's Battle Stadium stylesheet. |
| `public/js/stadium/stadium-data.js` | 819 | **HARD-FROZEN (`git diff = 0`)** — 18-type matrix, signature moves, 3v3 preset decks, boss roster, and 1,025 Pokédex helpers. |
| `public/js/stadium/stadium-audio.js` | 121 | **HARD-FROZEN (`git diff = 0`)** — WebAudio battle synthesizer + PokeAPI cry player. |
| `public/js/stadium/stadium-combat.js` | 1,376 | **HARD-FROZEN (`git diff = 0`)** — 3v3 squad state, D20 AP pool & banking rules, AI controller, and damage math. |
| `public/js/stadium/stadium-ui.js` | 1,641 | **HARD-FROZEN (`git diff = 0`)** — Arena DOM rendering, 4 attack animations, Trophy/Squad drawers, and `window.*` entrypoints. |

---

## 2. Persistent Configuration & Runtime JSON State Files

| File Path | Purpose & Schema Summary |
| :--- | :--- |
| `config/userPreferences.json` | **LOCKED PERSONAL VAULT:** Scott's untouchable per-SKU settings (`maxMarketBuyPrice`, `owned`, `inVault`, `wallOwned`, `dadRipOwned`, `loganRipOwned`, `autoPilotEnabled`, `active`) for all 131 SKUs + global toggles (`muteVaulted`, `wallHunterMode`, `liveDigestEnabled: true`, `singlesAlertsEnabled: false`, `favoritePokemonWatchlist`). |
| `config/catalog.json` | **STATIC CATALOG (`3,096` lines):** Static SKU metadata for all 131 SKUs (`id`, `name`, `era`, `formFactor`, `packCount`, `msrpCeiling`, `releaseDate`, `matchers`, `targetTcin`, `walmartItemId`, `bestBuySku`, `pcSlug`, `tcgProductId`). |
| `config/stores.json` | **UNIFIED STORE REGISTRY:** Single registry merging `LGS_STORES` + `STORE_SHIPPING_RULES` (`90` active Shopify LGS stores + `1` disabled dead store `Lets Play TCG` + `9` Big-Box shipping profiles). |
| `singlesCache.json` | Quiet Singles & Slabs Offload cache (`>= $15`, 100% isolated from sealed alerts). |
| `storeOffersCache.json` | Full in-stock sealed shelf visibility cache across all 90 Shopify LGS stores + TCGPlayer. |
| `storeHealth.json` | Per-store polling health, latency, `resolvedPath`, circuit breaker state, `__fastTier1Summary`, and `__bigBoxHealth`. |
| `marketCache.json` | Per-SKU rolling average, `estimatedMarketValue` baseline, lowest observed price, store, and timestamp (`131` SKUs). |
| `liveStock.json` | Currently in-stock sealed items under buy trigger (`< 6h`), `__bestOffers`, and `__recentOos`. |
| `dropsHistory.json` | Last 25 sealed Discord alert payloads. |
| `alertState.json` | Per-`${storeName}::${skuId}` deduplication memory. |
| `conqueredVault.json` | Gamified Trophy Plaque ledger. |
| `data/msrpTrophies.json` | Persistent Tier-A Retail MSRP Unicorn counter. |
| `salesHistory.json`, `dailySnapshots.json`, `weeklyCheckpoints.json` | Rolling price telemetry and 14/30/60/90-day history. |

---

## 3. Active REST API Endpoints (`server.js` on `http://localhost:3000`)
- `GET /api/status` — System health, `storeTelemetry`, `shelfSpread`, `nearMisses`, `bestCurrentOffers`, `nextBuyAdvisor`, `familyProgress`, `msrpTrophies`, `totalConquered`.
- `GET /api/advisor/next-buy` — Ranks Top 3 Smartest In-Stock Buys (`?budget=100|200|350|500`) where `completionCount < 3` alongside `bleedingWaitList` and `supplyTighteningList`.
- `POST /api/policies/:skuId/family-slots` — Updates `wallOwned`, `dadRipOwned`, `loganRipOwned`, `toggleAll`, or `autoPilotEnabled` in `config/userPreferences.json` and hot-reloads policies.
- `POST /api/digest/send-now` (and `POST /api/send-digest`) — Immediately dispatches the 4-section **DropBot Market & Deal Roundup Digest** to Discord.
- `GET /api/singles` & `POST /api/singles/watchlist` — Quiet Singles & Gyarados Offload Radar search and watchlist management.
- `GET /api/engine-room`, `GET /api/store-offers`, `GET /api/near-misses`, `GET /api/shelf-spread`, `GET /api/sku-history/:skuId`, `GET/POST /api/bounty-recon`, `GET/POST /api/policies`, `GET /api/live-stock`, `GET /api/drops`, `GET /api/trophies`, `GET /api/conquered-vault`, `POST /api/conquered-vault/claim`, `PATCH /api/conquered-vault/:id`, `GET /api/market-tape`, `GET /api/trends`, `POST /api/market-tape/checkpoint`, `GET/POST /api/settings`, `POST /api/reset-dedup`, `POST /api/test-alert`.
