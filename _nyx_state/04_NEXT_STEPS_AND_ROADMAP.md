# 04 — NEXT STEPS & V5 MODULAR ROADMAP

> **SINGLE SOURCE OF TRUTH (PART 4/6):** Defines our bite-sized, single-turn execution slices for the V5 overhaul. **Never combine multiple steps into one giant rewrite.** Complete one slice, verify compilation and runtime health, and run `dropbot save` before starting the next.

---

## Completed Milestones
- [x] **V5 Diagnostic Audit (Read-Only):** Completed 5-part ground-truth audit of Big-Box scrapers, 91-store Shopify latency/shipping/matcher blind spots, Top 15 cached Shopify offers in `storeOffersCache.json`, and file bloat.
- [x] **V5 Step 0 (Continuity Engine & Portable CLI):** Initialized `_nyx_state/` (`01` through `06`), populated the Failure Graveyard, built `scripts/dropbot-cli.ps1` + `scripts/install-dropbot-cli.ps1` (`dropbot save`, `dropbot undo`, `dropbot backup`, `dropbot next`), and synced baseline backup + GitHub.
- [x] **V5 Slice 1 (Personal Data Vault, Static Catalog & Unified Store Registry):** Extracted Scott's untouchable sliders and Wall checklist into `config/userPreferences.json`, static 131-SKU metadata into `config/catalog.json`, unified 90 active LGS + 9 Big-Box shipping rules into `config/stores.json` (disabling dead 404 store `Lets Play TCG`), and wired `src/config/configManager.ts` (`347` lines).
- [x] **V5 Slice 2 (Battle Stadium Modular Extraction, Delete `dashboard.html` Clone & Hard-Freeze Stadium):** Deleted the redundant 9,780-line `dashboard.html` clone (`git rm dashboard.html`), routed `/`, `/index.html`, and `/dashboard.html` to `public/index.html` (`trimmed from 9,780 to 5,543 lines`), extracted Logan's Battle Stadium into `public/css/stadium.css` (`353` lines) + `public/js/stadium/stadium-data.js` (`819` lines), `stadium-audio.js` (`121` lines), `stadium-combat.js` (`1,376` lines), and `stadium-ui.js` (`1,641` lines), and registered all 5 Stadium files in the **HARD-FROZEN FILES REGISTRY (`git diff = 0 lines`)**.

---

## Locked 4-Slice V5 Execution Sequence

### ➡️ Slice 3 (Current): Fix Deal Brain & Scam Shield (`evaluator.ts`, `policies.ts`, `vampirePoller.ts`)
- **Goal:** Kill the Pre-Order slider override bug, fix `$6.99` shipping blocking `$54.99` MSRP Unicorns and limit-1 drops, add `(box|display)` matcher normalization, raise `getMaxPlausiblePriceCeiling()`, and add the Marketplace BS Detector blocking `$35+` shipping traps and unverified deep-discount bait.

### Slice 4: Fix Narrow Shopify Store Collection Paths, Launch 15-Second Tier-1 Fast Restock Poller & Wire Honest Big-Box SKU/TCIN + Stealth Browser Polling
- **Goal:** Fix narrow Shopify store collection paths, launch the 15-Second Tier-1 Fast Restock Poller, and wire honest Big-Box SKU/TCIN & Stealth Browser polling.
