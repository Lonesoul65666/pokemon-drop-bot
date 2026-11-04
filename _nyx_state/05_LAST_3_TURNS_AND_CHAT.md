# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V4 Phase G & G.1 — Engine Room 96-Sensor Blade, Full Shelf Cache & 4-Tab Price History Modal)
- Built `storeOffersCache.json` (`upsertStoreOfferCache` & `pruneStoreMissingOffers` in `evaluator.ts`) to cache every matched in-stock offer across all 91 Shopify stores and TCGPlayer (`497` live offers cached).
- Upgraded `GET /api/sku-history/:skuId` and `#priceHistoryModal` to support `24H | 7D | 30D | 90D` timeframe tabs, live TCGPlayer/eBay floor comps, and `⟦ FRESH MOVER ⟧` restock badges.
- Built the `ENGINE ROOM` 96-sensor view (`GET /api/engine-room` + Deck 1 North Star 5 + Deck 2 91 Shopify LGS ledger) and fixed property normalization in `loadMergedStoreOffersBySku()` (`server.js`).
- Added `WALL HUNTER MODE` toggle and 12-hour anti-echo deduplication in `evaluator.ts`.

### Turn -1 (V4 Phase H — Logan's D20 Action-Point Pool Battle Stadium, Strict Reddit Outbound Filter & Shelf Spread Bar)
- Upgraded Logan's 3v3 Pokédex Battle Stadium (`public/index.html` & `dashboard.html`) to a tabletop `"Roll D20 for AP Pool (0–25 Max) ➔ Spend / Chain / Bank AP"` combat engine (`MOVE_AP_COSTS = [5, 9, 12, 18]`), separate Trainer Bags for Logan (P1) vs. Dad (P2), and post-match Victory Mystery Reward cards persisted in `localStorage`.
- Tightened `pollRedditDeals()` in `vampirePoller.ts` to `r/PKMNTCGDeals` only and required a verified outbound Big-Box URL (`hasVerifiedBigBoxOutboundUrl()`) before triggering `[BIG-BOX RESTOCK RADAR]`.
- Added `computeShelfSpreadDistribution()` (`server.js`) and the Live Market Spread Bar (`#liveMarketSpreadBar`) to `Live Command`.

### Turn 0 (Current Session — V5 Ground-Truth Missed-Deal Audit & Step 0 Continuity Engine Initialization)
- Conducted a read-only 5-part forensic audit of the entire repository to determine why Scott was only seeing TCGPlayer alerts and missing Big-Box and Shopify LGS MSRP drops:
  1. **Big-Box Truth Test:** Proved `Pokémon Center` is blocked by Imperva (`Pardon Our Interruption`), `Walmart` is blocked by PerimeterX (`Robot or human?`), `Best Buy` is a no-op telemetry stub, `Costco` fails because `CatalogSearch` is now a Next.js CSR shell, and `Target` RedSky keyword search returns 24 overpriced 3rd-party Target Plus scalpers—while `Math.max` fallbacks reported fake `200 OK` counts.
  2. **Shopify LGS Audit:** Proved full 91-store sweep cycle takes `~61s` (`~43s` poll + `15–22s` rest sleep + home-IP Cloudflare `429` retries), `$6.99` shipping math blocks limit-1/2 MSRP restocks and strips `isMsrpUnicorn` from `$54.99` ETBs (`JBs Emporium` Chaos Rising ETB @ `$54.99`), `isPreOrder` overrides Scott's `$222` Delta Reign trigger down to `$170`, `Zulus` misses `"Booster Display"`, and several stores are locked onto narrow collection feeds in `storeHealth.json`.
- Initialized the 6-file `_nyx_state/` Continuity Engine (`01` through `06`), populated the Failure Graveyard, and built the portable `dropbot` PowerShell CLI (`save`, `undo`, `backup`, `next`).

---

## Automated CLI Checkpoint Log (`dropbot save / undo / backup`)
- `2026-11-04 14:45 CST` | **INIT** | Initialized 6-file `_nyx_state/` continuity engine, Failure Graveyard, and `dropbot` PowerShell CLI suite.
- `2026-11-04 14:49 CST` | **SAVE** (from `169c7b2`) | Initial V5 Step 0 baseline backup (_nyx_state 6-file engine + dropbot CLI)
