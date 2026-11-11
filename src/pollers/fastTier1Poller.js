"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFastTier1SweepOnce = runFastTier1SweepOnce;
exports.startFastTier1Poller = startFastTier1Poller;
const axios_1 = __importDefault(require("axios"));
const dns_1 = __importDefault(require("dns"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const configManager_1 = require("../config/configManager");
const lgsPoller_1 = require("../../lgsPoller");
const policies_1 = require("../../policies");
const listener_1 = require("../../listener");
const singlesSniper_1 = require("../engine/singlesSniper");
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), '.env') });
dns_1.default.setDefaultResultOrder('ipv4first');
const FAST_INTERVAL_MS = 15000;
const FAST_CONCURRENCY = 6;
const FAST_TIMEOUT_MS = 6500;
const FAST_SWEEP_WATCHDOG_MS = 28000;
const storeHttpCacheMap = new Map();
const fastVariantSnapshotMap = new Map();
const seededFastStores = new Set();
let isFastPolling = false;
let lastFastSweepStartedAt = 0;
let totalFastCyclesRun = 0;
let cumulativeFastHits = 0;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function getJitter(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}
function buildFastDeltaPath(resolvedPath) {
    const base = (resolvedPath || '/products.json?limit=250').trim();
    // Curated sealed/boxes sub-collections keep their full 250-item feed; generic collections use root /products.json?limit=250 (sorted updated_at desc by Shopify core)
    if (!/\/collections\/[^/]*(sealed|boxes|etb|bundle)/i.test(base)) {
        return '/products.json?limit=250';
    }
    if (/limit=\d+/i.test(base)) {
        return base.replace(/limit=\d+/i, 'limit=250');
    }
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}limit=250`;
}
async function fetchFastStoreDelta(store, httpMeta) {
    const deltaPath = buildFastDeltaPath(store.resolvedPath);
    const url = `${store.baseUrl}${deltaPath}`;
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'application/json'
    };
    if (httpMeta.etag)
        headers['If-None-Match'] = httpMeta.etag;
    if (httpMeta.lastModified)
        headers['If-Modified-Since'] = httpMeta.lastModified;
    const attemptGet = async (httpsAgent) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FAST_TIMEOUT_MS);
        try {
            return await axios_1.default.get(url, {
                timeout: FAST_TIMEOUT_MS,
                signal: controller.signal,
                httpsAgent,
                headers,
                validateStatus: (s) => (s >= 200 && s < 300) || s === 304
            });
        }
        finally {
            clearTimeout(timer);
        }
    };
    try {
        const res = await attemptGet();
        return {
            status: res.status,
            products: res.status === 304 ? [] : (res.data?.products || []),
            etag: res.headers?.etag,
            lastModified: res.headers?.['last-modified']
        };
    }
    catch (directErr) {
        try {
            const proxy = (0, lgsPoller_1.getNextProxy)();
            const res = await attemptGet(proxy);
            return {
                status: res.status,
                products: res.status === 304 ? [] : (res.data?.products || []),
                etag: res.headers?.etag,
                lastModified: res.headers?.['last-modified']
            };
        }
        catch (proxyErr) {
            const code = proxyErr?.response?.status || directErr?.response?.status;
            return {
                status: code || 0,
                products: [],
                error: code ? `HTTP ${code}` : (proxyErr?.code || proxyErr?.message || 'FastPoll Error')
            };
        }
    }
}
async function pollSingleTier1StoreFast(store) {
    const startTs = Date.now();
    const httpMeta = storeHttpCacheMap.get(store.name) || {
        consecutiveFailures: 0,
        cooldownUntil: 0
    };
    if (httpMeta.cooldownUntil > startTs) {
        return { polled: false, notModified304: false, variantsChecked: 0, deltaHits: 0, latencyMs: 0 };
    }
    const res = await fetchFastStoreDelta(store, httpMeta);
    const latencyMs = Math.max(25, Date.now() - startTs);
    if (res.error || (res.status !== 200 && res.status !== 304)) {
        httpMeta.consecutiveFailures += 1;
        if (httpMeta.consecutiveFailures >= 6) {
            httpMeta.cooldownUntil = Date.now() + 5 * 60 * 1000;
        }
        storeHttpCacheMap.set(store.name, httpMeta);
        return { polled: false, notModified304: false, variantsChecked: 0, deltaHits: 0, latencyMs };
    }
    httpMeta.consecutiveFailures = 0;
    httpMeta.cooldownUntil = 0;
    if (res.etag)
        httpMeta.etag = res.etag;
    if (res.lastModified)
        httpMeta.lastModified = res.lastModified;
    storeHttpCacheMap.set(store.name, httpMeta);
    if (res.status === 304) {
        return { polled: true, notModified304: true, variantsChecked: 0, deltaHits: 0, latencyMs };
    }
    const products = Array.isArray(res.products) ? res.products : [];
    const fxMultiplier = (0, lgsPoller_1.resolveShopifyFxMultiplier)(store);
    const isStoreSeeded = seededFastStores.has(store.name);
    let variantsChecked = 0;
    let deltaHits = 0;
    const now = Date.now();
    for (const prod of products) {
        if (/kanzen\s*games/i.test(store.name) && prod.product_type && String(prod.product_type).trim().toLowerCase() !== 'pokemon sealed')
            continue;
        let isMetaSingle;
        for (const variant of prod.variants || []) {
            const variantId = Number(variant.id);
            if (!variantId)
                continue;
            variantsChecked += 1;
            const rawPrice = parseFloat(variant.price);
            const priceNum = fxMultiplier !== 1.0 ? Math.round(rawPrice * fxMultiplier * 100) / 100 : rawPrice;
            const safePrice = priceNum || 0;
            const isAvail = Boolean(variant.available);
            const prevFast = fastVariantSnapshotMap.get(variantId);
            // O(1) Delta Short-Circuit: skip unchanged variants before string/regex work so limit=250 runs near-zero CPU!
            if (prevFast && prevFast.available === isAvail && prevFast.price === safePrice) {
                prevFast.lastSeenAt = now;
                continue;
            }
            fastVariantSnapshotMap.set(variantId, { available: isAvail, price: safePrice, lastSeenAt: now });
            if (!isAvail || !priceNum || priceNum < 15)
                continue;
            if (isMetaSingle === undefined)
                isMetaSingle = (0, policies_1.isSingleOrNonSealedShopifyProduct)(prod);
            const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
            const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
            const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;
            if (isMetaSingle || (0, policies_1.isSingleCardOrNonSealed)(fullTitle, prod.product_type, `${prod.handle || ''} ${tagsStr}`)) {
                if (priceNum >= 15 && (0, policies_1.isCollectibleSingleCardOrSlab)(fullTitle, prod.product_type, tagsStr)) {
                    const rawCompare = parseFloat(variant.compare_at_price || '0');
                    (0, singlesSniper_1.ingestSingleCardOffer)({
                        title: fullTitle, storeName: store.name, price: priceNum,
                        compareAtPrice: rawCompare > 0 ? (fxMultiplier !== 1.0 ? Math.round(rawCompare * fxMultiplier * 100) / 100 : rawCompare) : undefined,
                        url: productUrl, itemId: String(variant.id), productType: prod.product_type, tags: prod.tags,
                        stock: typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0 ? variant.inventory_quantity : undefined,
                        image: prod.images?.[0]?.src
                    });
                }
                continue;
            }
            if (priceNum < 18 || !(0, policies_1.hasMandatorySealedContainerKeyword)(fullTitle))
                continue;
            if (!(0, policies_1.isValidSkuForFormFactor)(fullTitle, undefined, priceNum, { handle: `${prod.handle || ''} ${tagsStr}` })) {
                continue;
            }
            const prevGlobal = lgsPoller_1.variantStateMap.get(variantId);
            const isNewlyListed = !prevFast && !prevGlobal;
            const isRestockFlip = Boolean(prevFast && !prevFast.available && isAvail);
            const isPriceDrop = Boolean((prevFast && priceNum <= prevFast.price - 0.50) ||
                (prevGlobal && priceNum <= prevGlobal.price - 0.50));
            if (!isStoreSeeded && isNewlyListed && prevGlobal) {
                continue;
            }
            if (isNewlyListed || isRestockFlip || isPriceDrop) {
                lgsPoller_1.variantStateMap.set(variantId, { price: priceNum, lastCheckedAt: now, oosStrikes: 0 });
                deltaHits += 1;
                const realQty = typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0
                    ? variant.inventory_quantity
                    : undefined;
                const cart1xUrl = `${store.baseUrl}/cart/${variant.id}:1?payment=shop_pay`;
                const cart2xUrl = (realQty === undefined || realQty >= 2) ? `${store.baseUrl}/cart/${variant.id}:2?payment=shop_pay` : undefined;
                const cart3xUrl = (realQty === undefined || realQty >= 3) ? `${store.baseUrl}/cart/${variant.id}:3?payment=shop_pay` : undefined;
                const isPreOrder = /pre-?order|pre-?sale/i.test(`${fullTitle} ${tagsStr} ${prod.handle || ''}`);
                await (0, listener_1.processIncomingDrop)({
                    title: fullTitle,
                    retailer: store.name,
                    url: cart1xUrl,
                    productUrl,
                    cart1xUrl,
                    cart2xUrl,
                    cart3xUrl,
                    isPreOrder,
                    price: priceNum,
                    stock: realQty,
                    itemId: String(variant.id)
                });
            }
        }
    }
    seededFastStores.add(store.name);
    return { polled: true, notModified304: false, variantsChecked, deltaHits, latencyMs };
}
async function runFastTier1SweepOnce() {
    if (isFastPolling) {
        if (Date.now() - lastFastSweepStartedAt > FAST_SWEEP_WATCHDOG_MS) {
            isFastPolling = false;
        }
        else {
            return;
        }
    }
    isFastPolling = true;
    lastFastSweepStartedAt = Date.now();
    const tier1Stores = (0, configManager_1.loadTier1FastLgsStores)();
    const queue = [...tier1Stores];
    let storesPolled = 0;
    let notModified304Count = 0;
    let variantsChecked = 0;
    let deltaHits = 0;
    const perStoreMeta = new Map();
    try {
        const workerCount = Math.min(FAST_CONCURRENCY, queue.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (queue.length > 0) {
                const store = queue.shift();
                if (!store)
                    break;
                try {
                    const res = await pollSingleTier1StoreFast(store);
                    if (res.polled) {
                        storesPolled += 1;
                        perStoreMeta.set(store.name, {
                            lastFastPollAt: Date.now(),
                            lastFastLatencyMs: res.latencyMs
                        });
                    }
                    if (res.notModified304)
                        notModified304Count += 1;
                    variantsChecked += res.variantsChecked;
                    deltaHits += res.deltaHits;
                }
                catch (e) { }
                await sleep(getJitter(60, 160));
            }
        });
        await Promise.all(workers);
        totalFastCyclesRun += 1;
        cumulativeFastHits += deltaHits;
        (0, lgsPoller_1.recordFastTier1Telemetry)({
            status: 'ACTIVE_15S_DELTA',
            intervalMs: FAST_INTERVAL_MS,
            tier1StoreCount: tier1Stores.length,
            storesPolledLastCycle: storesPolled,
            notModified304Count,
            variantsCheckedLastCycle: variantsChecked,
            newOrRestockedHits: cumulativeFastHits,
            lastCycleHits: deltaHits,
            totalCyclesRun: totalFastCyclesRun,
            lastDurationMs: Date.now() - lastFastSweepStartedAt,
            tier1Stores: tier1Stores.map((s) => s.name)
        }, perStoreMeta);
    }
    finally {
        isFastPolling = false;
    }
}
function startFastTier1Poller() {
    const runLoop = async () => {
        try {
            await runFastTier1SweepOnce();
        }
        catch (err) {
            console.error(`[FastTier1Poller] 15s delta sweep error: ${err?.message || err}`);
        }
        finally {
            setTimeout(runLoop, FAST_INTERVAL_MS + getJitter(0, 1200));
        }
    };
    setTimeout(runLoop, 1500);
}
