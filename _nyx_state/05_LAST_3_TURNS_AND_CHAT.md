# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` / `dropbot backup` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V5 Slice 3.5: Build Standalone `src/engine/trendAdvisor.ts` `< 350 Lines`, Kill Blind Pre-Release Calendar Warning, Wire 30/60/90-Day Rolling Market Analytics & Add "Elastic Dip" + "Runaway Uptrend" Sniper Signals)
- Built standalone `src/engine/trendAdvisor.ts` (`< 350` lines), replaced hardcoded `"Pre-release bleed — wait for launch"` warnings with data-driven `◈ ⟦ BEATS $100 MARKET FLOOR (-13%) // SOLID PRE-LAUNCH GRAB ⟧` verdicts (`BEATS_MARKET_FLOOR`), implemented 60-day `ELASTIC_DIP` (`<= avg60d * 0.90` or `<= low60d * 1.04`) and `UPTREND_LAG_DEAL` (`change60dPct >= +10%`) sniper badges, enforced Law #1 (Zero Stock Emojis), and surfaced `trendVerdictLabel` across `storeOffersCache.json`, `/api/status`, `/api/sku-history/:skuId`, and `public/index.html`.

### Turn -1 (V5 Slice 4A, 4B & Slice 5: 15s Tier-1 Fast Restock Poller, Honest Big-Box Poller, Strict Sealed-Only Traffic Cop, Cache Purge & Quiet Singles / Gyarados Offload Radar)
- Built `src/pollers/fastTier1Poller.ts` (`297` lines, `< 350` lines) polling 26 Tier-1 Shopify stores every 15s (`?limit=50`, concurrency 6) and `src/pollers/bigBoxRetailPoller.ts` (`326` lines, `< 350` lines) polling Target (1P RedSky JSON), Walmart, Best Buy, Pokémon Center, Costco, Sam's Club, and GameStop with 100% honest parsed counts (`0` fake `Math.max` floors).
- Implemented `isSingleCardOrNonSealed()` and positive sealed container gates in `policies.ts`, built `src/engine/singlesSniper.ts` (`291` lines, `< 350` lines) routing singles (`>= $15`) quietly to `singlesCache.json` with a collapsible Gyarados watchlist search drawer, and purged `95` leaked single-card entries from `storeOffersCache.json`, `25` from `dropsHistory.json`, and `103` from `liveStock.json`.

### Turn 0 (Current Session — V5 Slice 6: Interactive "Rule of 3" `[WALL / DAD / LOGAN]` Checkboxes, Dynamic Auto-Pilot Dip Brain & `$100/$200/$350/$500+` Next-Buy Advisor, 1P Big-Box/PC Retail Flip Bypass, Roundup Digest Restoration, and 1-Click Shopify Cart Links)
- **1. Interactive "Rule of 3" Family Completion Tracker (`config/userPreferences.json`, `src/config/configManager.ts`, `policies.ts`, `evaluator.ts`, `server.js`, `public/index.html`):**
  - Upgraded per-SKU ownership state to track `wallOwned` (synced with `owned`/`inVault`), `dadRipOwned` (`false` default), and `loganRipOwned` (`false` default), computing `completionCount` (`0..3`) and `fullyConquered`.
  - Wired `POST /api/policies/:skuId/family-slots` and rendered interactive `[WALL]`, `[DAD RIP]`, `[LOGAN RIP]`, and `[X/3 ALL]` toggle pills across `Live Command`, `Capital Advisor`, `Bounty Hunter`, `Conquered Vault` Wall Checklist, and `Target Matrix`.
  - Enforced `0/3 (NEED WALL)` standard/Auto-Pilot hunting, `1/3` & `2/3 (WALL LOCKED // NEED RIP)` Rip Hunt Mode (`Math.min(effectiveMaxBuy, Math.max(msrpCeiling * 1.18, low60d * 1.03))` + `◈ ⟦ RIP PAIR READY (QTY 2+) ⟧`), and `3/3 (COMPLETE)` mute (`⟦ MUTED: 3/3 FAMILY COMPLETE ⟧`).
- **2. 1st-Party Big-Box & Pokémon Center "Retail MSRP Flip / Trade Bait" Bypass (`evaluator.ts`):**
  - Added `isVerified1PBigBoxOrPc()` (`Pokémon Center`, `Target`, `Walmart`, `Best Buy`, `Costco`, `Sam's Club`, `GameStop`). Even when a SKU is `3/3 COMPLETE` or muted, if a verified 1P Big-Box/PC retailer drops a sealed product at retail MSRP (`dropPrice <= msrpCeiling * 1.08`) and `estimatedMarketValue >= dropPrice * 1.30` (or PC exclusive), bypasses the mute filter and fires `◈ ⟦ RETAIL MSRP FLIP / TRADE BAIT // $XX.XX RETAIL VS $XXX MARKET (+XX%) ⟧`.
