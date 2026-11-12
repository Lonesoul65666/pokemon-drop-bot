# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` / `dropbot backup` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (Strict Read-Only Bare-Metal Live Engine Autopsy -> `_nyx_state/08_ENGINE_DIAGNOSTIC_REPORT.md`)
- Executed a 100% live-network forensic autopsy (`0` tracked lines modified) and authored `_nyx_state/08_ENGINE_DIAGNOSTIC_REPORT.md`, uncovering Zeno's Paradox (`dropPrice * 0.92`), the Rip-Hunt `$64.89` slider clamp, pre-send DNS alert loss + immortal Reddit ghosts, the `25 / 90` LGS `HTTP 429` storm + `588.0 MB` `[SEEN]` stdout CPU burn, residual fake `145` catalog telemetry, and 3 false-green `0`-node Big-Box parsers (`GameStop`, `Amazon`, `Costco`) + WAF transport misclassifications.

### Turn -1 (V6 Engine Repair Pass 1 — Kill Zeno's Paradox & Rip-Mode Slider Clamp, Commit-After-Send + Reddit TTL, Native HTTP/2 + `ETag` `304` LGS Engine (`88/90 HEALTHY`, `0` `429`s), Stop `588 MB` Log/CPU Bleed, and Remove Fake Telemetry)
- Killed Zeno's Paradox and Rip-Hunt `$64.89` slider overrides so `effectiveTargetCeiling = policyMaxBuy` always honors Scott's manual slider; added Commit-After-Send (`1500ms`/`4000ms` DNS/network retries) + 4h Reddit TTL (`0` ghosts); upgraded LGS `smartGetJson()` to Node 26 native HTTP/2 `fetch()` + `ETag`/`304` (`88/90` -> `90/90` healthy, `0` `429`s, CPU `73.5%` -> `0%–2%`, log `588 MB` -> `9.82 KB`); and purged fake `145` catalog / latency telemetry in `server.js`.

### Turn 0 (Current Session — V6 Engine Repair Pass 2: System Chrome Passive XHR Bridge, Split `bigBoxDomParsers.ts` `< 350L`, Fix All 9 Big-Box Parsers & Transports, Enforce `totalNodesFound > 0` Truth, and Protect Residential IP)
- **1. Upgraded `src/pollers/wafBrowserBridge.ts` (`316` lines `< 350`) to Invisible System Chrome + Passive Response Wire-Tap:**
  - Configured System Chrome (`channel: 'chrome'`, fallback `'msedge'`, `headless: true`, `--headless=new`, `--disable-blink-features=AutomationControlled`, `--disable-gpu`, `--no-startup-window`, `--mute-audio`, `ignoreHTTPSErrors: true`, `0` visible desktop windows verified on live sweep and PM2 daemon), concurrency `1` serial mutex (`page` & `context` always closed in `finally`), jittered per-retailer intervals (`Target` `75s`, `Walmart`/`Costco`/`Best Buy`/`Sam's Club` `90s–120s`, `GameStop`/`B&N` `150s`, `Pokémon Center` `180s`) persisted in `data/wafSessionCookies.json`, zero datacenter Webshare proxy fallback, and passive `page.on('response')` XHR capture (zero `page.evaluate` fetch injection, zero `page.route` timing leaks).
- **2. Split `bigBoxAdapters.ts` (`342` lines) & `bigBoxDomParsers.ts` (`301` lines) + Enforced `totalNodesFound > 0` Truth (`bigBoxRetailPoller.ts` `252` lines, `server.js`, `public/index.html`):**
  - Every adapter now returns `{ totalNodesFound, inStockOffers }`; `/api/engine-room` and `bigBoxRetailPoller.ts` only mark a Big-Box sensor green (`ULTRA_CORE` / `200 OK`) when `totalNodesFound > 0`, and flag `0`-node `200` shells as `PARSER_BLIND_0_NODES` (`SLEEPING_CORE` amber).
  - Repaired **GameStop** (`35` live tiles parsed via object/string `availability` fix), **Best Buy** (`16` `.product-list-item` tiles via System Chrome HTTP/2, eliminating Akamai's `12s` `ERR_CANCELED` tarpit + optional `BESTBUY_API_KEY` REST path), **Barnes & Noble** (`24` unique EAN cards on page 1 after fixing `{0,1800}?` lookahead boundary), **Amazon 1P** (`5` outer `s-search-result` cards with brand+title combine, non-strike `.a-offscreen` price, `rh=p_6:ATVPDKIKX0DER` `<= MSRP*1.08`, `95s` Undici HTTP/2 + Chrome fallback), **Costco** (passive `gdx-api.costco.com/catalog/search` + `ProductTile` DOM, honestly reporting `PARSER_BLIND_0_NODES` instead of false green when Kasada withholds search tiles), **Target** (passive `plp_search_v2` wire-tap on `facetedValue=dq4mn`), **Walmart** (`#__NEXT_DATA__` `itemStacks` locked to `F55CDC31AB754BB68FE0B39041159D63` + honest `WAF_CHALLENGE_PX`), **Sam's Club** (`WAF_CHALLENGE_PX` instead of mislabeled `IMPERVA`), and **Pokémon Center** (`ignoreHTTPSErrors: true` Direct Home IP distinguishing `ROUTER_TLS_FILTER`, `POKÉMON CENTER WAITING ROOM LIVE`, `WAF_CHALLENGE_IMPERVA`, and live stock).

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
