# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V6 Slice 3 Complete (Real Invisible Playwright WAF Worker `chrome-headless-new`, All 9 Big-Box Retailers Wired Into `processIncomingDrop()` + `storeOffersCache.json`, Amazon 1P `ATVPDKIKX0DER` & Barnes & Noble Shopify Hydrogen Live, Pokémon Center Queue-It / OOS Bugs Fixed, and 20 Priority Retail SKU IDs Seeded)**.
- **Last Checkpoint Timestamp:** `2026-11-11 00:06 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `a8a6d3a` (`V6 Slice 3: Real invisible Playwright WAF worker, live processIncomingDrop across all 9 Big-Box stores + Amazon 1P & B&N, and 1-tap retail cart links`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (`0` crashes, `332.5 MB` RSS, all 90 active Shopify LGS stores + all 9 Big-Box 1P sensors + `160s` invisible Playwright `chrome-headless-new` WAF worker + 0ms Fire-Then-Enrich Discord/Telegram dispatch)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (`0` crashes, `174.4 MB` RSS, `GET /api/engine-room` exposing all `9` live Big-Box sensors in `northStar5`)
- **Active Sensor & Cache Counts:**
  - **Shopify LGS Pool (`config/stores.json`):** `90` active healthy stores (`26` Tier-1 Fast 15s restock stores polling `?limit=250` + O(1) unchanged-variant diffing; `12` Canadian stores tagged `currency: "CAD"` + `/cart.js` runtime FX guard).
  - **Big-Box Sensors (`src/pollers/bigBoxRetailPoller.ts` + `src/pollers/bigBoxAdapters.ts` + `src/pollers/wafBrowserBridge.ts`):** All **`9` Big-Box / Official 1st-Party sensors** (`Pokémon Center`, `Target`, `Walmart`, `Best Buy`, `Amazon 1P ATVPDKIKX0DER`, `GameStop`, `Barnes & Noble`, `Costco`, `Sam's Club`) wired end-to-end into `processIncomingDrop()` with 1-Tap ATC / Universal App links (`target.com/p/-/A-{tcin}`, `walmart.com/pac?id={id}&quantity=1`, `api.bestbuy.com/click/-/{sku}/cart`, `amazon.com/gp/aws/cart/add.html?ASIN.1={asin}&Quantity.1=1`).
  - **Target Matrix (`config/catalog.json` + `config/userPreferences.json` + `marketCache.json`):** `131` tracked sealed SKUs (`20` priority SKUs seeded with `targetTcin`, `walmartItemId`, `bestBuySku`, `amazonAsin`, `pcSlug`, and `retailSearchQuery` + dynamic `matchProductToSku()` auto-discovery).

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
