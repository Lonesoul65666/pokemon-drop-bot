# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` / `dropbot backup` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V5 Slice 4A, 4B & Slice 5: 15s Tier-1 Fast Restock Poller, Honest Big-Box Poller, Strict Sealed-Only Traffic Cop, Cache Purge & Quiet Singles / Gyarados Offload Radar)
- Built `src/pollers/fastTier1Poller.ts` (`< 350` lines) polling 26 Tier-1 Shopify stores every 15s (`?limit=50`, concurrency 6) and `src/pollers/bigBoxRetailPoller.ts` (`< 350` lines) polling Target (1P RedSky JSON), Walmart, Best Buy, Pokémon Center, Costco, Sam's Club, and GameStop with 100% honest parsed counts (`0` fake `Math.max` floors).
- Implemented `isSingleCardOrNonSealed()` and positive sealed container gates in `policies.ts`, built `src/engine/singlesSniper.ts` (`< 350` lines) routing singles (`>= $15`) quietly to `singlesCache.json` with a collapsible Gyarados watchlist search drawer, and purged `95` leaked single-card entries from `storeOffersCache.json`, `25` from `dropsHistory.json`, and `103` from `liveStock.json`.

### Turn -1 (V5 Slice 6: Interactive "Rule of 3" `[WALL / DAD / LOGAN]` Checkboxes, Dynamic Auto-Pilot Dip Brain & `$100/$200/$350/$500+` Next-Buy Advisor, 1P Big-Box/PC Retail Flip Bypass, Roundup Digest Restoration, and 1-Click Shopify Cart Links)
- Upgraded per-SKU ownership state to track `wallOwned`, `dadRipOwned`, and `loganRipOwned`, computing `completionCount` (`0..3`) and `fullyConquered`, wired `POST /api/policies/:skuId/family-slots`, added 1P Big-Box/PC Retail MSRP Flip / Trade Bait Bypass (`◈ ⟦ RETAIL MSRP FLIP / TRADE BAIT // $XX.XX RETAIL VS $XXX MARKET (+XX%) ⟧`), implemented `computeAutoPilotTarget()` + `GET /api/advisor/next-buy` + the Capital Advisor Bar on `Live Command`, restored the twice-daily (`09:00` & `18:00`) 4-section Market & Deal Roundup Digest + `[SEND DIGEST NOW]`, rendered `[CART 1X]`, `[CART 2X]`, `[CART 3X]` buttons, and pinned `Kanzen Games` strictly to `/collections/pokemon-sealed-in-stock/products.json`.

### Turn 0 (Current Session — V5 Slice 7: Instant Optimistic UI for `[WALL / DAD / LOGAN]` Buttons, Trophy Room Top-Nav & `[Remove]` Replacement, Purge Fake `$115` ETB Market Placeholders, Card Visual Declutter, and Invisible `--headless=new` WAF Bypass for Pokémon Center & GameStop)
- **1. Instant Optimistic UI Updates on `[WALL]`, `[DAD RIP]`, `[LOGAN RIP]`, & `[3/3]` (`public/index.html` & `server.js`):**
  - Updated `toggleSkuFamilySlot()` in `public/index.html` with `applyFamilySlotStateToMemory()` and `syncSingleSkuDomInPlace()` so clicking `[WALL]`, `[DAD RIP]`, `[LOGAN RIP]`, or `[X/3 ALL]` immediately toggles active/lit CSS classes, updates the `0/3` ➔ `1/3` ➔ `2/3` ➔ `3/3` badge and border glow in the DOM at `0ms`, and updates `policies` + `latestStatusData` before `POST /api/policies/:skuId/family-slots` even finishes, then syncs the server-authoritative `data.policy` + top-level completion counters without a page reload.
- **2. Trophy Room Top-Nav & `[Remove]` Replacement (`public/index.html`):**
  - Moved the **Trophy Room / Conquered Showcase** to the top of `#view_CONQUERED_VAULT` and added the top **Trophy Room & Rule-of-3 Quick Nav** header (`ALL SETS` | `NEED WALL (0/3)` | `NEED RIP PAIR (1/3–2/3)` | `TROPHY ROOM (ON WALL)` | `3/3 COMPLETE`) on both `Conquered Vault` and `Target Matrix` (placing `✦ ⟦ TROPHY ROOM // CONQUERED WALL ETBS ⟧` at the top of `getMatrixCategoryGroups()`).
  - Removed the vague `[Remove]` button on Conquered/Trophy cards and replaced it with `renderFamilySlotsPillsHtml(p.id, p, false)`.
- **3. Purged Fake `$115` Market Placeholder Across S&V ETBs (`_nyx_state/02_TECHNICAL_ARCHITECTURE_AND_PIPELINES.md`, `config/catalog.json`, `marketCache.json`, `src/config/configManager.ts`, `src/engine/trendAdvisor.ts`, `evaluator.ts`, `policies.ts`, `server.js`):**
  - Logged `[FAILED - Hardcoded $115 ETB Market Value Placeholder]` in the Failure Graveyard (`02_TECHNICAL_ARCHITECTURE_AND_PIPELINES.md`).
  - Replaced fake `115` (`1150` case) placeholders across standard Scarlet & Violet / Mega Discovery ETBs in `config/catalog.json` (`sv-paradox-rift-roaring-etb` -> `$48`, `sv-paradox-rift-valiant-etb` -> `$48`, `sv-base-koraidon-etb` -> `$52`, `sv-base-miraidon-etb` -> `$52`, `sv-temporal-forces-wake-etb` -> `$50`, `sv-temporal-forces-leaves-etb` -> `$50`, `sv-shrouded-fable-etb` -> `$48`, `sv-stellar-crown-etb` -> `$54`, `sv-journey-together-etb` -> `$58`, `me-discovery-etb` -> `$56`, `sv-paldean-fates-etb` -> `$58` / `$60` live median) while leaving Scott's personal `maxMarketBuyPrice` sliders in `config/userPreferences.json` 100% untouched.
  - Added `computeLiveStoreOfferMedian()` / `getLiveStoreOfferMedian()` preferring the median of the lowest 3–5 verified in-stock LGS offers whenever `2+` plausible store offers exist, and hardened `policies.ts` against `[Set of 2]` multi-box bundles and hyphenated `pokemon-center` URL slugs.
- **4. Decluttered Dashboard Cards (`public/index.html`):**
  - Added `renderCardMetricsDrawerHtml()` (`<details>` / `[+ METRICS // 14D–90D ROLLING & FLOOR]`) and streamlined SKU cards across `Live Command`, `Bounty Hunter`, `Conquered Vault`, and `Target Matrix` so primary surfaces show only Set Title, Best Landed Price vs. Target Slider, 1 primary Verdict/Trend badge, `[CART 1X / 2X]` quick links, and interactive `[WALL] [DAD RIP] [LOGAN RIP]` pills.
- **5. Invisible `--headless=new` WAF Session Bridge (`src/pollers/wafBrowserBridge.ts` `< 250 Lines` & `src/pollers/bigBoxRetailPoller.ts` `< 350 Lines`):**
  - Created `src/pollers/wafBrowserBridge.ts` (`231` lines) enforcing `headless: true`, `windowsHide: true`, `--headless=new`, `--disable-gpu`, and `--no-startup-window`, running on a polite `150s` cycle with persistent cookie/session caching in `data/wafSessionCookies.json` and Queue-It header/redirect detection (`◈ ⟦ POKÉMON CENTER QUEUE ACTIVE — ENTER LINE NOW ⟧`).

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
