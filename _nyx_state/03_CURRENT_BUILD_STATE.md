# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V5 Step 0 Complete** (6-File `_nyx_state/` Continuity Engine, Failure Graveyard & Portable `dropbot` PowerShell CLI Suite Initialized; Ready for **V5 Step 1A: Frontend De-Bloat & Battle Stadium Extraction**).
- **Last Checkpoint Timestamp:** `2026-11-04 14:49 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `169c7b2` (`Initial V5 Step 0 baseline backup (_nyx_state 6-file engine + dropbot CLI)`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (Uptime `8D`, `0` restarts, ~480 MB RAM)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (Uptime `8D`, `0` restarts, ~90 MB RAM)
- **Active Sensor & Cache Counts:**
  - **Shopify LGS Pool:** `91` stores configured (`90` responding in latest sweep, `1` dead domain `Lets Play TCG` returning HTTP 404 in circuit cooldown; ~`40,096` listings scanned per ~61s cycle).
  - **Big-Box Sensors:** `5` North Star retailers configured in `vampirePoller.ts` (*Note: Currently returning 0 1P MSRP items due to Imperva/PerimeterX/Stub/CSR issues documented in `02_TECHNICAL_ARCHITECTURE_AND_PIPELINES.md`; slated for V5 Step 2A/2B overhaul*).
  - **Live Shelf Cache (`storeOffersCache.json`):** `497` matched in-stock offers across `66` unique SKUs (`248` Shopify LGS offers + `249` TCGPlayer Verified Seller offers).
  - **Target Matrix (`policies.json` & `marketCache.json`):** `131` tracked sealed SKUs (`38` Wall Display ETBs: `8` Conquered / `30` Still Needed).

---

## 2. Module Status Prior to V5 Refactoring

| Module / File | Lines | Status | V5 Target Action |
| :--- | :---: | :--- | :--- |
| `_nyx_state/01..06_*.md` | 6 files | **ACTIVE (V5 Step 0)** | Multi-agent continuity engine & Failure Graveyard |
| `scripts/dropbot-cli.ps1` | ~195 | **ACTIVE (V5 Step 0)** | Portable `dropbot save / undo / backup / next` CLI |
| `public/index.html` | 9,780 | **NEEDS SPLIT (Step 1A)** | Extract Logan's Stadium (~3,800 lines) to `public/js/logan-stadium.js` + `public/css/stadium.css` |
| `dashboard.html` | 9,780 | **DEPRECATED CLONE (Step 1A)** | Delete root duplicate & route `/dashboard.html` to `public/index.html` in `server.js` |
| `evaluator.ts` | 1,127 | **BUGS IDENTIFIED (Step 1B)** | Fix Pre-Order ceiling override (`L706`), `$54.99` MSRP shipping unicorn check (`L735`), and limit-1 shipping block (`L892`) |
| `policies.ts` & `policies.json` | 410 / 131 SKUs | **NEEDS UNBLOCKING (Step 1B/1D)** | Add `(box\|display)` regex support, raise `$115/$275` price ceilings, and split `catalog.json` vs `userPreferences.json` in Step 1D |
| `lgsPoller.ts` & `storeHealth.json` | 692 | **NEEDS SPEEDUP (Step 1C)** | Fix narrow `resolvedPath` feeds (`Zulus`, `Safari Zone`, `Kanzen`, `Poke-Collect`, etc.) and add `15s` Tier-1 Fast Delta Poller |
| `vampirePoller.ts` | 996 | **NEEDS REAL BIG-BOX (Step 2A/2B)** | Remove fake `Math.max` telemetry; wire real Target 1P TCINs, Best Buy SKUs, Costco API, and Playwright Stealth worker |
| `server.js` | 2,216 | **ONLINE (Port 3000)** | Serve unified `public/index.html` in Step 1A; modularize routes in V5 |
| `notifier.ts` | 814 | **ONLINE & STABLE** | FIFO Discord queue + 4h digest lock working |
| `marketTape.ts` & `marketComps.ts` | 772 / 457 | **ONLINE & STABLE** | 14-day NRT velocity tape & TCGPlayer/eBay comps working |
| `src/marketSync.ts` | 178 | **ONLINE & STABLE** | 6-hour TCGPlayer baseline sync working |
