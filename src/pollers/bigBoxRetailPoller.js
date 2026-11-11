"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BIG_BOX_STORES = void 0;
exports.formatHonestSensorBadge = formatHonestSensorBadge;
exports.pollPokemonCenterDirectMsrp = pollPokemonCenterDirectMsrp;
exports.pollSecondaryBigBoxSensors = pollSecondaryBigBoxSensors;
exports.pollBigBoxAggregators = pollBigBoxAggregators;
const axios_1 = __importDefault(require("axios"));
const lgsPoller_1 = require("../../lgsPoller");
const listener_1 = require("../../listener");
const notifier_1 = require("../../notifier");
const policies_1 = require("../../policies");
const wafBrowserBridge_1 = require("./wafBrowserBridge");
const bigBoxAdapters_1 = require("./bigBoxAdapters");
exports.BIG_BOX_STORES = [
    'Target', 'Best Buy', 'Pokémon Center', 'Walmart', 'Amazon', 'GameStop', 'Costco', "Sam's Club", 'Barnes & Noble'
];
const BASE_TARGET_QUERIES = [
    'pokemon elite trainer box', 'pokemon booster bundle',
    'pokemon prismatic evolutions', 'pokemon destined rivals', 'pokemon scarlet violet 151',
    'pokemon mega evolution', 'pokemon surging sparks', 'pokemon journey together'
];
const POKEMON_CENTER_URLS = [
    'https://www.pokemoncenter.com/en-us/category/elite-trainer-box',
    'https://www.pokemoncenter.com/en-us/category/booster-packs',
    'https://www.pokemoncenter.com/en-us/category/trading-card-game'
];
const BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache'
};
let targetCursor = 0;
let pcFeedCursor = 0;
let asinCursor = 0;
let lastPcPollAt = 0;
let isPollingBigBox = false;
let lastBigBoxPollAt = 0;
async function httpGetWithProxyFallback(url, headers, timeoutMs = 7000) {
    const attempt = async (httpsAgent) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await axios_1.default.get(url, {
                timeout: timeoutMs,
                signal: controller.signal,
                httpsAgent,
                headers,
                validateStatus: (s) => s >= 200 && s < 500
            });
        }
        finally {
            clearTimeout(timer);
        }
    };
    try {
        const res = await attempt();
        if (res.status >= 400) {
            try {
                const proxied = await attempt((0, lgsPoller_1.getNextProxy)());
                if (proxied.status < 400)
                    return proxied;
            }
            catch { }
        }
        return res;
    }
    catch {
        return await attempt((0, lgsPoller_1.getNextProxy)());
    }
}
function formatHonestSensorBadge(itemsExtracted, wafType) {
    if (wafType === 'IMPERVA')
        return { status: 'WAF_CHALLENGE_IMPERVA', lastStatus: 'WAF_CHALLENGE_IMPERVA', statusCode: 'WAF_CHALLENGE_IMPERVA' };
    if (wafType === 'PX')
        return { status: 'WAF_CHALLENGE_PX', lastStatus: 'WAF_CHALLENGE_PX', statusCode: 'WAF_CHALLENGE_PX' };
    if (wafType === 'CF')
        return { status: 'WAF_CHALLENGE_CF', lastStatus: 'WAF_CHALLENGE_CF', statusCode: 'WAF_CHALLENGE_CF' };
    if (wafType === 'BOT_CHECK')
        return { status: 'WAF_CHALLENGE_BOT_CHECK', lastStatus: 'WAF_CHALLENGE_BOT_CHECK', statusCode: 'WAF_CHALLENGE_BOT_CHECK' };
    if (itemsExtracted > 0) {
        const label = `200 OK // ${itemsExtracted} IN STOCK`;
        return { status: label, lastStatus: label, statusCode: '200_OK_PARSED' };
    }
    return { status: '200 OK // 0 IN STOCK', lastStatus: '200 OK // 0 IN STOCK', statusCode: '200_OK_0_IN_STOCK' };
}
function buildSensorNode(name, cadence, engineMethod, strictFilter, itemsExtracted, wafType, extra) {
    const badge = formatHonestSensorBadge(itemsExtracted, wafType);
    return {
        name, cadence, engineMethod, strictFilter,
        itemsExtracted, itemsParsed: itemsExtracted,
        ...badge, ...(extra || {}), lastCheckedAt: Date.now()
    };
}
async function pollPokemonCenterDirectMsrp(force = false) {
    const now = Date.now();
    if (!force && now - lastPcPollAt < 85000)
        return;
    lastPcPollAt = now;
    const pcUrl = POKEMON_CENTER_URLS[pcFeedCursor % POKEMON_CENTER_URLS.length];
    pcFeedCursor = (pcFeedCursor + 1) % POKEMON_CENTER_URLS.length;
    const wafMeta = {
        headless: true,
        args: wafBrowserBridge_1.INVISIBLE_HEADLESS_LAUNCH_OPTS.args,
        intervalSec: 160,
        sessionCacheFile: 'data/wafSessionCookies.json'
    };
    try {
        const sweep = await (0, wafBrowserBridge_1.sweepWafProtectedTarget)('pokemoncenter', pcUrl, force);
        if (sweep.isQueueActive) {
            await (0, notifier_1.sendPokemonCenterQueueAlert)({ queueUrl: 'https://www.pokemoncenter.com', detectedFromUrl: pcUrl });
            const qNode = buildSensorNode('Pokémon Center', '160s Playwright Headless + Queue-It Radar', 'Invisible Playwright Headless + Queue-It Detector', '$59.99 Exclusive / 1P MSRP Only', 0, undefined, { status: wafBrowserBridge_1.PC_QUEUE_BANNER, lastStatus: wafBrowserBridge_1.PC_QUEUE_BANNER, statusCode: 'QUEUE_ACTIVE', queueState: 'QUEUE_ACTIVE', queueActive: true, queueBanner: wafBrowserBridge_1.PC_QUEUE_BANNER, bridgeMode: sweep.browserChannel || 'PLAYWRIGHT_HEADLESS_NEW', lastUrlChecked: pcUrl });
            (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ pokemonCenterStatus: 'QUEUE_ACTIVE', wafBridge: wafMeta, northStar5: { pokemonCenter: qNode } });
            return;
        }
        if (sweep.isWafChallenged) {
            const cNode = buildSensorNode('Pokémon Center', '160s Playwright Headless + Queue-It Radar', 'Invisible Playwright Headless + Queue-It Detector', '$59.99 Exclusive / 1P MSRP Only', 0, sweep.wafType || 'IMPERVA', { queueState: 'NORMAL', queueActive: false, bridgeMode: sweep.browserChannel || 'PLAYWRIGHT_HEADLESS_NEW', lastUrlChecked: pcUrl });
            (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ pokemonCenterStatus: cNode.statusCode, wafBridge: wafMeta, northStar5: { pokemonCenter: cNode } });
            return;
        }
        const pcHits = (0, bigBoxAdapters_1.parsePokemonCenterPayload)(sweep.html || '');
        await (0, bigBoxAdapters_1.dispatchVerifiedBigBoxHits)(pcHits, listener_1.processIncomingDrop, 30);
        const node = buildSensorNode('Pokémon Center', '160s Playwright Headless + Queue-It Radar', 'Invisible Playwright Headless + InStock JSON-LD', '$59.99 Exclusive / 1P MSRP Only', pcHits.length, undefined, { queueState: 'NORMAL', queueActive: false, bridgeMode: sweep.browserChannel || 'PLAYWRIGHT_HEADLESS_NEW', lastUrlChecked: pcUrl });
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ pokemonCenterStatus: node.statusCode, wafBridge: wafMeta, northStar5: { pokemonCenter: node } });
    }
    catch {
        const node = buildSensorNode('Pokémon Center', '160s Playwright Headless + Queue-It Radar', 'Invisible Playwright Headless + Queue-It Detector', '$59.99 Exclusive / 1P MSRP Only', 0, 'IMPERVA', { queueState: 'NORMAL', queueActive: false });
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ pokemonCenterStatus: node.statusCode, northStar5: { pokemonCenter: node } });
    }
}
async function pollSecondaryBigBoxSensors() {
    // 1. Walmart 1P MSRP (`F55CDC31AB754BB68FE0B39041159D63` / Walmart.com)
    try {
        const wmUrl = 'https://www.walmart.com/search?q=pokemon+elite+trainer+box+booster+bundle&facet=retailer_type%3AWalmart';
        const res = await httpGetWithProxyFallback(wmUrl, BROWSER_HEADERS, 6500);
        const html = String(res.data || '');
        const isPx = res.status >= 400 || /px-captcha|Robot or human\?|verify you are human|\/blocked/i.test(html);
        const wmHits = isPx ? [] : (0, bigBoxAdapters_1.parseWalmartPayload)(html);
        if (wmHits.length > 0)
            await (0, bigBoxAdapters_1.dispatchVerifiedBigBoxHits)(wmHits, listener_1.processIncomingDrop, 20);
        const wmNode = buildSensorNode('Walmart (1P MSRP)', '45s 1P Facet Sweep', '1P Seller F55CDC31 + /pac 1-Tap Cart', 'Sold & Shipped by Walmart.com Only', wmHits.length, isPx ? 'PX' : undefined);
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ walmartStatus: wmNode.statusCode, northStar5: { walmart: wmNode } });
    }
    catch {
        const wmNode = buildSensorNode('Walmart (1P MSRP)', '45s 1P Facet Sweep', '1P Seller F55CDC31 + /pac 1-Tap Cart', 'Sold & Shipped by Walmart.com Only', 0, 'PX');
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ walmartStatus: wmNode.statusCode, northStar5: { walmart: wmNode } });
    }
    // 2. Amazon 1st-Party (`ATVPDKIKX0DER` ONLY)
    try {
        const seededAsins = policies_1.WATCH_POLICIES.map((p) => p.amazonAsin).filter(Boolean);
        const usePdp = seededAsins.length > 0 && asinCursor % 2 === 1;
        const pickedAsin = seededAsins[asinCursor % Math.max(1, seededAsins.length)];
        asinCursor += 1;
        const amzUrl = usePdp && pickedAsin
            ? `https://www.amazon.com/dp/${pickedAsin}?smid=${bigBoxAdapters_1.AMAZON_1P_MERCHANT_ID}&th=1&psc=1`
            : `https://www.amazon.com/s?k=pokemon+elite+trainer+box+booster+bundle&rh=p_6%3A${bigBoxAdapters_1.AMAZON_1P_MERCHANT_ID}&s=date-desc-rank`;
        const res = await httpGetWithProxyFallback(amzUrl, BROWSER_HEADERS, 6500);
        const html = String(res.data || '');
        const isBotGate = res.status >= 400 || /validateCaptcha|api-services-support@amazon\.com|Enter the characters you see below/i.test(html);
        const amzHits = isBotGate ? [] : (0, bigBoxAdapters_1.parseAmazon1pPayload)(html, !usePdp);
        if (amzHits.length > 0)
            await (0, bigBoxAdapters_1.dispatchVerifiedBigBoxHits)(amzHits, listener_1.processIncomingDrop, 20);
        const amzNode = buildSensorNode('Amazon (1P MSRP)', '45s ATVPDKIKX0DER Sweep', 'smid=ATVPDKIKX0DER + 1-Tap Cart Add', 'Ships & Sold by Amazon.com (<= MSRP*1.08)', amzHits.length, isBotGate ? 'BOT_CHECK' : undefined);
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ amazonStatus: amzNode.statusCode, northStar5: { amazon: amzNode } });
    }
    catch {
        const amzNode = buildSensorNode('Amazon (1P MSRP)', '45s ATVPDKIKX0DER Sweep', 'smid=ATVPDKIKX0DER + 1-Tap Cart Add', 'Ships & Sold by Amazon.com (<= MSRP*1.08)', 0, 'BOT_CHECK');
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ amazonStatus: amzNode.statusCode, northStar5: { amazon: amzNode } });
    }
    // 3. GameStop & Barnes & Noble via Invisible Playwright WAF Bridge (`160s` polite cycle)
    const wafTargets = [
        { domain: 'gamestop', key: 'gamestop', statusKey: 'gamestopStatus', name: 'GameStop', url: 'https://www.gamestop.com/search/?q=pokemon+elite+trainer+box&type=Primary&sort=BestMatch_Desc&p=1', filter: '1P Retail MSRP Sealed Boxes & ETBs', parser: bigBoxAdapters_1.parseGameStopPayload },
        { domain: 'barnesandnoble', key: 'barnesNoble', statusKey: 'barnesNobleStatus', name: 'Barnes & Noble', url: 'https://www.barnesandnoble.com/search?q=pokemon+trading+card+game', filter: '1P Retail MSRP ETBs & Booster Bundles', parser: bigBoxAdapters_1.parseBarnesAndNoblePayload }
    ];
    for (const wt of wafTargets) {
        const sw = await (0, wafBrowserBridge_1.sweepWafProtectedTarget)(wt.domain, wt.url, false);
        const hits = sw.ok && sw.html ? wt.parser(sw.html) : [];
        if (hits.length > 0)
            await (0, bigBoxAdapters_1.dispatchVerifiedBigBoxHits)(hits, listener_1.processIncomingDrop, 20);
        const node = buildSensorNode(wt.name, '160s Playwright WAF Bridge', 'Invisible Playwright + InStock JSON-LD', wt.filter, hits.length, sw.isWafChallenged ? (sw.wafType || 'CF') : undefined, { bridgeMode: sw.browserChannel || 'PLAYWRIGHT_HEADLESS_NEW' });
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ [wt.statusKey]: node.statusCode, northStar5: { [wt.key]: node } });
    }
    // 4. Best Buy, Costco, & Sam's Club
    const directChecks = [
        { key: 'bestBuy', statusKey: 'bestBuyStatus', name: 'Best Buy', cadence: '45s SKU Availability + 1-Tap Cart', method: 'AddToCart / OnlineAvailability + /click/-/SKU/cart', filter: '1P Retail MSRP ($49.99–$54.99 ETB / $27.99 Bundle)', url: 'https://www.bestbuy.com/site/searchpage.jsp?st=pokemon+elite+trainer+box+booster+bundle&id=pcat17071', parser: bigBoxAdapters_1.parseBestBuyPayload },
        { key: 'costco', statusKey: 'costcoStatus', name: 'Costco Wholesale', cadence: '60s CatalogSearch', method: 'CatalogSearch Online InStock JSON-LD', filter: '1P Member Sealed Multi-Packs & ETBs', url: 'https://www.costco.com/CatalogSearch?dept=All&keyword=pokemon+cards', parser: bigBoxAdapters_1.parseCostcoPayload },
        { key: 'samsClub', statusKey: 'samsClubStatus', name: "Sam's Club", cadence: '60s Club Inventory Check', method: 'SamsClub Online Inventory JSON + JSON-LD', filter: '1P Member Sealed Multi-Packs & ETBs', url: 'https://www.samsclub.com/s/pokemon%20cards', parser: bigBoxAdapters_1.parseSamsClubPayload }
    ];
    for (const c of directChecks) {
        try {
            const res = await httpGetWithProxyFallback(c.url, BROWSER_HEADERS, 6000);
            const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
            const isPx = res.status === 435 || /px-captcha|Robot or human\?/i.test(html);
            const isImp = res.status >= 400 || /Access Denied|_Incapsula_Resource|Pardon Our Interruption|cf-chl/i.test(html);
            const waf = isPx ? 'PX' : (isImp ? 'IMPERVA' : undefined);
            const hits = !waf ? c.parser(res.data) : [];
            if (hits.length > 0)
                await (0, bigBoxAdapters_1.dispatchVerifiedBigBoxHits)(hits, listener_1.processIncomingDrop, 20);
            const node = buildSensorNode(c.name, c.cadence, c.method, c.filter, hits.length, waf);
            (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ [c.statusKey]: node.statusCode, northStar5: { [c.key]: node } });
        }
        catch {
            const node = buildSensorNode(c.name, c.cadence, c.method, c.filter, 0, 'IMPERVA');
            (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ [c.statusKey]: node.statusCode, northStar5: { [c.key]: node } });
        }
    }
}
async function pollBigBoxAggregators() {
    if (isPollingBigBox) {
        if (Date.now() - lastBigBoxPollAt > 55000)
            isPollingBigBox = false;
        else
            return;
    }
    isPollingBigBox = true;
    lastBigBoxPollAt = Date.now();
    const dynamicQueries = Array.from(new Set([
        ...BASE_TARGET_QUERIES,
        ...policies_1.WATCH_POLICIES.map((p) => p.retailSearchQuery).filter(Boolean)
    ]));
    const keyword = dynamicQueries[targetCursor % dynamicQueries.length];
    targetCursor = (targetCursor + 1) % dynamicQueries.length;
    try {
        await pollPokemonCenterDirectMsrp();
        const seededTcins = Array.from(new Set(policies_1.WATCH_POLICIES.map((p) => p.targetTcin).filter(Boolean)));
        const encodedKw = encodeURIComponent(keyword);
        const redskyUrl = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&channel=WEB&count=24&default_purchasability_filter=true&include_sponsored=false&keyword=${encodedKw}&new_search=true&offset=0&page=%2Fs%2F${encodedKw}&platform=desktop&pricing_store_id=3991&zip=76177&state=TX&useragent=Mozilla%2F5.0&visitor_id=0192B7C8E2F0020188A9`;
        const res = await httpGetWithProxyFallback(redskyUrl, { ...BROWSER_HEADERS, Accept: 'application/json' }, 7000);
        const rawStr = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
        const isTargetPx = res.status === 435 || res.status >= 400 || /PXGWPp4wUS|px-captcha/i.test(rawStr);
        const targetHits = isTargetPx ? [] : (0, bigBoxAdapters_1.parseTargetRedskyPayload)(res.data);
        if (!isTargetPx && seededTcins.length > 0 && targetCursor % 2 === 0) {
            const tcinBatchUrl = `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&tcins=${seededTcins.slice(0, 20).join(',')}&store_id=3991&zip=76177&state=TX&channel=WEB`;
            try {
                const bRes = await httpGetWithProxyFallback(tcinBatchUrl, { ...BROWSER_HEADERS, Accept: 'application/json' }, 6500);
                if (bRes.status === 200)
                    targetHits.push(...(0, bigBoxAdapters_1.parseTargetRedskyPayload)(bRes.data));
            }
            catch { }
        }
        if (targetHits.length > 0)
            await (0, bigBoxAdapters_1.dispatchVerifiedBigBoxHits)(targetHits, listener_1.processIncomingDrop, 15);
        const tNode = buildSensorNode('Target (RedSky)', '15s RedSky TCIN + Search API', 'RedSky 1P Fulfillment + /p/-/A-{tcin}', '1P Target Sold Only (<= MSRP*1.08)', targetHits.length, isTargetPx ? 'PX' : undefined, { lastKeyword: keyword, seededTcinsTracked: seededTcins.length });
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ targetRedskyStatus: tNode.statusCode, lastTargetKeyword: keyword, itemsScanned: targetHits.length, northStar5: { target: tNode } });
        await pollSecondaryBigBoxSensors();
    }
    catch (err) {
        const tNode = buildSensorNode('Target (RedSky)', '15s RedSky TCIN + Search API', 'RedSky 1P Fulfillment + /p/-/A-{tcin}', '1P Target Sold Only (<= MSRP*1.08)', 0, 'PX');
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ targetRedskyStatus: 'WAF_CHALLENGE_PX', lastTargetError: err?.message || 'RedSky poll error', northStar5: { target: tNode } });
    }
    finally {
        isPollingBigBox = false;
        setTimeout(pollBigBoxAggregators, 15000);
    }
}
