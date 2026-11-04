# 04 — NEXT STEPS & V5 MODULAR ROADMAP

> **SINGLE SOURCE OF TRUTH (PART 4/6):** Defines our bite-sized, single-turn execution slices for the V5 overhaul. **Never combine multiple steps into one giant rewrite.** Complete one slice, verify compilation and runtime health, and run `dropbot save` before starting the next.

---

## Completed Milestones
- [x] **V5 Diagnostic Audit (Read-Only):** Completed 5-part ground-truth audit of Big-Box scrapers, 91-store Shopify latency/shipping/matcher blind spots, Top 15 cached Shopify offers in `storeOffersCache.json`, and file bloat.
- [x] **V5 Step 0 (Continuity Engine & Portable CLI):** Initialized `_nyx_state/` (`01` through `06`), populated the Failure Graveyard, built `scripts/dropbot-cli.ps1` + `scripts/install-dropbot-cli.ps1` (`dropbot save`, `dropbot undo`, `dropbot backup`, `dropbot next`), and synced baseline backup + GitHub.

---

## Upcoming Bite-Sized Execution Slices

### ➡️ NEXT UP: Step 1A — Frontend De-Bloat, Stadium Extraction & Clone Elimination
- **Goal:** Cut frontend maintenance bloat in half and permanently isolate Logan's 3v3 Battle Stadium from the Sniper UI.
- **Actions:**
  1. Extract Logan's Battle Stadium JS (~3,800 lines: 18-Type Matrix, 1,025-Species Evolution Resolver, Dual Partner Engine, 3v3 D20 AP Pool Combat Engine, Audio Synth, Trophy Locker) out of `public/index.html` into `public/js/logan-stadium.js` and its stadium-specific CSS into `public/css/stadium.css`.
  2. Update `server.js` so both `/` and `/dashboard.html` serve `public/index.html`, then **delete** the redundant 9,780-line root `dashboard.html` clone.
  3. Verify HTTP 200 on `/`, `/dashboard.html`, `public/js/logan-stadium.js`, and `public/css/stadium.css`, confirm both the Sniper Dashboard and Logan's Battle Stadium work identically, and mark `logan-stadium.js` + `stadium.css` as **FROZEN** in `01_PROJECT_IDENTITY_AND_LAWS.md`.

### Step 1B — Evaluator Math & Matcher Unblocking (Immediate Deal Unlocker)
- **Goal:** Stop `evaluator.ts` and `policies.ts` from silently suppressing real MSRP hits and sub-trigger Shopify deals sitting on shelves right now.
- **Actions:**
  1. **Fix Pre-Order Ceiling Trap (`evaluator.ts:706`):** Honor `policy.maxMarketBuyPrice` on pre-orders (`effectiveCeiling = policyMaxBuy`) instead of slashing `effectiveCeiling` down to `Math.round(rule.msrpCeiling * 1.05)` (`$170` / `$58`) whenever `[PREORDER]` or `(Presell)` appears in the title.
  2. **Fix MSRP Unicorn Shipping Check (`evaluator.ts:735`):** Check raw `dropPrice <= Math.round(rule.msrpCeiling * 1.08 * 100) / 100` (with `estimatedShipping <= 9.99`) for `isTierAMsrp` so a `$54.99` MSRP ETB + `$6.99` shipping (`$61.98` landed, e.g., `JBs Emporium` Chaos Rising ETB) triggers `isMsrpUnicorn = true` and bypasses `muteVaulted`.
  3. **Fix Single-Unit Shipping Threshold Trap (`evaluator.ts:892`):** Allow items where `dropPrice <= effectiveCeiling` and `dropPrice <= msrpCeiling * 1.08` (or within `$6.99` shipping tolerance) to pass even when `stock` is `1` or `2` (limit-1/2 drops).
  4. **Fix `"Booster Display"` Regexes & Price Ceilings (`policies.json` & `policies.ts`):** Update Booster Box matchers in `policies.json` to match `booster.*(box|display)` (unlocking `Zulus Games` `Journey Together: Booster Display`), and raise `getMaxPlausiblePriceCeiling()` in `policies.ts` (`ETB` -> `Math.max(350, policy.estimatedMarketValue * 1.35)`, `Booster Box` -> `Math.max(600, policy.estimatedMarketValue * 1.35)`, `SWSH Booster Box` -> `3200`) so real in-stock shelves (`Destined Rivals Box @ $398`, `Obsidian Flames ETB @ $269`, `Evolving Skies Box @ $2,499`) are never dropped from `storeOffersCache.json`.

### Step 1C — Shopify Collection Feed Repair & 15s Tier-1 Fast Delta Poller
- **Goal:** Fix blind collection paths across the 91 stores and catch 30-second MSRP restocks before they sell out.
- **Actions:**
  1. Override/repair narrow `resolvedPath` entries in `lgsPoller.ts` & `storeHealth.json` (`Zulus Games`, `Safari Zone`, `Smoke & Mirrors`, `Kanzen Games`, `Poke-Collect`, `Card Cavern`, `Card N All Gaming`, `Sealed and Sleeved`) and remove/replace dead `Lets Play TCG` (HTTP 404).
  2. Split Shopify polling into:
     - **Tier-1 Fast Delta Poller (`15s` cadence):** Polls `/products.json?limit=50` (most recently updated products) on the Top 25 restock LGS stores using proxy-first rotation to avoid home-IP Cloudflare 429s.
     - **Tier-2 Full Catalog Poller (`90s–180s` cadence):** Sweeps all 91 stores + deep pages for `storeOffersCache.json` and `Bounty Hunter`.

### Step 1D — Config Split (`config/catalog.json`, `config/stores.json`, `config/userPreferences.json`)
- **Goal:** Decouple static SKU metadata & retailer TCINs/SKUs from Scott's live slider/ownership preferences while keeping `/api/policies` 100% backward-compatible.

### Step 2A — Honest Big-Box Engine (Target 1P TCINs, Best Buy SKUs & Costco Search API)
- **Goal:** Rip out all `Math.max(..., 38/18/16/12)` fake telemetry in `vampirePoller.ts` and wire real Target 1P TCIN fulfillment checks, Best Buy SKU availability checks, and Costco's JSON search API.

### Step 2B — Playwright Stealth Browser Worker for Pokémon Center & Walmart 1P
- **Goal:** Add a lightweight headless stealth browser worker to solve Imperva (`pokemoncenter.com`) and PerimeterX (`walmart.com`) challenges and harvest session cookies/DOM for 1P MSRP restocks and Queue-It detection.
