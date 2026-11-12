# 08 — BARE-METAL LIVE ENGINE DIAGNOSTIC & FORENSIC AUTOPSY (`pokemon-drop-bot`)

> **Generated:** `2026-11-11 11:05 CST`  
> **Mode:** **STRICT READ-ONLY LIVE WIRE DIAGNOSTIC** (`0` mocks, `0` source/config/HTML mutations, `git diff = 0 lines` on all tracked files).  
> **Scope:** Live network/TLS/Playwright probes across all `9` Big-Box sensors (including DOM node counts vs. false-green detection), full `90`-store LGS + `25`-store Fast-Tier-1 runtime/log autopsy, row-by-row `storeOffersCache.json` (`665` offers) evaluator gate trace, and Engine Room red `(X)` / icon mismatch root-cause trace.

---

## Executive Ground-Truth Scorecard

| Subsystem | Dashboard Claim | Bare-Metal Reality | Primary Failure Modes Uncovered |
| :--- | :--- | :--- | :--- |
| **Big-Box Fleet (`9` Sensors)** | `9 / 9 ARMED` (`5x` `200 OK // 0 IN STOCK`, `4x` `WAF_CHALLENGE_*`) | **`1 / 9` Truly Healthy (`Barnes & Noble`)**<br>`3 / 9` False Greens (`Costco`, `GameStop`, `Amazon`)<br>`5 / 9` WAF/TLS/Tarpit Blocked (`PC`, `Target`, `Walmart`, `Best Buy`, `Sam's Club`) | **Costco** is an empty `2.51 MB` Next.js CSR shell (`0` product nodes); **GameStop** has `20` live search tiles (`4` in-stock ETBs) missed because `String(obj.availability)` -> `"[object Object]"`; **Amazon** truncates cards at `4,500 B` before byte `7,043` price & grabs `<h2>Pokémon</h2>`; **PC** hits local `ERR_CERT_AUTHORITY_INVALID` on Direct IP then Imperva `B10` on Webshare proxy; **Best Buy** hangs on Akamai HTTP/1.1 tarpit (`ERR_CANCELED`). |
| **Shopify LGS Fleet (`90` Enabled)** | `83–86 / 90 ARMED`, `0` zero-catalog stores (`145` min shown) | **`65` `HEALTHY` / `18` `DEGRADED` / `7` `CIRCUIT_OPEN`** (`25` stores actively failing `HTTP 429` + `4` hitting `22,000ms` watchdog timeouts) | Dual-poller self-DDoS (`fastTier1Poller` + 4-page `lgsPoller` both hitting Direct Home IP first -> `137 / 150` error lines are `HTTP 429`); `Squirtle Squad` dead `4.96 days` (`48` consecutive `429`s); `pokemon-drop-bot-out-0.log` bloated to **`588.0 MB`**; `server.js:2140` still fakes `catalogScanned: 145` when `0`. |
| **15s Tier-1 & 60s LGS Loops** | `15s` Fast Delta / `60s` Full Sweep | **Fast-Tier-1:** `20.19s` sweep + `15s` sleep = **`~35.8s` cycle** (`83.3%` `304` on responsive)<br>**Full LGS:** **`71s–75s` cycle** (`0%` `304` support) | `7 / 25` Tier-1 stores fail/throttle per cycle, dragging `fastTier1Poller` duration to `20,192ms`; `lgsPoller.ts` never sends `If-None-Match` (`ETag`), re-downloading `30,322` listings every `~73s`. |
| **Deal Evaluator & Trigger Brain** | Honors manual `maxMarketBuyPrice` sliders on `0/3` unowned SKUs | **Mathematically deadlocked (`Zeno's Paradox`) on every `isBleedingDown` SKU (`autoPilotEnabled: true` default)** | `evaluator.ts:1497` passes `lowestShelfPrice: dropPrice` into `trendAdvisor.ts:220–221`, setting `autoPilotCeiling = Math.round(dropPrice * 0.92)` — **moving the goalpost `8%` below whatever price the store charges!** Actively blocking unowned `Destined Rivals ETB @ $109.99` (`$111` slider) right now. |
| **Engine Room Icons & Badges** | Unified sensor status | **3-Way Visual Contradiction** (Red `(X)` hex left vs. Amber/Emerald badge right vs. `9/9 ARMED` header) | `server.js:2045–2049` assigns `SLEEPING_CORE` (amber warning) to every `200 OK // 0 IN STOCK` row (`itemsParsed === 0`), assigns `SHIELD_BLOCKED` red `(X)` to WAF rows while `index.html:5518` colors WAF text amber, and `server.js:2166` hard-adds `+ northStar5.length` (`9`) to `healthySensors`. |

---

## 1. Live Wire Probe Across All 9 Big-Box Sensors (100% Live Network, Zero Mocks)

### 1.0 Master Live-Wire & False-Green Verification Matrix

