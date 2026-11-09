# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V5 Slice 7 Complete (Instant Optimistic UI for `[WALL / DAD / LOGAN]` Buttons, Trophy Room Top-Nav & `[Remove]` Replacement, Purge Fake `$115` ETB Market Placeholders, Card Visual Declutter, and Invisible `--headless=new` WAF Session Bridge for Pokémon Center & GameStop)**.
- **Last Checkpoint Timestamp:** `2026-11-09 10:49 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `2190c28` (`V5 Slice 7: Instant family slot UI, Trophy Room top nav, fix  ETB market placeholders, declutter cards, and add invisible headless WAF bridge`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (`0` crashes, all 90 active Shopify LGS stores healthy, 15s Tier-1 Fast Poller + Big-Box Poller + 150s WAF Session Bridge + 09:00/18:00 Roundup Digest active)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (`HTTP 200 OK` across `/`, `/dashboard.html`, `/api/status`, `/api/advisor/next-buy`, `POST /api/digest/send-now`, `POST /api/policies/:skuId/family-slots`, `/api/singles`, and `/api/engine-room`)
- **Active Sensor & Cache Counts:**
  - **Shopify LGS Pool (`config/stores.json`):** `90` active healthy stores (`100%` online, `0` blocked; `26` Tier-1 Fast 15s restock stores).
  - **Big-Box Sensors (`src/pollers/bigBoxRetailPoller.ts` + `src/pollers/wafBrowserBridge.ts`):** `7` honest Big-Box / Official 1st-Party sensors (`Pokémon Center`, `Target`, `Walmart`, `Best Buy`, `Costco`, `Sam's Club`, `GameStop`) with zero fake `Math.max` floors and 150s persistent session caching in `data/wafSessionCookies.json`.
  - **Target Matrix (`config/catalog.json` + `config/userPreferences.json` + `marketCache.json`):** `131` tracked sealed SKUs with Rule of 3 Family Completion slots (`wallOwned`, `dadRipOwned`, `loganRipOwned`, `autoPilotEnabled: true`) and accurate `$48–$60` S&V ETB baselines (0 fake `$115` placeholders).

---

## 2. Module Status Across V5 Refactoring

| Module / File | Lines | Status | V5 Target Action |
| :--- | :---: | :--- | :--- |
| `_nyx_state/01..06_*.md` | 6 files | **ACTIVE (V5 Step 0–Slice 7)** | Multi-agent continuity engine & Failure Graveyard |
| `scripts/dropbot-cli.ps1` | 195 | **ACTIVE (V5 Step 0)** | Portable `dropbot save / undo / backup / next` CLI |
| `src/config/configManager.ts` | 335 | **ACTIVE (V5 Slice 7)** | `< 350` lines; merges `catalog.json` + `userPreferences.json` + `marketCache.json` + live store-offer median (`computeLiveStoreOfferMedian`); Rule of 3 slots |
| `src/engine/trendAdvisor.ts` | 312 | **ACTIVE (V5 Slice 7)** | `< 350` lines; 14d/30d/60d/90d Rolling Market Analytics, `getLiveStoreOfferMedian()`, `computeAutoPilotTarget()`, `BLEEDING DOWN`, `SUPPLY TIGHTENING`, & `ELASTIC_DIP` |
| `src/engine/singlesSniper.ts` | 323 | **ACTIVE (V5 Slice 6)** | `< 350` lines; Quiet Singles & Gyarados Offload Radar (`singlesCache.json`) with 100% silent alert rule enforced |
| `src/pollers/wafBrowserBridge.ts` | 231 | **ACTIVE (V5 Slice 7)** | `< 250` lines; 100% invisible `--headless=new` / session cookie bridge (`data/wafSessionCookies.json`, `150s` polite cycle) + Queue-It detector (`◈ ⟦ POKÉMON CENTER QUEUE ACTIVE — ENTER LINE NOW ⟧`) |
| `src/pollers/bigBoxRetailPoller.ts` | 296 | **ACTIVE (V5 Slice 7)** | `< 350` lines; Honest 7-retailer Big-Box 1P poller integrated with `wafBrowserBridge.ts` |
| `src/pollers/fastTier1Poller.ts` | 336 | **ACTIVE (V5 Slice 4A)** | `< 350` lines; 15-second Tier-1 Fast Shopify restock delta poller |
| `evaluator.ts` | 1,870 | **ACTIVE (V5 Slice 7)** | Live store-offer median preference, Rule of 3 Rip Hunt Mode (`1/3` & `2/3` + `◈ ⟦ RIP PAIR READY (QTY 2+) ⟧`), `3/3 COMPLETE` mute, 1P Big-Box/PC Retail MSRP Flip Bypass, and `buildShopifyDirectCartLinks()` |
| `notifier.ts` | 1,105 | **ACTIVE (V5 Slice 6)** | Hard silent-singles guard, `[CART 1X] / [CART 2X] / [CART 3X]` links, and twice-daily (`09:00` & `18:00`) 4-section Market & Deal Roundup Digest |
| `policies.ts` | 760 | **ACTIVE (V5 Slice 7)** | Strict Sealed-Only Traffic Cop (`isSingleCardOrNonSealed()`), multi-box (`Set of 2`) & hyphenated `pokemon-center` firewalls, and `reloadWatchPolicies()` |
| `server.js` | 2,861 | **ACTIVE (V5 Slice 7)** | Exposes `/api/advisor/next-buy`, `POST /api/policies/:skuId/family-slots` (returns `policy` + `sku`), `POST /api/digest/send-now`, `/api/singles`, and `/api/engine-room` with `wafBridge` telemetry |
| `public/index.html` | 6,299 | **ACTIVE (V5 Slice 7)** | Instant 0ms optimistic UI on `[WALL] [DAD RIP] [LOGAN RIP] [3/3 ALL]`, Top Trophy Room & Quick Filter pills (`ALL SETS` \| `NEED WALL (0/3)` \| `NEED RIP PAIR (1/3–2/3)` \| `TROPHY ROOM (ON WALL)` \| `3/3 COMPLETE`), and collapsible `<details>` `[+ METRICS]` drawers |
| `public/css/stadium.css` + `public/js/stadium/*.js` | 5 files | **HARD-FROZEN (V5 Slice 2)** | `git diff = 0 lines` verified |
