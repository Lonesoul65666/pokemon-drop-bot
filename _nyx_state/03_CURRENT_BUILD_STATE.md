# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V5 Slice 1 Complete** (Personal Data Vault `config/userPreferences.json`, Static Catalog `config/catalog.json`, Unified Store & Shipping Registry `config/stores.json`, and `src/config/configManager.ts` Facade Live; Ready for **V5 Slice 2: Battle Stadium 4-File Extraction & `dashboard.html` Clone Deletion**).
- **Last Checkpoint Timestamp:** `2026-11-04 16:21 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `acca670` (`V5 Slice 1: Lock personal sliders and Wall checklist in config/userPreferences.json and unify store shipping registry in config/stores.json`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (`0` crashes, all 90 active Shopify LGS stores healthy)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (`HTTP 200 OK` across `/api/status`, `/api/policies`, `/api/engine-room`)
- **Active Sensor & Cache Counts:**
  - **Shopify LGS Pool (`config/stores.json`):** `90` active healthy stores (`100%` online, `0` blocked; dead 143h 404 store `Lets Play TCG` disabled with `enabled: false`).
  - **Big-Box Sensors (`config/stores.json` & `vampirePoller.ts`):** `5` North Star retailers + `4` additional Big-Box shipping profiles unified in `config/stores.json` (*slated for V5 Slice 4 real TCIN/SKU + Stealth Browser overhaul*).
  - **Live Shelf Cache (`storeOffersCache.json`):** `497` matched in-stock offers across `66` unique SKUs (`248` Shopify LGS offers + `249` TCGPlayer Verified Seller offers).
  - **Target Matrix (`config/catalog.json` + `config/userPreferences.json` + `marketCache.json`):** `131` tracked sealed SKUs (`9` total owned SKUs; `38` Wall Display ETBs: `8` Conquered / `30` Still Needed).

---

## 2. Module Status Across V5 Refactoring

| Module / File | Lines | Status | V5 Target Action |
| :--- | :---: | :--- | :--- |
| `_nyx_state/01..06_*.md` | 6 files | **ACTIVE (V5 Step 0)** | Multi-agent continuity engine & Failure Graveyard |
| `scripts/dropbot-cli.ps1` | 195 | **ACTIVE (V5 Step 0)** | Portable `dropbot save / undo / backup / next` CLI |
| `src/config/configManager.ts` | 347 | **ACTIVE (V5 Slice 1)** | Merges `catalog.json` + `userPreferences.json` + `marketCache.json`; isolates UI writes from background syncs |
| `config/userPreferences.json` | 800 | **LOCKED VAULT (V5 Slice 1)** | Scott's untouchable sliders (`maxMarketBuyPrice`), `owned`/`inVault` flags, and global toggles |
| `config/catalog.json` | 3,096 | **ACTIVE (V5 Slice 1)** | Static SKU metadata (`131` SKUs) + optional retailer TCIN/SKU/Slug fields |
| `config/stores.json` | 1,215 | **ACTIVE (V5 Slice 1)** | Unified store & shipping registry (`90` active LGS + `1` disabled 404 + `9` Big-Box) |
| `public/index.html` | 9,780 | **NEXT UP (V5 Slice 2)** | Extract Logan's Battle Stadium into 4 modular files (`< 400 lines` each) under `public/js/stadium/` + `public/css/stadium.css` |
| `dashboard.html` | 9,780 | **NEXT UP (V5 Slice 2)** | Delete duplicate root clone & route `/dashboard.html` to `public/index.html` |
| `evaluator.ts` | 1,013 | **SLATED FOR SLICE 3** | Shipping registry unified (-114 lines); fix Pre-Order override, `$6.99` shipping unicorn trap, and limit-1 drops in Slice 3 |
| `policies.ts` | 387 | **SLATED FOR SLICE 3** | Wired to `configManager.ts`; add `(box\|display)` normalization & raise price ceilings in Slice 3 |
| `lgsPoller.ts` | 594 | **SLATED FOR SLICE 4** | Store list unified in `config/stores.json` (-98 lines); fix narrow `resolvedPath` feeds & launch 15s Tier-1 Fast Poller in Slice 4 |
| `vampirePoller.ts` | 996 | **SLATED FOR SLICE 3/4** | Add Marketplace BS Detector in Slice 3; wire real Big-Box TCIN/SKU & Stealth Browser polling in Slice 4 |
| `src/marketSync.ts` | 168 | **ACTIVE (V5 Slice 1)** | Routes 6-hour baseline updates exclusively to `marketCache.json` (never touches `userPreferences.json`) |
| `server.js` | 2,213 | **ACTIVE (V5 Slice 1)** | Wired to `configManager.ts` for `/api/policies`, `/api/settings`, and `/api/conquered-vault/claim` |
