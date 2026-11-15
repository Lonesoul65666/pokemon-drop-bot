"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fastTier1Telemetry = void 0;
exports.runFastTier1DeltaCycle = runFastTier1DeltaCycle;
exports.startFastTier1Poller = startFastTier1Poller;
const axios_1 = __importDefault(require("axios"));
const policies_1 = require("../../policies");
const evaluator_1 = require("../../evaluator");
const notifier_1 = require("../../notifier");
const listener_1 = require("../../listener");
const configManager_1 = require("../config/configManager");
const lgsPoller_1 = require("../../lgsPoller");
const currencyGuard_1 = require("../engine/currencyGuard");
const etagByUrl = new Map();
const fastVariantMemory = new Map();
let fastTimer = null;
let cycleInFlight = false;
exports.fastTier1Telemetry = {
    status: 'STARTING',
    intervalMs: 15000,
    tier1StoreCount: 0,
    storesPolledLastCycle: 0,
    notModified304Count: 0,
    variantsCheckedLastCycle: 0,
    newOrRestockedHits: 0,
    totalCyclesRun: 0,
    lastSweepAt: 0
};
const FAST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'application/json,text/plain,*/*',
    ...currencyGuard_1.SHOPIFY_USD_HEADERS
};
function getTier1ShopifyStores() {
    const all = (0, configManager_1.loadActiveLgsStores)();
    const explicitTier1 = all.filter((s) => s.enabled !== false && s.storeType === 'SHOPIFY_LGS' && s.tier === 'TIER1_FAST');
    if (explicitTier1.length >= 20) {
        return explicitTier1.slice(0, 25);
    }
    return all.filter((s) => s.enabled !== false && s.storeType === 'SHOPIFY_LGS').slice(0, 25);
}
async function fetchStoreDeltaJson(url, useProxy) {
    const localizedUrl = (0, currencyGuard_1.appendShopifyUsCountryParam)(url);
    await (0, lgsPoller_1.acquireShopifyEgressSlot)(useProxy ? 'PROXY' : 'DIRECT', localizedUrl);
    const cached = etagByUrl.get(localizedUrl);
    const headers = { ...FAST_HEADERS };
    const canSendEtag = cached && Date.now() - cached.last200At < 10 * 60 * 1000;
    if (canSendEtag && cached?.etag)
        headers['If-None-Match'] = cached.etag;
    if (canSendEtag && cached?.lastModified)
        headers['If-Modified-Since'] = cached.lastModified;
    const agent = useProxy ? (0, lgsPoller_1.getSharedProxyAgent)() : undefined;
    const res = await axios_1.default.get(localizedUrl, {
        timeout: 7000,
        headers,
        ...(agent ? { httpsAgent: agent, proxy: false } : {}),
        validateStatus: (s) => (s >= 200 && s < 300) || s === 304
    });
    if (res.status === 304) {
        return { status: 304, notModified: true, products: [] };
    }
    const nextEtag = typeof res.headers?.etag === 'string' ? res.headers.etag : undefined;
    const nextLastMod = typeof res.headers?.['last-modified'] === 'string' ? res.headers['last-modified'] : undefined;
    if (nextEtag || nextLastMod) {
        etagByUrl.set(localizedUrl, { etag: nextEtag, lastModified: nextLastMod, last200At: Date.now() });
    }
    const products = Array.isArray(res.data?.products) ? res.data.products : [];
    return { status: res.status, notModified: false, products };
}
async function probeStoreJson(url, useProxy) {
    await (0, lgsPoller_1.acquireShopifyEgressSlot)(useProxy ? 'PROXY' : 'DIRECT', url);
    const agent = useProxy ? (0, lgsPoller_1.getSharedProxyAgent)() : undefined;
    const res = await axios_1.default.get(url, {
        timeout: 4500,
        headers: { ...FAST_HEADERS },
        ...(agent ? { httpsAgent: agent, proxy: false } : {}),
        validateStatus: () => true
    });
    return { status: res.status, data: res.data };
}
async function pollSingleTier1StoreDelta(store, useProxy) {
    const started = Date.now();
    const resolvedPath = store.resolvedPath || '/products.json?limit=250';
    const fastPath = resolvedPath.replace(/limit=\d+/i, 'limit=100');
    const url = `${store.baseUrl}${fastPath.startsWith('/') ? '' : '/'}${fastPath}`;
    let activeProxy = useProxy;
    let currRes = await (0, currencyGuard_1.resolveVerifiedStoreCurrency)(store, activeProxy ? 'PROXY' : 'DIRECT', (u) => probeStoreJson(u, activeProxy));
    if (currRes.quarantineNonUsd && activeProxy) {
        activeProxy = false;
        currRes = await (0, currencyGuard_1.resolveVerifiedStoreCurrency)(store, 'DIRECT', (u) => probeStoreJson(u, false));
    }
    if (currRes.quarantineNonUsd) {
        return { status: 422, notModified: false, checkedVariants: 0, hits: 0, latencyMs: Date.now() - started, productsCount: 0 };
    }
    const delta = await fetchStoreDeltaJson(url, activeProxy);
    if (delta.notModified) {
        return { status: 304, notModified: true, checkedVariants: 0, hits: 0, latencyMs: Date.now() - started, productsCount: 0 };
    }
    const fxMult = currRes.fxMultiplier;
    let checkedVariants = 0;
    let hits = 0;
    const now = Date.now();
    for (const prod of delta.products) {
        if (!prod || !prod.title)
            continue;
        const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
        const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;
        if ((0, policies_1.isPoisonedVariantOrAccessory)(undefined, prod.title) ||
            (0, policies_1.isSingleCardOrNonSealed)(prod.title, `${prod.handle || ''} ${tagsStr}`, productUrl)) {
            continue;
        }
        const variants = Array.isArray(prod.variants) ? prod.variants : [];
        for (const variant of variants) {
            if (!variant || !variant.id)
                continue;
            checkedVariants++;
            const varIdStr = String(variant.id);
            const isAvail = (0, currencyGuard_1.isVariantStrictlyAvailable)(variant);
            const rawPrice = parseFloat(String(variant.price || '0'));
            if (!Number.isFinite(rawPrice) || rawPrice <= 0)
                continue;
            const shelfUsd = fxMult !== 1.0 ? Math.round(rawPrice * fxMult * 100) / 100 : rawPrice;
            if ((0, policies_1.isPoisonedVariantOrAccessory)(variant.title, prod.title, shelfUsd)) {
                if (fastVariantMemory.get(varIdStr)?.available)
                    await (0, notifier_1.markAlertSoldOut)(varIdStr);
                fastVariantMemory.set(varIdStr, { available: false, price: shelfUsd, shippingUsd: 0, seenAt: now });
                continue;
            }
            const shipCalc = (0, currencyGuard_1.computeVerifiedStoreShippingUsd)(store, shelfUsd, currRes);
            const prevFast = fastVariantMemory.get(varIdStr);
            if (!isAvail) {
                if (prevFast?.available) {
                    await (0, notifier_1.markAlertSoldOut)(varIdStr);
                }
                fastVariantMemory.set(varIdStr, { available: false, price: shelfUsd, shippingUsd: shipCalc.shippingUsd, seenAt: now });
                continue;
            }
            fastVariantMemory.set(varIdStr, { available: true, price: shelfUsd, shippingUsd: shipCalc.shippingUsd, seenAt: now });
            const vTitle = variant.title && variant.title !== 'Default Title' ? `${prod.title} - ${variant.title}` : prod.title;
            if (!(0, policies_1.hasMandatorySealedContainerKeyword)(vTitle))
                continue;
            const isBrandNewOrRestocked = !prevFast || !prevFast.available;
            const isPriceDropOrSync = Boolean(prevFast &&
                (shelfUsd !== prevFast.price || shipCalc.shippingUsd !== prevFast.shippingUsd));
            if (!isBrandNewOrRestocked && !isPriceDropOrSync)
                continue;
            const matchedRule = (0, evaluator_1.matchTargetRuleForStaging)(vTitle, shelfUsd, store.name, `${prod.handle || ''} ${tagsStr} ${productUrl}`);
            if (!matchedRule)
                continue;
            const checkoutUrl = `${store.baseUrl}/cart/${variant.id}:1?payment=shop_pay`;
            const stockQty = typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0
                ? variant.inventory_quantity
                : undefined;
            const isSingleQty = (0, evaluator_1.isCaseSkuFormat)(matchedRule.formFactor, matchedRule.id, vTitle)
                || (0, policies_1.isUpcOrSpcFormat)(matchedRule.formFactor, matchedRule.id, vTitle);
            hits++;
            await (0, listener_1.processIncomingDrop)({
                title: vTitle,
                price: shelfUsd,
                itemPrice: shelfUsd,
                shippingPrice: shipCalc.shippingUsd,
                freeShipping: shipCalc.shippingUsd === 0,
                shippingNoteOverride: shipCalc.shippingNote,
                retailer: store.name,
                url: checkoutUrl,
                productUrl,
                cart1xUrl: checkoutUrl,
                cart2xUrl: isSingleQty ? undefined : `${store.baseUrl}/cart/${variant.id}:2?payment=shop_pay`,
                cart3xUrl: isSingleQty ? undefined : `${store.baseUrl}/cart/${variant.id}:3?payment=shop_pay`,
                stock: stockQty,
                itemId: varIdStr,
                sellerVerified: true
            });
        }
    }
    return {
        status: delta.status,
        notModified: false,
        checkedVariants,
        hits,
        latencyMs: Math.max(25, Date.now() - started),
        productsCount: delta.products.length
    };
}
async function runFastTier1DeltaCycle() {
    if (cycleInFlight)
        return exports.fastTier1Telemetry;
    cycleInFlight = true;
    try {
        const tier1Stores = getTier1ShopifyStores();
        exports.fastTier1Telemetry.tier1StoreCount = tier1Stores.length;
        const hasProxy = Boolean((0, lgsPoller_1.getSharedProxyAgent)());
        let notModCount = 0;
        let totalVariants = 0;
        let totalHits = 0;
        let polledOk = 0;
        const perStorePatch = new Map();
        const CHUNK = 9;
        for (let i = 0; i < tier1Stores.length; i += CHUNK) {
            const batch = tier1Stores.slice(i, i + CHUNK);
            const settled = await Promise.allSettled(batch.map((store, idx) => pollSingleTier1StoreDelta(store, hasProxy && idx % 3 === 1)));
            settled.forEach((s, idx) => {
                if (s.status === 'fulfilled') {
                    polledOk++;
                    if (s.value.notModified)
                        notModCount++;
                    totalVariants += s.value.checkedVariants;
                    totalHits += s.value.hits;
                    perStorePatch.set(batch[idx].name, {
                        lastFastPollAt: Date.now(),
                        lastFastLatencyMs: s.value.latencyMs,
                        productsCount: s.value.productsCount
                    });
                }
            });
        }
        exports.fastTier1Telemetry.status = 'ACTIVE_15S_DELTA';
        exports.fastTier1Telemetry.storesPolledLastCycle = polledOk;
        exports.fastTier1Telemetry.notModified304Count = notModCount;
        exports.fastTier1Telemetry.variantsCheckedLastCycle = totalVariants;
        exports.fastTier1Telemetry.newOrRestockedHits = totalHits;
        exports.fastTier1Telemetry.totalCyclesRun += 1;
        exports.fastTier1Telemetry.lastSweepAt = Date.now();
        (0, lgsPoller_1.recordFastTier1Telemetry)({ ...exports.fastTier1Telemetry }, perStorePatch);
    }
    finally {
        cycleInFlight = false;
    }
    return exports.fastTier1Telemetry;
}
function startFastTier1Poller(intervalMs = 15000) {
    if (fastTimer)
        return;
    etagByUrl.clear();
    fastVariantMemory.clear();
    exports.fastTier1Telemetry.intervalMs = intervalMs;
    exports.fastTier1Telemetry.status = 'ACTIVE_15S_DELTA';
    setTimeout(() => {
        runFastTier1DeltaCycle().catch(() => { });
    }, 4000).unref();
    fastTimer = setInterval(() => {
        runFastTier1DeltaCycle().catch(() => { });
    }, intervalMs);
    fastTimer.unref();
}
