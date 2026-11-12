# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V6 Engine Repair Pass 1 Complete (Zeno's Paradox `dropPrice * 0.92` & Rip-Mode `$64.89` Slider Clamp Killed, Commit-After-Send Discord Retries + 4h Reddit Ghost TTL Live, Native HTTP/2 ALPN + `ETag` `304` LGS Engine at `88 / 90 HEALTHY` with `0` `HTTP 429`s, `588 MB` `[SEEN]` Log/CPU Burn Stopped (`0%–2%` CPU), and Fake Server Telemetry Purged)**.
- **Last Checkpoint Timestamp:** `2026-11-11 22:07 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `53f1509` (`V6 Engine Pass 1: Kill Zeno's Paradox and Rip-Mode slider clamp, add LGS ETag 304 + 429 pacing, stop 588MB log CPU burn, and remove fake server telemetry`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (`0` crashes, `0%–2%` CPU down from `73.5%`, `275.0 MB` RSS, `9.82 KB` log down from `588.0 MB`, **`88 / 90` Shopify LGS stores `HEALTHY` (`0` `HTTP 429`s!)**, `16 / 25` `HTTP 304` Tier-1 fast-delta hits in `9.38s` + `17 / 65` `HTTP 304` Tier-2 hits)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (`0` crashes, `126.3 MB` RSS, `GET /api/engine-room` reporting 100% honest `healthySensors: 88` (`healthyLgsSensors: 88`, `healthyBigBoxSensors: 0`), `0` fake `145` catalog counts, and aligned Big-Box left/right status icons)
- **Active Sensor & Cache Counts:**
  - **Shopify LGS Pool (`config/stores.json`):** `90` active stores (`88 / 90 HEALTHY` on live wire via Node 26 Undici HTTP/2 ALPN `fetch()` + Chrome navigation headers + `ETag`/`304`; only `Squirtle Squad Card Shop` `HTTP 401 Storefront Password Locked` and `The Gaming Goat` `HTTP 403` degraded; `0` `HTTP 429`s).
  - **Big-Box Sensors (`src/pollers/bigBoxRetailPoller.ts` + `src/pollers/bigBoxAdapters.ts` + `src/pollers/wafBrowserBridge.ts`):** `9` Big-Box sensors wired with honest `WAF_CHALLENGE_*` (`SHIELD_BLOCKED` crimson) vs `PARSER_BLIND (0 NODES)` (`SLEEPING_CORE` amber) telemetry — queued for **V6 Engine Repair Pass 2** next turn.
  - **Target Matrix (`config/catalog.json` + `config/userPreferences.json` + `marketCache.json`):** `131` tracked sealed SKUs (`0` synthetic `Math.sin` points, `0` stale `reddit_*` ghosts, manual `policyMaxBuy` sliders honored 100% across `0/3`, `1/3`, and `2/3` sets).

---

## 2. Module Status Across V5–V6 Refactoring

