# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V6 Engine Repair Pass 2 Complete (System Chrome Passive XHR Bridge `wafBrowserBridge.ts` `< 350L`, Split `bigBoxAdapters.ts` + `bigBoxDomParsers.ts` `< 350L`, GameStop/Amazon/BestBuy/B&N/Walmart/Costco/Target/PC Parsers Repaired, `totalNodesFound > 0` Truth Enforced via `PARSER_BLIND_0_NODES`, `0` Visible Windows, and Residential IP Protected)**.
- **Last Checkpoint Timestamp:** `2026-11-11 23:23 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `2c55e4d` (`V6 Engine Pass 2: System Chrome passive XHR bridge, fix GameStop/Amazon/Costco/Target/BestBuy/Walmart parsers, and enforce totalNodesFound truth`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (`0` crashes, `0` visible browser windows spawned, **`90 / 90` Shopify LGS stores `HEALTHY` (`19 / 25` `HTTP 304` Tier-1 fast-delta hits)** + serial jittered System Chrome Big-Box sweep active)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (`0` crashes, `108.8 MB` RSS, `GET /api/engine-room` reporting 100% honest `healthySensors: 94` (`healthyLgsSensors: 90`, `healthyBigBoxSensors: 4` with `totalNodesFound > 0`: `GameStop` `35`, `Barnes & Noble` `24`, `Best Buy` `16`, `Amazon 1P` `5`), `Costco` flagged amber `PARSER_BLIND_0_NODES`, and `PC`/`Target`/`Walmart`/`Sam's Club` flagged crimson `WAF_CHALLENGE_*`)
- **Active Sensor & Cache Counts:**
  - **Shopify LGS Pool (`config/stores.json`):** `90` active stores (`90 / 90` reporting healthy in `/api/engine-room` via Node 26 Undici HTTP/2 ALPN `fetch()` + `ETag`/`304`, `0` `HTTP 429`s).
  - **Big-Box Sensors (`src/pollers/bigBoxRetailPoller.ts` + `src/pollers/bigBoxAdapters.ts` + `src/pollers/bigBoxDomParsers.ts` + `src/pollers/wafBrowserBridge.ts`):** `9` Big-Box sensors on serial polite System Chrome (`75s–180s` jittered intervals, `0` datacenter proxy fallbacks, passive `page.on('response')` wire-tap, and strict `totalNodesFound > 0` green gate).
  - **Target Matrix (`config/catalog.json` + `config/userPreferences.json` + `marketCache.json`):** `131` tracked sealed SKUs (`0` synthetic `Math.sin` points, `0` stale `reddit_*` ghosts, manual `policyMaxBuy` sliders honored 100% across `0/3`, `1/3`, and `2/3` sets).

---

## 2. Module Status Across V5–V6 Refactoring