| # | Sensor | Request URL Probed | Transport Executed | Latency (`ms`) | HTTP Status | Key Anti-Bot / Server Headers | Total Product Nodes on Page (incl. OOS) | Adapter In-Stock Hits | Forensic Verdict |
| :-: | :--- | :--- | :--- | :---: | :---: | :--- | :---: | :---: | :--- |
| 1 | **Pokémon Center** | `https://www.pokemoncenter.com/en-us/category/elite-trainer-box` | Playwright `chrome-headless-new` (Direct -> Webshare Proxy) | Direct: `3,547ms`<br>Proxy: `2,651ms` | Direct: `ERR_CERT`<br>Proxy: `200` (`6,031 B`) | `x-iinfo: 62-103361259-0 ... B10(14,0,0) U24`, `content-type: text/html` | **`0`** (`0` `/product/` links, `0` OOS badges) | `0` | **GENUINE WAF + LOCAL TLS INTERCEPT (`WAF_CHALLENGE_IMPERVA`)** |
| 2 | **Target (RedSky)** | `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?key=9f36aeaf...&keyword=pokemon%20prismatic%20evolutions&pricing_store_id=3991&zip=76177&visitor_id=0192B...` | `axios` Direct -> Webshare Proxy *(+ tested w/ `Origin`, `Referer`, `Sec-Fetch-*` & Playwright)* | Direct: `153ms` (`132ms`)<br>Proxy: `786ms` (`652ms`) | Direct: `435`<br>Proxy: `435` (`343 B`) | `set-cookie: _pxhd`, `via: 1.1 varnish`, `x-cache: MISS`, `content-type: application/json` | **`0`** (JSON PerimeterX challenge) | `0` | **GENUINE PERIMETERX TLS/COOKIE BLOCK (`WAF_CHALLENGE_PX`)** |
| 3 | **Walmart (1P MSRP)** | `https://www.walmart.com/search?q=pokemon+elite+trainer+box+booster+bundle&facet=retailer_type%3AWalmart` | `axios` Direct -> Webshare Proxy | Direct: `256ms`<br>Proxy: `764ms` | Direct: `412`<br>Proxy: `412` (`361 B`) *(sporadic `200` on unburned proxy IP)* | `set-cookie: _pxhd, akavpau_p2, TS012768cf`, `content-type: application/json` | **`0`** on `412` (`hasNextData: false`) | `0` | **GENUINE PERIMETERX `412` BLOCK (`PXu6b0qd2S`) — INTERMITTENT ON PROXY** |
| 4 | **Best Buy** | `https://www.bestbuy.com/site/searchpage.jsp?st=pokemon+elite+trainer+box+booster+bundle&id=pcat17071` | `axios` Direct -> Webshare Proxy (`6s` live / `12s` probe cap) | Direct: `12,016ms`<br>Proxy: `12,010ms` | `0` (`ERR_CANCELED` timeout) | None (Akamai stalls TCP stream before HTTP status line) | **`0`** (`0 B` body) | `0` | **AKAMAI HTTP/1.1 TARPIT + MISLABELED `WAF_CHALLENGE_IMPERVA`** |
| 5 | **Costco Wholesale** | `https://www.costco.com/CatalogSearch?dept=All&keyword=pokemon+cards` | `axios` Direct | Direct: `222ms` | **`200 OK`** (`2,508,957 B`) | `set-cookie: client-zip-short, C_LOC, BCO, f_as`, `content-type: text/html` | **`0` (`0` JSON-LD, `0` GTM, `0` `.product.html`, `0` tiles)** | `0` | **100% FALSE GREEN (`200 OK // 0 IN STOCK` ON EMPTY NEXT.JS CSR SHELL)** |
| 6 | **Sam's Club** | `https://www.samsclub.com/s/pokemon%20cards` | `axios` Direct -> Webshare Proxy | Direct: `392ms`<br>Proxy: `1,441ms` | Direct: `412`<br>Proxy: `412` (`367 B`) | `set-cookie: akavpau_spa, WCP_IDENTITY, TSbdf847b3027`, `content-type: application/json` | **`0`** (`hasNextData: false`) | `0` | **GENUINE PERIMETERX `412` (`PXsLC3j22K`) MISLABELED AS `IMPERVA`** |
| 7 | **GameStop** | `https://www.gamestop.com/search/?q=pokemon+elite+trainer+box&type=Primary&sort=BestMatch_Desc&p=1` | Playwright `chrome-headless-new` Direct | Direct: `2,789ms` | **`200 OK`** (`242,855 B`) | `server: cloudflare`, `cf-ray: a58ed851faf62d2f-DFW`, `cf-cache-status: DYNAMIC` | **`20` `.product-tile` / `data-gtmdata` cards (`4` LIVE `available: true` ETBs!)** | **`0`** | **100% FALSE GREEN — SELF-INFLICTED `String(obj.availability)` BUG** |
| 8 | **Amazon (1P `ATVPDKIKX0DER`)** | `https://www.amazon.com/s?k=pokemon+elite+trainer+box+booster+bundle&rh=p_6%3AATVPDKIKX0DER&s=date-desc-rank` | `axios` Direct -> Webshare Proxy | Direct: `882ms` | **`200 OK`** (`654,072 B`) *(trips `503` on rapid bursts)* | `server: Server`, `x-cache: Miss from cloudfront`, `via: 1.1 ...cloudfront.net`, `set-cookie: session-id` | **`5–8` `data-asin` cards** (incl. `B0H78BB9TY` *30th ETB* OOS & `B0H2JVZYZZ` `$29.99` InStock) | **`0`** | **FALSE GREEN — 3 SELF-INFLICTED REGEX BUGS IN `parseAmazon1pPayload`** |
| 9 | **Barnes & Noble** | `https://www.barnesandnoble.com/search?q=pokemon+trading+card+game` | Playwright `chrome-headless-new` Direct (`+1500ms` hydration) | Direct: `2,734ms` | **`200 OK`** (`1,804,517 B`) | `server: cloudflare`, `powered-by: Shopify, Oxygen, Hydrogen`, `cf-ray: a58ed860fa7f9b31-DFW` | **`33` unique product cards (`48–58` `/w/...?ean=` links, `3` OOS labels)** | `0` | **100% TRUE GREEN (`33` REAL CARDS PARSED, `0` IN-STOCK ETBs)** |

---

### 1.1 Per-Sensor Raw Wire Evidence & Root-Cause Autopsy

#### 1. Pokémon Center (`WAF_CHALLENGE_IMPERVA`)
- **Direct Home IP (`Playwright chrome-headless-new`):** Failed in `3,547ms` before reaching Imperva:
  ```text
  ERROR: page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://www.pokemoncenter.com/en-us/category/elite-trainer-box
  ```
  - **Why:** Either ISP/router DNS-TLS filtering (e.g., Spectrum Security Shield / router MITM page) is intercepting `www.pokemoncenter.com` on the local LAN OR `playwright.chromium.launch` in `src/pollers/wafBrowserBridge.ts:154` lacks `ignoreHTTPSErrors: true` on `newContext()`.
- **Webshare Proxy Fallback (`Playwright chrome-headless-new`):** Returned `HTTP 200` (`2,651ms`, `x-iinfo: 62-103361259-0 ENNN RT(1794416338222 629) q(0 -1 -1 1) r(0 -1) B10(14,0,0) U24`, `6,031` bytes):
  ```html
  <!DOCTYPE html><html><head> <noscript> <title>Pardon Our Interruption</title> </noscript> <meta name="viewport" content="width=device-width, initial-scale=1"> <meta name="robots" content="noindex, nofollow"> <meta http-equiv="cache-control" content="no-cache, no-store, must-revalidate">
  ```
  - **Diagnosis:** Genuine Imperva Incapsula `B10` datacenter IP block against Webshare's `146.103.1.23` subnet. Until Direct Home IP's `ERR_CERT_AUTHORITY_INVALID` cause is resolved (or a residential proxy is used), Pokémon Center falls back to Webshare every 160s and hits Imperva's interstitial (`0` product nodes).

#### 2. Target RedSky (`WAF_CHALLENGE_PX` — `HTTP 435`)
- **Tested Both Standard `BROWSER_HEADERS` (`153ms` Direct / `786ms` Proxy) AND Full Same-Origin Headers (`Origin: https://www.target.com`, `Referer: https://www.target.com/s?searchTerm=...`, `Sec-Fetch-Site: same-site`, `Sec-Fetch-Mode: cors` -> `132ms` Direct / `652ms` Proxy):** Both returned **`HTTP 435`** (`343` bytes):
  ```json
  {"appId":"PXGWPp4wUS","blockScript":"https://captcha.px-cdn.net/PXGWPp4wUS/captcha.js?a=c&u=d4138a36-ddf0-11f1-8dd2-afa13228f1b6&v=&m=0","firstPartyEnabled":false,"hostUrl":"https://collector-PXGWPp4wUS.perimeterx.net","jsClientSrc":"https://client.perimeterx.net/PXGWPp4wUS/main.min.js","uuid":"d4138a36-ddf0-11f1-8dd2-afa13228f1b6","vid":""}
  ```
- **Tested Playwright Same-Origin `page.evaluate(() => fetch(redskyUrl))` from `https://www.target.com/p/-/A-93954435`:** PerimeterX's `client.px-cloud.net/PXGWPp4wUS/main.min.js` monkey-patches `window.fetch` and aborted the un-warmed call (`TypeError: Failed to fetch at II.hw.<computed> (client.px-cloud.net/PXGWPp4wUS/main.min.js:2:230036)`).
- **Diagnosis:** **100% genuine PerimeterX (`PXGWPp4wUS`) enforcement** requiring a valid solved `_px3` / `_pxhd` telemetry cookie (`vid` non-empty) + browser TLS fingerprint. Not a missing query parameter or `Sec-Fetch` header bug. Note: Instead of calling `fetch()` manually, intercepting Target's *own* automatic RedSky XHR response via `page.waitForResponse(r => r.url().includes('redsky_aggregations'))` during normal PDP/PLP navigation in Playwright avoids manual `fetch` monkey-patch rejection.

#### 3. Walmart 1P (`HTTP 412` PerimeterX — Intermittent `200 OK` on Rotating Proxy)
- **Raw `412` Payload (`256ms` Direct / `764ms` Proxy, `361` bytes):**
  ```json
  {"redirectUrl":"/blocked?url=Lw==&uuid=d420917a-ddf0-11f1-b461-79225717725e&vid=&g=b","appId":"PXu6b0qd2S","jsClientSrc":"/px/PXu6b0qd2S/init.js","firstPartyEnabled":true,"vid":"","uuid":"d420917a-ddf0-11f1-b461-79225717725e","hostUrl":"/px/PXu6b0qd2S/xhr","blockScript":"/px/PXu6b0qd2S/captcha/captcha.js?a=c&m=0&u=d420917a-ddf0-11f1-b461-79225717725e&v=&g=b"}
  ```
