# pokemon-drop-bot — Architecture & Operational State

## Current Architecture Status (Phase 1 + Core 3 + Scalability Hardening + Wave 1 Store Onboarding)

### 1. Proxy, Concurrency & Wave 1 Store Network (`lgsPoller.ts`)
- **Verified USD Shopify Store Network**: 31 active US Shopify LGS stores (14 retained core stores + 17 Wave 1 onboarded stores), strictly validated for HTTP 200 `/products.json` feeds, USD currency (`Shopify.currency.active === "USD"`), US storefront origin (excluding `.ca`/`.uk`/`.au` and CAD/AUD stores), and English Pokémon TCG sealed inventory.
- **Gateway Routing**: Smart direct-first HTTP requests with automatic fallback to `WEBSHARE_PROXY_URL` (`HttpsProxyAgent`) on 403/429/network errors across `lgsPoller.ts`, `vampirePoller.ts`, `marketComps.ts`, and `src/marketSync.ts`.
- **Bounded Concurrency & Cycle Mutex**: `isPolling` cycle overlap guards prevent overlapping poll loops in `lgsPoller.ts` and `vampirePoller.ts`. Store polling uses an 8-worker bounded pool (`MAX_CONCURRENT_STORES = 8`) with `8000ms` request timeouts.
- **Per-Store Circuit Breaker**: Tracks consecutive store failures in `storeHealth.json` (exposed at `GET /api/store-health`). 3 consecutive failures (`403`/`404`/timeout) trigger a 15-minute cooldown backoff.

### 2. SKU Validation & Landed-Cost Evaluation (`policies.ts` & `evaluator.ts`)
- **Strict SKU & Form-Factor Guard**: Shared `isValidSkuForFormFactor()` blocks 18-pack half booster boxes, bundles, blisters, Battle Stadiums, and foreign language sets (JP/KR/CN/ES/FR/DE) from matching 36-pack English Booster Box and Master Case targets.
- **Hard Minimum Plausible Price Floors**: Enforced across both incoming drop matchers and live market comp scrapers (`Booster Box >= $95`, `ETB >= $32`, `Booster Bundle >= $18`, `ETB Case >= $450`, `Master Case >= $550`).
- **True Landed-Cost & Free-Ship Multiplier Math**: Uses `STORE_SHIPPING_RULES` (`getStoreShippingProfile()`) to compute `landedPrice = dropPrice + estimatedShipping` per store (`$0` shipping if `>= freeShipThreshold` or free-shipping flag, else store flat shipping). If `dropPrice <= maxBuy` but `landedPrice > maxBuy`, computes `qtyForFreeShip = Math.ceil(freeShipThreshold / dropPrice)` (up to `4x`) and attaches a multi-unit free-shipping note.
- **Pre-Order Isolation & Era Caps**: Detects pre-orders (`⏳ PRE-ORDER`) and enforces a strict ceiling of `Math.min(maxBuy, Math.round(msrp * 1.05))`. Low-sample (`< 5` comps) and `me-*` era targets clamp synced market baselines to `<= 1.35x` policy baseline (`$110` cap on `me-*` standard ETBs).

### 3. Checkout Acceleration, Digest & Discord Rate-Limit Queue (`notifier.ts` & `server.js`)
- **Shopify Instant-Cart Permalinks**: Generates `⚡ Instant Cart (1x)` (`/cart/{variant_id}:1`) and `⚡ Instant Cart (2x)` (`/cart/{variant_id}:2`) links alongside product URLs in Discord embeds and Dashboard cards.
- **4-Hour Live Shelf Digest**: Scheduled every 4 hours (skipping 12:00 AM–7:00 AM local quiet hours and empty shelves) plus on-demand via `POST /api/send-digest` (`📲 Send Digest to Discord`), grouping top deals into `🎯 NEEDED FOR VAULT` and `🔒 IN VAULT / CREW DEALS` with 4-hour OOS tracking.
- **Discord FIFO Webhook Queue**: All Discord webhook POST/PATCH requests route through `enqueueDiscordWebhook()` with `1250ms` minimum spacing and automatic HTTP `429` `retry_after` backoff.
- **Atomic Persistence**: All JSON state files (`liveStock.json`, `marketCache.json`, `policies.json`, `storeHealth.json`, `alertState.json`, `dropsHistory.json`) use `atomicWriteJson()` (`.tmp` write + `fs.renameSync`).
