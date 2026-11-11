# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` / `dropbot backup` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V6 Step 0 — Strict Read-Only Deep Forensic System & Commercial Audit -> `_nyx_state/07_DEEP_SYSTEM_AND_COMMERCIAL_AUDIT.md`)
- Executed a strict read-only, line-by-line forensic audit of `C:\pokemon-drop-bot` (`0` tracked lines modified) and authored `_nyx_state/07_DEEP_SYSTEM_AND_COMMERCIAL_AUDIT.md`.
- Uncovered 5 critical silent defects: (1) `4,000ms–15,000ms` synchronous pre-alert `getDualMarketComps()` blocking in `notifier.ts:333` & `listener.ts:27` + missing `?payment=shop_pay` / native retail deep links, (2) `\bpack\b`, `\bpromo\b`, `\bfoil\b`, and `\bsingle\b` in `GLOBAL_JUNK_EXCLUSIONS` silently killing `"6-Pack Booster Bundle"`, `"ETB (Includes Full-Art Foil Promo Card)"`, and `"Single Strike ETB"` + `?limit=50` blind spot in `fastTier1Poller.ts` + 12 Canadian stores missing CAD->USD conversion, (3) `Math.sin` synthetic 90d/24h price curves in `trendAdvisor.ts` & `server.js` + Auto-Pilot silently overriding Scott's slider upward, (4) 2-process `storeOffersCacheMem` split-brain overwrite in `server.js` + `965ms` synchronous `/api/status` JSON re-parsing + unbounded `2,801`-key `singlesCache.json`, and (5) `wafBrowserBridge.ts` using plain `axios.get` instead of real Chromium for JS challenges.

### Turn -1 (V6 Slice 1: 0ms Fire-Then-Enrich Alerts, 1-Tap Shop Pay + Mobile Deep Links, Matcher & CAD Fixes, Purge `Math.sin`, and Stop Split-Brain Overwrites)
- Refactored `sendAlert()` in `notifier.ts` + `listener.ts` to dispatch Discord (`priorityFront = true`) + Telegram in `0ms` with `?payment=shop_pay` Shopify fast-lanes and Target/BestBuy/Walmart native mobile ATC links, enriching live market comps asynchronously via background `PATCH`.
- Fixed `isSingleCardOrNonSealed()` (`policies.ts`) to unblock `pack/promo/foil/single` on valid sealed containers, upgraded `fastTier1Poller.ts` (`342` lines) to `?limit=250` with `ETag`/`304` + O(1) diffing, wired 12-store CAD->USD (`0.73` FX + `/cart.js` runtime auto-detection), purged 100% of `Math.sin` synthetic history in `trendAdvisor.ts` & `server.js` with Hard Ceiling enforcement, and stopped split-brain `storeOffersCache.json` overwrites while cutting `/api/status` from `965ms` -> `12.49ms`.

### Turn 0 (Current Session — V6 Slice 3: Real Invisible Playwright WAF Worker, Wire All 9 Big-Box Retailers Into `processIncomingDrop()`, Add Amazon 1P `ATVPDKIKX0DER` & Barnes & Noble, Fix Pokémon Center Queue/OOS Bugs, and Seed Retail SKU IDs)
- **1. Real Invisible Playwright WAF Worker (`src/pollers/wafBrowserBridge.ts`, `345` lines `< 350`):**
  - Installed `playwright` (`package.json`) and replaced the fake `axios.get` bridge with real headless Chromium (`channel: 'chrome'` / `'msedge'`, `headless: true`, `--headless=new`, `--disable-gpu`, `--no-startup-window`, `--mute-audio`, verified `0` visible desktop windows on Windows via Win32 `IsWindowVisible()`).
  - Enforced `waitUntil: 'domcontentloaded'` with a hard `15000ms` timeout, `finally { await page.close() }` + `finally { await context.close() }`, native Chrome UA alignment (penetrating `GameStop` and `Barnes & Noble` Shopify Hydrogen at `HTTP 200 OK`), and polite `160s` session caching in `data/wafSessionCookies.json`.
  - Deleted the hardcoded `Chaos Rising` stub and OOS category link scraper on Pokémon Center, wiring `sendPokemonCenterQueueAlert()` (`30m` cooldown, `◈ ⟦ POKÉMON CENTER WAITING ROOM LIVE — JOIN QUEUE NOW ⟧` -> `https://www.pokemoncenter.com`) and strict `InStock` payload verification.
- **2. Wired All 9 Big-Box Retailers Into `processIncomingDrop()` (`src/pollers/bigBoxAdapters.ts` `310` lines & `src/pollers/bigBoxRetailPoller.ts` `273` lines, both `< 350`):**
  - Wired `Target` (RedSky 1P only -> `target.com/p/-/A-{tcin}`, honest `435` `WAF_CHALLENGE_PX`), `Walmart` (strict `F55CDC31AB754BB68FE0B39041159D63` 1P -> `walmart.com/pac?id={itemId}&quantity=1`), `Best Buy` (1P online availability -> `api.bestbuy.com/click/-/{sku}/cart`), `Amazon 1P` (`smid=ATVPDKIKX0DER` `<= msrpCeiling * 1.08` -> `amazon.com/gp/aws/cart/add.html?ASIN.1={asin}&Quantity.1=1`), `Pokémon Center`, `GameStop`, `Barnes & Noble` (`/search?q=pokemon+trading+card+game` Hydrogen `"Quick Add"`), `Costco`, and `Sam's Club` into `processIncomingDrop()` + `storeOffersCache.json` + `/api/engine-room` (`northStar5` `9` live sensors).
- **3. Seeded Retail SKU IDs & Verified End-to-End (`config/catalog.json`, `config/stores.json`, `evaluator.ts`, `notifier.ts`, `lgsPoller.ts`, `server.js`):**
  - Populated `targetTcin`, `walmartItemId`, `bestBuySku`, `amazonAsin`, `pcSlug`, and `retailSearchQuery` across `20` priority sealed SKUs in `config/catalog.json` with dynamic `matchProductToSku()` fallback; verified 9-adapter dry-run integration (`0` false alerts on OOS/3P payloads), restarted PM2, and verified live `/api/engine-room` (`HTTP 200`, `9` Big-Box sensors).

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
- `2026-11-11 00:06 CST` | **SAVE** (from `a8a6d3a`) | V6 Slice 3: Real invisible Playwright WAF worker, live processIncomingDrop across all 9 Big-Box stores + Amazon 1P & B&N, and 1-tap retail cart links
