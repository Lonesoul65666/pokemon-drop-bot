# 05 — LAST 3 TURNS, RECENT DECISIONS & CONTINUITY LOG

> **SINGLE SOURCE OF TRUTH (PART 5/6):** Rolling log of recent engineering turns and `dropbot save` / `dropbot undo` / `dropbot backup` checkpoints so any new session or computer has immediate conversational continuity.

---

## Rolling 3-Turn Engineering History

### Turn -2 (V6 Engine Repair Pass 2 — System Chrome Passive XHR Bridge, Split `bigBoxDomParsers.ts` `< 350L`, Fix All 9 Big-Box Parsers & Transports, Enforce `totalNodesFound > 0` Truth, and Protect Residential IP)
- Upgraded `src/pollers/wafBrowserBridge.ts` (`316` lines) to invisible System Chrome (`channel: 'chrome'`, `--headless=new`, `ignoreHTTPSErrors: true`, `0` visible windows) with passive `page.on('response')` wire-tapping; split `bigBoxAdapters.ts` + `bigBoxDomParsers.ts` (`< 350` lines); fixed `GameStop`, `Best Buy`, `Barnes & Noble`, `Amazon 1P`, `Costco`, `Target`, `Walmart`, `Sam's Club`, and `Pokémon Center` parsers; and enforced `PARSER_BLIND_0_NODES` when `totalNodesFound === 0`.

### Turn -1 (V6 Engine Repair Pass 3 — 6h Home-IP WAF Shield `WIRE_ARMED_IP_SHIELD`, Bluesky Jetstream WS + Rotating Proxy-Reddit Restock Wire, Plush Exclusion, GameStop Slider Fallthrough, & Bounded `<15s` Probe Hardening)
- Added 2-strike `6h` `WIRE_ARMED_IP_SHIELD` protection (`HOME_IP_SHIELD_DOMAINS`: `pokemoncenter`, `target`, `walmart`, `costco`, `samsclub`, `/api/engine-room` `99/99` healthy sensors, `blockedCount: 0`); built `src/pollers/publicRestockWire.ts` (`338L`) connecting to `wss://jetstream2.us-east.bsky.network/subscribe` + `getAuthorFeed` (`@pokemonrestocks.bsky.social`, `@hoomandeals.bsky.social`) with `AbortSignal.timeout(5000)` native redirect unshortening, canonical 1-tap ATC URLs, and `QUEUE`/`INVITE`/`DRAWING` routing; upgraded `listener.ts` to per-request rotating Webshare Proxy-Reddit (`keepAlive: false`); blocked plush/Squishmallow bundles; and enabled `allowAboveMsrpSliderFallthrough: true` on `GameStop` (`6` live ETB shelves cached).

### Turn 0 (Current Session — V6 Phase 2: Discord Alert Overhaul, Earned `7d/15d -> 30d/60d/90d` Watermarks, ETB-Only Wall Rule, Box-Art Preservation, TCGPlayer Comp Gate, & Commander Cost-Basis Integration)
- **1. Alert Quality Gates (`evaluator.ts`, `notifier.ts`, `marketComps.ts`):**
  - Killed worse-than-market LGS alerts: both `evaluator.ts` (`getCachedVerifiedTcgLowestShipped` + `FALLING_KNIFE_WAIT` gate) and `notifier.ts` (`getLiveTcgPlayerCompFast` pre-send check) suppress non-1P LGS offers whose `landedPrice` exceeds verified live `tcgplayerLowestShipped` (`comp > $0`), keeping `HOLD OFF` / overpriced LGS offers silent (`Overpriced LGS Test $125.00 > TCGPlayer $59.99` verified suppressed).
  - Eliminated `@everyone` (`0` occurrences across `.ts`) and restricted `@here` + Gold/Crimson strictly to **1st-Party Big-Box MSRP** drops and live **Queue / Invite / Online Draw** windows (`Elite4 TCG @ $167` verified `mentionContent: ""`, `verdictHeadline: "SUGGESTED BUY"`). Enforced `Math.max(5.00, lastAlertedLandedPrice * 0.04)` minimum re-alert step-down within cooldown windows.
- **2. Earned Historical Watermarks — Zero Fabricated Buckets (`src/engine/watermarkHistory.ts` `236L` `< 300`, `marketTape.ts`, `src/engine/trendAdvisor.ts` `329L` `< 350`):**
  - Lifted `marketTape.ts` pruning from `14` days to `95` days (`NINETY_FIVE_DAYS_MS` / `.slice(-95)`), calculated real `realDaysTracked` from `dailySnapshots.json` + `salesHistory.json` (filtering seeded `Baseline` rows), and rendered ONLY earned milestone bands (`7d`, `15d`, `30d`, `60d`, `90d` — e.g., `Shelf Floor — 7d: $1,000 • 15d: $1,105 (15d tracked — 30d unlocks in 15d)`), plus optional verified TCGPlayer `infinite-api` quarter comp notes during async enrich.
- **3. Commander Cost-Basis Memory + Strict ETB-Only Wall Rule (`src/engine/purchaseMemory.ts` `176L` `< 200`):**
  - Enforced ETB-only `0/3`–`3/3` Wall strings strictly on single `etb` / `pc_etb` SKUs while formatting Booster Boxes, Bundles, UPCs, and `10-ETB` / `6-Box` Cases as `Rip / Pack Format ($X.XX / pack)` or `Sealed Case ($X.XX / box)`.
  - Mirrored `conqueredVault.json` (including Scott's `$1,529.45` `me-30th-celebration-etb-case`) into `data/purchaseLedger.json` via `atomicWriteJson` (`0` diff on frozen `userPreferences.json` / `conqueredVault.json`) and surfaced `Last Paid: $1,529 (Beats your $1,529 buy by $529)`.
- **4. Clean 5-Line Discord Embed + Preserved Box-Art Thumbnails (`src/notifications/discordEmbedBuilder.ts` `263L` `< 340`, `notifier.ts`, `lgsPoller.ts`, `fastTier1Poller.ts`, `bigBoxDomParsers.ts`):**
  - Built `buildCleanDiscordAlertEmbed()` (`0` `"At Target"` text, `0` duplicate shipping strings, `0` bracket soup), propagated live Shopify `prod.images[0].src` / Big-Box `imageUrl` + local `public/assets/items/` attachment fallback, preserved `embed.thumbnail` across both `0ms` send and async `PATCH`, verified `COMPILE_OK` + PM2 `online`, and dispatched both live `[FORMAT PREVIEW]` embeds to Scott's Discord cleanly (`exit code 0`).

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
