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
const TRACKALACKER_PAGES = [
    { slug: 'pokemon-30th-celebration-elite-trainer-box', title: 'Pokemon 30th Celebration Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-30th-celebration-booster-bundle', title: 'Pokemon 30th Celebration Booster Bundle', formFactor: 'Booster Bundle' },
    { slug: 'pokemon-mega-evolution-phantasmal-flames-elite-trainer-box', title: 'Mega Evolution Phantasmal Flames Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-mega-evolution-phantasmal-flames-booster-box', title: 'Mega Evolution Phantasmal Flames Booster Box', formFactor: 'Booster Box' },
    { slug: 'pokemon-mega-evolution-ascended-heroes-elite-trainer-box', title: 'Mega Evolution Ascended Heroes Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-mega-evolution-ascended-heroes-booster-bundle', title: 'Mega Evolution Ascended Heroes Booster Bundle', formFactor: 'Booster Bundle' },
    { slug: 'pokemon-mega-evolution-mega-discovery-elite-trainer-box', title: 'Mega Evolution Mega Discovery Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-mega-evolution-mega-discovery-booster-box', title: 'Mega Evolution Mega Discovery Booster Box', formFactor: 'Booster Box' },
    { slug: 'pokemon-prismatic-evolutions-elite-trainer-box', title: 'Pokemon Prismatic Evolutions Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-prismatic-evolutions-pokemon-center-elite-trainer-box', title: 'Pokemon Prismatic Evolutions Pokemon Center Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-prismatic-evolutions-booster-bundle', title: 'Pokemon Prismatic Evolutions Booster Bundle', formFactor: 'Booster Bundle' },
    { slug: 'pokemon-scarlet-and-violet-151-booster-bundle', title: 'Pokemon Scarlet & Violet 151 Booster Bundle', formFactor: 'Booster Bundle' },
    { slug: 'pokemon-scarlet-and-violet-151-elite-trainer-box', title: 'Pokemon Scarlet & Violet 151 Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-scarlet-and-violet-151-pokemon-center-elite-trainer-box', title: 'Pokemon Scarlet & Violet 151 Pokemon Center Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-destined-rivals-elite-trainer-box', title: 'Pokemon Destined Rivals Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-destined-rivals-pokemon-center-elite-trainer-box', title: 'Pokemon Destined Rivals Pokemon Center Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-destined-rivals-booster-box', title: 'Pokemon Destined Rivals Booster Box', formFactor: 'Booster Box' },
    { slug: 'pokemon-journey-together-elite-trainer-box', title: 'Pokemon Journey Together Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-journey-together-pokemon-center-elite-trainer-box', title: 'Pokemon Journey Together Pokemon Center Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-journey-together-booster-box', title: 'Pokemon Journey Together Booster Box', formFactor: 'Booster Box' },
    { slug: 'pokemon-surging-sparks-elite-trainer-box', title: 'Pokemon Surging Sparks Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-surging-sparks-pokemon-center-elite-trainer-box', title: 'Pokemon Surging Sparks Pokemon Center Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-surging-sparks-booster-box', title: 'Pokemon Surging Sparks Booster Box', formFactor: 'Booster Box' },
    { slug: 'pokemon-surging-sparks-booster-bundle', title: 'Pokemon Surging Sparks Booster Bundle', formFactor: 'Booster Bundle' },
    { slug: 'pokemon-paldean-fates-elite-trainer-box', title: 'Pokemon Paldean Fates Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-paldean-fates-booster-bundle', title: 'Pokemon Paldean Fates Booster Bundle', formFactor: 'Booster Bundle' },
    { slug: 'pokemon-black-bolt-elite-trainer-box', title: 'Pokemon Black Bolt Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-white-flare-elite-trainer-box', title: 'Pokemon White Flare Elite Trainer Box', formFactor: 'ETB' },
    { slug: 'pokemon-twilight-masquerade-booster-box', title: 'Pokemon Twilight Masquerade Booster Box', formFactor: 'Booster Box' },
    { slug: 'pokemon-paldea-evolved-booster-box', title: 'Pokemon Paldea Evolved Booster Box', formFactor: 'Booster Box' },
    { slug: 'pokemon-crown-zenith-elite-trainer-box', title: 'Pokemon Crown Zenith Elite Trainer Box', formFactor: 'ETB' }
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
const SUPPORTED_BIG_BOX_REGEX = /target|best\s*buy|pokemon\s*center|pokémon\s*center|pokemoncenter|walmart|amazon|gamestop|costco|sam'?s\s*club|samsclub|barnes\s*(&|and)\s*noble|\bb&n\b/i;
function normalizeBigBoxRetailerLabel(rawSeller, rawUrl, sourceSuffix = 'Big-Box Restock') {
    const detected = (0, policies_1.detectBigBoxRetailer)(rawSeller, rawUrl);
    if (detected) {
        return `${detected} (${sourceSuffix})`;
    }
    return `${rawSeller.trim()} (${sourceSuffix})`;
}
async function smartGet(url, headers, timeout = 8000) {
    try {
        return await axios_1.default.get(url, { timeout, headers });
    }
    catch (e) {
        return await axios_1.default.get(url, { timeout, httpsAgent: (0, lgsPoller_1.getNextProxy)(), headers });
    }
}
async function smartPost(url, body, headers, timeout = 6000) {
    try {
        return await axios_1.default.post(url, body, { timeout, headers });
    }
    catch (e) {
        return await axios_1.default.post(url, body, { timeout, httpsAgent: (0, lgsPoller_1.getNextProxy)(), headers });
    }
}
let tlCursor = 0;
let isPollingBigBox = false;
async function pollBigBoxAggregators() {
    if (isPollingBigBox)
        return;
    isPollingBigBox = true;
    const target = TRACKALACKER_PAGES[tlCursor % TRACKALACKER_PAGES.length];
    tlCursor = (tlCursor + 1) % TRACKALACKER_PAGES.length;
    try {
        const url = `https://www.trackalacker.com/products/showcase/${target.slug}`;
        const res = await smartGet(url, {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml'
        }, 8000);
        const html = res.data || '';
        const extractedOffers = [];
        // 1. Parse JSON-LD InStock Offer Blocks
        const offerBlocks = [...html.matchAll(/\{[^{}]*"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"[^{}]*\}/gi)];
        for (const m of offerBlocks) {
            const raw = m[0];
            const priceMatch = raw.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i);
            const sellerMatch = raw.match(/"name"\s*:\s*"([^"]+)"/i);
            const urlMatch = raw.match(/"url"\s*:\s*"([^"]+)"/i);
            if (priceMatch) {
                extractedOffers.push({
                    seller: sellerMatch ? sellerMatch[1] : 'Big-Box Retailer',
                    price: parseFloat(priceMatch[1]),
                    link: urlMatch ? urlMatch[1] : url,
                    rawText: raw
                });
            }
        }
        // 2. Parse HTML live In-Stock retailer rows for Target, Best Buy, Pokemon Center, Walmart, Amazon, GameStop, Costco, Sam's Club, Barnes & Noble
        const rowMatches = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
        for (const rm of rowMatches) {
            const rowHtml = rm[1];
            if (!/in\s*stock|available\s*now|add\s*to\s*cart|pre-?order\s*now/i.test(rowHtml))
                continue;
            if (/out\s*of\s*stock|sold\s*out|unavailable/i.test(rowHtml))
                continue;
            const retailerMatch = rowHtml.match(/(Target|Best\s*Buy|Pok[eé]mon\s*Center|Walmart|Amazon|GameStop|Costco|Sam'?s\s*Club|Barnes\s*(?:&|and|&amp;)\s*Noble)/i);
            const priceMatch = rowHtml.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
            const hrefMatch = rowHtml.match(/href="([^"]+)"/i);
            if (retailerMatch && priceMatch) {
                const rawHref = hrefMatch ? hrefMatch[1] : url;
                const resolvedLink = rawHref.startsWith('http') ? rawHref : `https://www.trackalacker.com${rawHref}`;
                extractedOffers.push({
                    seller: retailerMatch[1].replace(/&amp;/gi, '&'),
                    price: parseFloat(priceMatch[1]),
                    link: resolvedLink,
                    rawText: rowHtml
                });
            }
        }
        for (const offer of extractedOffers) {
            const { seller, price, link, rawText } = offer;
            if (/ebay|tcgplayer|stockx|goat|mercari/i.test(`${seller} ${link}`))
                continue;
            if (!SUPPORTED_BIG_BOX_REGEX.test(`${seller} ${link}`) && seller !== 'Big-Box Retailer')
                continue;
            const normalizedRetailer = normalizeBigBoxRetailerLabel(seller, link, 'Big-Box Restock');
            if (!(0, policies_1.isValidSkuForFormFactor)(target.title, target.formFactor, price, {
                handle: link,
                retailer: normalizedRetailer,
                sourceUrl: link,
                allowPcRetailUnlock: true
            })) {
                continue;
            }
            const offerKey = `${target.slug}_${normalizedRetailer}_${price}`;
            const lastSeen = seenBigBoxOffers.get(offerKey) || 0;
            if (Date.now() - lastSeen > 1000 * 60 * 60 * 4) {
                seenBigBoxOffers.set(offerKey, Date.now());
                const isPreOrder = /pre-?order|pre-?sale/i.test(`${target.title} ${rawText}`);
                const isBigBoxFreeShip = price >= 35 && SUPPORTED_BIG_BOX_REGEX.test(normalizedRetailer);
                await (0, listener_1.processIncomingDrop)({
                    title: target.title,
                    retailer: normalizedRetailer,
                    url: link,
                    price,
                    stock: undefined,
                    itemId: offerKey,
                    isPreOrder,
                    freeShipping: isBigBoxFreeShip
                });
            }
        }
    }
    catch (e) {
    }
    finally {
        isPollingBigBox = false;
        setTimeout(pollBigBoxAggregators, 10000);
    }
}
function extractOutboundRetailerUrl(text, fallbackUrl) {
    const urlMatch = text.match(/https?:\/\/(?:www\.)?(?:target\.com|bestbuy\.com|pokemoncenter\.com|walmart\.com|amazon\.com|a\.co|gamestop\.com|costco\.com|samsclub\.com|barnesandnoble\.com)[^\s)"\]<>]*/i);
    return urlMatch ? urlMatch[0] : fallbackUrl;
}
let isPollingReddit = false;
async function pollRedditDeals() {
    if (isPollingReddit)
        return;
    isPollingReddit = true;
    try {
        const feeds = [
            'https://www.reddit.com/r/PKMNTCGDeals/new.json?limit=20',
            'https://www.reddit.com/r/PKMNTCGDeals/hot.json?limit=15'
        ];
        const posts = [];
        for (const feedUrl of feeds) {
            try {
                const res = await smartGet(feedUrl, {
                    'User-Agent': 'Windows:DropBotCommander:v3.3 (by /u/Lonesoul65666)',
                    Accept: 'application/json'
                }, 8000);
                const children = res.data?.data?.children || [];
                for (const c of children) {
                    if (c?.data)
                        posts.push(c.data);
                }
            }
            catch (e) { }
        }
        // Fallback to RSS/Atom feed if JSON endpoints return 0 posts
        if (posts.length === 0) {
            try {
                const rssRes = await smartGet('https://www.reddit.com/r/PKMNTCGDeals/new/.rss', {
                    'User-Agent': 'Windows:DropBotCommander:v3.3 (by /u/Lonesoul65666)',
                    Accept: 'application/atom+xml,application/xml,text/xml'
                }, 8000);
                const xml = rssRes.data || '';
                const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
                for (const ent of entries) {
                    const block = ent[1];
                    const idMatch = block.match(/<id>([^<]+)<\/id>/i);
                    const titleMatch = block.match(/<title>([^<]+)<\/title>/i);
                    const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
                    const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
                    if (idMatch && titleMatch) {
                        posts.push({
                            id: idMatch[1],
                            title: titleMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
                            url_overridden_by_dest: linkMatch ? linkMatch[1] : '',
                            selftext: contentMatch ? contentMatch[1] : '',
                            created_utc: Math.floor(Date.now() / 1000) - 60
                        });
                    }
                }
            }
            catch (e) { }
        }
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
            const priceMatch = `${title} ${selftext}`.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
            if (!priceMatch)
                continue;
            const price = parseFloat(priceMatch[1]);
            if (price < 18)
                continue;
            const rawDest = post.url_overridden_by_dest || `https://www.reddit.com${post.permalink || ''}`;
            const dealUrl = extractOutboundRetailerUrl(`${rawDest} ${selftext}`, rawDest);
            const storeMatch = title.match(/^\[([^\]]+)\]/);
            const rawStoreTag = storeMatch ? storeMatch[1] : '';
            const detectedBigBox = (0, policies_1.detectBigBoxRetailer)(`${rawStoreTag} ${title}`, dealUrl);
            const retailer = detectedBigBox
                ? `${detectedBigBox} (via PKMNTCGDeals)`
                : (rawStoreTag ? `${rawStoreTag} (via PKMNTCGDeals)` : 'r/PKMNTCGDeals Alert');
            const isPreOrder = /pre-?order|pre-?sale/i.test(`${title} ${post.link_flair_text || ''}`);
            const freeShipping = Boolean(/free ship|fs/i.test(title) || (detectedBigBox && price >= 35));
            await (0, listener_1.processIncomingDrop)({
                title,
                retailer,
                url: dealUrl,
                price,
                stock: undefined,
                itemId: `reddit_${post.id}`,
                isPreOrder,
                freeShipping
            });
        }
    }
    catch (e) {
    }
    finally {
        isPollingReddit = false;
        setTimeout(pollRedditDeals, 60000);
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
async function getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling) {
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
            const total = Math.round((itemPrice + shipPrice) * 100) / 100;
            if (itemPrice > 0 && total >= minFloor && total <= maxCeiling) {
                return {
                    price: total,
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
async function pollTcgPlayerUndercuts() {
    if (isPollingTcg)
        return;
    isPollingTcg = true;
    try {
        const activePolicies = policies_1.WATCH_POLICIES.filter((p) => p.active !== false);
        if (activePolicies.length === 0) {
            return;
        }
        for (let i = 0; i < 6; i++) {
            const policy = activePolicies[tcgCursor % activePolicies.length];
            tcgCursor = (tcgCursor + 1) % activePolicies.length;
            const formFactor = policy.formFactor || 'Booster Box';
            const minFloor = (0, policies_1.getMinPlausiblePriceFloor)(formFactor);
            const maxCeiling = (0, policies_1.getMaxPlausiblePriceCeiling)(formFactor, policy.id, policy.name);
            try {
                if (policy.tcgProductId) {
                    const prodId = policy.tcgProductId;
                    const bestSeller = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling);
                    if (bestSeller && bestSeller.price >= minFloor && bestSeller.price <= maxCeiling) {
                        const prev = lowestTcgSeenMap.get(policy.id);
                        const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;
                        if (!prev || bestSeller.price <= prev.lowestPrice - 2 || minsSinceLast >= 15) {
                            lowestTcgSeenMap.set(policy.id, { lowestPrice: bestSeller.price, timestamp: Date.now() });
                            await (0, listener_1.processIncomingDrop)({
                                title: policy.name,
                                retailer: `${bestSeller.sellerName} (TCGPlayer • ${bestSeller.rating}%)`,
                                url: `https://www.tcgplayer.com/product/${prodId}?Language=English`,
                                price: bestSeller.price,
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
                    const bestSeller = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling);
                    const fallbackCandidate = parseFloat(item.lowestPriceWithShipping || item.lowestPrice || 0);
                    const lowestPrice = bestSeller ? bestSeller.price : fallbackCandidate;
                    if (!lowestPrice || lowestPrice < minFloor || lowestPrice > maxCeiling)
                        continue;
                    const shopLabel = bestSeller
                        ? `${bestSeller.sellerName} (TCGPlayer • ${bestSeller.rating}%)`
                        : 'TCGPlayer Verified Seller';
                    const effectiveCeiling = Math.max(policy.msrpCeiling || 0, policy.maxMarketBuyPrice || 0);
                    if (lowestPrice > effectiveCeiling) {
                        (0, evaluator_1.markLiveStockOut)(`tcg_${prodId}`);
                        break;
                    }
                    const prev = lowestTcgSeenMap.get(policy.id);
                    const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;
                    if (!prev || lowestPrice <= prev.lowestPrice - 2 || minsSinceLast >= 15) {
                        lowestTcgSeenMap.set(policy.id, { lowestPrice, timestamp: Date.now() });
                        const isPreOrder = /pre-?order|pre-?sale/i.test(prodTitle);
                        await (0, listener_1.processIncomingDrop)({
                            title: prodTitle,
                            retailer: shopLabel,
                            url: `https://www.tcgplayer.com/product/${prodId}?Language=English`,
                            price: lowestPrice,
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
