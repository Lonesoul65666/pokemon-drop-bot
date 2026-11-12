"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBestBuyOfficialApiConfigured = isBestBuyOfficialApiConfigured;
exports.pollBestBuyOfficialProductsApi = pollBestBuyOfficialProductsApi;
const policies_1 = require("../../policies");
const bigBoxAdapters_1 = require("./bigBoxAdapters");
function isBestBuyOfficialApiConfigured() {
    return Boolean(String(process.env.BESTBUY_API_KEY || '').trim());
}
async function pollBestBuyOfficialProductsApi() {
    const apiKey = String(process.env.BESTBUY_API_KEY || '').trim();
    const empty = { totalNodesFound: 0, inStockOffers: [] };
    if (!apiKey) {
        return { configured: false, ok: false, status: 0, parsed: empty };
    }
    const seededSkus = policies_1.WATCH_POLICIES
        .map((p) => String(p.bestBuySku || '').trim())
        .filter((sku) => /^\d{7}$/.test(sku))
        .slice(0, 25);
    const filter = seededSkus.length > 0
        ? `sku in(${seededSkus.join(',')})`
        : 'search=pokemon&search=elite&search=trainer&search=box';
    const apiUrl = `https://api.bestbuy.com/v1/products(${filter})` +
        `?apiKey=${encodeURIComponent(apiKey)}&format=json&pageSize=25` +
        `&show=sku,name,salePrice,regularPrice,onlineAvailability,buttonState`;
    try {
        const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
            return { configured: true, ok: false, status: res.status, parsed: empty };
        }
        const data = await res.json();
        const parsed = (0, bigBoxAdapters_1.parseBestBuyPayload)(data);
        return { configured: true, ok: true, status: res.status, parsed };
    }
    catch {
        return { configured: true, ok: false, status: 0, parsed: empty };
    }
}
