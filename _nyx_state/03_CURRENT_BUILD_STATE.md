# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V5 Slice 3.5 Complete** (Extracted standalone `src/engine/trendAdvisor.ts` (`312` lines, `< 350` lines), killed the blind Pre-Release calendar bleed warning in favor of data-driven `◈ ⟦ BEATS $100 MARKET FLOOR (-13%) // SOLID PRE-LAUNCH GRAB ⟧` verdicts, wired 14d/30d/60d/90d rolling market analytics with the `60D ELASTIC DIP` and `MARKET CLIMBING` sniper signals, enforced Zero Stock Emojis on Close-Call tags, and surfaced `trendVerdictLabel` across `storeOffersCache.json`, `/api/status`, `/api/sku-history/:skuId`, and `public/index.html`; Ready for **V5 Slice 4: Fix Narrow Shopify Store Collection Paths, Launch 15-Second Tier-1 Fast Restock Poller & Wire Honest Big-Box SKU/TCIN + Stealth Browser Polling**).
- **Last Checkpoint Timestamp:** `2026-11-05 00:16 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `12fac76` (`Manual dropbot save checkpoint`)
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
| `evaluator.ts` | 1,290 | **ACTIVE (V5 Slice 3.5)** | Unblocked pre-order sliders, `$54.99` MSRP Unicorns w/ `$6.99` ship, `+$5/+$10` Close-Call Cushion, `${store}::${sku}` cooldowns, `trendAdvisor.ts` integration, and Scam Shield |
| `src/engine/trendAdvisor.ts` | 312 | **ACTIVE (V5 Slice 3.5)** | Standalone `< 350` line 14d/30d/60d/90d Rolling Market Analytics, Data-Driven Pre-Release Verdicts, 60D Elastic Dip & Runaway Uptrend Sniper Signals |
| `policies.ts` | 412 | **ACTIVE (V5 Slice 3)** | Normalized `booster.*(box\|display)` matchers & dynamic `getMaxPlausiblePriceCeiling()` (`709` Destined Rivals, `285` SV ETBs, `4,207` Evolving Skies) |
| `vampirePoller.ts` | 1,019 | **ACTIVE (V5 Slice 3 / Next Slice 4)** | Wired Marketplace Scam & Shipping Trap Shield (`shipping > $35` or `>20%`, unverified 1-qty `>35%` under market, real `freeShipping`); Big-Box TCIN/SKU in Slice 4 |
| `lgsPoller.ts` | 594 | **NEXT UP (V5 Slice 4)** | Fix narrow `resolvedPath` feeds & launch 15s Tier-1 Fast Poller in Slice 4 |
| `src/marketSync.ts` | 168 | **ACTIVE (V5 Slice 1)** | Routes 6-hour baseline updates exclusively to `marketCache.json` (never touches `userPreferences.json`) |
| `server.js` | 2,352 | **ACTIVE (V5 Slice 3)** | Serves `public/index.html` + Stadium modules and enriches all shelf/bounty offers with plain-English `statusTag` & `statusTier` |
