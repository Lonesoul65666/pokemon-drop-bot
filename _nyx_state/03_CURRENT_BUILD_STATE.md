# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V5 Slice 2 Complete** (Deleted redundant 9,780-line `dashboard.html` clone, extracted Logan's Battle Stadium into `public/css/stadium.css` + 4 modular JS files under `public/js/stadium/`, trimmed `public/index.html` from `9,780` to `5,543` lines, and Hard-Froze Logan's Stadium; Ready for **V5 Slice 3: Fix Deal Brain & Scam Shield**).
- **Last Checkpoint Timestamp:** `2026-11-04 16:32 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `89da145` (`V5 Slice 2: Extract Logan Battle Stadium into modular public/js/stadium/ files, delete duplicate 9780-line dashboard.html clone, and hard-freeze Stadium`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (`0` crashes, all 90 active Shopify LGS stores healthy)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (`HTTP 200 OK` across `/`, `/dashboard.html`, `/css/stadium.css`, `/js/stadium/stadium-data.js`, `/js/stadium/stadium-audio.js`, `/js/stadium/stadium-combat.js`, `/js/stadium/stadium-ui.js`, and `/api/status`)
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
| `public/css/stadium.css` | 353 | **HARD-FROZEN (V5 Slice 2)** | Extracted Battle Stadium CSS (`git diff = 0 lines`) |
| `public/js/stadium/stadium-data.js` | 819 | **HARD-FROZEN (V5 Slice 2)** | 18-Type Matrix, Signature Moves, Preset Decks, Gauntlet Bosses & 1,025 Pokédex Helpers (`git diff = 0 lines`) |
| `public/js/stadium/stadium-audio.js` | 121 | **HARD-FROZEN (V5 Slice 2)** | WebAudio Battle Synthesizer + Official PokeAPI Cry Player (`git diff = 0 lines`) |
| `public/js/stadium/stadium-combat.js` | 1,376 | **HARD-FROZEN (V5 Slice 2)** | 3v3 Squad State, D20 AP Pool & Banking, Turn Tracker, AI Controller & Damage Math (`git diff = 0 lines`) |
| `public/js/stadium/stadium-ui.js` | 1,641 | **HARD-FROZEN (V5 Slice 2)** | Arena DOM Rendering, 4 Visual Attack Animations, Trophy/Squad Drawers & `window.*` Entrypoints (`git diff = 0 lines`) |
| `public/index.html` | 5,543 | **ACTIVE (V5 Slice 2)** | Trimmed by `-4,237` lines (`9,780 -> 5,543`); serves `/`, `/index.html`, and `/dashboard.html` |
| `dashboard.html` | 0 (Deleted) | **DELETED (V5 Slice 2)** | Removed redundant 9,780-line root clone via `git rm dashboard.html` |
| `evaluator.ts` | 1,013 | **NEXT UP (V5 Slice 3)** | Fix Pre-Order override, `$6.99` shipping unicorn trap, and limit-1 drops in Slice 3 |
| `policies.ts` | 387 | **NEXT UP (V5 Slice 3)** | Add `(box\|display)` normalization & raise `getMaxPlausiblePriceCeiling()` in Slice 3 |
| `vampirePoller.ts` | 996 | **NEXT UP (V5 Slice 3/4)** | Add Marketplace BS Detector (`$35+` shipping traps & unverified deep-discount bait) in Slice 3; Big-Box TCIN/SKU in Slice 4 |
| `lgsPoller.ts` | 594 | **SLATED FOR SLICE 4** | Fix narrow `resolvedPath` feeds & launch 15s Tier-1 Fast Poller in Slice 4 |
| `src/marketSync.ts` | 168 | **ACTIVE (V5 Slice 1)** | Routes 6-hour baseline updates exclusively to `marketCache.json` (never touches `userPreferences.json`) |
| `server.js` | 2,200 | **ACTIVE (V5 Slice 2)** | Routes `/`, `/index.html`, `/dashboard.html` to `public/index.html` and serves `public/css/stadium.css` + `public/js/stadium/*.js` |
