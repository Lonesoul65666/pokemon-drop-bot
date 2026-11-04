# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V4 Phase H — Logan's D20 Action-Point Pool Battle Stadium, Strict Reddit Outbound Filter & Shelf Spread Bar)
- Upgraded Logan's 3v3 Pokédex Battle Stadium (`public/index.html` & `dashboard.html`) to a tabletop `"Roll D20 for AP Pool (0–25 Max) ➔ Spend / Chain / Bank AP"` combat engine (`MOVE_AP_COSTS = [5, 9, 12, 18]`), separate Trainer Bags for Logan (P1) vs. Dad (P2), and post-match Victory Mystery Reward cards persisted in `localStorage`.
- Tightened `pollRedditDeals()` in `vampirePoller.ts` to `r/PKMNTCGDeals` only and required a verified outbound Big-Box URL (`hasVerifiedBigBoxOutboundUrl()`) before triggering `[BIG-BOX RESTOCK RADAR]`.
- Added `computeShelfSpreadDistribution()` (`server.js`) and the Live Market Spread Bar (`#liveMarketSpreadBar`) to `Live Command`.

### Turn -1 (V5 Ground-Truth Missed-Deal Audit & Step 0 Continuity Engine Initialization)
- Conducted a read-only 5-part forensic audit of the entire repository to determine why Scott was only seeing TCGPlayer alerts and missing Big-Box and Shopify LGS MSRP drops:
  1. **Big-Box Truth Test:** Proved `Pokémon Center` is blocked by Imperva (`Pardon Our Interruption`), `Walmart` is blocked by PerimeterX (`Robot or human?`), `Best Buy` is a no-op telemetry stub, `Costco` fails because `CatalogSearch` is now a Next.js CSR shell, and `Target` RedSky keyword search returns 24 overpriced 3rd-party Target Plus scalpers—while `Math.max` fallbacks reported fake `200 OK` counts.
  2. **Shopify LGS Audit:** Proved full 91-store sweep cycle takes `~61s`, `$6.99` shipping math blocks limit-1/2 MSRP restocks and strips `isMsrpUnicorn` from `$54.99` ETBs (`JBs Emporium` Chaos Rising ETB @ `$54.99`), `isPreOrder` overrides Scott's `$222` Delta Reign trigger down to `$170`, `Zulus` misses `"Booster Display"`, and several stores are locked onto narrow collection feeds in `storeHealth.json`.
- Initialized the 6-file `_nyx_state/` Continuity Engine (`01` through `06`), populated the Failure Graveyard, and built the portable `dropbot` PowerShell CLI (`save`, `undo`, `backup`, `next`).

### Turn 0 (Current Session — V5 Slice 1: Personal Data Vault `config/userPreferences.json`, Static Catalog `config/catalog.json`, Unified Store Registry `config/stores.json` & `src/config/configManager.ts`)
- Locked our 4-Slice V5 execution order in `_nyx_state/04_NEXT_STEPS_AND_ROADMAP.md` and added `[FAILED - V4 TCGPlayer Shipping Scam & Unverified Bait-and-Switch Trap]` (`Prismatic Evolutions ETB Case` at `$499.00 + $199.99 Shipping` by unverified 1-qty seller `Crawford gaming`) to the Failure Graveyard in `_nyx_state/02_TECHNICAL_ARCHITECTURE_AND_PIPELINES.md`.
- Split the 3 tangled data lifecycles into `C:\pokemon-drop-bot\config\` with zero data loss:
  1. `config/userPreferences.json`: Extracted 100% of Scott's personal settings (`maxMarketBuyPrice`, `owned`, `inVault`, `active`) for all `131` SKUs (`9` owned total / `8` Wall ETBs) plus global toggles (`muteVaulted`, `wallHunterMode`, `liveDigestEnabled`). Enforced Hard Law: background syncs (`src/marketSync.ts`) and pollers are strictly forbidden from touching this file.
  2. `config/catalog.json`: Extracted static SKU metadata for all `131` SKUs (`id`, `name`, `era`, `formFactor`, `packCount`, `msrpCeiling`, `releaseDate`, `matchers`, plus optional retailer ID fields `targetTcin`, `walmartItemId`, `bestBuySku`, `pcSlug`, `tcgProductId`).
  3. `config/stores.json`: Unified `LGS_STORES` (`lgsPoller.ts`) and `STORE_SHIPPING_RULES` (`evaluator.ts`) into a single registry (`90` active healthy Shopify LGS stores + `9` Big-Box profiles, with dead 404 store `Lets Play TCG` disabled via `enabled: false`).
- Built `src/config/configManager.ts` (`347` lines, `< 350` lines law) and wired clean facades across `policies.ts`, `src/marketSync.ts`, `lgsPoller.ts`, `evaluator.ts`, `notifier.ts`, and `server.js`. Verified 100% data parity (`0` mismatches across 131 SKUs), `0` TypeScript errors, and `HTTP 200 OK` on `/api/status`, `/api/policies`, and `/api/engine-room`.

---

## Automated CLI Checkpoint Log (`dropbot save / undo / backup`)
- `2026-11-04 14:45 CST` | **INIT** | Initialized 6-file `_nyx_state/` continuity engine, Failure Graveyard, and `dropbot` PowerShell CLI suite.
- `2026-11-04 14:49 CST` | **SAVE** (from `169c7b2`) | Initial V5 Step 0 baseline backup (_nyx_state 6-file engine + dropbot CLI)
- `2026-11-04 16:21 CST` | **SAVE** (from `acca670`) | V5 Slice 1: Lock personal sliders and Wall checklist in config/userPreferences.json and unify store shipping registry in config/stores.json
