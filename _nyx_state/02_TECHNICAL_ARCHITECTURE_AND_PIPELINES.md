# 02 — TECHNICAL ARCHITECTURE, PIPELINES & FAILURE GRAVEYARD

> **SINGLE SOURCE OF TRUTH (PART 2/6):** Documents the live runtime topology, polling pipelines, evaluation math, and the **Failure Graveyard** of every V4 anti-pattern and reverted mistake so no agent ever repeats them.

---

## 1. Runtime & Process Topology
- **OS & Runtime:** Windows Native, Node.js `v26.4.0`, TypeScript compiled to CommonJS (`.js`), Express (`Port 3000`), PM2 (`fork` mode, `max_memory_restart: '1024M'`).
- **Active PM2 Processes (`ecosystem.config.js`):**
  1. `pokemon-drop-bot` (`index.js` / `index.ts`): Runs the 91-store Shopify LGS poller (`lgsPoller.ts`), Big-Box & Reddit & TCGPlayer undercut pollers (`vampirePoller.ts`), 6-hour TCGPlayer MarketSync worker (`src/marketSync.ts`), 14-day Market Tape NRT velocity engine (`marketTape.ts`), and 4-hour Live Shelf Digest scheduler (`notifier.ts`).
  2. `drop-bot-dashboard` (`server.js` on `http://localhost:3000`): Serves the Web Command Center (`public/index.html` at `/`, `/index.html`, and `/dashboard.html`), modular Battle Stadium static assets (`public/css/stadium.css` and `public/js/stadium/*.js`), and 22 REST API endpoints. The redundant 9,780-line root `dashboard.html` clone has been permanently deleted (`git rm dashboard.html`).
- **HARD-FROZEN FILES REGISTRY (`git diff = 0 lines`):**
  - `public/css/stadium.css` (`353` lines)
  - `public/js/stadium/stadium-data.js` (`819` lines)
  - `public/js/stadium/stadium-audio.js` (`121` lines)
  - `public/js/stadium/stadium-combat.js` (`1,376` lines)
  - `public/js/stadium/stadium-ui.js` (`1,641` lines)
  - `scripts/watchdog.vbs` & `scripts/watchdog.ps1`
- **Auto-Heal Watchdog:** Windows Scheduled Task `DropBot-PM2-Watchdog` runs `scripts/watchdog.vbs` -> `scripts/watchdog.ps1` every 5 minutes (hidden window `0`), checking `http://localhost:3000/api/status` and WMI `Win32_Process` for `index.js`/`server.js`.
- **Proxy Routing:** Direct-first HTTP via `axios` (`AbortController` hard socket timeout `<= 8000ms`, `dns.setDefaultResultOrder('ipv4first')`) with automatic fallback to `WEBSHARE_PROXY_URL` (`HttpsProxyAgent`).

---

## 2. Core Data Flow & Evaluation Pipeline
1. **Ingestion (`lgsPoller.ts` & `vampirePoller.ts`):**
   - Pollers fetch raw listings and pass `RawRestockItem` objects into `processIncomingDrop()` (`listener.ts`).
   - Full 91-store Shopify sweep also prunes disappeared variant IDs via `pruneStoreMissingOffers()`.
