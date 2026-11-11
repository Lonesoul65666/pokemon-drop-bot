# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` / `dropbot backup` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V5 Slice 7: Instant Optimistic UI for `[WALL / DAD / LOGAN]` Buttons, Trophy Room Top-Nav & `[Remove]` Replacement, Purge Fake `$115` ETB Market Placeholders, Card Visual Declutter, and `wafBrowserBridge.ts`)
- Implemented 0ms optimistic DOM + in-memory `latestStatusData` updates on `[WALL]`, `[DAD RIP]`, `[LOGAN RIP]`, and `[3/3 ALL]` clicks; promoted the Trophy Room to the top of `Conquered Vault` and `Target Matrix` with quick filter pills and replaced `[Remove]` with interactive Rule-of-3 pills.
- Purged fake `$115` (`$1,150` case) S&V ETB baselines in `config/catalog.json` and `marketCache.json` while preferring live store-offer medians (`computeLiveStoreOfferMedian`), tucked secondary rolling metrics into collapsible `<details>` `[+ METRICS]` drawers, and added `src/pollers/wafBrowserBridge.ts` (`231` lines) with 150s persistent session caching in `data/wafSessionCookies.json` and Queue-It header detection.

### Turn -1 (V6 Step 0 — Strict Read-Only Deep Forensic System & Commercial Audit -> `_nyx_state/07_DEEP_SYSTEM_AND_COMMERCIAL_AUDIT.md`)
- Executed a strict read-only, line-by-line forensic audit of `C:\pokemon-drop-bot` (`0` tracked lines modified) and authored `_nyx_state/07_DEEP_SYSTEM_AND_COMMERCIAL_AUDIT.md`.
- Uncovered 5 critical silent defects: (1) `4,000ms–15,000ms` synchronous pre-alert `getDualMarketComps()` blocking in `notifier.ts:333` & `listener.ts:27` + missing `?payment=shop_pay` / native retail deep links, (2) `\bpack\b`, `\bpromo\b`, `\bfoil\b`, and `\bsingle\b` in `GLOBAL_JUNK_EXCLUSIONS` silently killing `"6-Pack Booster Bundle"`, `"ETB (Includes Full-Art Foil Promo Card)"`, and `"Single Strike ETB"` + `?limit=50` blind spot in `fastTier1Poller.ts` + 12 Canadian stores missing CAD->USD conversion, (3) `Math.sin` synthetic 90d/24h price curves in `trendAdvisor.ts` & `server.js` + Auto-Pilot silently overriding Scott's slider upward, (4) 2-process `storeOffersCacheMem` split-brain overwrite in `server.js` + `965ms` synchronous `/api/status` JSON re-parsing + unbounded `2,801`-key `singlesCache.json`, and (5) `wafBrowserBridge.ts` using plain `axios.get` instead of real Chromium for JS challenges.

### Turn 0 (Current Session — V6 Slice 1: 0ms Fire-Then-Enrich Alerts, 1-Tap Shop Pay + Mobile Deep Links, Matcher & CAD Fixes, Purge `Math.sin`, and Stop Split-Brain Overwrites)
- **0. Failure Graveyard Logged (`_nyx_state/02_TECHNICAL_ARCHITECTURE_AND_PIPELINES.md`):**
  - Permanently recorded all 5 V5->V6 anti-patterns (`Math.sin` synthetic history & upward slider override, synchronous pre-alert comp scraping, `axios` fake WAF bridge, `pack/foil/promo/single` sealed collateral damage + `?limit=50` + CAD gap, and 2-process `storeOffersCacheMem` split-brain overwrite + unbounded `singlesCache.json`).
- **1. 0ms Fire-Then-Enrich & Mobile Checkout Fast-Lane (`notifier.ts`, `listener.ts`, `evaluator.ts`, `src/pollers/fastTier1Poller.ts`, `lgsPoller.ts`, `public/index.html`):**
  - Refactored `sendAlert()` in `notifier.ts` to dispatch Discord (`priorityFront = true`) + Telegram in `0ms` using `mtimeMs`-cached telemetry floors and `embed.url = primaryFastUrl`, then run `getDualMarketComps()` asynchronously in a detached background task that `PATCH`es live market comps onto the message if still active. Updated `listener.ts` (`processIncomingDrop`) to non-blocking `void alertPromise.catch(...)`.
  - Appended `?payment=shop_pay` to all `1x`, `2x`, and `3x` Shopify direct `/cart/{variantId}:{qty}` links across `evaluator.ts`, `fastTier1Poller.ts`, `lgsPoller.ts`, and `public/index.html`, and added `buildMobileRetailerLinks()` for Target (`target.com/p/-/A-{tcin}`), Best Buy (`api.bestbuy.com/click/-/{sku}/cart`), and Walmart (`walmart.com/pac?id={id}&quantity=1` + `affil.walmart.com/cart/buynow`).
