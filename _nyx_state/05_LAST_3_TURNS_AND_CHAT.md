# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` / `dropbot backup` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V6 Engine Repair Pass 3 — 6h Home-IP WAF Shield `WIRE_ARMED_IP_SHIELD`, Bluesky Jetstream WS + Rotating Proxy-Reddit Restock Wire, Plush Exclusion, GameStop Slider Fallthrough, & Bounded `<15s` Probe Hardening)
- Added 2-strike `6h` `WIRE_ARMED_IP_SHIELD` protection (`HOME_IP_SHIELD_DOMAINS`: `pokemoncenter`, `target`, `walmart`, `costco`, `samsclub`, `/api/engine-room` `99/99` healthy sensors, `blockedCount: 0`); built `src/pollers/publicRestockWire.ts` (`338L`) connecting to `wss://jetstream2.us-east.bsky.network/subscribe` + `getAuthorFeed` (`@pokemonrestocks.bsky.social`, `@hoomandeals.bsky.social`) with `AbortSignal.timeout(5000)` native redirect unshortening, canonical 1-tap ATC URLs, and `QUEUE`/`INVITE`/`DRAWING` routing; upgraded `listener.ts` to per-request rotating Webshare Proxy-Reddit (`keepAlive: false`); blocked plush/Squishmallow bundles; and enabled `allowAboveMsrpSliderFallthrough: true` on `GameStop` (`6` live ETB shelves cached).

### Turn -1 (V6 Phase 2 + Phase 2B — Discord Alert Overhaul, Falling-Knife Gate, Earned `7d/15d -> 30d/60d/90d` Watermarks, ETB-Only Wall Rule, Single-Qty Case Guard, Box-Art Preservation, & Commander Cost-Basis Integration)
- Built `src/engine/watermarkHistory.ts` (`236L`), `src/engine/purchaseMemory.ts` (`176L`), and `src/notifications/discordEmbedBuilder.ts` (`299L`); killed worse-than-TCGPlayer and `<8%` falling-knife LGS alerts (Amber `CAUTIOUS DIP — STILL SLIDING` on `8%–11%` undercuts, Green `SUGGESTED BUY` on stable floors or `>=12%` undercuts); restricted `@here` strictly to 1P Big-Box MSRP + Queue/Draw (`0` `@everyone`); enforced `Math.max(5.00, last * 0.04)` step-downs; locked `case` SKUs to `1x` Shop Pay only; and preserved box-art thumbnails across `0ms` send + async `PATCH`.

### Turn 0 (Current Session — V6 Phase 3A & 3B Complete: Cache Poison Scrub, Sanity Floors, Dynamic `Cost × Need × Trend` 3-Tier Live Command UI, Muted Drawer, ETB-Only `[LOGAN WALL] / [OFFICE SEALED] / [DAD RIP]` Pills, Conquered Vault Buy Links, & Instant Global Fuzzy Search)
- **1. Cache Poison Scrub & Sanity Floors (`policies.ts`, `lgsPoller.ts`, `src/pollers/fastTier1Poller.ts`, `src/engine/cacheScrubber.ts` `303L` `< 350`):**
  - Inspected both `product.title` and `variant.title` (`isRejectedVariantTitle`) to block cheap acrylic/empty/JP/Korean/single-pack child variants (`$38.97` Paldean Fates & `$44.99` Fusion Strike ghosts eliminated), enforced `getSanityPriceFloor()` (`msrp * 0.62` and `verifiedMarket * 0.38` when `verifiedMarket >= 90`), scrubbed poisoned rows + `[FORMAT PREVIEW]` `$922.99` test ticks across runtime JSON caches via `atomicWriteJson()`, and reset bogus non-1P `msrpTrophies.json` (`totalMsrpHits: 0`).
- **2. Dynamic `Cost × Need × Trend` Deal Ranker & Enriched APIs (`src/engine/dealRanker.ts` `261L` `< 300`, `server.js`):**
  - Ranked all live offers into `BUY_NOW_PINNED`, `CAUTIOUS_WATCH`, and `MUTED_DRAWER` with `priorityScore`, `verdictLabel`, `isWallFormat`, `isCaseSku`, `pricePerPack`, `earnedWatermarks`, `purchaseMemory`, cleaned `bestLiveOffer` (`No LGS <= Comp` + `TCGPlayer $XX` link), and `bestBuyActionsBySku` on `/api/conquered-vault`.
- **3. Dynamic 3-Tier Live Command UI, ETB-Only Wall Controls, Vault Buy Links, & Global Fuzzy Search (`public/index.html`):**
  - Rendered Emerald `BUY_NOW_PINNED` cards pinned at top, Amber `CAUTIOUS_WATCH` cards with amber/outline CTAs, and auto-hid all `MUTED_DRAWER` items behind `[+ Show Muted / Hold-Off Shelf (X)]`; enforced single-qty `1x` case lock across all views & modals; restricted `[LOGAN WALL] • [OFFICE SEALED] • [DAD RIP]` pills strictly to `isWallFormat === true` ETBs while showing pack/case math + `Last Paid` memory on non-ETBs; synced Top KPIs honestly (`0` 1P MSRP catches armed state, zero Cooperstown hardcodes); wired `[⚡ Buy @ Store ↗]` / `[Shop TCGPlayer ↗]` onto all unconquered (`< 3/3`) Vault ETBs; and added instant token-normalized fuzzy search across all 131 SKUs / 38 Wall Sets.

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
- `2026-11-09 10:49 CST` | **SAVE** (from `2190c28`) | V5 Slice 7: Instant family slot UI, Trophy Room top nav, fix  ETB market placeholders, declutter cards, and add invisible headless WAF bridge
- `2026-11-10 23:20 CST` | **SAVE** (from `1b23a36`) | V6 Slice 1: 0ms Fire-Then-Enrich alerts, Shop Pay fast-lane, fix promo/pack matcher & CAD stores, purge Math.sin, and fix split-brain cache overwrite
- `2026-11-11 00:06 CST` | **SAVE** (from `a8a6d3a`) | V6 Slice 3: Real invisible Playwright WAF worker, live processIncomingDrop across all 9 Big-Box stores + Amazon 1P & B&N, and 1-tap retail cart links
- `2026-11-11 22:07 CST` | **SAVE** (from `53f1509`) | V6 Engine Pass 1: Kill Zeno's Paradox and Rip-Mode slider clamp, add LGS ETag 304 + 429 pacing, stop 588MB log CPU burn, and remove fake server telemetry
- `2026-11-11 23:23 CST` | **SAVE** (from `2c55e4d`) | V6 Engine Pass 2: System Chrome passive XHR bridge, fix GameStop/Amazon/Costco/Target/BestBuy/Walmart parsers, and enforce totalNodesFound truth
- `2026-11-12 14:46 CST` | **SAVE** (from `66119b2`) | V6 Engine Pass 3: Home-IP WAF shield, Bluesky Jetstream + proxy-Reddit restock wire, plush exclusion, and GameStop slider fallthrough
- `2026-11-12 15:35 CST` | **SAVE** (from `c25b13a`) | V6 Phase 2: Clean Discord embed with box art, earned 7d/15d->90d watermarks, ETB-only wall logic, TCGPlayer comp gate, and purchase cost memory
- `2026-11-12 19:26 CST` | **SAVE** (from `4569eae`) | V6 Phase 3 Complete: Dynamic Cost x Need x Trend UI, muted hold-off drawer, ETB-only wall pills, Vault buy links, and fuzzy search