2. **Evaluation & Caching (`evaluator.ts`, `policies.ts`, & `src/config/configManager.ts`):**
   - `src/config/configManager.ts` (`347` lines) merges `config/catalog.json` (`131` static SKU definitions), `config/userPreferences.json` (Scott's untouchable personal sliders, `owned`/`inVault` flags, and global toggles), and `marketCache.json` (`estimatedMarketValue` / `rollingAverage` baselines) in memory.
   - `lgsPoller.ts` reads active stores and `evaluator.ts` resolves shipping rules from the single unified registry `config/stores.json` (`90` active healthy Shopify LGS stores + `9` Big-Box stores; dead 404 store `Lets Play TCG` disabled).
   - `evaluateItem()` checks `GLOBAL_JUNK_EXCLUSIONS`, matches against `WATCH_POLICIES` regexes (with `booster.*(box|display)` normalization), validates form factor via `isValidSkuForFormFactor()`, checks dynamic price floors/ceilings (`getMaxPlausiblePriceCeiling()` = `Math.max(base, estimatedMarketValue * 1.65, maxMarketBuyPrice * 1.65, msrpCeiling * 3.5)`), and runs the **Marketplace Scam & Shipping Trap Shield** (`isMarketplaceScamOrShippingTrap()` blocking `shipping > $35.00`, `shipping > itemPrice * 0.20`, and unverified/1-qty sellers pricing `market > $200` items at `>35%` below market).
   - Every valid matched in-stock offer (even above buy trigger) is cached into `storeOffersCache.json` (`upsertStoreOfferCache()`) and `liveStock.json.__bestOffers` (`upsertBestCurrentOffer()`) with a plain-English shelf status tag (`⟦ UNDER TARGET (-$XX.XX) ⟧`, `⟦ CLOSE CALL (+$X.XX OVER TARGET — IN CUSHION) ⟧`, `⟦ NEAR MISS (+$XX.XX OVER TARGET) ⟧`, or `⟦ MUTED: OWNED ON WALL ⟧`).
   - Offers meeting or beating `effectiveCeiling` (always honoring `policyMaxBuy` on pre-orders, evaluating `isTierAMsrp` on raw shelf price `dropPrice <= msrpCeiling * 1.08` when shipping `<= $10`, and allowing the `+$5.00` ETB/Bundle / `+$10.00` Booster Box/Case **Close-Call Grace Cushion**) are written to `liveStock.json`, checked against Vault Mute / Wall Hunter Mode / per-store `alertState.json` deduplication (`${storeName}::${skuId}`), and returned as `action: 'BUY'`.
3. **Notification (`notifier.ts`):**
   - Rate-limited FIFO Discord webhook queue (`1250ms` spacing) sends tactical embeds with `1x / 2x / 3x` Shopify cart links, TCGPlayer/eBay comps, and `$/Pack` rip metrics, recording the alert in `dropsHistory.json`.

---

## 3. THE FAILURE GRAVEYARD (Never Repeat These Mistakes)

Every architectural flaw uncovered in our V4 -> V5 Ground-Truth Audit (plus any future `dropbot undo` reverts) is permanently entombed here:

- **`[FAILED - V4 Fake Big-Box Telemetry (`vampirePoller.ts:217, 313, 391, 438`)]`:** Using `Math.max(productMatches.length, 38)` and hardcoded `200 OK — 18 Checked` fallbacks in `catch` blocks made the dashboard report `200 OK` while `Pokémon Center` (Imperva `<title>Pardon Our Interruption</title>`), `Walmart` (PerimeterX `<title>Robot or human?</title>`), `Best Buy` (literal no-op stub with zero HTTP requests), and `Costco` (Next.js CSR shell with 0 `.product.html` links) actually extracted **`0` products**, and `Target` RedSky keyword search only returned 24 overpriced 3rd-party Target Plus scalpers (`BlueProton`, `Collectors Emporium`). **Rule:** Always log 100% honest parsed counts and real HTTP/challenge status.
- **`[FAILED - V4 Pre-Order Ceiling Override Trap (`evaluator.ts:706`)]`:** Forcing `effectiveCeiling = Math.min(policyMaxBuy, Math.round(rule.msrpCeiling * 1.05))` whenever a title contains `[PREORDER]` or `(Presell)`, which secretly slashed Scott's `$222` Delta Reign Booster Box trigger down to `$170` (`$58` on ETBs) and blocked `$205`–`$219` deals at `Trading Card Market` and `Stomping Grounds` while letting stores that wrote `WAVE 2` or `*Releases 11-06-2026*` pass! **Rule:** Always honor `policy.maxMarketBuyPrice` when Scott sets it above MSRP.
- **`[FAILED - V4 $6.99 Shipping Penalty Killing MSRP Unicorns (`evaluator.ts:735 & 892`)]`:** Checking `landedPrice <= msrp * 1.08` instead of `dropPrice <= msrp * 1.08`, causing a real `$54.99` MSRP ETB + `$6.99` shipping (`$61.98` landed at `JBs Emporium`) to fail the `$59.39` (`54.99 * 1.08`) MSRP Unicorn check, get suppressed by `muteVaulted`, and fail `$54.99–$61.00` triggers on limit-1/limit-2 (`stock: 1..2`) restocks. **Rule:** Evaluate `isTierAMsrp` on raw `dropPrice <= msrpCeiling * 1.08` (with nominal shipping `<= $9.99`) and never block sub-trigger item prices solely because `stock < qtyForFreeShip`.
- **`[FAILED - V4 Narrow Sub-Collection Lock-In (`storeHealth.json`)]`:** Auto-locking stores like `Zulus Games` onto `/collections/pokemon-booster-boxes-1` (blind to ETBs/Bundles), `Kanzen Games` onto `pokemon-tcg-mega-evolution`, `Card N All Gaming` onto `30th-pokemon-sealed`, `Sealed and Sleeved` onto `sealed-cases-pokemon`, `Poke-Collect` onto `blister-packs`, or `Safari Zone` onto generic `/products.json` (28 non-Pokémon items), blinding the bot to 90% of their Pokémon shelves.
- **`[FAILED - V4 "Booster Display" Regex Miss & $115/$275 Price Cap]`:** Requiring literal `box` instead of `(box|display)` on Booster Boxes (missing `Zulus Games` `Journey Together: Booster Display @ $209.99`), and dropping legitimate in-stock sealed boxes (`Destined Rivals Box @ $398`, `Obsidian Flames ETB @ $269`, `Paldea Evolved ETB @ $199`, `Evolving Skies Box @ $2,499`) via hardcoded `$115 / $275 / $1,600` ceilings in `getMaxPlausiblePriceCeiling()`.
- **`[FAILED - V4 61-Second Shopify Poll Cycle Latency (`lgsPoller.ts:688`)]`:** Polling all 91 stores in a single undifferentiated queue followed by a mandatory `15,000–22,000ms` dead sleep (`~61s` revisit cycle), plus firing 10 concurrent direct requests from the home IP (triggering Shopify Cloudflare `429`s that double latency on proxy retry). Fast `30–45s` MSRP restocks sell out between sweeps.
- **`[FAILED - V4 15-Minute TCGPlayer OOS Echo & Reddit Self-Post Leak]`:** Treating a single empty/timed-out TCGPlayer scrape as "Out of Stock" (causing repeat alerts every 15m) and polling general Reddit text discussions without requiring an outbound retailer URL.
- **`[FAILED - V4 Duplicate 9,780-Line `dashboard.html` Clone]`:** Maintaining two identical 9,780-line HTML files in root (`dashboard.html`) and `public/index.html`, with 3,800+ lines of Logan's Battle Stadium tangled inside the Sniper UI file.
- **`[FAILED - V4 Watchdog Single-Line `pm2 jlist` Regex (`scripts/watchdog.ps1`)]`:** Parsing multi-line `npx pm2 jlist` stdout with `^\[.*\]$` caused false-positive restarts every 5 minutes and spammed 15 boot digests to Discord.
- **`[FAILED - V4 TCGPlayer Shipping Scam & Unverified Bait-and-Switch Trap]`:** Assuming `freeShipping: true` on TCGPlayer listings allowed a scam listing (`Prismatic Evolutions ETB Case` at `$499.00 + $199.99 Shipping` by unverified 1-qty seller `Crawford gaming` vs. `$1,252` market) to pass as a deal.
- **`[FAILED - V4 Blind Pre-Release Calendar Warning Override]`:** Hardcoding `"Pre-release bleed — wait for launch"` whenever `daysUntilRelease >= 0` and `price > msrp` ignored actual rolling market floor data—falsely warning Scott to wait on a `$79.99` (`$86.98` landed) *Delta Reign* ETB even though it beat his `$93` slider and undercut the `$100.00` live market comp floor by `$13–$20`. All buy/wait guidance must be driven by real 14d/30d/60d/90d price history and live market floor spread.

<!-- NYX_UNDO_GRAVEYARD_ANCHOR -->
