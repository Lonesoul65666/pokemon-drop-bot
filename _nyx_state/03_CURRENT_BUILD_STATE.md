# 03 — CURRENT BUILD STATE (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 3/6):** Snapshot of live git state, PM2 health, monitored store telemetry, and module readiness. Automatically updated on every `dropbot save` / `dropbot undo` / `dropbot backup`.

---

## 1. Live System Snapshot
- **Current Phase:** **V6 Phase 2 Complete (Clean 5-Line Discord Embed Overhaul w/ Preserved Box-Art Thumbnails, Earned `7d/15d -> 30d/60d/90d` Watermark History `watermarkHistory.ts` `< 300L` + `95d` `marketTape.ts` Retention, Strict ETB-Only Wall Rule, Commander Cost-Basis `purchaseMemory.ts` `< 200L` w/ `$1,529` 30th Case Ledger, TCGPlayer Comp Gate, & 1P-Only `@here` / `Math.max(5, 4%)` Step-Down Quality Gates)**.
- **Last Checkpoint Timestamp:** `2026-11-12 15:35 CST`
- **Git Branch:** `main`
- **Parent Baseline Commit:** `c25b13a` (`V6 Phase 2: Clean Discord embed with box art, earned 7d/15d->90d watermarks, ETB-only wall logic, TCGPlayer comp gate, and purchase cost memory`)
- **PM2 Process Status:**
  - `pokemon-drop-bot` (id `0`, `index.js`): **ONLINE** (`0` orphaned `node -e` processes, `0` visible browser windows, **`90 / 90` Shopify LGS stores `HEALTHY` (`17 / 25` `HTTP 304` Tier-1 fast-delta hits)** + Bluesky Jetstream WebSocket `OPEN` (`2` DIDs) + `4` Direct `200 OK` Big-Box sensors + `5` `WIRE_ARMED_IP_SHIELD` sensors)
  - `drop-bot-dashboard` (id `1`, `server.js` on `http://localhost:3000`): **ONLINE** (`0` crashes, `127.5 MB` RSS, `GET /api/engine-room` reporting **`healthySensors: 99` / `totalSensors: 99`** (`healthyLgsSensors: 90`, `healthyBigBoxSensors: 4` direct `200 OK`: `GameStop` `6` in-stock cached offers, `Best Buy`, `Amazon 1P` proxy-first, `Barnes & Noble`; `wireShieldedBigBoxSensors: 5` `WIRE_ARMED_IP_SHIELD`: `Pokémon Center`, `Target`, `Walmart`, `Costco`, `Sam's Club`; `blockedCount: 0`))
- **Active Sensor & Cache Counts:**
  - **Shopify LGS Pool (`config/stores.json`):** `90` active stores (`90 / 90` reporting healthy in `/api/engine-room` via Node 26 Undici HTTP/2 ALPN `fetch()` + `ETag`/`304`, `0` `HTTP 429`s).
  - **Big-Box Sensors & Public Restock Wire (`src/pollers/bigBoxRetailPoller.ts`, `publicRestockWire.ts`, `bestBuyOfficialApi.ts`, `wafBrowserBridge.ts`, `listener.ts`):** `4` Direct/Proxy-First `200 OK` (`Best Buy`, `GameStop` w/ slider fallthrough, `Amazon 1P` Webshare proxy-first, `Barnes & Noble`) + `5` Home-IP WAF-Shielded (`6h` `WIRE_ARMED_IP_SHIELD` after 2 strikes) backed sub-second by Bluesky Jetstream WS (`@pokemonrestocks.bsky.social`, `@hoomandeals.bsky.social`) + `25s` rotating Webshare Proxy-Reddit (`new.json` -> `new/.rss` fallback).
  - **Target Matrix (`config/catalog.json` + `config/userPreferences.json` + `marketCache.json`):** `131` tracked sealed SKUs (`/\bsquishmallows?\b|\bplush(?:ie|ies)?\b/i` unconditionally blocked, `4h` wire/Reddit cache TTL, `30m` cross-channel dedup, manual `policyMaxBuy` sliders honored 100%).

---

## 2. Module Status Across V5–V6 Refactoring

