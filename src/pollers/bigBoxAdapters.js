"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePokemonCenterPayload = exports.parseBarnesAndNoblePayload = exports.parseAmazon1pPayload = exports.parseGameStopPayload = exports.resetBigBoxAdapterDedup = exports.discoveredRetailIds = exports.AMAZON_1P_MERCHANT_ID = exports.WALMART_1P_SELLER_ID = void 0;
exports.cleanHtmlText = cleanHtmlText;
exports.resolveBigBoxPolicyMatch = resolveBigBoxPolicyMatch;
exports.parseTargetRedskyPayload = parseTargetRedskyPayload;
exports.parseWalmartPayload = parseWalmartPayload;
exports.parseBestBuyPayload = parseBestBuyPayload;
exports.parseCostcoPayload = parseCostcoPayload;
exports.parseSamsClubPayload = parseSamsClubPayload;
exports.dispatchVerifiedBigBoxHits = dispatchVerifiedBigBoxHits;
const listener_1 = require("../../listener");
const policies_1 = require("../../policies");
exports.WALMART_1P_SELLER_ID = 'F55CDC31AB754BB68FE0B39041159D63';
exports.AMAZON_1P_MERCHANT_ID = 'ATVPDKIKX0DER';
const seenBigBoxOffers = new Map();
exports.discoveredRetailIds = new Map();
const resetBigBoxAdapterDedup = () => { seenBigBoxOffers.clear(); };
exports.resetBigBoxAdapterDedup = resetBigBoxAdapterDedup;
function cleanHtmlText(s) {
    return String(s || '')
        .replace(/&#38;|&amp;/gi, '&')
        .replace(/&#8212;|&mdash;/gi, ' - ')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function resolveBigBoxPolicyMatch(params) {
    const title = cleanHtmlText(params.title);
    const price = Number(params.price);
    if (!title || !Number.isFinite(price) || price < 18)
        return null;
    if ((0, policies_1.isSingleCardOrNonSealed)(title, undefined, params.url) || !(0, policies_1.hasMandatorySealedContainerKeyword)(title))
        return null;
    let rule = null;
    if (params.tokenField && params.tokenValue) {
        const tok = String(params.tokenValue).trim().toLowerCase();
        const seeded = policies_1.WATCH_POLICIES.find((p) => p.active !== false && String(p[params.tokenField] || '').toLowerCase().includes(tok));
        if (seeded &&
            (0, policies_1.hasMandatorySealedContainerKeyword)(title, seeded.formFactor) &&
            (0, policies_1.isValidSkuForFormFactor)(title, seeded.formFactor, price, {
                ruleId: seeded.id,
                targetName: seeded.name,
                handle: params.url,
                retailer: params.retailer,
                sourceUrl: params.url,
                allowPcRetailUnlock: Boolean(params.allowPcRetailUnlock)
            })) {
            rule = seeded;
        }
    }
    if (!rule) {
        rule = (0, policies_1.matchProductToSku)(title, price, {
            handle: params.url,
            retailer: params.retailer,
            sourceUrl: params.url,
            allowPcRetailUnlock: Boolean(params.allowPcRetailUnlock)
        });
    }
    if (!rule)
        return null;
    const isPc = Boolean(params.allowPcRetailUnlock);
    const baseMsrp = isPc && String(rule.formFactor || '').toUpperCase() === 'ETB'
        ? Math.max(59.99, rule.msrpCeiling || 59.99)
        : (rule.msrpCeiling || 54.99);
    if (price > Math.round(baseMsrp * 1.08 * 100) / 100)
        return null;
    if (params.tokenField && params.tokenValue)
        exports.discoveredRetailIds.set(`${params.tokenField}:${params.tokenValue}`, rule.id);
    return rule;
}
function parseTargetRedskyPayload(payloadsOrObj, fallbackHtml = '') {
    const inStockOffers = [];
    const seenTcins = new Set();
    const seenHits = new Set();
    const envelopes = Array.isArray(payloadsOrObj) ? payloadsOrObj : (payloadsOrObj ? [payloadsOrObj] : []);
    for (const env of envelopes) {
        const payload = env?.data?.data ? env.data : env;
        const rawList = payload?.data?.search?.products ||
            payload?.data?.product_summaries ||
            (payload?.data?.product ? [payload.data.product] : []);
        if (!Array.isArray(rawList))
            continue;
        for (const p of rawList) {
            const tcin = String(p?.tcin || '').trim();
            const title = cleanHtmlText(p?.item?.product_description?.title || p?.title || '');
            if (!tcin && !title)
                continue;
            seenTcins.add(tcin || title);
            if (tcin && seenHits.has(tcin))
                continue;
            const price = parseFloat(String(p?.price?.current_retail ?? p?.price?.reg_retail ?? 0));
            const vendors = Array.isArray(p?.item?.product_vendors)
                ? p.item.product_vendors.map((v) => String(v?.vendor_name || '')).join(' ')
                : String(p?.sold_by || '');
            const is3p = Boolean(p?.fulfillment?.is_marketplace ||
                p?.item?.relationship_type_code === 'MP' ||
                /target\s*plus|blueproton|collectors\s*emporium|marketplace/i.test(vendors));
            if (is3p || !tcin || !title || !price)
                continue;
            const shipOpt = p?.fulfillment?.shipping_options;
            const availStatus = String(shipOpt?.availability_status || p?.availability_status || '').toUpperCase();
            const allOos = p?.fulfillment?.is_out_of_stock_in_all_online_locations;
            const isOnlineInStock = availStatus === 'IN_STOCK' ||
                availStatus === 'AVAILABLE' ||
                availStatus === 'PRE_ORDER_SELLABLE' ||
                availStatus === 'LIMITED_STOCK' ||
                (!availStatus && allOos === false && Number(shipOpt?.available_to_promise_quantity ?? 1) > 0);
            if (!isOnlineInStock || /OUT_OF_STOCK|SOLD_OUT|UNAVAILABLE|DISCONTINUED/i.test(availStatus))
                continue;
            const targetUrl = `https://www.target.com/p/-/A-${tcin}`;
            if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Target', url: targetUrl, tokenField: 'targetTcin', tokenValue: tcin }))
                continue;
            seenHits.add(tcin);
            inStockOffers.push({
                title, retailer: 'Target', url: targetUrl, productUrl: targetUrl,
                price, itemId: `target_${tcin}`, isPreOrder: availStatus === 'PRE_ORDER_SELLABLE' || /pre-?order/i.test(title), freeShipping: price >= 35
            });
        }
    }
    if (seenTcins.size === 0 && fallbackHtml) {
        for (const m of fallbackHtml.matchAll(/\/p\/[^"'?#]*-\/A-(\d{8,10})/gi)) {
            seenTcins.add(m[1]);
        }
    }
    return { totalNodesFound: seenTcins.size, inStockOffers };
}
function parseWalmartPayload(raw, capturedJsons = []) {
    const inStockOffers = [];
    const seenIds = new Set();
    const seenHits = new Set();
    const dataSources = [];
    if (typeof raw === 'string') {
        const m = raw.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (m) {
            try {
                dataSources.push(JSON.parse(m[1]));
            }
            catch { }
        }
    }
    else if (raw && typeof raw === 'object') {
        dataSources.push(raw);
    }
    for (const cj of capturedJsons) {
        if (cj?.data)
            dataSources.push(cj.data);
    }
    for (const data of dataSources) {
        const items = [];
        const stacks = data?.props?.pageProps?.initialData?.searchResult?.itemStacks || data?.data?.search?.searchResult?.itemStacks || data?.itemStacks || [];
        for (const st of stacks) {
            if (Array.isArray(st?.items))
                items.push(...st.items);
        }
        const pdpProd = data?.props?.pageProps?.initialData?.data?.product || data?.product;
        if (pdpProd)
            items.push(pdpProd);
        for (const it of items) {
            const itemId = String(it?.usItemId || it?.id || '').trim();
            const title = cleanHtmlText(it?.name || it?.title || '');
            if (!itemId || !title)
                continue;
            seenIds.add(itemId);
            if (seenHits.has(itemId))
                continue;
            const price = parseFloat(String(it?.priceInfo?.currentPrice?.price ?? it?.priceInfo?.linePrice ?? it?.price ?? 0).replace(/[^0-9.]/g, ''));
            const sellerId = String(it?.sellerId || it?.catalogSellerId || '');
            const sellerName = String(it?.sellerName || '');
            const is1pWalmart = sellerId === exports.WALMART_1P_SELLER_ID || (!sellerId && /^walmart(\.com)?$/i.test(sellerName.trim()));
            const avail = String(it?.availabilityStatusV2?.value || it?.availabilityStatus || '').toUpperCase();
            if (!is1pWalmart || !price || (avail !== 'IN_STOCK' && avail !== 'PRE_ORDER'))
                continue;
            const pacUrl = `https://www.walmart.com/pac?id=${itemId}&quantity=1`;
            const pdpUrl = `https://www.walmart.com/ip/${itemId}`;
            if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Walmart', url: pdpUrl, tokenField: 'walmartItemId', tokenValue: itemId }))
                continue;
            seenHits.add(itemId);
            inStockOffers.push({
                title, retailer: 'Walmart', url: pacUrl, productUrl: pdpUrl, cart1xUrl: pacUrl,
                price, itemId: `walmart_${itemId}`, isPreOrder: Boolean(it?.isPreorder || avail === 'PRE_ORDER' || /pre-?order/i.test(title)), freeShipping: price >= 35
            });
        }
    }
    return { totalNodesFound: seenIds.size, inStockOffers };
}
const bigBoxDomParsers_1 = require("./bigBoxDomParsers");
Object.defineProperty(exports, "parseGameStopPayload", { enumerable: true, get: function () { return bigBoxDomParsers_1.parseGameStopPayload; } });
Object.defineProperty(exports, "parseAmazon1pPayload", { enumerable: true, get: function () { return bigBoxDomParsers_1.parseAmazon1pPayload; } });
Object.defineProperty(exports, "parseBarnesAndNoblePayload", { enumerable: true, get: function () { return bigBoxDomParsers_1.parseBarnesAndNoblePayload; } });
Object.defineProperty(exports, "parsePokemonCenterPayload", { enumerable: true, get: function () { return bigBoxDomParsers_1.parsePokemonCenterPayload; } });
function parseBestBuyPayload(raw) {
    if (typeof raw === 'object' && raw !== null && Array.isArray(raw.products)) {
        const inStockOffers = [];
        let totalNodesFound = 0;
        for (const p of raw.products) {
            const sku = String(p.sku || p.skuId || '').trim();
            const title = cleanHtmlText(p.name || '');
            if (!sku || !title)
                continue;
            totalNodesFound += 1;
            const state = p.onlineAvailability === true ? 'ADD_TO_CART' : String(p.buttonState || p.orderable || 'SOLD_OUT');
            if (!/^(ADD_TO_CART|PRE_ORDER|ONLINE_ONLY|INSTOCK|AVAILABLE)$/i.test(state.trim()))
                continue;
            const price = Number(p.salePrice ?? p.regularPrice ?? p.currentPrice ?? 0);
            const atcUrl = `https://api.bestbuy.com/click/-/${sku}/cart`;
            const pdpUrl = `https://www.bestbuy.com/site/-/${sku}.p?skuId=${sku}`;
            if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Best Buy', url: pdpUrl, tokenField: 'bestBuySku', tokenValue: sku }))
                continue;
            inStockOffers.push({
                title, retailer: 'Best Buy', url: atcUrl, productUrl: pdpUrl, cart1xUrl: atcUrl,
                price, itemId: `bestbuy_${sku}`, isPreOrder: /PRE_ORDER/i.test(state), freeShipping: price >= 35
            });
        }
        return { totalNodesFound, inStockOffers };
    }
    return (0, bigBoxDomParsers_1.parseBestBuyDom)(String(raw || ''));
}
function parseCostcoPayload(html, capturedJsons = []) {
    const domRes = (0, bigBoxDomParsers_1.parseCostcoDom)(html);
    const seenIds = new Set(domRes.inStockOffers.map((o) => String(o.itemId)));
    let apiNodes = 0;
    for (const cj of capturedJsons) {
        const data = cj?.data || cj;
        const docs = data?.docs || data?.products || data?.searchResults || data?.items || [];
        if (!Array.isArray(docs))
            continue;
        for (const d of docs) {
            const id = String(d?.item_number || d?.id || d?.partNumber || d?.sku || '').trim();
            const title = cleanHtmlText(d?.item_product_name || d?.name || d?.title || '');
            if (!id && !title)
                continue;
            apiNodes += 1;
            const status = String(d?.deliveryStatus || d?.inventoryStatus || d?.item_Availability || 'IN_STOCK');
            if (/out[\s_]*of[\s_]*stock|unavailable|sold[\s_]*out/i.test(status))
                continue;
            const price = parseFloat(String(d?.item_location_pricing_salePrice ?? d?.price ?? d?.finalPrice ?? 0).replace(/[^0-9.]/g, ''));
            const rawUrl = String(d?.url || d?.item_product_url || '');
            const url = rawUrl.startsWith('http') ? rawUrl : `https://www.costco.com/${rawUrl.replace(/^\//, '') || `.product.${id}.html`}`;
            const itemKey = `costco_${id}`;
            if (seenIds.has(itemKey) || !price || !resolveBigBoxPolicyMatch({ title, price, retailer: 'Costco', url }))
                continue;
            seenIds.add(itemKey);
            domRes.inStockOffers.push({ title, retailer: 'Costco', url, productUrl: url, price, itemId: itemKey, freeShipping: true });
        }
    }
    return { totalNodesFound: Math.max(domRes.totalNodesFound, apiNodes), inStockOffers: domRes.inStockOffers };
}
function parseSamsClubPayload(raw, capturedJsons = []) {
    const inStockOffers = [];
    const seenIds = new Set();
    let ldNodes = 0;
    const payloads = [];
    if (typeof raw === 'string') {
        const ld = (0, bigBoxDomParsers_1.extractJsonLdShelfProducts)(raw, 'https://www.samsclub.com');
        ldNodes = ld.totalNodes;
        for (const it of ld.inStockItems) {
            seenIds.add(it.sku);
            if (resolveBigBoxPolicyMatch({ title: it.title, price: it.price, retailer: "Sam's Club", url: it.url })) {
                inStockOffers.push({ title: cleanHtmlText(it.title), retailer: "Sam's Club", url: it.url, productUrl: it.url, price: it.price, itemId: `sams_${it.sku}`, freeShipping: it.price >= 50 });
            }
        }
        const m = raw.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (m) {
            try {
                payloads.push(JSON.parse(m[1]));
            }
            catch { }
        }
    }
    else if (raw && typeof raw === 'object') {
        payloads.push(raw);
    }
    for (const cj of capturedJsons) {
        if (cj?.data)
            payloads.push(cj.data);
    }
    for (const p of payloads) {
        const records = p?.props?.pageProps?.initialData?.searchResult?.records || p?.payload?.records || p?.records || [];
        for (const r of records) {
            const prodId = String(r?.productId || r?.itemId || '').trim();
            const title = cleanHtmlText(r?.titles?.simpleTitle || r?.title || '');
            if (!prodId && !title)
                continue;
            seenIds.add(prodId || title);
            const price = parseFloat(String(r?.skus?.[0]?.onlineOffer?.price?.finalPrice?.amount ?? r?.price ?? 0));
            const status = String(r?.skus?.[0]?.onlineOffer?.inventory?.status || r?.inventoryStatus || '').toUpperCase();
            if (!prodId || !title || !price || !/^(AVAILABLE|IN_STOCK)$/i.test(status))
                continue;
            const url = `https://www.samsclub.com/p/-/${prodId}`;
            if (!resolveBigBoxPolicyMatch({ title, price, retailer: "Sam's Club", url }))
                continue;
            inStockOffers.push({ title, retailer: "Sam's Club", url, productUrl: url, price, itemId: `sams_${prodId}`, freeShipping: price >= 50 });
        }
    }
    return { totalNodesFound: Math.max(seenIds.size, ldNodes), inStockOffers };
}
async function dispatchVerifiedBigBoxHits(hits, dropSink = listener_1.processIncomingDrop, cooldownMins = 15) {
    let dispatched = 0;
    const now = Date.now();
    for (const hit of hits) {
        const key = String(hit.itemId || `${hit.retailer}_${hit.title}`);
        const prev = seenBigBoxOffers.get(key);
        const curPrice = Number(hit.price || 0);
        if (!prev || curPrice < prev.price || (now - prev.timestamp) / 60000 >= cooldownMins) {
            seenBigBoxOffers.set(key, { price: curPrice, timestamp: now });
            await dropSink(hit);
            dispatched += 1;
        }
    }
    return dispatched;
}
