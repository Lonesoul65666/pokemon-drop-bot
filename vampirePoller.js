"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pollRedditDeals = pollRedditDeals;
exports.pollTcgPlayerUndercuts = pollTcgPlayerUndercuts;
const axios_1 = __importDefault(require("axios"));
const lgsPoller_1 = require("./lgsPoller");
const listener_1 = require("./listener");
const policies_1 = require("./policies");
const seenRedditIds = new Set();
const seenTcgPrices = new Map();
// A. Vampiric Reddit Deal Monitor (Catches Target, Best Buy, Walmart, Costco, Pokemon Center & LGS drops posted to r/PKMNTCGDeals)
async function pollRedditDeals() {
    try {
        const proxy = (0, lgsPoller_1.getNextProxy)();
        const res = await axios_1.default.get('https://www.reddit.com/r/PKMNTCGDeals/new.json?limit=15', {
            timeout: 8000,
            httpsAgent: proxy,
            headers: {
                'User-Agent': 'Windows:DropBotCommander:v2.1 (by /u/Lonesoul65666)',
                Accept: 'application/json'
            }
        });
        const posts = res.data?.data?.children || [];
        for (const child of posts) {
            const post = child.data;
            if (!post || seenRedditIds.has(post.id))
                continue;
            seenRedditIds.add(post.id);
            // Only evaluate fresh posts from the last 2 hours
            const ageSeconds = (Date.now() / 1000) - (post.created_utc || 0);
            if (ageSeconds > 7200)
                continue;
            const title = post.title || '';
            const priceMatch = title.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
            if (!priceMatch)
                continue;
            const price = parseFloat(priceMatch[1]);
            const dealUrl = post.url_overridden_by_dest || `https://www.reddit.com${post.permalink}`;
            // Extract retailer tag like [Target] or [Best Buy] if present
            const storeMatch = title.match(/^\[([^\]]+)\]/);
            const retailer = storeMatch ? `${storeMatch[1]} (via PKMNTCGDeals)` : 'r/PKMNTCGDeals Alert';
            await (0, listener_1.processIncomingDrop)({
                title,
                retailer,
                url: dealUrl,
                price,
                stock: 1,
                itemId: `reddit_${post.id}`
            });
        }
    }
    catch (e) {
        // Ignore transient Reddit rate limits
    }
    setTimeout(pollRedditDeals, 60000); // Check every 60 seconds
}
// B. TCGPlayer Lowest-Listing Undercut Sniper (Catches individual sellers listing below your Max Buy Trigger)
let tcgCursor = 0;
async function pollTcgPlayerUndercuts() {
    const activePolicies = policies_1.WATCH_POLICIES.filter((p) => p.active !== false);
    if (activePolicies.length === 0) {
        setTimeout(pollTcgPlayerUndercuts, 30000);
        return;
    }
    // Check 4 items per cycle so we sweep the catalog smoothly without rate-limiting
    for (let i = 0; i < 4; i++) {
        const policy = activePolicies[tcgCursor % activePolicies.length];
        tcgCursor = (tcgCursor + 1) % activePolicies.length;
        try {
            const cleanQ = policy.name
                .replace(/\(36-Pack\)/gi, '')
                .replace(/\(6 Boxes \/ 216 Packs\)/gi, '')
                .replace(/\(10 ETBs\)/gi, '')
                .replace(/6-Pack /gi, '')
                .replace(/Sealed /gi, '')
                .trim();
            const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(cleanQ)}&isList=false`;
            const body = {
                algorithm: "sales_synonym_v2",
                from: 0,
                size: 6,
                filters: { term: { productLineName: ["pokemon"] }, range: {}, match: {} },
                listingSearch: { context: { cart: {} }, filters: { term: { sellerStatus: "Live", channelId: 0 }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } } },
                context: { cart: {}, shippingCountry: "US" },
                settings: { useFuzzySearch: false, didYouMean: {} },
                sort: {}
            };
            const res = await axios_1.default.post(url, body, {
                timeout: 6000,
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
            });
            const results = res.data?.results?.[0]?.results || [];
            for (const item of results) {
                if (item.customAttributes?.number)
                    continue;
                const prodTitle = `${item.productName || ''} ${item.setName || ''}`;
                const lowestPrice = parseFloat(item.lowestPriceWithShipping || item.lowestPrice || 0);
                if (!lowestPrice || lowestPrice <= 0)
                    continue;
                // Only process if the price changed or hasn't been seen at this level
                const prevPrice = seenTcgPrices.get(policy.id);
                if (prevPrice !== lowestPrice) {
                    seenTcgPrices.set(policy.id, lowestPrice);
                    const prodId = Math.floor(Number(item.productId));
                    await (0, listener_1.processIncomingDrop)({
                        title: prodTitle,
                        retailer: 'TCGPlayer Verified Seller',
                        url: `https://www.tcgplayer.com/product/${prodId}`,
                        price: lowestPrice,
                        stock: 1,
                        itemId: `tcg_${prodId}_${lowestPrice}`
                    });
                }
                break;
            }
        }
        catch (e) { }
    }
    setTimeout(pollTcgPlayerUndercuts, 15000);
}
