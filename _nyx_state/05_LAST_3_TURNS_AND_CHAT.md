# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` / `dropbot backup` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V6 Slice 3 — Real Invisible Playwright WAF Worker, All 9 Big-Box Retailers Wired Into `processIncomingDrop()`, Amazon 1P `ATVPDKIKX0DER` & Barnes & Noble, and Priority Retail SKU Seeding)
- Installed `playwright` and built `src/pollers/wafBrowserBridge.ts` (`345` lines `< 350`) with real headless Chromium (`--headless=new`, `0` visible Windows HWNDs, `waitUntil: 'domcontentloaded'`, hard `15000ms` timeout, `finally { await page.close() }`, persistent `data/wafSessionCookies.json`), Queue-It waiting room alerts, and `src/pollers/bigBoxAdapters.ts` (`310` lines) + `src/pollers/bigBoxRetailPoller.ts` (`273` lines) across all `9` Big-Box 1P channels.

### Turn -1 (Strict Read-Only Bare-Metal Live Engine Autopsy -> `_nyx_state/08_ENGINE_DIAGNOSTIC_REPORT.md`)
- Executed a 100% live-network forensic autopsy (`0` tracked lines modified) and authored `_nyx_state/08_ENGINE_DIAGNOSTIC_REPORT.md`, uncovering: (1) Zeno's Paradox (`dropPrice * 0.92` self-undercutting ceiling killing 100% of bleeding-down SKUs like `$109.99` *Destined Rivals ETB*), (2) Rip-Hunt `$64.89` (`msrp * 1.18`) hard clamp crushing manual sliders on `1/3` & `2/3` sets (*Prismatic Evolutions* `$121`, *Delta Reign* `$93`), (3) pre-send `alertState.json` lock dropping alerts on transient DNS `ENOTFOUND` + immortal `reddit_t3_*` ghosts, (4) `25 / 90` LGS `HTTP 429` storm + `588.0 MB` `[SEEN]` stdout log at `73.5%` CPU, (5) residual `145` catalog / fake latency / `healthySensors` `+ northStar5.length` inflation in `server.js`, and (6) 3 false-green `0-node` Big-Box parsers (`GameStop`, `Amazon`, `Costco`) + WAF transport issues queued for Pass 2.

### Turn 0 (Current Session — V6 Engine Repair Pass 1: Kill Zeno's Paradox & Rip-Mode Slider Clamp, Commit-After-Send + Reddit TTL, Native HTTP/2 + `ETag` `304` LGS Engine (`88/90 HEALTHY`, `0` `429`s), Stop `588 MB` Log/CPU Bleed, and Remove Fake Telemetry)
- **1. Fixed All 3 Evaluator & Notifier Trigger Blockers (`src/engine/trendAdvisor.ts` `327` lines, `evaluator.ts`, `listener.ts`, `notifier.ts`, `index.ts`):**
  - Killed Zeno's Paradox (`dropPrice * 0.92`) and Rip-Hunt `$64.89` slider clamp so `effectiveTargetCeiling = policyMaxBuy` always honors Scott's manual slider while preserving `BLEEDING DOWN` as an honest advisory signal and `◈ ⟦ NEED RIP PAIR (QTY 2+) ⟧` on `1/3` & `2/3` sets. Verified live `0ms` Discord alerts firing immediately on *Destined Rivals ETB* (`$109.99` at `Collector Store`, `$78.29` at `Kanzen Games`), *Delta Reign ETB* (`$84.99` at `Collector Store`, `$86.00` at `Shinobi`), and *Prismatic Evolutions ETB* (`$119.99` -> `BUY`).
  - Implemented Commit-After-Send (`PendingAlertCommit` + `commitAlertDelivery` + `releasePendingAlertLock`) with `1500ms`/`4000ms` network/DNS/5xx retries in `notifier.ts`, plus a strict 4-hour TTL purging all stale `reddit_*` / `PKMNTCGDeals` ghosts (`0` remaining in `storeOffersCache.json` and `liveStock.json`).
- **2. Cracked Shopify's Cloudflare `HTTP 429` Storm & Stopped `588 MB` / `73.5%` CPU Bleed (`lgsPoller.ts`, `src/pollers/fastTier1Poller.ts` `286` lines `< 350`, `listener.ts`):**
  - Proved on live wire that `axios.get()` (Node HTTP/1.1 + `Accept: application/json` without HTTP/2 ALPN or `Sec-Fetch-*` headers) triggered Cloudflare Bot Score `1` (`TOO_MANY_REQUESTS`), and upgraded `smartGetJson()` to Node 26 native `fetch()` (Undici TLS 1.3 + HTTP/2 ALPN + Chrome document navigation headers), `ETag`/`If-None-Match` `304` caching, zero cold-boot `/cart.js` bursts, Tier-1 reconciliation only every 5th `lgsPoller` sweep, and per-store proxy fallback.
  - Fleet health jumped from `65/90` -> **`88 / 90 HEALTHY` (`0` `HTTP 429`s!)**, `fastTier1Poller` hit `16 / 25` `HTTP 304` in `9.38s` (`17 / 65` `HTTP 304` on Tier-2 Sweep #2), `[SEEN]` spam dropped to `0` lines (`9.82 KB` log vs `588.0 MB`), and `pokemon-drop-bot` CPU dropped from **`73.5%` -> `0%–2%`**.
- **3. Purged Residual Fake Telemetry & Aligned Engine Room Icons (`server.js` & `public/index.html`):**
  - Deleted fake `145` catalog fallback, fake deterministic latency `180 + ((idx * 37) % 340)`, and `?? 18`; fixed `healthySensors` to count ONLY truly healthy sensors (`88`, `healthyBigBoxSensors: 0`); and aligned Big-Box left `coreTier` SVGs with right status pills (`WAF_CHALLENGE_*` crimson, `PARSER_BLIND (0 NODES)` amber, verified `200 OK` emerald). Big-Box scrapers (`bigBox*.ts`, `wafBrowserBridge.ts`) left untouched (`git diff = 0`) for Pass 2 next turn.

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
