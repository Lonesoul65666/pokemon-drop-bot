# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V5 Slice 1: Personal Data Vault `config/userPreferences.json`, Static Catalog `config/catalog.json`, Unified Store Registry `config/stores.json` & `src/config/configManager.ts`)
- Locked our 4-Slice V5 execution order in `_nyx_state/04_NEXT_STEPS_AND_ROADMAP.md` and added `[FAILED - V4 TCGPlayer Shipping Scam & Unverified Bait-and-Switch Trap]` (`Prismatic Evolutions ETB Case` at `$499.00 + $199.99 Shipping` by unverified 1-qty seller `Crawford gaming`) to the Failure Graveyard in `_nyx_state/02_TECHNICAL_ARCHITECTURE_AND_PIPELINES.md`.
- Split the 3 tangled data lifecycles into `C:\pokemon-drop-bot\config\` with zero data loss:
  1. `config/userPreferences.json`: Extracted 100% of Scott's personal settings (`maxMarketBuyPrice`, `owned`, `inVault`, `active`) for all `131` SKUs (`9` owned total / `8` Wall ETBs) plus global toggles (`muteVaulted`, `wallHunterMode`, `liveDigestEnabled`). Enforced Hard Law: background syncs (`src/marketSync.ts`) and pollers are strictly forbidden from touching this file.
  2. `config/catalog.json`: Extracted static SKU metadata for all `131` SKUs (`id`, `name`, `era`, `formFactor`, `packCount`, `msrpCeiling`, `releaseDate`, `matchers`, plus optional retailer ID fields `targetTcin`, `walmartItemId`, `bestBuySku`, `pcSlug`, `tcgProductId`).
  3. `config/stores.json`: Unified `LGS_STORES` (`lgsPoller.ts`) and `STORE_SHIPPING_RULES` (`evaluator.ts`) into a single registry (`90` active healthy Shopify LGS stores + `9` Big-Box profiles, with dead 404 store `Lets Play TCG` disabled via `enabled: false`).
- Built `src/config/configManager.ts` (`347` lines, `< 350` lines law) and wired clean facades across `policies.ts`, `src/marketSync.ts`, `lgsPoller.ts`, `evaluator.ts`, `notifier.ts`, and `server.js`.

### Turn -1 (V5 Slice 2: Delete Redundant 9,780-Line `dashboard.html` Clone, Extract Logan's Battle Stadium into Modular Files Under `public/js/stadium/` + `public/css/stadium.css` & Hard-Freeze Stadium)
- Updated `server.js` (`2,200` lines) so `GET /`, `GET /index.html`, and `GET /dashboard.html` all serve `public/index.html`, and deleted the redundant 9,780-line root `C:\pokemon-drop-bot\dashboard.html` clone from disk (`git rm dashboard.html`).
- Extracted Logan's Battle Stadium out of `public/index.html` (`trimmed from 9,780 down to 5,543 lines`, `-4,237` lines removed) with 100% fidelity and zero gameplay truncation into `public/css/stadium.css` (`353` lines), `public/js/stadium/stadium-data.js` (`819` lines), `public/js/stadium/stadium-audio.js` (`121` lines), `public/js/stadium/stadium-combat.js` (`1,376` lines), and `public/js/stadium/stadium-ui.js` (`1,641` lines).
- Verified `0` syntax errors, verified `HTTP 200 OK` across all 8 live endpoints, and registered `public/css/stadium.css` + `public/js/stadium/*.js` in the **HARD-FROZEN FILES REGISTRY (`git diff = 0 lines`)** in `_nyx_state/01` and `_nyx_state/02`.

### Turn 0 (Current Session — V5 Slice 3: Fix Deal Brain, Add `$5/$10` Close-Call Cushion, Enforce Per-Store Alert Cooldowns, Add Plain-English Rejection Tags & Wire Marketplace Scam Shield)
- **Fixed the 4 Deal-Blocking Traps + Added the `$5 ETB / $10 Box` Close-Call Grace Cushion (`evaluator.ts`, `policies.ts`, `config/catalog.json`, `src/config/configManager.ts`):**
  1. **Killed Pre-Order Ceiling Override:** Removed the `isPreOrder ? Math.min(policyMaxBuy, Math.round(rule.msrpCeiling * 1.05))` cap in `evaluator.ts` so `effectiveCeiling = policyMaxBuy` is always honored.
  2. **Fixed `$6.99` Guessed Shipping Blocking `$54.99` MSRP Unicorns & Limit-1 Drops:** Updated `isTierAMsrp` to check raw `dropPrice <= msrpCeiling * 1.08` when standard shipping is `<= $10.00`, and allowed sub-trigger / Unicorn shelf drops to pass even on limit-1/limit-2 stock with transparent `$XX.XX Shelf + $X.XX Est. Ship ($XX.XX Landed)` notes.
  3. **Added `$5 ETB / $10 Booster Box` Close-Call Grace Cushion (`getCloseCallGraceBuffer` & `computeOfferShelfStatus`):** Offers within `+$5.00` (ETB/Bundle) or `+$10.00` (Booster Box/Case) above `policyMaxBuy` (and `<= market * 0.93` or `<= msrp * 1.10`) trigger as `CLOSE CALL (WITHIN +$X.XX OF TARGET)` (`Journey Together @ $199.99 vs $193 -> +$6.99`, `Perfect Order @ $168.00 vs $161.64 -> +$6.36`).
  4. **Normalized `"Booster Display"` Matchers & Raised `getMaxPlausiblePriceCeiling()`:** Normalized 64 matchers in `config/catalog.json` and `policies.ts` (`booster.*(box|display)`, optional `(mega evolution )?`, `scarlet.*violet`), and updated `getMaxPlausiblePriceCeiling()` (`Destined Rivals Box -> $709.04`, `Obsidian Flames / Paldea Evolved ETBs -> $285.00`, `Evolving Skies Box -> $4,207.48`).
- **Enforced Per-Store Cooldown Keys & Plain-English Shelf Status Badges (`evaluator.ts`, `server.js`, `public/index.html`):**
  - Scoped `alertState.json` deduplication keys to `${storeName}::${skuId}` (preserving individual TCGPlayer seller names instead of collapsing all TCGPlayer sellers into one key).
  - Computed and rendered 4-tier plain-English status tags (`⟦ UNDER TARGET (-$17.00) ⟧`, `⟦ CLOSE CALL (+$6.36 OVER TARGET — IN CUSHION) ⟧`, `⟦ NEAR MISS (+$12.00 OVER TARGET) ⟧`, `⟦ MUTED: OWNED ON WALL ⟧`) across `storeOffersCache.json`, `server.js`, and `public/index.html`.
- **Wired the Marketplace Scam & Shipping Trap Shield (`vampirePoller.ts` & `evaluator.ts`):**
  - Eliminated hardcoded `freeShipping: true` and unverified search-card fallbacks in `vampirePoller.ts`, and blocked any 3P listing where `shipping > $35.00`, `shipping > itemPrice * 0.20`, or an unverified/1-qty seller prices a `market > $200` box/case at `>35%` below market (`Crawford gaming` `$499 + $199.99 ship` blocked immediately).

---

## Automated CLI Checkpoint Log (`dropbot save / undo / backup`)
- `2026-11-04 14:45 CST` | **INIT** | Initialized 6-file `_nyx_state/` continuity engine, Failure Graveyard, and `dropbot` PowerShell CLI suite.
- `2026-11-04 14:49 CST` | **SAVE** (from `169c7b2`) | Initial V5 Step 0 baseline backup (_nyx_state 6-file engine + dropbot CLI)
- `2026-11-04 16:21 CST` | **SAVE** (from `acca670`) | V5 Slice 1: Lock personal sliders and Wall checklist in config/userPreferences.json and unify store shipping registry in config/stores.json
- `2026-11-04 16:32 CST` | **SAVE** (from `89da145`) | V5 Slice 2: Extract Logan Battle Stadium into modular public/js/stadium/ files, delete duplicate 9780-line dashboard.html clone, and hard-freeze Stadium
- `2026-11-04 17:04 CST` | **SAVE** (from `51e0616`) | V5 Slice 3: Unblock pre-order sliders and MSRP shipping, add / Close-Call cushion, per-store cooldowns, and TCGPlayer scam shield
