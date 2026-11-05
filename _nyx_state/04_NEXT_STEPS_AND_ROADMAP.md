# 04 — NEXT STEPS & V5 MODULAR ROADMAP

> **SINGLE SOURCE OF TRUTH (PART 4/6):** Defines our bite-sized, single-turn execution slices for the V5 overhaul. **Never combine multiple steps into one giant rewrite.** Complete one slice, verify compilation and runtime health, and run `dropbot save` before starting the next.

---

## Completed Milestones
- [x] **V5 Diagnostic Audit (Read-Only):** Completed 5-part ground-truth audit of Big-Box scrapers, 91-store Shopify latency/shipping/matcher blind spots, Top 15 cached Shopify offers in `storeOffersCache.json`, and file bloat.
- [x] **V5 Step 0 (Continuity Engine & Portable CLI):** Initialized `_nyx_state/` (`01` through `06`), populated the Failure Graveyard, built `scripts/dropbot-cli.ps1` + `scripts/install-dropbot-cli.ps1` (`dropbot save`, `dropbot undo`, `dropbot backup`, `dropbot next`), and synced baseline backup + GitHub.
- [x] **V5 Slice 1 (Personal Data Vault, Static Catalog & Unified Store Registry):** Extracted Scott's untouchable sliders and Wall checklist into `config/userPreferences.json`, static 131-SKU metadata into `config/catalog.json`, unified 90 active LGS + 9 Big-Box shipping rules into `config/stores.json` (disabling dead 404 store `Lets Play TCG`), and wired `src/config/configManager.ts` (`347` lines).
- [x] **V5 Slice 2 (Battle Stadium Modular Extraction, Delete `dashboard.html` Clone & Hard-Freeze Stadium):** Deleted the redundant 9,780-line `dashboard.html` clone (`git rm dashboard.html`), routed `/`, `/index.html`, and `/dashboard.html` to `public/index.html` (`trimmed from 9,780 to 5,543 lines`), extracted Logan's Battle Stadium into `public/css/stadium.css` (`353` lines) + `public/js/stadium/stadium-data.js` (`819` lines), `stadium-audio.js` (`121` lines), `stadium-combat.js` (`1,376` lines), and `stadium-ui.js` (`1,641` lines), and registered all 5 Stadium files in the **HARD-FROZEN FILES REGISTRY (`git diff = 0 lines`)**.
- [x] **V5 Slice 3 (Fix Deal Brain, Add `$5/$10` Close-Call Cushion, Per-Store Alert Cooldowns, Plain-English Shelf Status Tags & Marketplace Scam Shield):** Removed the Pre-Order `msrp * 1.05` ceiling override in `evaluator.ts`, evaluated `isTierAMsrp` on raw shelf price (`dropPrice <= msrp * 1.08` when shipping `<= $10`) and unblocked limit-1/2 drops, added the `+$5.00` ETB/Bundle and `+$10.00` Booster Box/Case Close-Call Grace Cushion (`◈ ⟦ CLOSE CALL: WITHIN +$X.XX OF TARGET ⟧`), normalized `booster.*(box|display)` matchers across `config/catalog.json` and `policies.ts`, raised `getMaxPlausiblePriceCeiling()`, scoped `alertState.json` keys to `${storeName}::${skuId}`, added plain-English `statusTag` pills across `storeOffersCache.json`, `server.js`, and `public/index.html`, and wired the Marketplace Scam & Shipping Trap Shield in `vampirePoller.ts` and `evaluator.ts`.
- [x] **V5 Slice 3.5 (Build Standalone `src/engine/trendAdvisor.ts` `< 350 Lines`: Kill Blind Pre-Release Calendar Warning, Wire 30/60/90-Day Rolling Market Analytics & Add "Elastic Dip" + "Runaway Uptrend" Sniper Signals):** Built `src/engine/trendAdvisor.ts` (`312` lines), replaced hardcoded `"Pre-release bleed — wait for launch"` warnings with data-driven `◈ ⟦ BEATS $100 MARKET FLOOR (-13%) // SOLID PRE-LAUNCH GRAB ⟧` verdicts (`BEATS_MARKET_FLOOR`), implemented 60-day `ELASTIC_DIP` (`<= avg60d * 0.90` or `<= low60d * 1.04`) and `UPTREND_LAG_DEAL` (`change60dPct >= +10%`) sniper badges, enforced Law #1 (Zero Stock Emojis), and surfaced `trendVerdictLabel` across `storeOffersCache.json`, `/api/status`, `/api/sku-history/:skuId`, and `public/index.html`.

---

## Locked 4-Slice V5 Execution Sequence

### ➡️ Slice 4 (Current): Fix Narrow Shopify Store Collection Paths, Launch 15-Second Tier-1 Fast Restock Poller & Wire Honest Big-Box SKU/TCIN + Stealth Browser Polling
- **Goal:** Fix narrow Shopify store collection paths, launch the 15-Second Tier-1 Fast Restock Poller, and wire honest Big-Box SKU/TCIN & Stealth Browser polling.
