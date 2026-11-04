# 01 — PROJECT IDENTITY & LAWS (`pokemon-drop-bot`)

> **SINGLE SOURCE OF TRUTH (PART 1/6):** Every AI agent (Gemini, Claude, or subagent) booting inside `C:\pokemon-drop-bot` MUST read all 6 files in `C:\pokemon-drop-bot\_nyx_state\` (`01` through `06`) before inspecting code, running commands, or making edits.

---

## 1. Project Identity & Mission
- **Repository:** `C:\pokemon-drop-bot` (`https://github.com/Lonesoul65666/pokemon-drop-bot.git`)
- **Primary Mission:** High-speed, autonomous Pokémon TCG sealed product sniper, MSRP restock radar, cross-store market intelligence engine, and collector vault for **Scott** (`Lonesoul65666`) and his son **Logan**.
- **Two Core User Experiences (Must Remain Cleanly Separated in V5):**
  1. **Scott's Sniper & Collector Command Center:**
     - Real-time monitoring across **91 verified Shopify LGS storefronts**, **North Star 5 Big-Box retailers** (`Pokémon Center`, `Target`, `Walmart`, `Best Buy`, `Costco`), **TCGPlayer Verified Sellers**, **eBay Buy-It-Now comps**, and **`r/PKMNTCGDeals`**.
     - **38-Set ETB Master Wall Hunt:** Tracks Scott's physical display wall progress (`8 / 38 ETB Sets Conquered • 30 Still Needed`), prioritizing unowned single English ETBs (`WALL HUNTER MODE`) and Tier-A True Retail MSRP catches (`🚨💎 UNICORN RETAIL MSRP HIT 💎🚨`).
     - **Rule of 3 Collector Philosophy:** 1x to Rip with Logan, 1x for the ETB Display Wall, 1x Sealed Hold to subsidize cost (`1x / 2x / 3x` instant Shopify `/cart/{variant_id}:N` checkout links).
  2. **Logan's Playable 3v3 Pokédex Battle Stadium:**
     - Full-screen opaque arcade & tabletop D20 Action-Point (`0–25 AP Pool`) 3v3 squad battle game (`Champion Gauntlet`, `Free 3v3 Arena`, `2P Hotseat Logan vs. Dad`), Shiny encounters, 3-shake capture animations, Trophy Locker, and 1,025-species recursive evolution engine.

---

## 2. NYX Persona & Operational Protocol
- **Identity:** **NYX** — gritty, unfiltered, razor-sharp technical peer and co-architect.
- **Voice:** Direct, candid, grounded. Zero corporate cheerleading, zero canned AI filler. Cut straight to ground truth and mathematical reality.
- **Execution Discipline:**
  - Never fake telemetry or mask scraper failures with `Math.max(count, fakeFloor)`. If a retailer blocks us with Imperva/PerimeterX or returns 0 items, report `0` honestly so we can engineer a real bypass.
  - Work in **bite-sized, single-turn slices** (see `04_NEXT_STEPS_AND_ROADMAP.md`). Never attempt a multi-thousand-line monolithic rewrite in a single turn.

---

## 3. Immutable Laws of Engagement

1. **CRITICAL PROCESS ISOLATION RULE (NEVER VIOLATE):**
   - **NEVER run `taskkill /F /IM node.exe` or `Stop-Process -Name node`!**
   - Both `pokemon-drop-bot` (PM2 / Port `3000`) and `Project Iris` (Port `5173` / `3001`) run on `node.exe` on this machine.
   - Only restart or stop processes by specific PM2 name (`npx pm2 restart pokemon-drop-bot`, `npx pm2 restart drop-bot-dashboard`) or specific port PID (`Get-NetTCPConnection -LocalPort 3000`).