| Module / File | Lines | Status | V6 Active Role |
| :--- | :---: | :--- | :--- |
| `_nyx_state/01..07_*.md` | 7 files | **ACTIVE (V6 Slice 1)** | Multi-agent continuity engine, Failure Graveyard (`02`), & Deep System + Commercial Audit (`07`) |
| `scripts/dropbot-cli.ps1` | 195 | **ACTIVE (V5 Step 0)** | Portable `dropbot save / undo / backup / next` CLI |
| `src/config/configManager.ts` | 339 | **ACTIVE (V6 Slice 3, `< 350`)** | Merges `catalog.json` + `userPreferences.json` + `marketCache.json` + `amazonAsin` / `retailSearchQuery` propagation |
| `src/engine/trendAdvisor.ts` | 328 | **ACTIVE (V6 Slice 1, `< 350`)** | Honest 14d/30d/60d/90d rolling metrics (`0` `Math.sin`), `sampleDaysCount` / `insufficientHistory`, & Hard Ceiling Rule (`effectiveTargetCeiling <= Math.max(msrpCeiling, policyMaxBuy)`) |
| `src/engine/singlesSniper.ts` | 336 | **ACTIVE (V6 Slice 1, `< 350`)** | Quiet Singles & Gyarados Offload Radar (`singlesCache.json`) with 500-key LRU cap (`pruneCompBenchmarksLru`) & 100% silent alert rule |
| `src/pollers/wafBrowserBridge.ts` | 345 | **ACTIVE (V6 Slice 3, `< 350`)** | Real invisible Playwright worker (`chrome-headless-new`, `0` visible windows, `waitUntil: 'domcontentloaded'`, `15000ms` timeout, `finally { await page.close() }`, `data/wafSessionCookies.json` `160s` cycle) + Queue-It detector |
| `src/pollers/bigBoxAdapters.ts` | 310 | **ACTIVE (V6 Slice 3, `< 350`)** | Verified 1P payload parsers & `processIncomingDrop()` dispatcher for all `9` Big-Box retailers |
| `src/pollers/bigBoxRetailPoller.ts` | 273 | **ACTIVE (V6 Slice 3, `< 350`)** | Honest 9-retailer Big-Box 1P poller integrated with `wafBrowserBridge.ts`, `bigBoxAdapters.ts`, & `processIncomingDrop()` |
| `src/pollers/fastTier1Poller.ts` | 342 | **ACTIVE (V6 Slice 1, `< 350`)** | 15s Tier-1 Fast Shopify poller upgraded to `?limit=250` (`updated_at desc`), `ETag`/`304`, O(1) unchanged-variant diffing, `?payment=shop_pay`, & CAD->USD FX |
| `evaluator.ts` | 1,941 | **ACTIVE (V6 Slice 1)** | `mtimeMs`-synced `storeOffersCacheMem`, `buildShopifyDirectCartLinks()` (`?payment=shop_pay`), `buildMobileRetailerLinks()` (Target/BestBuy/Walmart ATC), & Rule of 3 logic |
| `notifier.ts` | 1,052 | **ACTIVE (V6 Slice 1)** | **0ms Fire-Then-Enrich** alert dispatch (`priorityFront = true` immediate send + background `getDualMarketComps()` `PATCH`), `embed.url` fast-lane handoff, & 09:00/18:00 Roundup Digest |
| `listener.ts` | 92 | **ACTIVE (V6 Slice 1)** | Non-blocking `void sendAlert(...).catch(...)` handoff eliminating head-of-line blocking inside poller loops |
| `lgsPoller.ts` | 816 | **ACTIVE (V6 Slice 1)** | 90-store Shopify poller with `resolveShopifyFxMultiplier()` (12 `CAD` stores + `/cart.js` auto-detect), `?payment=shop_pay` cart links, & 3-arg `isSingleCardOrNonSealed()` |
| `policies.ts` | 717 | **ACTIVE (V6 Slice 1)** | Context-aware `isSingleCardOrNonSealed()` unblocking `\bpack\b/\bpromo\b/\bfoil\b/\bsingle\b` on valid sealed containers while blocking 100% of singles, slabs, loose packs, & partial-ETB traps |
| `server.js` | 2,934 | **ACTIVE (V6 Slice 1)** | `mtimeMs`-backed `readJsonCached()` + memoized `/api/status` (`12.49ms`) & `/api/engine-room` (`25.55ms`), zero split-brain `storeOffersCache.json` writes, & honest `/api/sku-history/:skuId` |
| `public/index.html` | 6,302 | **ACTIVE (V6 Slice 1)** | Instant 0ms Rule-of-3 UI, Top Trophy Room nav, collapsible `[+ METRICS]` drawers, and `?payment=shop_pay` `[CART 1X/2X/3X]` buttons |
| `public/css/stadium.css` + `public/js/stadium/*.js` | 5 files | **HARD-FROZEN (V5 Slice 2)** | `git diff = 0 lines` verified |