- **3. Dynamic Auto-Pilot Sliders & `$100 / $200 / $350 / $500+` Next Best Buy Advisor (`src/engine/trendAdvisor.ts`, `server.js`, `public/index.html`):**
  - Added `computeAutoPilotTarget()` in `src/engine/trendAdvisor.ts` (`336` lines, `< 350` lines) computing `autoPilotCeiling` from 14d/60d/90d rolling history (`Math.round(low60d * 1.03)` for Elastic Dip/Grails, `-8%` below shelf floor with `◈ ⟦ BLEEDING DOWN (-X% 14D) // HOLD OFF ⟧` for falling knives, and `◈ ⟦ SUPPLY TIGHTENING (+X% 60D) // PRIORITY GRAB ⟧` for breakouts).
  - Exposed `GET /api/advisor/next-buy` and added the top-level **Capital Advisor Bar** on `Live Command` with `$100`, `$200`, `$350`, `$500+` budget pills, Top 3 Smartest In-Stock Buys Right Now, and the Bleeding / Hold Off caution list.
- **4. Restored Roundup Digest + 1-Click Direct Shopify Cart Links + 100% Silent Singles + Kanzen Games Sealed-Feed Pin (`notifier.ts`, `src/engine/singlesSniper.ts`, `config/stores.json`, `storeHealth.json`, `lgsPoller.ts`, `policies.ts`, `server.js`, `public/index.html`):**
  - Enabled `liveDigestEnabled: true`, upgraded `sendStockDigestCard()` into the 4-section **DropBot Market & Deal Roundup Digest** scheduled at `09:00` and `18:00` local time, and wired `POST /api/digest/send-now` + the top header **`[SEND DIGEST NOW]`** button.
  - Added `buildShopifyDirectCartLinks()` (`https://{storeDomain}/cart/{variantId}:1`, `:2`, `:3`) across Discord embeds and UI cards (`[CART 1X]`, `[CART 2X]`, `[CART 3X]`), and enforced `singlesAlertsEnabled: false` in both `singlesSniper.ts` and `notifier.ts`.
  - Pinned `Kanzen Games` in `config/stores.json` and `storeHealth.json` strictly to `/collections/pokemon-sealed-in-stock/products.json` and `/collections/pokemon-elite-trainer-box/products.json`, prioritized `/collections/pokemon-sealed-in-stock` and `/collections/pokemon-sealed` above `/collections/pokemon-tcg` in `lgsPoller.ts`, rejected non-`"Pokemon Sealed"` `product_type` items on `Kanzen Games`, and hardened `isSingleCardOrNonSealed()` (`policies.ts`) with `\bholofoil\b`, `reverse holofoil`, `pokeball holo`, `masterball holo`, `\(\d{1,3}\/\d{1,3}\)`, `\[[a-z]{2,4}\d*:`, and `/products/<slug>` URL inspection.

---

## Automated CLI Checkpoint Log (`dropbot save / undo / backup`)
- `2026-11-04 14:45 CST` | **INIT** | Initialized 6-file `_nyx_state/` continuity engine, Failure Graveyard, and `dropbot` PowerShell CLI suite.
- `2026-11-04 14:49 CST` | **SAVE** (from `169c7b2`) | Initial V5 Step 0 baseline backup (_nyx_state 6-file engine + dropbot CLI)
- `2026-11-04 16:21 CST` | **SAVE** (from `acca670`) | V5 Slice 1: Lock personal sliders and Wall checklist in config/userPreferences.json and unify store shipping registry in config/stores.json
- `2026-11-04 16:32 CST` | **SAVE** (from `89da145`) | V5 Slice 2: Extract Logan Battle Stadium into modular public/js/stadium/ files, delete duplicate 9780-line dashboard.html clone, and hard-freeze Stadium
- `2026-11-04 17:04 CST` | **SAVE** (from `51e0616`) | V5 Slice 3: Unblock pre-order sliders and MSRP shipping, add Close-Call cushion, per-store cooldowns, and TCGPlayer scam shield
- `2026-11-04 18:13 CST` | **SAVE** (from `6dc0947`) | V5 Slice 3.5: Extract src/engine/trendAdvisor.ts with 30/60/90d Elastic Dip sniper and replace blind pre-release calendar warnings
- `2026-11-05 00:16 CST` | **SAVE** (from `12fac76`) | Manual dropbot save checkpoint
- `2026-11-07 01:13 CST` | **SAVE** (from `4972515`) | V5 Slice 6: Rule of 3 Wall/Dad/Logan checkboxes, Auto-Pilot Dip Advisor, Big-Box Flip Bypass, Roundup Digest, and 1-Click Cart links
- `2026-11-07 18:54 CST` | **SAVE** (from `9d72726`) | V5 Final Polish: Pin Kanzen Games to pokemon-sealed-in-stock feed and block Holofoil/bracket singles