| Module / File | Lines | Status | V6 Active Role |
| :--- | :---: | :--- | :--- |
| `_nyx_state/01..08_*.md` | 8 files | **ACTIVE (V6 Phase 2)** | Multi-agent continuity engine, Failure Graveyard (`02`), Commercial Audit (`07`), & Live Diagnostic Report (`08`) |
| `scripts/dropbot-cli.ps1` | 207 | **ACTIVE (V5 Step 0)** | Portable `dropbot save / undo / backup / next` CLI |
| `src/config/configManager.ts` | 339 | **ACTIVE (V6 Slice 3, `< 350`)** | Merges `catalog.json` + `userPreferences.json` + `marketCache.json` + `amazonAsin` / `retailSearchQuery` propagation |
| `src/engine/trendAdvisor.ts` | 329 | **ACTIVE (V6 Phase 2, `< 350`)** | Honest rolling metrics (`0` `Math.sin`), re-exports `watermarkHistory.ts`, advisory-only `BLEEDING DOWN`, & Hard Ceiling Rule |
| `src/engine/watermarkHistory.ts` | 236 | **ACTIVE (V6 Phase 2, `< 300`)** | Real `realDaysTracked` age + earned-only `7d/15d/30d/60d/90d` shelf watermarks + optional TCGPlayer `infinite-api` quarter comp note |
| `src/engine/purchaseMemory.ts` | 176 | **ACTIVE (V6 Phase 2, `< 200`)** | Mirrors `conqueredVault.json` -> `data/purchaseLedger.json` (`$1,529.45` 30th Case), `Last Paid` delta math, & strict ETB-only `0/3`–`3/3` Wall rule |
| `src/notifications/discordEmbedBuilder.ts` | 263 | **ACTIVE (V6 Phase 2, `< 340`)** | Clean 5-line Discord embed builder, 1P-only `@here` theme (`0` `@everyone`), `0` `"At Target"`, & 7-layer box-art thumbnail preservation |
| `src/engine/singlesSniper.ts` | 336 | **ACTIVE (V6 Slice 1, `< 350`)** | Quiet Singles & Gyarados Offload Radar (`singlesCache.json`) with 500-key LRU cap (`pruneCompBenchmarksLru`) & 100% silent alert rule |
| `src/pollers/wafBrowserBridge.ts` | 317 | **ACTIVE (V6 Pass 3, `< 350`)** | Invisible System Chrome worker + 2-strike `6h` Home-IP WAF Shield (`HOME_IP_SHIELD_DOMAINS` -> `WIRE_ARMED_IP_SHIELD` in `data/wafSessionCookies.json`) |
| `src/pollers/bigBoxAdapters.ts` | 315 | **ACTIVE (V6 Pass 3, `< 350`)** | Verified 1P JSON/hybrid parsers + `allowAboveMsrpSliderFallthrough` + 30m `claimBigBoxCrossChannelSignal()` deduplicator |
| `src/pollers/bigBoxDomParsers.ts` | 312 | **ACTIVE (V6 Phase 2, `< 350`)** | Split DOM shelf parsers for `GameStop`, `Amazon 1P`, `Barnes & Noble`, `Pokémon Center`, `Best Buy`, & `Costco` + `imageUrl` extraction |
| `src/pollers/bigBoxRetailPoller.ts` | 295 | **ACTIVE (V6 Pass 3, `< 350`)** | 9-retailer Big-Box 1P poller emitting `WIRE_ARMED_IP_SHIELD`, Webshare Proxy-First `Amazon 1P`, & Hybrid `Best Buy` |
| `src/pollers/bestBuyOfficialApi.ts` | 47 | **ACTIVE (V6 Pass 3, `< 350`)** | Optional Best Buy Official Products REST API (`BESTBUY_API_KEY`) poller with Chrome DOM fallback |
| `src/pollers/publicRestockWire.ts` | 338 | **ACTIVE (V6 Pass 3, `< 350`)** | Sub-second Bluesky Jetstream WS + `25s` `getAuthorFeed` wire, `AbortSignal.timeout(5000)` native `fetch()` unshortener, canonical retail ATC builder, & `QUEUE`/`INVITE`/`DRAWING` classifier |
| `src/pollers/fastTier1Poller.ts` | 286 | **ACTIVE (V6 Phase 2, `< 350`)** | 15s Tier-1 Fast Shopify poller via Node 26 HTTP/2 `fetch()`, `?limit=250`, `ETag`/`304`, `?payment=shop_pay`, CAD->USD FX, & `imageUrl` |
| `evaluator.ts` | 2,027 | **ACTIVE (V6 Phase 2)** | 1P-only `isTierAMsrp`, worse-than-TCGPlayer & `FALLING_KNIFE_WAIT` LGS gates, `Math.max(5.00, last * 0.04)` step-down, & ETB-only Wall tags |
| `notifier.ts` | 1,042 | **ACTIVE (V6 Phase 2)** | **0ms Fire-Then-Enrich** w/ `buildCleanDiscordAlertEmbed()`, pre-send `getLiveTcgPlayerCompFast` LGS gate, box-art preservation across `PATCH`, & `@here` Queue/Draw |
| `marketTape.ts` | 718 | **ACTIVE (V6 Phase 2)** | Lifted `dailySnapshots.json` & `salesHistory.json` retention from `14` days to `95` days so `15d/30d/60d/90d` watermarks unlock naturally |
| `listener.ts` | 259 | **ACTIVE (V6 Phase 2)** | Non-blocking `void sendAlert(...).catch(...)` handoff, `imageUrl` propagation, & rotating Webshare Proxy-Reddit poller |
| `lgsPoller.ts` | 992 | **ACTIVE (V6 Phase 2)** | 90-store Shopify poller with `resolveShopifyFxMultiplier()`, `?payment=shop_pay` cart links, `prod.images[0].src` box art, & 3-arg `isSingleCardOrNonSealed()` |
| `policies.ts` | 717 | **ACTIVE (V6 Slice 1)** | Context-aware `isSingleCardOrNonSealed()` unblocking `\bpack\b/\bpromo\b/\bfoil\b/\bsingle\b` on valid sealed containers while blocking 100% of singles, slabs, loose packs, & partial-ETB traps |
| `server.js` | 2,934 | **ACTIVE (V6 Slice 1)** | `mtimeMs`-backed `readJsonCached()` + memoized `/api/status` (`12.49ms`) & `/api/engine-room` (`25.55ms`), zero split-brain `storeOffersCache.json` writes, & honest `/api/sku-history/:skuId` |
| `public/index.html` | 6,302 | **ACTIVE (V6 Slice 1)** | Instant 0ms Rule-of-3 UI, Top Trophy Room nav, collapsible `[+ METRICS]` drawers, and `?payment=shop_pay` `[CART 1X/2X/3X]` buttons |
| `public/css/stadium.css` + `public/js/stadium/*.js` | 5 files | **HARD-FROZEN (V5 Slice 2)** | `git diff = 0 lines` verified |