- **Diagnosis:** Genuine PerimeterX (`PXu6b0qd2S`) block on raw `axios` (`vid: ""`). `storeHealth.json` occasionally records `200 OK // 0 IN STOCK` when Webshare rotates onto a fresh IP, but >80% of sweeps bounce off `HTTP 412`.

#### 4. Best Buy (`ERR_CANCELED` Socket Timeout -> Mislabeled `WAF_CHALLENGE_IMPERVA`)
- **Raw Wire Behavior:** Both Direct (`12,016ms`) and Webshare Proxy (`12,010ms`) hung with `0` bytes received until `AbortController` canceled the request (`ERROR: ERR_CANCELED canceled`).
- **Diagnosis:** **Two-part failure:** (1) `www.bestbuy.com` sits behind **Akamai Bot Manager**, which tarpit-stalls HTTP/1.1 Node TLS JA3 connections indefinitely rather than returning `403`. (2) `src/pollers/bigBoxRetailPoller.ts:222–223` catches the timeout exception and hardcodes `'IMPERVA'` (`WAF_CHALLENGE_IMPERVA`). Routing Best Buy through Playwright HTTP/2 (`chrome-headless-new`) OR Best Buy's official `api.bestbuy.com/v1/products` JSON endpoint eliminates the Akamai HTTP/1.1 tarpit.

#### 5. Costco Wholesale (**100% FALSE GREEN** — `200 OK // 0 IN STOCK` on Empty CSR Shell)
- **Raw Wire Behavior:** `axios` Direct returned `HTTP 200 OK` in `222ms` (`2,508,957` bytes, `<title>Search | Costco</title>`):
  ```html
  <!DOCTYPE html><html lang="en-us"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="stylesheet" href="/consumer-web/search/prd/catalog-usbc/_next/static/css/eb248990deb054f8.css" data-precedence="next"/>
  ```
- **False-Green Proof:**
  - `ldJsonScriptCount`: **`0`**
  - `gtmAttrCount`: **`0`**
  - `dotProductLinks` (`.product.html`): **`0`**
  - `productTileDomNodes`: **`0`**
- **Diagnosis:** Costco's `/CatalogSearch` is now a pure client-side Next.js shell (`/consumer-web/search/prd/catalog-usbc/_next/`) that fetches search results asynchronously via XHR (`ecom.costco.com` / search API) after JS hydration. `parseCostcoPayload()` (`src/pollers/bigBoxAdapters.ts:268`) scans `2.51 MB` of empty layout scaffolding, finds `0` elements, and `buildSensorNode()` falsely stamps `200 OK // 0 IN STOCK`. If Costco drops Blooming Waters or Prismatic Mini-Tin 5-packs right now, **this sensor is 100% blind.**

#### 6. Sam's Club (`HTTP 412` PerimeterX Mislabeled as `WAF_CHALLENGE_IMPERVA`)
- **Raw `412` Payload (`392ms` Direct / `1,441ms` Proxy, `367` bytes):**
  ```json
  {"redirectUrl":"/are-you-human?url=Lw==&uuid=d43b99ab-ddf0-11f1-aece-c7e80abf4cf1&vid=&g=b","appId":"PXsLC3j22K","jsClientSrc":"/px/PXsLC3j22K/init.js","firstPartyEnabled":true,"vid":"","uuid":"d43b99ab-ddf0-11f1-aece-c7e80abf4cf1","hostUrl":"/px/PXsLC3j22K/xhr","blockScript":"/px/PXsLC3j22K/captcha/captcha.js?a=c&m=0&u=d43b99ab-ddf0-11f1-aece-c7e80abf4cf1&v=&g=b"}
  ```
- **Diagnosis:** Genuine **PerimeterX (`PXsLC3j22K`)** block (Walmart/Sam's shared WCP stack). Mislabeled `WAF_CHALLENGE_IMPERVA` in `src/pollers/bigBoxRetailPoller.ts:215–217` because `isPx` only checks `res.status === 435 || /px-captcha|Robot or human\?/i` and misses `status === 412` + `/are-you-human|PXsLC3j22K/i`.

#### 7. GameStop (**100% FALSE GREEN** — Self-Inflicted `String(obj.availability)` Bug on Live Stock)
- **Raw Wire Behavior:** Playwright `chrome-headless-new` bypassed Cloudflare (`cf-ray: a58ed851faf62d2f-DFW`) cleanly on Direct IP in `2,789ms` (`HTTP 200 OK`, `242,855` bytes, redirected to `/search-new/?p=1&sort=BestMatch_Desc&type=Primary&q=pokemon%20elite%20trainer%20box`).
- **False-Green Proof (DOM Node Count vs. Parser Output):**
  - `totalProductTilesOnPage`: **`20` product cards**
  - `totalDataGtmNodes`: **`20` `data-gtmdata` JSON payloads**
  - `ldJsonScriptsOnSearchPage`: **`0`**
  - **Live Shippable ETBs Present in GameStop's HTML Right Now (`readyToOrder: true, available: true`):**
    1. `450739` — *Pokemon Trading Card Game: Delta Reign Elite Trainer Box* @ **`$99.99`** (`availObj: { readyToOrder: true, available: true }`)
    2. `443858` — *Pokemon Trading Card Game: Chaos Rising Elite Trainer Box* @ **`$89.99`** (`availObj: { readyToOrder: true, available: true }`)
    3. `445744` — *Pokemon Trading Card Game: Pitch Black Elite Trainer Box* @ **`$89.99`** (`availObj: { readyToOrder: true, available: true }`)
    4. `438990` — *Pokemon Trading Card Game: Perfect Order Elite Trainer Box* @ **`$84.99`** (`availObj: { readyToOrder: true, available: true }`)
  - `adapterInStockHits`: **`0`**
- **Exact Code Bug (`src/pollers/bigBoxAdapters.ts:231–233`):**
  ```ts
  const obj = JSON.parse(cleanHtmlText(g[1]));
  const avail = String(obj?.availability || obj?.productInfo?.availability || '');
  if (!/^(in\s*stock|available|pre-?order)$/i.test(avail)) continue;
  ```
  GameStop's `data-gtmdata.availability` is a **nested object** (`{ readyToOrder: true, available: true }`), NOT a string! `String(obj?.availability)` evaluates to `"[object Object]"`, failing `/^(in\s*stock|available|pre-?order)$/i` 100% of the time! *(Note: those 4 current GameStop ETBs are priced at `$84.99–$99.99`, so `resolveBigBoxPolicyMatch`'s `<= msrpCeiling * 1.08` 1P MSRP filter would properly filter out their scalped prices anyway—but if GameStop lists a `$54.99` MSRP pre-order or `$26.99` Booster Bundle today, `parseGameStopPayload` will miss it 100% of the time.)*

