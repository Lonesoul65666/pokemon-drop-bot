# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V6 Slice 1 Complete (0ms Fire-Then-Enrich Alerts, 1-Tap `?payment=shop_pay` + Native Mobile Deep Links, Sealed-Container Matcher & 12-Store CAD FX Fixes, 100% `Math.sin` Synthetic History Purge + Hard Slider Ceiling Rule, Split-Brain `storeOffersCache` Stopgap, `mtimeMs` API Memoization `965ms -> 12.5ms`, and 500-Key `singlesCache` LRU)**.
- **Last Checkpoint Timestamp:** `2026-11-10 23:20 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `1b23a36` (`V6 Slice 1: 0ms Fire-Then-Enrich alerts, Shop Pay fast-lane, fix promo/pack matcher & CAD stores, purge Math.sin, and fix split-brain cache overwrite`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (`0` crashes, all 90 active Shopify LGS stores healthy with 12-store CAD->USD `0.73` FX + auto-detection, 15s Tier-1 Fast Poller at `?limit=250` with `ETag`/O(1) variant diffing, Big-Box Poller, 150s WAF Session Bridge, and 0ms Fire-Then-Enrich Discord/Telegram dispatch)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (`0%` idle CPU, `GET /api/status` warm latency `12.49ms` down from `965ms`, `GET /api/engine-room` `25.55ms`, zero split-brain `storeOffersCache.json` overwrites)
- **Active Sensor & Cache Counts:**
  - **Shopify LGS Pool (`config/stores.json`):** `90` active healthy stores (`100%` online, `0` blocked; `26` Tier-1 Fast 15s restock stores polling `?limit=250` + O(1) unchanged-variant diffing; `12` Canadian stores tagged `currency: "CAD"` + `/cart.js` runtime FX guard).
  - **Big-Box Sensors (`src/pollers/bigBoxRetailPoller.ts` + `src/pollers/wafBrowserBridge.ts`):** `7` honest Big-Box / Official 1st-Party sensors (`Pokémon Center`, `Target`, `Walmart`, `Best Buy`, `Costco`, `Sam's Club`, `GameStop`) with Universal / 1-Tap ATC mobile deep links (`target.com/p/-/A-{tcin}`, `api.bestbuy.com/click/-/{sku}/cart`, `walmart.com/pac?id={id}&quantity=1`).
  - **Target Matrix (`config/catalog.json` + `config/userPreferences.json` + `marketCache.json`):** `131` tracked sealed SKUs with Rule of 3 Family Completion slots (`wallOwned`, `dadRipOwned`, `loganRipOwned`, `autoPilotEnabled: true`), hard ceiling rule (`effectiveTargetCeiling <= policyMaxBuy`), and honest rolling timestamp history (`0` `Math.sin` synthetic curves).

---

## 2. Module Status Across V5–V6 Refactoring

| Module / File | Lines | Status | V6 Active Role |
| :--- | :---: | :--- | :--- |
| `_nyx_state/01..07_*.md` | 7 files | **ACTIVE (V6 Slice 1)** | Multi-agent continuity engine, Failure Graveyard (`02`), & Deep System + Commercial Audit (`07`) |
| `scripts/dropbot-cli.ps1` | 195 | **ACTIVE (V5 Step 0)** | Portable `dropbot save / undo / backup / next` CLI |
| `src/config/configManager.ts` | 335 | **ACTIVE (`< 350` lines)** | Merges `catalog.json` + `userPreferences.json` + `marketCache.json` + live store-offer median; Rule of 3 slots |
| `src/engine/trendAdvisor.ts` | 328 | **ACTIVE (V6 Slice 1, `< 350`)** | Honest 14d/30d/60d/90d rolling metrics (`0` `Math.sin`), `sampleDaysCount` / `insufficientHistory`, & Hard Ceiling Rule (`effectiveTargetCeiling <= Math.max(msrpCeiling, policyMaxBuy)`) |
| `src/engine/singlesSniper.ts` | 336 | **ACTIVE (V6 Slice 1, `< 350`)** | Quiet Singles & Gyarados Offload Radar (`singlesCache.json`) with 500-key LRU cap (`pruneCompBenchmarksLru`) & 100% silent alert rule |
| `src/pollers/wafBrowserBridge.ts` | 231 | **ACTIVE (`< 250` lines)** | Session cookie bridge (`data/wafSessionCookies.json`, `150s` cycle) + Queue-It detector *(Playwright upgrade queued for V6 Slice 3)* |
| `src/pollers/bigBoxRetailPoller.ts` | 296 | **ACTIVE (`< 350` lines)** | Honest 7-retailer Big-Box 1P poller integrated with `wafBrowserBridge.ts` |
| `src/pollers/fastTier1Poller.ts` | 342 | **ACTIVE (V6 Slice 1, `< 350`)** | 15s Tier-1 Fast Shopify poller upgraded to `?limit=250` (`updated_at desc`), `ETag`/`304`, O(1) unchanged-variant diffing, `?payment=shop_pay`, & CAD->USD FX |
| `evaluator.ts` | 1,941 | **ACTIVE (V6 Slice 1)** | `mtimeMs`-synced `storeOffersCacheMem`, `buildShopifyDirectCartLinks()` (`?payment=shop_pay`), `buildMobileRetailerLinks()` (Target/BestBuy/Walmart ATC), & Rule of 3 logic |
| `notifier.ts` | 1,052 | **ACTIVE (V6 Slice 1)** | **0ms Fire-Then-Enrich** alert dispatch (`priorityFront = true` immediate send + background `getDualMarketComps()` `PATCH`), `embed.url` fast-lane handoff, & 09:00/18:00 Roundup Digest |
| `listener.ts` | 92 | **ACTIVE (V6 Slice 1)** | Non-blocking `void sendAlert(...).catch(...)` handoff eliminating head-of-line blocking inside poller loops |
| `lgsPoller.ts` | 816 | **ACTIVE (V6 Slice 1)** | 90-store Shopify poller with `resolveShopifyFxMultiplier()` (12 `CAD` stores + `/cart.js` auto-detect), `?payment=shop_pay` cart links, & 3-arg `isSingleCardOrNonSealed()` |
| `policies.ts` | 717 | **ACTIVE (V6 Slice 1)** | Context-aware `isSingleCardOrNonSealed()` unblocking `\bpack\b/\bpromo\b/\bfoil\b/\bsingle\b` on valid sealed containers while blocking 100% of singles, slabs, loose packs, & partial-ETB traps |
| `server.js` | 2,934 | **ACTIVE (V6 Slice 1)** | `mtimeMs`-backed `readJsonCached()` + memoized `/api/status` (`12.49ms`) & `/api/engine-room` (`25.55ms`), zero split-brain `storeOffersCache.json` writes, & honest `/api/sku-history/:skuId` |
| `public/index.html` | 6,302 | **ACTIVE (V6 Slice 1)** | Instant 0ms Rule-of-3 UI, Top Trophy Room nav, collapsible `[+ METRICS]` drawers, and `?payment=shop_pay` `[CART 1X/2X/3X]` buttons |
| `public/css/stadium.css` + `public/js/stadium/*.js` | 5 files | **HARD-FROZEN (V5 Slice 2)** | `git diff = 0 lines` verified |
