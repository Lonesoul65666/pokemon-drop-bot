# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` / `dropbot backup` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V6 Engine Repair Pass 1 — Kill Zeno's Paradox & Rip-Mode Slider Clamp, Commit-After-Send + Reddit TTL, Native HTTP/2 + `ETag` `304` LGS Engine (`90/90 HEALTHY`, `0` `429`s), Stop `588 MB` Log/CPU Bleed, and Remove Fake Telemetry)
- Killed Zeno's Paradox and Rip-Hunt `$64.89` slider overrides so `effectiveTargetCeiling = policyMaxBuy` always honors Scott's manual slider; added Commit-After-Send (`1500ms`/`4000ms` DNS/network retries) + 4h Reddit TTL (`0` ghosts); upgraded LGS `smartGetJson()` to Node 26 native HTTP/2 `fetch()` + `ETag`/`304` (`90/90` healthy, `0` `429`s, CPU `73.5%` -> `0%–2%`, log `588 MB` -> `9.82 KB`); and purged fake `145` catalog / latency telemetry in `server.js`.

### Turn -1 (V6 Engine Repair Pass 2 — System Chrome Passive XHR Bridge, Split `bigBoxDomParsers.ts` `< 350L`, Fix All 9 Big-Box Parsers & Transports, Enforce `totalNodesFound > 0` Truth, and Protect Residential IP)
- Upgraded `src/pollers/wafBrowserBridge.ts` (`316` lines) to invisible System Chrome (`channel: 'chrome'`, `--headless=new`, `ignoreHTTPSErrors: true`, `0` visible windows) with passive `page.on('response')` wire-tapping; split `bigBoxAdapters.ts` + `bigBoxDomParsers.ts` (`< 350` lines); fixed `GameStop`, `Best Buy`, `Barnes & Noble`, `Amazon 1P`, `Costco`, `Target`, `Walmart`, `Sam's Club`, and `Pokémon Center` parsers; and enforced `PARSER_BLIND_0_NODES` when `totalNodesFound === 0`.

### Turn 0 (Current Session — V6 Engine Repair Pass 3: 6h Home-IP WAF Shield `WIRE_ARMED_IP_SHIELD`, Bluesky Jetstream WS + Rotating Proxy-Reddit Restock Wire, Plush Exclusion, GameStop Slider Fallthrough, & Bounded `<15s` Probe Hardening)
- **1. Home-IP WAF Shield (`wafBrowserBridge.ts` `317L`, `bigBoxRetailPoller.ts` `295L`, `server.js`, `public/index.html`):**
  - Added 2-strike `6h` `WIRE_ARMED_IP_SHIELD` protection (`HOME_IP_SHIELD_DOMAINS`: `pokemoncenter`, `target`, `walmart`, `costco`, `samsclub`) so WAF-challenged retailers stop hammering from Scott's home IP and transition cleanly to `WIRE_SHIELD` (`5` shielded + `4` direct `200 OK` = `9/9` Big-Box + `90/90` LGS = `99/99` healthy sensors, `blockedCount: 0`), while routing `Amazon 1P` Webshare Proxy-First and `Best Buy` via `bestBuyOfficialApi.ts` (`47L`) + Chrome fallback.
- **2. Sub-Second Bluesky Jetstream + Proxy-Reddit Restock Wire (`publicRestockWire.ts` `338L`, `listener.ts`, `notifier.ts`, `bigBoxAdapters.ts` `315L`):**
  - Built `src/pollers/publicRestockWire.ts` connecting to `wss://jetstream2.us-east.bsky.network/subscribe` (`OPEN` in `276–424ms`) + `25s` `getAuthorFeed` (`@pokemonrestocks.bsky.social`, `@hoomandeals.bsky.social`), native `fetch()` redirect unshortening (`AbortSignal.timeout(5000)` on every hop, zero keep-alive proxy socket leaks), canonical 1-tap ATC URL generation (`target.com/p/-/A-{tcin}`, `walmart.com/pac?id={id}&quantity=1`, `api.bestbuy.com/click/-/{sku}/cart`, `amazon.com/dp/{asin}?smid=ATVPDKIKX0DER`), `INSTANT_BUY_RESTOCK` vs `QUEUE_INVITE_DRAWING` (`QUEUE`/`INVITE`/`DRAWING` -> `sendBigBoxQueueOrDrawingAlert()`), `15m` live freshness gate, `4h` wire/Reddit cache TTL, and `30m` `claimBigBoxCrossChannelSignal()` dedup.
  - Upgraded `listener.ts` `pollProxyRedditDealsOnce()` to per-request rotating Webshare proxy (`keepAlive: false`, `AbortSignal.timeout(5000)`, `new.json` -> `new/.rss` fallback yielding `HTTP 200 OK` / `21` posts parsed on unburned exit IPs).
- **3. Plush Exclusion, GameStop Slider Fallthrough & Bounded `<15s` Verification Probe (`policies.ts`, `bigBoxDomParsers.ts` `309L`, `evaluator.ts`):**
  - Added `/\bsquishmallows?\b|\bplush(?:ie|ies)?\b/i` to `GLOBAL_JUNK_EXCLUSIONS`, enabled `allowAboveMsrpSliderFallthrough: true` on `GameStop` (`6` live GameStop ETB shelves now cached in `storeOffersCache.json`, with `$84.99 <= $93.00` passing `UNDER_SLIDER_TRIGGER` on `me-delta-reign-etb` and `$84.99 > $54.99` muting on `me-perfect-order-etb`), verified `0` orphaned `node -e` processes, and ran a single clean `8.05s` (`< 15s`) hard-exiting verification probe (`finally { process.exit(0); }`).

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