#### 8. Amazon 1P `ATVPDKIKX0DER` (**FALSE GREEN** — 3 Self-Inflicted Regex Bugs + Rapid-Poll `503`)
- **Raw Wire Behavior:** `axios` Direct returned `HTTP 200 OK` in `882ms` (`654,072` bytes, CloudFront) with **`5–8` `data-asin` blocks** (including `B0H78BB9TY` *Pokémon TCG: 30th Celebration Elite Trainer Box* [OOS, `$59.99` ref] and `B0H2JVZYZZ` *Pokémon TCG: First Partner Illustration Collection—Series 3* [`$29.99`, **In Stock**, `Ships from and sold by Amazon.com`]).
- **Exact Self-Inflicted Parser Bugs (`src/pollers/bigBoxAdapters.ts:171–194`):**
  1. **`4,500`-Byte Card Truncation + Nested `data-asin` Split (`line 171`):** Amazon's 2026 search cards are `9,406–15,399` bytes long, with `<span class="a-offscreen">$59.99</span>` sitting at byte **`7,043–11,804`**—beyond `[\s\S]{0,4500}?`! Worse, Amazon's inline Add-to-Cart widget inside the card is *itself* `<div data-asin="B0H2JVZYZZ" ...>`, so the lookahead `(?=<div[^>]+data-asin=|$)` slices the outer card off right before its own ATC button (`price: null` on half, `title: ""` on the ATC half).
  2. **Brand `<h2>Pokémon</h2>` Matched Instead of Product Title (`line 178`):** Amazon renders *two* `<h2>` tags per card: first `<h2><span>Pokémon</span></h2>` (7-char brand header), then `<h2 aria-label="Pokémon TCG: ...">` (actual product title). `block.match(/<h2[^>]*>([\s\S]{5,260}?)<\/h2>/i)` captures `"Pokémon"`, failing every SKU matcher.
  3. **PDP Unscoped `a-offscreen` Matches `$00` Before BuyBox Price (`line 193`):** On `/dp/B0H2JVZYZZ?smid=ATVPDKIKX0DER`, hidden shipping/installment `a-offscreen` spans precede `#corePrice_feature_div`, yielding `"00"` instead of the BuyBox price.
  4. **Cookie-less `axios` Burst Sensitivity:** Firing un-cookied `axios` hits every `45s` intermittently trips Amazon's `503` / `validateCaptcha` gate (`WAF_CHALLENGE_BOT_CHECK`).

#### 9. Barnes & Noble (**100% TRUE GREEN** — Verified Selector Alignment)
- **Raw Wire Behavior:** Playwright `chrome-headless-new` (`navigator.webdriver = false` + native Chrome `156.0.0.0` UA + `1,500ms` Hydrogen hydration wait) returned `HTTP 200 OK` in `2,734ms` (`1,804,517` bytes, `powered-by: Shopify, Oxygen, Hydrogen`).
- **DOM Verification:** Found **`48–58` `/w/...?ean=\d{13}` links** across **`33` unique product cards** (e.g., `/w/pokemon-battle-academy-board-game-pokemon/1137733945?ean=0820650856952`), `3` explicit `"Out of Stock"` labels, and `0` `"Quick Add"` / `"Add to Bag"` buttons on tracked sealed ETBs/Bundles. *(Important note: without `navigator.webdriver = false` stealth init script, B&N returns `0` `/w/` links—proving `wafBrowserBridge.ts` stealth evasions are actively doing real work here.)*

---

## 2. LGS Fleet (`90` Enabled + `1` Disabled) & Fast-Tier-1 Loop Audit

### 2.1 Fleet Health Summary & Fake Telemetry Mask
- **Configured Stores (`config/stores.json`):** `91` total Shopify LGS entries (`90` `enabled: true`, `1` disabled dead 404 store: `Lets Play TCG`).
- **True `storeHealth.json` Status Breakdown (`90` Active Stores):**
  - **`65` `HEALTHY`** (`72.2%`)
  - **`18` `DEGRADED`** (`20.0%` — `1` to `6` consecutive `HTTP 429` failures)
  - **`7` `CIRCUIT_OPEN`** (`7.8%` — `8` to `48` consecutive `HTTP 429` failures; locked in 15-minute cooldown blackout)
  - **`0` `zeroCatalogCnt`** in `storeHealth.json` right now *only* because `lastProductsCount` retains the old count from prior successful sweeps across `429` errors.
- **Residual Fake Fallback Bug in `server.js:2140 & 2151`:**
  - `server.js:2140`: `catalogScanned: catalogScanned > 0 ? catalogScanned : 145` — any store returning `0` catalog items is still falsely masked as `145` items in `/api/engine-room`!
  - `server.js:2151`: `latencyMs: Number(health.lastLatencyMs || (180 + ((idx * 37) % 340)))` — fabricates deterministic fake latencies (`180–520ms`) whenever `lastLatencyMs` is missing/zero.

### 2.2 Complete List of All 25 `DEGRADED` / `CIRCUIT_OPEN` LGS Stores (`storeHealth.json`)

Every single degraded or circuit-open store in the fleet is failing with **`HTTP 429` (Cloudflare / Shopify Rate Limit)**:

| # | Store Name | Tier | Live State | Consec. Fails | Error | Cached Catalog | Last Success Ago | Failing Endpoint URL |
| :-: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| 1 | **Squirtle Squad Card Shop** | Tier 2 | `CIRCUIT_OPEN` | **`48`** | `HTTP 429` | 1,000 | **`428,892s` (`4.96d`)** | `https://squirtlesquadcardshop.com/collections/pokemon/products.json?limit=250` |
| 2 | **401 Games** *(CAD)* | Tier 2 | `CIRCUIT_OPEN` | **`15`** | `HTTP 429` | 1,009 | `7,482s` (`2.08h`) | `https://store.401games.ca/collections/all-pokemon/products.json?limit=250` |
| 3 | **Shinobi Collectibles** | Tier 2 | `CIRCUIT_OPEN` | **`11`** | `HTTP 429` | 860 | `3,547s` (`59.1m`) | `https://shinobicollectibles.com/collections/pokemon/products.json?limit=250` |
| 4 | **The Gaming Goat** | Tier 2 | `CIRCUIT_OPEN` | **`10`** | `HTTP 429` | 476 | `2,830s` (`47.2m`) | `https://tgg-games.com/collections/pokemon/products.json?limit=250` |
| 5 | **Tistaminis** *(CAD)* | Tier 2 | `CIRCUIT_OPEN` | **`9`** | `HTTP 429` | 1,000 | `2,261s` (`37.7m`) | `https://tistaminis.com/products.json?limit=250` |
| 6 | **iPokeTCG** | Tier 2 | `CIRCUIT_OPEN` | **`8`** | `HTTP 429` | 63 | `955s` (`15.9m`) | `https://ipoketcg.com/products.json?limit=250` |
| 7 | **Top Shop Collectibles** | Tier 2 | `CIRCUIT_OPEN` | **`8`** | `HTTP 429` | 66 | `872s` (`14.5m`) | `https://topshopcollectibles.com/products.json?limit=250` |
| 8 | **Pentix Games** | Tier 2 | `DEGRADED` | `6` | `HTTP 429` | 174 | `505s` | `https://pentixgames.com/collections/pokemon/products.json?limit=250` |
| 9 | **Knight & Day Games** | **Tier 1** | `DEGRADED` | `5` | `HTTP 429` | 476 | `404s` | `https://knightanddaygames.com/collections/pokemon/products.json?limit=250` |
| 10 | **The Poke Court** | Tier 2 | `DEGRADED` | `5` | `HTTP 429` | 267 | `380s` | `https://thepokecourt.com/collections/pokemon-sealed-product/products.json?limit=250` |
| 11 | **Moxie Card Shop** | Tier 2 | `DEGRADED` | `5` | `HTTP 429` | 215 | `441s` | `https://moxiecardshop.com/collections/pokemon-boosters/products.json?limit=250` |
| 12 | **Victory Road Collections** | Tier 2 | `DEGRADED` | `4` | `HTTP 429` | 88 | `362s` | `https://victoryroadcollections.com/collections/sealed-pokemon-collection/products.json?limit=250` |
| 13 | **MissingNo Games** | Tier 2 | `DEGRADED` | `4` | `HTTP 429` | 33 | `360s` | `https://missingnogames.com/collections/elite-trainer-boxes/products.json?limit=250` |
| 14 | **The Awesome Card Shop** | Tier 2 | `DEGRADED` | `3` | `HTTP 429` | 93 | `296s` | `https://theawesomecardshop.com/collections/pokemon/products.json?limit=250` |
| 15 | **PokeGirl CC** | Tier 2 | `DEGRADED` | `3` | `HTTP 429` | 264 | `296s` | `https://pokegirlcc.com/products.json?limit=250` |
| 16 | **Joshs Cards** | **Tier 1** | `DEGRADED` | `2` | `HTTP 429` + `22s` Watchdog | 1,000 | `180s` | `https://joshscards.com/products.json?limit=250` |
| 17 | **Hobbiesville** *(CAD)* | Tier 2 | `DEGRADED` | `2` | `HTTP 429` + `22s` Watchdog | 1,000 | `232s` | `https://hobbiesville.com/products.json?limit=250` |
| 18 | **Poke Unlimited** | Tier 2 | `DEGRADED` | `2` | `HTTP 429` | 563 | `208s` | `https://pokeunlimited.com/products.json?limit=250` |
| 19 | **Puzzled Gamer** | Tier 2 | `DEGRADED` | `2` | `HTTP 429` | 46 | `211s` | `https://puzzledgamer.com/collections/pokemon-tcg/products.json?limit=250` |
| 20 | **Trading Card Market** | **Tier 1** | `DEGRADED` | `1` | `HTTP 429` | 641 | `89s` | `https://tradingcardmarket.com/collections/pokemon/products.json?limit=250` |
| 21 | **Stomping Grounds** | **Tier 1** | `DEGRADED` | `1` | `HTTP 429` | 358 | `93s` | `https://www.stompinggroundstcg.com/collections/pokemon-trading-card-game/products.json?limit=250` |
| 22 | **Forge and Fire** | **Tier 1** | `DEGRADED` | `1` | `HTTP 429` | 1,000 | `136s` | `https://forgenfiregaming.com/products.json?limit=250` |
| 23 | **Rip N Ship Arena** | Tier 2 | `DEGRADED` | `1` | `HTTP 429` | 228 | `100s` | `https://www.ripnshiparena.com/products.json?limit=250` |
| 24 | **Mox Boarding House** | Tier 2 | `DEGRADED` | `1` | `HTTP 429` | 1,000 | `151s` | `https://moxboardinghouse.com/products.json?limit=250` |
| 25 | **Lvl Up Games** *(CAD)* | Tier 2 | `DEGRADED` | `1` | `HTTP 429` | 279 | `127s` | `https://lvlupgames.ca/collections/alpha-asc-pokemon/products.json?limit=250` |