| Module / File | Lines | Status | V6 Active Role |
| :--- | :---: | :--- | :--- |
| `_nyx_state/01..08_*.md` | 8 files | **ACTIVE (V6 Pass 2)** | Multi-agent continuity engine, Failure Graveyard (`02`), Commercial Audit (`07`), & Live Diagnostic Report (`08`) |
| `scripts/dropbot-cli.ps1` | 207 | **ACTIVE (V5 Step 0)** | Portable `dropbot save / undo / backup / next` CLI |
| `src/config/configManager.ts` | 339 | **ACTIVE (V6 Slice 3, `< 350`)** | Merges `catalog.json` + `userPreferences.json` + `marketCache.json` + `amazonAsin` / `retailSearchQuery` propagation |
| `src/engine/trendAdvisor.ts` | 327 | **ACTIVE (V6 Pass 1, `< 350`)** | Honest 14d/30d/60d/90d rolling metrics (`0` `Math.sin`), advisory-only `BLEEDING DOWN`, & Hard Ceiling Rule (`effectiveTargetCeiling = policyMaxBuy`) |
| `src/engine/singlesSniper.ts` | 336 | **ACTIVE (V6 Slice 1, `< 350`)** | Quiet Singles & Gyarados Offload Radar (`singlesCache.json`) with 500-key LRU cap (`pruneCompBenchmarksLru`) & 100% silent alert rule |
| `src/pollers/wafBrowserBridge.ts` | 316 | **ACTIVE (V6 Pass 2, `< 350`)** | Invisible System Chrome worker (`channel: 'chrome'`, `--headless=new`, `ignoreHTTPSErrors: true`, concurrency `1` mutex, passive `page.on('response')` JSON wire-tap, `75s–180s` jittered cooldowns, `0` datacenter proxy fallback) |
| `src/pollers/bigBoxAdapters.ts` | 342 | **ACTIVE (V6 Pass 2, `< 350`)** | Verified 1P JSON/hybrid parsers (`Target` RedSky passive XHR, `Walmart` `F55CDC31`, `Best Buy`, `Costco`, `Sam's Club`) returning `{ totalNodesFound, inStockOffers }` + `processIncomingDrop()` dispatcher |
| `src/pollers/bigBoxDomParsers.ts` | 301 | **ACTIVE (V6 Pass 2, `< 350`)** | Split DOM shelf parsers for `GameStop` (object/string `availability`), `Amazon 1P` (`s-search-result` outer slice + brand/title combine), `Barnes & Noble`, `Pokémon Center`, `Best Buy`, & `Costco` |
| `src/pollers/bigBoxRetailPoller.ts` | 252 | **ACTIVE (V6 Pass 2, `< 350`)** | Honest 9-retailer Big-Box 1P poller enforcing `PARSER_BLIND_0_NODES` when `totalNodesFound === 0` + `runSinglePassBigBoxSweep()` |
| `src/pollers/fastTier1Poller.ts` | 285 | **ACTIVE (V6 Pass 1, `< 350`)** | 15s Tier-1 Fast Shopify poller via Node 26 HTTP/2 `fetch()`, `?limit=250`, `ETag`/`304`, `?payment=shop_pay`, & CAD->USD FX |
| `evaluator.ts` | 1,941 | **ACTIVE (V6 Slice 1)** | `mtimeMs`-synced `storeOffersCacheMem`, `buildShopifyDirectCartLinks()` (`?payment=shop_pay`), `buildMobileRetailerLinks()` (Target/BestBuy/Walmart ATC), & Rule of 3 logic |
| `notifier.ts` | 1,052 | **ACTIVE (V6 Slice 1)** | **0ms Fire-Then-Enrich** alert dispatch (`priorityFront = true` immediate send + background `getDualMarketComps()` `PATCH`), `embed.url` fast-lane handoff, & 09:00/18:00 Roundup Digest |
| `listener.ts` | 92 | **ACTIVE (V6 Slice 1)** | Non-blocking `void sendAlert(...).catch(...)` handoff eliminating head-of-line blocking inside poller loops |
| `lgsPoller.ts` | 816 | **ACTIVE (V6 Slice 1)** | 90-store Shopify poller with `resolveShopifyFxMultiplier()` (12 `CAD` stores + `/cart.js` auto-detect), `?payment=shop_pay` cart links, & 3-arg `isSingleCardOrNonSealed()` |
| `policies.ts` | 717 | **ACTIVE (V6 Slice 1)** | Context-aware `isSingleCardOrNonSealed()` unblocking `\bpack\b/\bpromo\b/\bfoil\b/\bsingle\b` on valid sealed containers while blocking 100% of singles, slabs, loose packs, & partial-ETB traps |
| `server.js` | 2,934 | **ACTIVE (V6 Slice 1)** | `mtimeMs`-backed `readJsonCached()` + memoized `/api/status` (`12.49ms`) & `/api/engine-room` (`25.55ms`), zero split-brain `storeOffersCache.json` writes, & honest `/api/sku-history/:skuId` |
| `public/index.html` | 6,302 | **ACTIVE (V6 Slice 1)** | Instant 0ms Rule-of-3 UI, Top Trophy Room nav, collapsible `[+ METRICS]` drawers, and `?payment=shop_pay` `[CART 1X/2X/3X]` buttons |
| `public/css/stadium.css` + `public/js/stadium/*.js` | 5 files | **HARD-FROZEN (V5 Slice 2)** | `git diff = 0 lines` verified |
