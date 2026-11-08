# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V5 Slice 6 + Kanzen Games Sealed-Feed Pin & Holofoil/Bracket Anti-Singles Patch Complete** (Interactive "Rule of 3" `[WALL / DAD RIP / LOGAN RIP]` checkboxes, Dynamic Auto-Pilot Dip Brain & `$100/$200/$350/$500+` Next-Buy Capital Advisor, 1st-Party Big-Box & Pokémon Center Retail MSRP Flip / Trade Bait Bypass, 4-Section Market & Deal Roundup Digest (`09:00` & `18:00` + `[SEND DIGEST NOW]`), 1-Click Direct Shopify Cart Links (`[CART 1X]`, `[CART 2X]`, `[CART 3X]`), Kanzen Games pinned to `/collections/pokemon-sealed-in-stock/products.json` + `product_type === "Pokemon Sealed"`, and 100% Silent Singles Enforcement).
- **Last Checkpoint Timestamp:** `2026-11-07 18:54 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `9d72726` (`V5 Final Polish: Pin Kanzen Games to pokemon-sealed-in-stock feed and block Holofoil/bracket singles`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (`0` crashes, all 90 active Shopify LGS stores healthy, 15s Tier-1 Fast Poller + Big-Box Poller + 09:00/18:00 Roundup Digest active)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (`HTTP 200 OK` across `/`, `/dashboard.html`, `/api/status`, `/api/advisor/next-buy`, `POST /api/digest/send-now`, `POST /api/policies/:skuId/family-slots`, `/api/singles`, and `/api/engine-room`)
- **Active Sensor & Cache Counts:**
  - **Shopify LGS Pool (`config/stores.json`):** `90` active healthy stores (`100%` online, `0` blocked; `26` Tier-1 Fast 15s restock stores).
  - **Big-Box Sensors (`src/pollers/bigBoxRetailPoller.ts`):** `7` honest Big-Box / Official 1st-Party sensors (`Pokémon Center`, `Target`, `Walmart`, `Best Buy`, `Costco`, `Sam's Club`, `GameStop`) with zero fake `Math.max` floors.
  - **Target Matrix (`config/catalog.json` + `config/userPreferences.json` + `marketCache.json`):** `131` tracked sealed SKUs with Rule of 3 Family Completion slots (`wallOwned`, `dadRipOwned`, `loganRipOwned`, `autoPilotEnabled: true`).

---

## 2. Module Status Across V5 Refactoring

| Module / File | Lines | Status | V5 Target Action |
| :--- | :---: | :--- | :--- |
| `_nyx_state/01..06_*.md` | 6 files | **ACTIVE (V5 Step 0)** | Multi-agent continuity engine & Failure Graveyard |
| `scripts/dropbot-cli.ps1` | 195 | **ACTIVE (V5 Step 0)** | Portable `dropbot save / undo / backup / next` CLI |
| `src/config/configManager.ts` | 336 | **ACTIVE (V5 Slice 6)** | `< 350` lines; merges `catalog.json` + `userPreferences.json` + `marketCache.json`; Rule of 3 slots (`wallOwned`, `dadRipOwned`, `loganRipOwned`, `autoPilotEnabled`) & `singlesAlertsEnabled: false` |
| `src/engine/trendAdvisor.ts` | 336 | **ACTIVE (V5 Slice 6)** | `< 350` lines; 14d/30d/60d/90d Rolling Market Analytics, `computeAutoPilotTarget()`, `BLEEDING DOWN`, `SUPPLY TIGHTENING`, & `ELASTIC_DIP` |
| `src/engine/singlesSniper.ts` | 291 | **ACTIVE (V5 Slice 6)** | `< 350` lines; Quiet Singles & Gyarados Offload Radar (`singlesCache.json`) with 100% silent alert rule enforced |
| `src/pollers/bigBoxRetailPoller.ts` | 326 | **ACTIVE (V5 Slice 4B)** | `< 350` lines; Honest 7-retailer Big-Box 1P poller (Target RedSky 1P, Walmart, Best Buy, PC, Costco, Sam's, GameStop) |
| `src/pollers/fastTier1Poller.ts` | 297 | **ACTIVE (V5 Slice 4A)** | `< 350` lines; 15-second Tier-1 Fast Shopify restock delta poller |
| `evaluator.ts` | 1,355 | **ACTIVE (V5 Slice 6)** | Rule of 3 Rip Hunt Mode (`1/3` & `2/3` + `◈ ⟦ RIP PAIR READY (QTY 2+) ⟧`), `3/3 COMPLETE` mute, 1P Big-Box/PC Retail MSRP Flip / Trade Bait Bypass, and `buildShopifyDirectCartLinks()` |
| `notifier.ts` | 915 | **ACTIVE (V5 Slice 6)** | Hard silent-singles guard, `[CART 1X] / [CART 2X] / [CART 3X]` links, and twice-daily (`09:00` & `18:00`) 4-section Market & Deal Roundup Digest |
| `policies.ts` | 485 | **ACTIVE (V5 Slice 6)** | Strict Sealed-Only Traffic Cop (`isSingleCardOrNonSealed()`) + positive sealed container gate + `reloadWatchPolicies()` |
| `server.js` | 2,610 | **ACTIVE (V5 Slice 6)** | Exposes `/api/advisor/next-buy`, `POST /api/policies/:skuId/family-slots`, `POST /api/digest/send-now`, `/api/singles`, and embeds `nextBuyAdvisor` in `/api/status` |
| `public/index.html` | 6,095 | **ACTIVE (V5 Slice 6)** | Top `[SEND DIGEST NOW]` button, `$100/$200/$350/$500+` Capital Advisor Bar, interactive `[WALL] [DAD RIP] [LOGAN RIP] [3/3 ALL]` pills, and `[CART 1X/2X/3X]` buttons |
| `public/css/stadium.css` + `public/js/stadium/*.js` | 5 files | **HARD-FROZEN (V5 Slice 2)** | `git diff = 0 lines` verified |