- **2. Sealed Matcher Friendly-Fire Fix, `?limit=250` Tier-1 Fast Poller, & 12-Store CAD->USD FX (`policies.ts`, `config/catalog.json`, `config/stores.json`, `lgsPoller.ts`, `src/pollers/fastTier1Poller.ts`):**
  - Split `isSingleCardOrNonSealed()` (`policies.ts`) into unconditional junk exclusions vs. `CONTEXT_SENSITIVE_NON_SEALED_PATTERNS` (`\bpack\b`, `\bpromo\b`, `\bfoil\b`, `full art`, `\bholo\b`, `\bsingle\b`) and `ACCESSORY_CONTENT_PATTERNS`, and added reverse word-order Battle Styles matchers in `config/catalog.json` — verified 100% pass across sealed bundles/ETBs and 100% rejection across raw singles, slabs, loose packs, and partial-ETB traps.
  - Upgraded `fastTier1Poller.ts` (`342` lines, `< 350`) to `/products.json?limit=250` (`updated_at desc` / curated sealed `?limit=250`) with `ETag`/`304` + O(1) unchanged-variant short-circuiting, tagged `Kanzen Games` & `Sports Card Junction` as `CAD` (`12` total `CAD` stores in `config/stores.json`), and added `resolveShopifyFxMultiplier()` (`0.73` CAD->USD + `/cart.js` currency auto-detection).
- **3. Purged All `Math.sin` Synthetic History & Enforced Hard Slider Ceiling (`src/engine/trendAdvisor.ts` & `server.js`):**
  - Deleted 100% of `Math.sin` / `pseudoRand` curve generators, `/destined-rivals/i` hardcodes, and fake `0.99x` eBay floors; exposed honest `sampleDaysCount` & `insufficientHistory` (`< 14d`); and clamped `computeAutoPilotTarget()` so `effectiveTargetCeiling <= Math.max(msrpCeiling, policyMaxBuy)`.
- **4. Surgical Split-Brain Stopgap, `mtimeMs` API Memoization & 500-Key `singlesCache` LRU (`server.js`, `evaluator.ts`, `src/engine/singlesSniper.ts`):**
  - Removed `refreshCachedStoreOffersStatus()` from `server.js` POST routes, synced `evaluator.ts` `storeOffersCacheMem` by `mtimeMs`, memoized `/api/status` (`965ms` -> `12.49ms`) and `/api/engine-room` (`25.55ms`) via `readJsonCached()` + `getDashboardStateSignature()`, and pruned `singlesCache.json` `compBenchmarks` from `2,801` -> `500` keys with strict 500-key LRU in `singlesSniper.ts` (`336` lines).

---

## Automated CLI Checkpoint Log (`dropbot save / undo / backup`)
- `2026-11-04 14:45 CST` | **INIT** | Initialized 6-file `_nyx_state/` continuity engine, Failure Graveyard, and `dropbot` PowerShell CLI suite.
- `2026-11-04 14:49 CST` | **SAVE** (from `169c7b2`) | Initial V5 Step 0 baseline backup (_nyx_state 6-file engine + dropbot CLI)
- `2026-11-04 16:21 CST` | **SAVE** (from `acca670`) | V5 Slice 1: Lock personal sliders and Wall checklist in config/userPreferences.json and unify store shipping registry in config/stores.json
- `2026-11-04 16:32 CST` | **SAVE** (from `89da145`) | V5 Slice 2: Extract Logan Battle Stadium into modular public/js/stadium/ files, delete duplicate 9780-line dashboard.html clone, and hard-freeze Stadium
- `2026-11-04 17:04 CST` | **SAVE** (from `51e0616`) | V5 Slice 3: Unblock pre-order sliders and MSRP shipping, add Close-Call cushion, per-store cooldowns, and TCGPlayer scam shield
- `2026-11-04 18:13 CST` | **SAVE** (from `6dc0947`) | V5 Slice 3.5: Extract src/engine/trendAdvisor.ts with 30/60/90d Elastic Dip sniper and replace blind pre-release calendar warnings
- `2026-11-05 00:16 CST` | **SAVE** (from `12fac76`) | Manual dropbot save checkpoint
- `2026-11-07 01:13 CST` | **SAVE** (from `4972515`) | V5 Slice 6: Rule of 3 Wall/Dad/Logan checkboxes, Auto-Pilot Dip Advisor, Big-Box Flip Bypass, Roundup Digest, and 1-Click Cart links
- `2026-11-07 18:54 CST` | **SAVE** (from `9d72726`) | V5 Final Polish: Pin Kanzen Games to pokemon-sealed-in-stock feed and block Holofoil/bracket singles
- `2026-11-09 10:49 CST` | **SAVE** (from `2190c28`) | V5 Slice 7: Instant family slot UI, Trophy Room top nav, fix  ETB market placeholders, declutter cards, and add invisible headless WAF bridge
- `2026-11-10 23:20 CST` | **SAVE** (from `1b23a36`) | V6 Slice 1: 0ms Fire-Then-Enrich alerts, Shop Pay fast-lane, fix promo/pack matcher & CAD stores, purge Math.sin, and fix split-brain cache overwrite
