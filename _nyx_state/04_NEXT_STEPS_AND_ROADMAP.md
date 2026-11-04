# 04 — NEXT STEPS & V5 MODULAR ROADMAP

> **SINGLE SOURCE OF TRUTH (PART 4/6):** Defines our bite-sized, single-turn execution slices for the V5 overhaul. **Never combine multiple steps into one giant rewrite.** Complete one slice, verify compilation and runtime health, and run `dropbot save` before starting the next.

---

## Completed Milestones
- [x] **V5 Diagnostic Audit (Read-Only):** Completed 5-part ground-truth audit of Big-Box scrapers, 91-store Shopify latency/shipping/matcher blind spots, Top 15 cached Shopify offers in `storeOffersCache.json`, and file bloat.
- [x] **V5 Step 0 (Continuity Engine & Portable CLI):** Initialized `_nyx_state/` (`01` through `06`), populated the Failure Graveyard, built `scripts/dropbot-cli.ps1` + `scripts/install-dropbot-cli.ps1` (`dropbot save`, `dropbot undo`, `dropbot backup`, `dropbot next`), and synced baseline backup + GitHub.

---

## Locked 4-Slice V5 Execution Sequence

### ➡️ Slice 1 (Current): Personal Data Vault (`config/userPreferences.json`), Static Catalog (`config/catalog.json`), and Unified 91-Store + Shipping Registry (`config/stores.json`)
- **Goal:** Permanently decouple Scott's personal settings from static SKU metadata and background market syncs, and unify all store & shipping rules in one registry.
- **Actions:**
  1. Extract 100% of Scott's personal per-SKU settings (`maxMarketBuyPrice`, `owned`, `inVault`, `active`) for all 131 SKUs plus global toggles (`muteVaulted`, `wallHunterMode`, `liveDigestEnabled`) into `config/userPreferences.json` (strictly off-limits to background pollers/syncs).
  2. Extract static SKU metadata for all 131 SKUs (`id`, `name`, `era`, `formFactor`, `packCount`, `msrpCeiling`, `releaseDate`, `matchers`, plus optional retailer ID fields `targetTcin`, `walmartItemId`, `bestBuySku`, `pcSlug`, `tcgProductId`) into `config/catalog.json`.
  3. Merge `LGS_STORES` (`lgsPoller.ts`) and `STORE_SHIPPING_RULES` (`evaluator.ts`) into `config/stores.json`, and disable dead 404 store `Lets Play TCG`.
  4. Build `src/config/configManager.ts` (`< 350 lines`) to merge `catalog.json` + `userPreferences.json` + `marketCache.json` seamlessly for `policies.ts`, `evaluator.ts`, `lgsPoller.ts`, `src/marketSync.ts`, and `server.js`.

### Slice 2: Extract Logan's Battle Stadium into 4 Modular Files (`< 400 lines` each) & Delete Duplicate `dashboard.html` Clone
- **Goal:** Extract Logan's Battle Stadium into 4 modular files (`< 400 lines` each) under `public/js/stadium/` + `public/css/stadium.css`, delete the duplicate 9,780-line `dashboard.html` clone, and Hard-Freeze Logan's game.

### Slice 3: Fix Deal Brain & Scam Shield (`evaluator.ts`, `policies.ts`, `vampirePoller.ts`)
- **Goal:** Kill the Pre-Order slider override bug, fix `$6.99` shipping blocking `$54.99` MSRP Unicorns and limit-1 drops, add `(box|display)` matcher normalization, raise `getMaxPlausiblePriceCeiling()`, and add the Marketplace BS Detector blocking `$35+` shipping traps and unverified deep-discount bait.

### Slice 4: Fix Narrow Shopify Store Collection Paths, Launch 15-Second Tier-1 Fast Restock Poller & Wire Honest Big-Box SKU/TCIN + Stealth Browser Polling
- **Goal:** Fix narrow Shopify store collection paths, launch the 15-Second Tier-1 Fast Restock Poller, and wire honest Big-Box SKU/TCIN & Stealth Browser polling.