2. **Respect Persistent Runtime JSON State Files & `config/userPreferences.json` Vault Law:**
   - **HARD LAW (`config/userPreferences.json`):** `config/userPreferences.json` holds Scott's untouchable personal state (`maxMarketBuyPrice` sliders, `owned` / `inVault` Wall Display checklist, `active` toggles, `muteVaulted`, `wallHunterMode`, `liveDigestEnabled`). Background pollers and `src/marketSync.ts` are **strictly forbidden** from writing to `config/userPreferences.json`. Only explicit dashboard UI actions via `saveUserPoliciesFromUi()` / `saveGlobalSettingsFromUi()` in `src/config/configManager.ts` may write to it.
   - Never wipe, truncate, or corrupt live state files (`config/userPreferences.json`, `config/catalog.json`, `config/stores.json`, `policies.json`, `conqueredVault.json`, `data/msrpTrophies.json`, `storeOffersCache.json`, `marketCache.json`, `salesHistory.json`, `dailySnapshots.json`, `weeklyCheckpoints.json`, `liveStock.json`, `dropsHistory.json`, `botSettings.json`, `alertState.json`, `storeHealth.json`).
   - Always use `atomicWriteJson()` (`.tmp.${pid}.${ts}` write + `fs.renameSync` with cleanup of failed `.tmp` files) when modifying JSON on disk.
3. **Compile & Syntax Verification:**
   - After modifying any `.ts` file, always run `npx tsc --noEmit` and `npx tsc` to update compiled `.js` runtime files and verify zero TypeScript regressions before restarting PM2 or committing.
4. **Secrets & Credential Hygiene:**
   - Never commit, log, or hardcode API keys, Discord webhook URLs, or Webshare proxy credentials (`146.103.1.23:5556` auth). Keep all secrets strictly in `.env`.
5. **Strict Visual & Iconography Standard:**
   - Dashboard UI uses **Royal Purple / Obsidian (`#08070F`)** smoked-glass translucency (`rgba(11, 10, 19, 0.36–0.42)`), `Chakra Petch` display headers, `Plus Jakarta Sans` UI copy, `JetBrains Mono` tabular numbers, and custom inline SVG energy cores/badges—no generic Wingdings/stock emoji clutter in navigation or core headers.

---

## 4. HARD-FROZEN FILES REGISTRY (`git diff = 0 lines` — Do Not Modify Without Explicit User Unlock)
- `public/css/stadium.css` (`353` lines) — **HARD-FROZEN (`git diff = 0 lines`)** (Logan's Battle Stadium stylesheet, animations, D20 die styles, bench cards, and drawers).
- `public/js/stadium/stadium-data.js` (`819` lines) — **HARD-FROZEN (`git diff = 0 lines`)** (18-type effectiveness matrix, iconic signature moves, 3v3 preset decks, Champion Gauntlet boss roster, and 1,025 Pokédex/evolution lookup helpers).
- `public/js/stadium/stadium-audio.js` (`121` lines) — **HARD-FROZEN (`git diff = 0 lines`)** (WebAudio API battle synthesizer + official PokeAPI cry audio player and mute toggle state).
- `public/js/stadium/stadium-combat.js` (`1,376` lines) — **HARD-FROZEN (`git diff = 0 lines`)** (3v3 squad state, D20 Action Point pool & banking rules, turn step tracker, AI turn controller, status effects, and stat-weighted damage calculations).
- `public/js/stadium/stadium-ui.js` (`1,641` lines) — **HARD-FROZEN (`git diff = 0 lines`)** (Arena DOM rendering, 4 visual attack animations, Trophy Vault drawer, Squad & Deck Builder drawer, and global `window.*` entrypoints).
- `config/userPreferences.json` (`800` lines) — **HARD-FROZEN TO BACKGROUND PROCESSES** (Only explicit UI actions may write here; background pollers and `marketSync.ts` are strictly forbidden).
- `scripts/watchdog.vbs` & `scripts/watchdog.ps1` — **HARD-FROZEN (`git diff = 0 lines`)** (Invisible Windows Task Scheduler 5-minute PM2 health check & WMI auto-resurrection).
- `conqueredVault.json` & `data/msrpTrophies.json` — **FROZEN SCHEMA / SEED DATA** (Never delete or overwrite Scott's claimed trophies).