- **Additional Recurrent Blackout / Watchdog Stores in `pokemon-drop-bot-error-0.log`:**
  - **22,000ms Watchdog Aborts (`[LGS Poller] Watchdog aborted hung store ...`):** `Zulus Games` (repeatedly aborting 4-page deep crawls!), `Joshs Cards`, `Hobbiesville`, and `PokeBox USA`.
  - **Rolling 15m Circuit-Breaker Flappers:** `AVA TCG`, `J&J Gaming Factory`, `Over The Brick`, `Safari Zone`, `Kanzen Games`, `Game Grid Lehi`, `Galactic Toys`, `PKMN Colosseum`, `Tabletop Village`, and `The Pokecave`.

### 2.3 Real Sweep Duration, `HTTP 429` Storm & `ETag` `304` Hit Rate
- **Active PM2 Log Footprint (`~/.pm2/logs/`):**
  - `pokemon-drop-bot-out-0.log`: **`588,039,066` bytes (`588.0 MB`!)** — bloated because `evaluator.ts` prints a `console.log("   [SEEN] ...")` line for every rejected Near-Miss across `30,322` listings every `~73s` (`~20 MB/hour` of stdout churn, driving process CPU to `73.5%` and RSS to `445.1 MB`!).
  - `pokemon-drop-bot-error-0.log`: **`1,865,709` bytes (`1.86 MB`)** — **`137` of the last `150` lines (`91.3%`) are `HTTP 429` Circuit Breaker trips**, with the remaining lines being `22,000ms` store watchdog aborts and `Failed to send Discord alert: getaddrinfo ENOTFOUND discord.com`.
- **`fastTier1Poller` (Configured `15,000ms`):**
  - **Actual Sweep Duration:** **`20,192ms` (`20.19s`)** across `25` Tier-1 stores (`18` responded, `7` failed/throttled, `2,295` variants checked, `1,467` cycles run). Because `fastTier1Poller.ts` schedules `setTimeout(..., 15000)` *after* `await sweep()` finishes, **true revisit cadence is `~35.2s` (`20.2s + 15.0s`), NOT `15s`!**
  - **`ETag` `304 Not Modified` Hit Rate:** **`15 / 18` (`83.3%` of responsive stores; `60.0%` of total 25-store Tier-1 pool)**. `ETag` works great when Shopify doesn't `429`, but `7` stores are failing with `429`/proxy retry latency, dragging sweep time to `20.2s`.
- **`lgsPoller` (Configured `~60s`):**
  - **Actual Sweep Duration (from live log timestamps `10:50:41` -> `10:51:52` -> `10:53:07`):** **`71s–75s` per full cycle** (`63–67 / 90` stores responding, `30,109–30,322` listings checked).
  - **`ETag` `304` Hit Rate:** **`0.0%` (`0` `304` hits)** — `lgsPoller.ts` never sends `If-None-Match` headers AND re-crawls up to `4` pages (`?page=1..4&limit=250` = `1,000` products) from Direct Home IP *even on the 25 stores already polled every 15s by `fastTier1Poller`*! That double-polling from Direct Home IP is the #1 cause of the `HTTP 429` storm.

---

## 3. Evaluator, Cooldown & Trigger Gate Trace + Engine Room Icon Autopsy

### 3.1 Row-by-Row Trace: Top 12 Lowest-Priced In-Stock Offers in `storeOffersCache.json` (`665` Total Offers)

