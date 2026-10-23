"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BIG_BOX_STORES = void 0;
exports.pollBigBoxAggregators = pollBigBoxAggregators;
exports.pollRedditDeals = pollRedditDeals;
exports.pollTcgPlayerUndercuts = pollTcgPlayerUndercuts;
const axios_1 = __importDefault(require("axios"));
const lgsPoller_1 = require("./lgsPoller");
const listener_1 = require("./listener");
const policies_1 = require("./policies");
const marketComps_1 = require("./marketComps");
const evaluator_1 = require("./evaluator");
const seenRedditIds = new Set();
const lowestTcgSeenMap = new Map();
const seenBigBoxOffers = new Map();
const TARGET_REDSKY_QUERIES = [
    'pokemon elite trainer box',
    'pokemon booster bundle',
    'pokemon booster box',
    'pokemon prismatic evolutions',
    'pokemon destined rivals',
    'pokemon scarlet violet 151',
    'pokemon mega evolution',
    'pokemon surging sparks'
];
exports.BIG_BOX_STORES = [
    'Target',
    'Best Buy',
    'Pokémon Center',
    'Walmart',
    'Amazon',
    'GameStop',
    'Costco',
    "Sam's Club",
    'Barnes & Noble'
];
function isShippingScam(itemPrice, shippingPrice, formFactor) {
    if (shippingPrice === undefined || shippingPrice <= 0)
        return false;
    const isCase = formFactor === 'ETB Case' || formFactor === 'Master Case';
    const maxAbsShip = isCase ? 75 : 35;
    if (shippingPrice > maxAbsShip)
        return true;
    if (itemPrice > 0 && shippingPrice > itemPrice * 0.30)
        return true;
    return false;
}
async function axiosRequestWithAbort(method, url, headers, timeout, body, httpsAgent) {
    const safeTimeout = Math.min(timeout, 10000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), safeTimeout);
    try {
        if (method === 'POST') {
            return await axios_1.default.post(url, body, { timeout: safeTimeout, signal: controller.signal, httpsAgent, headers });
        }
        return await axios_1.default.get(url, { timeout: safeTimeout, signal: controller.signal, httpsAgent, headers });
    }
    finally {
        clearTimeout(timer);
    }
}
async function smartGet(url, headers, timeout = 8000) {
    try {
        return await axiosRequestWithAbort('GET', url, headers, timeout);
    }
    catch (e) {
        return await axiosRequestWithAbort('GET', url, headers, timeout, undefined, (0, lgsPoller_1.getNextProxy)());
    }
}
async function smartPost(url, body, headers, timeout = 6000) {
    try {
        return await axiosRequestWithAbort('POST', url, headers, timeout, body);
    }
    catch (e) {
        return await axiosRequestWithAbort('POST', url, headers, timeout, body, (0, lgsPoller_1.getNextProxy)());
    }
}
let targetCursor = 0;
let isPollingBigBox = false;
let lastBigBoxPollAt = 0;
async function pollBigBoxAggregators() {
    if (isPollingBigBox) {
        if (Date.now() - lastBigBoxPollAt > 45000) {
            isPollingBigBox = false;
        }
        else {
            return;
        }
    }
    isPollingBigBox = true;
    lastBigBoxPollAt = Date.now();
    const keyword = TARGET_REDSKY_QUERIES[targetCursor % TARGET_REDSKY_QUERIES.length];
    targetCursor = (targetCursor + 1) % TARGET_REDSKY_QUERIES.length;
    try {
        const encodedKw = encodeURIComponent(keyword);
        const redskyUrl = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&channel=WEB&count=24&default_purchasability_filter=true&include_sponsored=false&keyword=${encodedKw}&new_search=true&offset=0&page=%2Fs%2F${encodedKw}&platform=desktop&pricing_store_id=3991&useragent=Mozilla%2F5.0&visitor_id=0192B7C8E2F0020188A9`;
        const res = await smartGet(redskyUrl, {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Accept: 'application/json'
        }, 8000);
        const products = res.data?.data?.search?.products || [];
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({
            targetRedskyStatus: 'HEALTHY',
            lastTargetKeyword: keyword,
            itemsScanned: products.length
        });
        const activeTcinSet = new Set();
        for (const p of products) {
            const tcin = String(p.tcin || '');
            const rawTitle = String(p.item?.product_description?.title || '')
                .replace(/&#38;|&amp;/g, '&')
                .replace(/&#8212;|&mdash;/g, ' - ')
                .trim();
            const price = parseFloat(p.price?.current_retail || p.price?.reg_retail || 0);
            const buyUrl = String(p.item?.enrichment?.buy_url || (tcin ? `https://www.target.com/p/-/A-${tcin}` : 'https://www.target.com'));
            if (!tcin || !rawTitle || !price || price < 18)
                continue;
            activeTcinSet.add(tcin);
            const matchedPolicy = policies_1.WATCH_POLICIES.find((pol) => pol.active !== false && pol.matchers.some((rx) => rx.test(rawTitle)));
            if (!matchedPolicy)
                continue;
            if (!(0, policies_1.isValidSkuForFormFactor)(rawTitle, matchedPolicy.formFactor, price, {
                ruleId: matchedPolicy.id,
                targetName: matchedPolicy.name,
                handle: buyUrl,
                retailer: 'Target',
                sourceUrl: buyUrl,
                allowPcRetailUnlock: false
            })) {
                continue;
            }
            const offerKey = `target_${tcin}`;
            const prev = seenBigBoxOffers.get(offerKey);
            const minsSince = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;
            if (!prev || price < prev.price || minsSince >= 15) {
                seenBigBoxOffers.set(offerKey, { price, timestamp: Date.now() });
                const isPreOrder = /pre-?order|pre-?sale/i.test(rawTitle);
                await (0, listener_1.processIncomingDrop)({
                    title: rawTitle,
                    retailer: 'Target (RedSky Live)',
                    url: buyUrl,
                    productUrl: buyUrl,
                    price,
                    stock: undefined,
                    itemId: offerKey,
                    isPreOrder,
                    freeShipping: price >= 35
                });
            }
        }
    }
    catch (err) {
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({
            targetRedskyStatus: 'DEGRADED',
            lastTargetError: err?.message || 'RedSky poll error'
        });
    }
    finally {
        isPollingBigBox = false;
        setTimeout(pollBigBoxAggregators, 15000);
    }
}
function extractOutboundRetailerUrl(text, fallbackUrl) {
    const urlMatch = text.match(/https?:\/\/(?:www\.)?(?:target\.com|bestbuy\.com|pokemoncenter\.com|walmart\.com|amazon\.com|a\.co|gamestop\.com|costco\.com|samsclub\.com|barnesandnoble\.com)[^\s)"\]<>]*/i);
    return urlMatch ? urlMatch[0] : fallbackUrl;
}
const REDDIT_RSS_FEEDS = [
    'https://www.reddit.com/r/PKMNTCGDeals/new/.rss',
    'https://www.reddit.com/r/PKMNTCGDeals/hot/.rss',
    'https://www.reddit.com/r/PokemonTCG/new/.rss'
];
let redditFeedCursor = 0;
let isPollingReddit = false;
let lastRedditPollAt = 0;
async function pollRedditDeals() {
    if (isPollingReddit) {
        if (Date.now() - lastRedditPollAt > 90000) {
            isPollingReddit = false;
        }
        else {
            return;
        }
    }
    isPollingReddit = true;
    lastRedditPollAt = Date.now();
    const rssUrl = REDDIT_RSS_FEEDS[redditFeedCursor % REDDIT_RSS_FEEDS.length];
    redditFeedCursor = (redditFeedCursor + 1) % REDDIT_RSS_FEEDS.length;
    try {
        const rssRes = await smartGet(rssUrl, {
            'User-Agent': 'Windows:DropBotCommander:v4.0 (by /u/Lonesoul65666)',
            Accept: 'application/atom+xml,application/xml,text/xml'
        }, 8000);
        const xml = rssRes.data || '';
        const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
        const posts = [];
        for (const ent of entries) {
            const block = ent[1];
            const idMatch = block.match(/<id>([^<]+)<\/id>/i);
            const titleMatch = block.match(/<title>([^<]+)<\/title>/i);
            const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
            const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
            const updatedMatch = block.match(/<(?:updated|published)>([^<]+)<\/(?:updated|published)>/i);
            if (idMatch && titleMatch) {
                const parsedUtc = updatedMatch ? Math.floor(Date.parse(updatedMatch[1]) / 1000) : 0;
                posts.push({
                    id: idMatch[1],
                    title: titleMatch[1]
                        .replace(/&amp;/g, '&')
                        .replace(/&#39;/g, "'")
                        .replace(/&quot;/g, '"')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>'),
                    url_overridden_by_dest: linkMatch ? linkMatch[1] : '',
                    selftext: contentMatch
                        ? contentMatch[1]
                            .replace(/&amp;/g, '&')
                            .replace(/&#39;/g, "'")
                            .replace(/&quot;/g, '"')
                            .replace(/&lt;/g, '<')
                            .replace(/&gt;/g, '>')
                        : '',
                    created_utc: parsedUtc > 0 ? parsedUtc : Math.floor(Date.now() / 1000) - 60
                });
            }
        }
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({
            redditRssStatus: 'HEALTHY',
            lastRedditFeed: rssUrl,
            lastRedditPostsChecked: posts.length
        });
        for (const post of posts) {
            if (!post || !post.id || seenRedditIds.has(post.id))
                continue;
            seenRedditIds.add(post.id);
            const ageSeconds = (Date.now() / 1000) - (post.created_utc || 0);
            if (ageSeconds > 7200)
                continue;
            const title = post.title || '';
            const selftext = post.selftext || '';
            if (/stockx/i.test(title))
                continue;
            const rawDest = post.url_overridden_by_dest || `https://www.reddit.com${post.permalink || ''}`;
            const dealUrl = extractOutboundRetailerUrl(`${rawDest} ${selftext}`, rawDest);
            const storeMatch = title.match(/^\[([^\]]+)\]/);
            const rawStoreTag = storeMatch ? storeMatch[1] : '';
            const detectedBigBox = (0, policies_1.detectBigBoxRetailer)(`${rawStoreTag} ${title} ${selftext}`, dealUrl);
            const priceMatch = `${title} ${selftext}`.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
            let price = priceMatch ? parseFloat(priceMatch[1]) : undefined;
            let isBigBoxRestockRadar = false;
            // If Reddit post omits a literal $XX.XX price (e.g. "[Pokemon Center] Prismatic Evolutions ETB Back In Stock" or "[Target] Restock"),
            // do NOT drop it if it names or links to a supported Big-Box retailer and matches a tracked policy SKU!
            if (!price && detectedBigBox) {
                const matchedPolicy = policies_1.WATCH_POLICIES.find((p) => p.active !== false && p.matchers.some((rx) => rx.test(`${title} ${selftext}`)));
                if (matchedPolicy && matchedPolicy.msrpCeiling > 0) {
                    price = matchedPolicy.msrpCeiling;
                    isBigBoxRestockRadar = true;
                    console.log(`📡 [BIG-BOX RESTOCK RADAR] Reddit post "${title}" matched ${matchedPolicy.name} at ${detectedBigBox} (Assumed MSRP $${price.toFixed(2)}) -> ${dealUrl}`);
                }
            }
            if (!price || price < 18)
                continue;
            const retailer = isBigBoxRestockRadar && detectedBigBox
                ? `${detectedBigBox} [BIG-BOX RESTOCK RADAR]`
                : (detectedBigBox
                    ? `${detectedBigBox} (via PKMNTCGDeals)`
                    : (rawStoreTag ? `${rawStoreTag} (via PKMNTCGDeals)` : 'r/PKMNTCGDeals Alert'));
            const isPreOrder = /pre-?order|pre-?sale/i.test(`${title} ${post.link_flair_text || ''}`);
            const freeShipping = Boolean(isBigBoxRestockRadar || /free ship|fs/i.test(title) || (detectedBigBox && price >= 35));
            await (0, listener_1.processIncomingDrop)({
                title,
                retailer,
                url: dealUrl,
                productUrl: dealUrl,
                price,
                stock: undefined,
                itemId: `reddit_${post.id}`,
                isPreOrder,
                freeShipping,
                isBigBoxRestockRadar,
                shippingNoteOverride: isBigBoxRestockRadar
                    ? `📡 [BIG-BOX RESTOCK RADAR] Live ${detectedBigBox} Restock Signal — Assumed Retail MSRP ($${price.toFixed(2)})`
                    : undefined
            });
        }
    }
    catch (err) {
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({
            redditRssStatus: 'DEGRADED',
            lastRedditError: err?.message || 'Reddit RSS error'
        });
    }
    finally {
        isPollingReddit = false;
        setTimeout(pollRedditDeals, 45000);
    }
}
function doesTcgResultMatchFormFactor(title, targetName, formFactor, price, ruleId) {
    if (!(0, marketComps_1.isValidCompTitle)(title, targetName, formFactor, price, ruleId))
        return false;
    const t = title.toLowerCase();
    if (formFactor === 'ETB Case') {
        return (t.includes('elite trainer') || t.includes('etb')) && t.includes('case');
    }
    if (formFactor === 'Master Case') {
        return (t.includes('booster box') || t.includes('display')) && t.includes('case') && !t.includes('bundle') && !t.includes('etb');
    }
    if (formFactor === 'ETB') {
        return (t.includes('elite trainer') || t.includes('etb')) && !t.includes('case') && !t.includes('center');
    }
    if (formFactor === 'Booster Box') {
        return (t.includes('booster box') || t.includes('display')) && !t.includes('case') && !t.includes('bundle');
    }
    if (formFactor === 'Booster Bundle') {
        return t.includes('bundle') && !t.includes('case');
    }
    return true;
}
function formatTransparentMarketplaceShipping(itemPrice, shippingPrice, totalPrice) {
    const landed = totalPrice ?? Math.round(((itemPrice || 0) + (shippingPrice || 0)) * 100) / 100;
    if (shippingPrice !== undefined && shippingPrice > 0) {
        if (itemPrice > 0 && itemPrice < 35) {
            return `$${itemPrice.toFixed(2)} + $${shippingPrice.toFixed(2)} Ship ($${landed.toFixed(2)} Landed — Under $35 Threshold, 2x May Unlock Free Ship)`;
        }
        return `$${itemPrice.toFixed(2)} + $${shippingPrice.toFixed(2)} Ship ($${landed.toFixed(2)} Landed)`;
    }
    if (shippingPrice === 0) {
        return '+FREE Shipping (Confirmed $0.00 Ship)';
    }
    if (itemPrice > 0 && itemPrice < 35) {
        return '+Est. Ship / Check Cart — Under $35 Threshold, 2x May Unlock Free Ship';
    }
    return '+FREE Shipping (Over $35 Threshold)';
}
async function getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling, formFactor) {
    try {
        const url = `https://mp-search-api.tcgplayer.com/v1/product/${prodId}/listings`;
        const body = {
            filters: {
                term: { sellerStatus: "Live", channelId: 0, language: ["English"] },
                range: { quantity: { gte: 1 } },
                exclude: { channelExclusion: 0 }
            },
            from: 0,
            size: 10,
            sort: { field: "price+shipping", order: "asc" },
            context: { shippingCountry: "US", cart: {} }
        };
        const res = await smartPost(url, body, { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, 8000);
        const listings = res.data?.results?.[0]?.results || [];
        for (const l of listings) {
            const rating = parseFloat(l.sellerRating || 100);
            if (rating < 95)
                continue;
            const itemPrice = parseFloat(l.price || 0);
            const shipPrice = parseFloat(l.shippingPrice || 0);
            if (isShippingScam(itemPrice, shipPrice, formFactor))
                continue;
            const total = Math.round((itemPrice + shipPrice) * 100) / 100;
            if (itemPrice > 0 && total >= minFloor && total <= maxCeiling) {
                return {
                    price: total,
                    itemPrice,
                    shipping: shipPrice,
                    sellerName: l.sellerName || 'Verified Shop',
                    rating,
                    sales: parseInt(l.completedSales || l.sellerSales || '500', 10)
                };
            }
        }
    }
    catch (e) { }
    return null;
}
let tcgCursor = 0;
let isPollingTcg = false;
let lastTcgPollAt = 0;
async function pollTcgPlayerUndercuts() {
    if (isPollingTcg) {
        if (Date.now() - lastTcgPollAt > 90000) {
            isPollingTcg = false;
        }
        else {
            return;
        }
    }
    isPollingTcg = true;
    lastTcgPollAt = Date.now();
    try {
        const activePolicies = policies_1.WATCH_POLICIES.filter((p) => p.active !== false);
        if (activePolicies.length === 0) {
            return;
        }
        // 2x Priority Polling for the 30 "Needed for Wall" ETBs (formFactor === 'etb' && !owned)
        const neededWallEtbs = activePolicies.filter((p) => String(p.formFactor || '').toLowerCase() === 'etb' && !p.owned && !p.inVault);
        const priorityRotation = [...activePolicies, ...neededWallEtbs];
        for (let i = 0; i < 8; i++) {
            const policy = priorityRotation[tcgCursor % priorityRotation.length];
            tcgCursor = (tcgCursor + 1) % priorityRotation.length;
            const formFactor = policy.formFactor || 'Booster Box';
            const minFloor = (0, policies_1.getMinPlausiblePriceFloor)(formFactor);
            const maxCeiling = (0, policies_1.getMaxPlausiblePriceCeiling)(formFactor, policy.id, policy.name);
            const effectiveCeiling = Math.max(policy.msrpCeiling || 0, policy.maxMarketBuyPrice || 0);
            try {
                if (policy.tcgProductId) {
                    const prodId = policy.tcgProductId;
                    const bestSeller = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling, formFactor);
                    if (bestSeller && bestSeller.price >= minFloor && bestSeller.price <= maxCeiling) {
                        const isUnderTrigger = bestSeller.price <= effectiveCeiling;
                        const prev = lowestTcgSeenMap.get(policy.id);
                        const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;
                        if (!isUnderTrigger && prev?.inStockUnderTrigger) {
                            (0, evaluator_1.markLiveStockOut)(`tcg_${prodId}`);
                            (0, evaluator_1.markAlertKeyOutOfStock)(policy.id, 'TCGPlayer Verified Seller');
                        }
                        if (!prev || bestSeller.price <= prev.lowestPrice - 2 || (!prev.inStockUnderTrigger && isUnderTrigger) || minsSinceLast >= 15) {
                            lowestTcgSeenMap.set(policy.id, {
                                lowestPrice: bestSeller.price,
                                timestamp: Date.now(),
                                inStockUnderTrigger: isUnderTrigger
                            });
                            const shippingNoteOverride = formatTransparentMarketplaceShipping(bestSeller.itemPrice, bestSeller.shipping, bestSeller.price);
                            await (0, listener_1.processIncomingDrop)({
                                title: policy.name,
                                retailer: `${bestSeller.sellerName} (TCGPlayer • ${bestSeller.rating}%)`,
                                url: `https://www.tcgplayer.com/product/${prodId}?Language=English`,
                                price: bestSeller.price,
                                itemPrice: bestSeller.itemPrice,
                                shippingPrice: bestSeller.shipping,
                                shippingNoteOverride,
                                stock: undefined,
                                itemId: `tcg_${prodId}`,
                                freeShipping: true
                            });
                        }
                    }
                    continue;
                }
                const cleanQ = policy.name
                    .replace(/\(.*?\)/g, '')
                    .replace(/6-Pack /gi, '')
                    .replace(/Sealed /gi, '')
                    .replace(/Mega Evolution:/gi, '')
                    .replace(/Scarlet & Violet:/gi, '')
                    .replace(/ETB/gi, 'Elite Trainer Box')
                    .trim();
                const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(cleanQ)}&isList=false`;
                const body = {
                    algorithm: "sales_synonym_v2",
                    from: 0,
                    size: 12,
                    filters: { term: { productLineName: ["pokemon"] }, range: {}, match: {} },
                    listingSearch: { context: { cart: {} }, filters: { term: { sellerStatus: "Live", channelId: 0 }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } } },
                    context: { cart: {}, shippingCountry: "US" },
                    settings: { useFuzzySearch: true, didYouMean: {} },
                    sort: {}
                };
                const res = await smartPost(url, body, { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, 8000);
                const results = res.data?.results?.[0]?.results || [];
                for (const item of results) {
                    if (item.customAttributes?.number)
                        continue;
                    const prodTitle = `${item.productName || ''} ${item.setName || ''}`.trim();
                    if (!doesTcgResultMatchFormFactor(prodTitle, policy.name, formFactor, undefined, policy.id))
                        continue;
                    const prodId = Math.floor(Number(item.productId));
                    const bestSeller = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling, formFactor);
                    const rawItemPrice = parseFloat(item.lowestPrice || 0);
                    const rawWithShipping = parseFloat(item.lowestPriceWithShipping || item.lowestPrice || 0);
                    const rawShipDiff = rawWithShipping > rawItemPrice && rawItemPrice > 0
                        ? Math.round((rawWithShipping - rawItemPrice) * 100) / 100
                        : 0;
                    if (!bestSeller && isShippingScam(rawItemPrice, rawShipDiff, formFactor)) {
                        (0, evaluator_1.markLiveStockOut)(`tcg_${prodId}`);
                        break;
                    }
                    const fallbackCandidate = rawWithShipping || rawItemPrice;
                    const lowestPrice = bestSeller ? bestSeller.price : fallbackCandidate;
                    if (!lowestPrice || lowestPrice < minFloor || lowestPrice > maxCeiling)
                        continue;
                    const parsedItemPrice = bestSeller ? bestSeller.itemPrice : (rawItemPrice > 0 ? rawItemPrice : lowestPrice);
                    const parsedShipPrice = bestSeller
                        ? bestSeller.shipping
                        : (rawShipDiff > 0 ? rawShipDiff : undefined);
                    if (isShippingScam(parsedItemPrice, parsedShipPrice, formFactor)) {
                        (0, evaluator_1.markLiveStockOut)(`tcg_${prodId}`);
                        break;
                    }
                    const shippingNoteOverride = formatTransparentMarketplaceShipping(parsedItemPrice, parsedShipPrice, lowestPrice);
                    const shopLabel = bestSeller
                        ? `${bestSeller.sellerName} (TCGPlayer • ${bestSeller.rating}%)`
                        : `TCGPlayer Verified Seller ($${parsedItemPrice.toFixed(2)})`;
                    const isUnderTrigger = lowestPrice <= effectiveCeiling;
                    const prev = lowestTcgSeenMap.get(policy.id);
                    const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;
                    if (!isUnderTrigger) {
                        (0, evaluator_1.markLiveStockOut)(`tcg_${prodId}`);
                        if (prev?.inStockUnderTrigger) {
                            (0, evaluator_1.markAlertKeyOutOfStock)(policy.id, 'TCGPlayer Verified Seller');
                        }
                    }
                    // Pass to processIncomingDrop when newly seen, price drops, flips into trigger, or every 15m so bestCurrentOffers / Near Misses stay fresh
                    if (!prev || lowestPrice <= prev.lowestPrice - 2 || (!prev.inStockUnderTrigger && isUnderTrigger) || minsSinceLast >= 15) {
                        lowestTcgSeenMap.set(policy.id, {
                            lowestPrice,
                            timestamp: Date.now(),
                            inStockUnderTrigger: isUnderTrigger
                        });
                        const isPreOrder = /pre-?order|pre-?sale/i.test(prodTitle);
                        await (0, listener_1.processIncomingDrop)({
                            title: prodTitle,
                            retailer: shopLabel,
                            url: `https://www.tcgplayer.com/product/${prodId}?Language=English`,
                            price: lowestPrice,
                            itemPrice: parsedItemPrice,
                            shippingPrice: parsedShipPrice,
                            shippingNoteOverride,
                            stock: undefined,
                            itemId: `tcg_${prodId}`,
                            isPreOrder,
                            freeShipping: true
                        });
                    }
                    break;
                }
            }
            catch (e) { }
        }
    }
    finally {
        isPollingTcg = false;
        setTimeout(pollTcgPlayerUndercuts, 12000);
    }
}