| # | Store | SKU (`slots`) | Shelf + Ship = **Landed** | Manual Slider (`MSRP`) | Effective Ceiling | Alerted? (`alertState.json`) | Exact Gate Verdict & Why It Did / Did Not Fire |
| :-: | :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| 1 | `Target [BIG-BOX RESTOCK RADAR]` | `me-30th-celebration-bundle` (`0/3`) | `$32.00 + $0.00 =` **`$32.00`** | `$32.00` (`$32.00`) | `$32.00` | **YES** (`10:10 AM`, `reddit_t3_1xrvq3k`) | **STALE REDDIT GHOST:** Alerted days ago from Reddit RSS; locked in `alertState.json` (`lastPrice: $32`) and **never pruned** from `storeOffersCache.json` because `pruneStoreMissingOffers` only prunes Shopify LGS stores. |
| 2 | `Target (via PKMNTCGDeals)` | `me-delta-reign-etb` (`W/-/-` `1/3`) | `$50.00 + $0.00 =` **`$50.00`** | `$93.00` (`$54.99`) | `$54.99` | **YES** (`04:26 AM`, `reddit_t3_1xp9i22`) | **STALE REDDIT GHOST:** Alerted days ago via `isTierAMsrp` (`$50 <= $59.39`); sits permanently at `#2` in `storeOffersCache.json` despite being long OOS on Target. |
| 3 | `JBs Emporium` | `me-chaos-rising-etb` (`W/D/L` `3/3`) | `$54.99 + $6.99 =` **`$61.98`** | `$54.99` (`$54.99`) | `$54.99` | **YES** (`08:33 AM`, `count: 7`) | **FIRED VIA MSRP UNICORN BYPASS:** Raw `dropPrice` (`$54.99`) `<= $54.99 * 1.08` (`$59.39`) with `ship <= $10` triggered `isMsrpUnicorn = true`, bypassing `3/3` mute (`inDropsHistory: 08:33 AM`), then deduplicated cleanly in `alertState.json`. |
| 4 | `Derium and Wifey` | `sv-shrouded-fable-bundle` (`0/3`) | `$57.99 + $6.99 =` **`$64.98`** | `$32.00` (`$32.00`) | `$32.00` | Historical (`$57.99` old) | **BLOCKED (Price > Slider):** `$64.98` landed exceeds `$32.00` MSRP slider + `$5.00` Close-Call cushion (`+$32.98` over target). |
| 5 | `PKMN Colosseum` | `sv-shrouded-fable-bundle` (`0/3`) | `$57.99 + $6.99 =` **`$64.98`** | `$32.00` (`$32.00`) | `$32.00` | Historical | **BLOCKED (Price > Slider):** `$64.98` landed exceeds `$32.00` slider (`+$32.98` over target). |
| 6 | `Common Lands` | `sv-shrouded-fable-bundle` (`0/3`) | `$58.75 + $6.99 =` **`$65.74`** | `$32.00` (`$32.00`) | `$32.00` | Historical | **BLOCKED (Price > Slider):** `$65.74` landed exceeds `$32.00` slider (`+$33.74` over target). |
| 7 | `Stomping Grounds` | `sv-shrouded-fable-bundle` (`0/3`) | `$59.00 + $6.99 =` **`$65.99`** | `$32.00` (`$32.00`) | `$32.00` | Historical | **BLOCKED (Price > Slider):** `$65.99` landed exceeds `$32.00` slider (`+$33.99` over target). |
| 8 | `CardPop USA` | `me-perfect-order-etb` (`W/D/L` `3/3`) | `$59.99 + $6.99 =` **`$66.98`** | `$54.99` (`$54.99`) | `$54.99` | Historical | **BLOCKED (3/3 Complete + Above MSRP*1.08):** Raw shelf `$59.99 > $59.39` (`54.99 * 1.08` by `$0.60`), so `isTierAMsrp = false` and `fullyConquered` (`3/3`) mutes it (`⟦ MUTED: 3/3 FAMILY COMPLETE ⟧`). |
| 9 | `CardPop USA` | `me-pitch-black-etb` (`W/D/L` `3/3`) | `$59.99 + $6.99 =` **`$66.98`** | `$60.00` (`$54.99`) | `$55.00` | Historical | **BLOCKED (3/3 Complete + Above MSRP*1.08):** Raw `$59.99 > $59.39`, muted by `3/3` completion + Zeno `-8%` pull (`59.99 * 0.92 = $55.00`). |
| 10 | `CardsHQ` | `sv-shrouded-fable-bundle` (`0/3`) | `$59.99 + $6.99 =` **`$66.98`** | `$32.00` (`$32.00`) | `$32.00` | **NO** (`null`) | **BLOCKED (Price > Slider):** `$66.98` landed exceeds `$32.00` slider (`+$34.98` over target). |
| 11 | `MinMaxGames` | `me-pitch-black-etb` (`W/D/L` `3/3`) | `$60.00 + $6.99 =` **`$66.99`** | `$60.00` (`$54.99`) | `$55.00` | Historical | **BLOCKED (3/3 Complete + Above MSRP*1.08):** Raw `$60.00 > $59.39`, muted by `3/3` completion. |
| 12 | `PokeGirl CC` | `me-perfect-order-etb` (`W/D/L` `3/3`) | `$62.99 + $6.99 =` **`$69.98`** | `$54.99` (`$54.99`) | `$54.99` | Historical (`wasOos: true`) | **BLOCKED (3/3 Complete + Above Slider):** `$69.98` landed > `$54.99` and `3/3` complete. |

---

### 3.2 CRITICAL DISCOVERY: Sub-Slider Unowned Deals Actively Silenced Right Now

Scanning all `40` cached offers sitting **below or within `+$5` of Scott's manual sliders** exposed **two massive silent trigger blockers** suppressing real in-stock deals on `0/3` unowned and `1/3`–`2/3` sets:

| Store | SKU (`Slots`) | Landed Price | Scott's Manual Slider | Secret `effectiveCeiling` Applied | `alerted` Now? | Silent Blocker Killing the Alert |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`Collector Store`** | **`sv-destined-rivals-etb` (`0/3` NEED WALL)** | **`$109.99` (Free Ship)** | **`$111.00`** | **`$101.00`** | **`FALSE` (NEVER ALERTED!)** | **BLOCKER #1 (`Zeno's Paradox`):** `109.99 * 0.92 = $101.00`! Even `$101 + $5` cushion (`$106`) < `$109.99`, labeling a sub-slider Wall ETB as `NEAR MISS (+$8.99 OVER TARGET)`! |
| `Collector Store` | `sv-surging-sparks-etb` (`0/3` NEED WALL) | **`$114.99` (Free Ship)** | **`$115.00`** | **`$106.00`** | Locked (prior) / **Failing live gate** | **BLOCKER #1 (`Zeno's Paradox`):** `114.99 * 0.92 = $106.00` (`NEAR MISS +$8.99 OVER TARGET` in live stdout log line 25). |
| `Collector Store` | `sv-journey-together-booster-box` (`0/3`) | **`$189.99` (Free Ship)** | **`$190.00`** | **`$175.00`** | Locked (prior) / **Failing live gate** | **BLOCKER #1 (`Zeno's Paradox`):** `189.99 * 0.92 = $175.00` (`NEAR MISS +$14.99 OVER TARGET` in live stdout log line 48). |
| `1st Edition Collectibles` | `swsh-evolving-skies-etb` (`0/3` NEED WALL) | **`$455.00` (Free Ship)** | **`$469.00`** | **`$419.00`** | Locked (prior) / **Failing live gate** | **BLOCKER #1 (`Zeno's Paradox`):** `455.00 * 0.92 = $419.00` (`NEAR MISS +$36.00 OVER TARGET` despite beating slider by `-$14.00`!). |
| **`Lvl Up Games`** | **`sv-prismatic-evolutions-etb` (`W/-/L` `2/3`)** | **`$112.15`** (`$102.16+$9.99`) | **`$121.00`** | **`$64.89`** | **`FALSE` (NEVER ALERTED!)** | **BLOCKER #2 (`Rip Hunt Override`):** Because `wallOwned = true` (`2/3`), `ripHuntCeiling` (`54.99 * 1.18 = $64.89`) overrides Scott's `$121.00` slider (also kills `Trading Card Market` `$116.99`, `Zulus` `$119.99`, `Collector Store` `$119.99`). |
| **`Spankys Card Shop`** | **`me-delta-reign-etb` (`W/-/-` `1/3`)** | **`$91.54`** (`$84.55+$6.99`) | **`$93.00`** | **`$64.89`** | **`FALSE` (NEVER ALERTED!)** | **BLOCKER #2 (`Rip Hunt Override`):** `1/3` Wall Locked slashes `$93.00` slider down to `$64.89` (`MinMaxGames` `$84.99`, `PokeGirl CC` `$86.98`, `Trading Card Market` `$86.99` also muted). |

#### Root Cause Proof of Silent Blocker #1 — The "Zeno's Paradox" `dropPrice * 0.92` Deadlock (`evaluator.ts:1497` + `src/engine/trendAdvisor.ts:220–221`)
1. In `evaluator.ts:1495–1497`, `evaluateItem()` calls `evaluateSkuTrendAndTiming()` with `autoPilotEnabled: rule.autoPilotEnabled !== false` (**`true` by default across all 131 SKUs**) and passes **`lowestShelfPrice: dropPrice`** (the incoming item's *own* price!).
2. In `src/engine/trendAdvisor.ts:209, 219–221`:
   ```ts
   const isBleedingDown = Boolean(hasMinTrendSamples && (rolling.delta14dPct <= -5 || (activeStoreCount >= 8 && rolling.delta14dPct <= -2.5)));
   if (isBleedingDown) {
     const floorRef = lowestShelfPrice > 0 ? lowestShelfPrice : (rolling.low30d || rolling.currentMarket);
     autoPilotCeiling = Math.max(round2(msrpCeiling * 0.90), Math.round(floorRef * 0.92));
   }
   ```
3. **Mathematical Consequence:** Because `floorRef === dropPrice`, `autoPilotCeiling = Math.round(dropPrice * 0.92)`. For **every ETB priced above `$62.50`** (`0.92x + $5 < x`) and **every Booster Box priced above `$175.70`** (`0.92x + $10 < x`), `dropPrice` can **NEVER** be `<= Math.round(dropPrice * 0.92) + cushion`! Even if a store drops *Evolving Skies ETB* from `$455` to `$200` (`$269` below Scott's `$469` slider!), `autoPilotCeiling` instantly moves to `$184` (`200 * 0.92`) + `$5` cushion = `$189` and **STILL REJECTS IT**!

#### Additional Delivery / State Bugs Found in Section 3
- **Transient DNS Alert Loss (`notifier.ts`):** `pokemon-drop-bot-error-0.log` (`steps/516:586`) recorded `Failed to send Discord alert: getaddrinfo ENOTFOUND discord.com`. `postDiscordPayloadNow()` handles HTTP `429` `retry_after`, but on a transient socket/DNS `ENOTFOUND`/`ECONNRESET` error it rejects and drops the alert after `evaluator.ts` has already marked `alertState.json` as alerted!
- **Immortal Reddit Ghost Offers (`vampirePoller.ts` / `evaluator.ts`):** Offers with `itemId` starting with `reddit_t3_*` have no TTL expiration in `storeOffersCache.json`, polluting `#1` and `#2` cheapest shelf slots indefinitely.

---

### 3.3 Why Engine Room Big-Box Sensors Render Red `(X)` / Mismatched Icons (`server.js` & `public/index.html`)

Inspecting `server.js:2025–2049, 2166` and `public/index.html:3469–3488, 5357–5385, 5478, 5509–5521` revealed **three conflicting status mappers**:

1. **Left Icon (`getEngineCoreSvg(s.coreTier)` in `public/index.html:5357–5385`) vs. Right Pill (`statusCls` in `public/index.html:5517–5521`):**
   - In `server.js:2045–2049`:
     ```js
     let coreTier = 'SLEEPING_CORE';
     if (/QUEUE_ACTIVE/i.test(humanStatus) || itemsParsed > 0 || matched.length > 0) coreTier = 'ULTRA_CORE';
     else if (/WAF|SHIELD|CHALLENGE|403/i.test(humanStatus)) coreTier = 'SHIELD_BLOCKED';
     ```
   - Whenever a Big-Box sensor is `WAF_CHALLENGE_IMPERVA`, `WAF_CHALLENGE_PX`, or `WAF_CHALLENGE_BOT_CHECK`, `server.js` sets `coreTier = 'SHIELD_BLOCKED'`, which `getEngineCoreSvg()` renders as a **crimson red hexagon with a red `(X)` (`#F43F5E`)** on the left of the row—while `index.html:5518` (`const isWarn = /403|CHALLENGE|SHIELD/i.test(humanStatus)`) styles the status badge on the right of the *exact same row* **amber (`bg-amber-500/20 text-amber-300`)**!
2. **`200 OK // 0 IN STOCK` Assigned `SLEEPING_CORE` (Amber Warning Icon) Instead of Healthy Green:**
   - Because `200 OK // 0 IN STOCK` has `itemsParsed === 0` and `matched.length === 0`, `server.js:2045` leaves `coreTier = 'SLEEPING_CORE'` (**amber dashed warning circle `#F59E0B`**) on the left while `index.html:5520` renders an **emerald green `200 OK // 0 IN STOCK` pill** on the right! A Big-Box sensor can *never* show a healthy green/cyan core icon unless an MSRP drop is actively in stock at that exact second.
3. **Header Summary Hardcodes `9 / 9` Big-Box Sensors as Healthy/Armed (`server.js:2166` & `public/index.html:5478`):**
   - `server.js:2166`: `healthySensors: lgsRows.filter((r) => r.coreTier !== 'SHIELD_BLOCKED').length + northStar5.length` — unconditionally counts all `9` Big-Box sensors as healthy even when `5` of them have `coreTier === 'SHIELD_BLOCKED'` red `(X)` icons!

---

## 4. Recommended V6 Slice 3.5 Surgical Fix Order (For Next Build Turn)

1. **Kill the Zeno's Paradox `dropPrice * 0.92` Deadlock & Fix Rip-Hunt Slider Respect (`src/engine/trendAdvisor.ts` & `evaluator.ts`):**
   - Never pass `dropPrice` as `lowestShelfPrice` to pull `effectiveTargetCeiling` below itself; make `BLEEDING DOWN` an **advisory badge only** (never overriding Scott's explicit `policyMaxBuy` slider downward on `0/3` unowned SKUs), let explicit manual sliders above MSRP work cleanly or expose a clear toggle for Rip Hunt (`1/3` & `2/3`), prune `reddit_t3_*` cache entries older than `4h`, and add 2-attempt DNS/network retry in `postDiscordPayloadNow()`.
2. **Fix the 3 False-Green Big-Box Parsers & Re-Route Blocked Transports (`src/pollers/bigBoxAdapters.ts`, `bigBoxRetailPoller.ts`, `wafBrowserBridge.ts`):**
   - **GameStop:** Parse `typeof obj?.availability === 'object' ? (obj.availability.available && obj.availability.readyToOrder) : ...` so all `20` search tiles parse cleanly.
   - **Amazon 1P:** Split search cards by top-level `data-component-type="s-search-result"`, read the last/longest `<h2>` (`aria-label`), remove the `4,500`-char cap, and scope PDP price to `#corePriceDisplay_desktop_feature_div` / `priceToPay`.
   - **Costco:** Route Costco search through Playwright XHR interception or hydrated DOM (and mark `0 total product nodes` as `CSR_UNHYDRATED` / `SELECTOR_EMPTY`—NEVER `200 OK // 0 IN STOCK` when `totalNodesSeen === 0`!).
   - **Pokémon Center / Best Buy / Target / Sam's Club:** Add `ignoreHTTPSErrors: true` on Playwright context (testing Direct PC without router cert abort), route Best Buy via Playwright HTTP/2 (killing Akamai `ERR_CANCELED` tarpit), passive-intercept RedSky XHR on Target PLP/PDP navigation, and fix `412` PerimeterX classification on Sam's Club.
3. **Stop the LGS `HTTP 429` Storm & `588 MB` Log Bloat (`lgsPoller.ts`, `fastTier1Poller.ts`, `evaluator.ts`, `server.js`):**
   - Exclude `fastTier1Poller`'s 25 stores from `lgsPoller`'s Direct-IP hammer (or add `ETag`/`If-None-Match` to `lgsPoller.ts` + proxy-first on `429`-prone stores), silence per-item `[SEEN]` Near-Miss stdout spam, remove fake `145` catalog / fake latency fallbacks in `server.js:2140, 2151`, and align Engine Room `coreTier` icons (`VERIFIED_200_EMPTY` -> emerald core, honest `healthySensors` count).

---

## 5. Engine Repair Pass 1 — Post-Fix Live Verification Addendum (`2026-11-11 22:05 CST`)

All **Section 2**, **Section 3.1/3.2**, and **Section 3.3** defects have been resolved and verified on live wire (leaving Section 1 Big-Box scraper adapters untouched at `git diff = 0` for **Engine Repair Pass 2**):

1. **Zeno's Paradox & Rip-Mode Slider Clamp Eliminated (`src/engine/trendAdvisor.ts` `327` lines & `evaluator.ts`):**
   - *Destined Rivals ETB* (`0/3`, `$111` slider): `Collector Store` `$109.99` & `Kanzen Games` `$78.29` (`$88.28` landed) evaluated as `UNDER_TARGET` / `BUY` and dispatched live `[DISCORD SENT 0ms]` embeds while preserving `◈ ⟦ BLEEDING DOWN (-3% 14D • 19D REAL) // HOLD OFF ⟧` strictly as advisory guidance.
   - *Prismatic Evolutions ETB* (`2/3` Rip Mode, `$121` slider): `Collector Store` `$119.99` evaluated as `UNDER_TARGET` (`⟦ RIP TARGET HIT (-$1.01) ⟧ • ◈ ⟦ NEED RIP PAIR (QTY 2+) ⟧`, `BUY`).
   - *Delta Reign ETB* (`1/3` Rip Mode, `$93` slider): `MinMaxGames` `$84.99`, `Collector Store` `$84.99`, `Shinobi Collectibles` `$86.00`, and `Stomping Grounds` `$89.00` evaluated as `UNDER_TARGET` (`⟦ RIP TARGET HIT ⟧ • ◈ ⟦ NEED RIP PAIR (QTY 2+) ⟧`) and dispatched live `[DISCORD SENT 0ms]` embeds.
2. **Commit-After-Send & 4h Reddit TTL (`notifier.ts`, `evaluator.ts`, `listener.ts`):**
   - `alertState.json` now commits only after HTTP `2xx` Discord/Telegram confirmation (with `1500ms`/`4000ms` exponential-backoff retries on `ENOTFOUND`/`ECONNRESET`/`5xx`). Stale `reddit_*` ghosts in `storeOffersCache.json` = **`0`**, in `liveStock.json` = **`0`**.
3. **LGS `HTTP 429` Storm Crushed via Native HTTP/2 ALPN + `ETag` `304` (`lgsPoller.ts` & `src/pollers/fastTier1Poller.ts` `286` lines):**
   - Replaced `axios` HTTP/1.1 (`Accept: application/json`, Cloudflare Bot Score `1` -> `429` tarpit) with Node 26 Undici HTTP/2 ALPN `fetch()` + Chrome document navigation headers + `ETag`/`If-None-Match` `304` + Tier-1 5th-cycle reconciliation.
   - **Live Soak Result:** `LGS Sweep #1` hit **`88 / 90 HEALTHY` (`0` `HTTP 429`s!)** in `49.7s`; `LGS Sweep #2 [T2-STANDARD]` hit `17 / 65` `HTTP 304` (`0` `HTTP 429`s); `fastTier1Poller` Cycle #4 polled `25 / 25` stores in `9.38s` with **`16 / 25` (`64%`) `HTTP 304`**. Only `Squirtle Squad Card Shop` (`HTTP 401 Storefront Password Locked` at `/password`) and `The Gaming Goat` (`HTTP 403`) remain degraded.
   - `pokemon-drop-bot` CPU dropped from **`73.5%` -> `0%–2%`**, `out-0.log` dropped from **`588.0 MB` -> `9.82 KB`** (`0` `[SEEN]` spam lines).
4. **Honest Engine Room Telemetry (`server.js` & `public/index.html`):**
   - `healthySensors: 88` (`healthyLgsSensors: 88`, `healthyBigBoxSensors: 0`), `0` fake `145` catalog counts, `0` fake deterministic latencies, and aligned crimson `WAF_CHALLENGE_*` vs amber `PARSER_BLIND (0 NODES)` Big-Box indicators ready for **Engine Repair Pass 2**.

---

## 6. Engine Repair Pass 2 — Post-Fix Live Verification Addendum (`2026-11-11 23:20 CST`)

All **Section 1** Big-Box parser, transport, WAF classification, and `totalNodesFound` truth defects have been resolved across `src/pollers/wafBrowserBridge.ts` (`316` lines), `src/pollers/bigBoxAdapters.ts` (`342` lines), `src/pollers/bigBoxDomParsers.ts` (`301` lines), and `src/pollers/bigBoxRetailPoller.ts` (`252` lines) — all strictly `< 350` lines, with **`0` visible Chrome/Edge windows spawned** (`BASELINE_VISIBLE_BROWSER_WINDOWS: 0`, `NEW_VISIBLE_CHROME_WINDOWS_SPAWNED: 0`, `VISIBLE_WINDOWS_AFTER_PM2: 0`):

| Retailer | Transport | HTTP Status | Total Shelf Nodes Found | In-Stock Sealed Matches | Final Engine Room Status |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **Pokémon Center** | `Playwright (chrome-headless-new)` | `403` (`200` interstitial) | `0` | `0` | `WAF_CHALLENGE_IMPERVA` (`SHIELD_BLOCKED` crimson; Direct TLS `ERR_CERT` resolved via `ignoreHTTPSErrors: true` on `prod.ui.pokemoncenter.com`, `0` Webshare proxy fallback) |
| **Target** | `Playwright Passive XHR (chrome-headless-new)` | `435` | `0` | `0` | `WAF_CHALLENGE_PX` (`SHIELD_BLOCKED` crimson; passive `page.on('response')` wire-tap on `plp_search_v2` `facetedValue=dq4mn`, `0` `axios` / `0` `page.evaluate` fetch injection) |
| **Amazon 1P** | `Undici HTTP/2 fetch` (`+ Chrome fallback`) | `200` | **`5`** | `0` | **`200 OK // 0 IN STOCK`** (`ULTRA_CORE` emerald; outer `s-search-result` slice without `4,500B` cap, brand+`<h2>` title combine, non-strike `.a-offscreen` price, `rh=p_6:ATVPDKIKX0DER`) |
| **Best Buy** | `Playwright (chrome-headless-new)` | `200` | **`16`** | `0` | **`200 OK // 0 IN STOCK`** (`ULTRA_CORE` emerald; Akamai `12s` `ERR_CANCELED` HTTP/1.1 tarpit eliminated via System Chrome HTTP/2 `.product-list-item` parser) |
| **Walmart (1P MSRP)** | `Playwright (chrome-headless-new)` | `200->PX` *(unblocked `200` parses `27` `F55CDC31` items)* | `0` *(on PX `/blocked`)* | `0` | `WAF_CHALLENGE_PX` (`SHIELD_BLOCKED` crimson; `#__NEXT_DATA__` `itemStacks` locked to `F55CDC31AB754BB68FE0B39041159D63`, poisoned PX cookies auto-cleared) |
| **Costco Wholesale** | `Playwright (chrome-headless-new)` | `200` | **`0`** | `0` | **`PARSER_BLIND_0_NODES`** (`SLEEPING_CORE` amber — false green eliminated when Kasada holds back `gdx-api.costco.com/catalog/search` tiles!) |
| **Sam's Club** | `Playwright (chrome-headless-new)` | `200->PX` | `0` | `0` | `WAF_CHALLENGE_PX` (`SHIELD_BLOCKED` crimson; `/are-you-human` & `412` classified as `PX`, never `IMPERVA`) |
| **GameStop** | `Playwright (chrome-headless-new)` | `200` | **`35`** | `0` *(4 live ETBs @ `$84.99–$99.99` properly filtered above `MSRP*1.08`)* | **`200 OK // 0 IN STOCK`** (`ULTRA_CORE` emerald; `[object Object]` nested `availability` bug fixed) |
| **Barnes & Noble** | `Playwright (chrome-headless-new)` | `200` | **`24`** | `0` | **`200 OK // 0 IN STOCK`** (`ULTRA_CORE` emerald; `{0,1800}?` lookahead boundary fixed to index-slice all Hydrogen `/w/?ean=` cards) |

- **Live `/api/engine-room` Verification:** `totalSensors: 99`, `healthySensors: 94` (`healthyLgsSensors: 90`, `healthyBigBoxSensors: 4` — up from `1` true green in Diagnostic Section 1.0, with `0` false greens!).
