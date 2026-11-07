"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.variantStateMap = exports.MONITORED_STORES = exports.LGS_STORES = void 0;
exports.getNextProxy = getNextProxy;
exports.recordBigBoxCheckTelemetry = recordBigBoxCheckTelemetry;
exports.recordFastTier1Telemetry = recordFastTier1Telemetry;
exports.getFastTier1Telemetry = getFastTier1Telemetry;
exports.pollShopifyStores = pollShopifyStores;
const axios_1 = __importDefault(require("axios"));
const https_proxy_agent_1 = require("https-proxy-agent");
const dns_1 = __importDefault(require("dns"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const listener_1 = require("./listener");
const notifier_1 = require("./notifier");
const policies_1 = require("./policies");
const evaluator_1 = require("./evaluator");
const configManager_1 = require("./src/config/configManager");
const singlesSniper_1 = require("./src/engine/singlesSniper");
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), '.env') });
dns_1.default.setDefaultResultOrder('ipv4first');
const WEBSHARE_PROXY_URL = process.env.WEBSHARE_PROXY_URL || '';
const STORE_HEALTH_PATH = path_1.default.resolve(process.cwd(), 'storeHealth.json');
const MAX_CONCURRENT_STORES = 10;
const REQUEST_TIMEOUT_MS = 8000;
const CIRCUIT_BREAKER_THRESHOLD = 8;
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
function getNextProxy() {
    return new https_proxy_agent_1.HttpsProxyAgent(WEBSHARE_PROXY_URL);
}
const storeHealthMap = new Map();
let bigBoxHealthTelemetry = {
    targetRedskyStatus: 'HEALTHY',
    redditRssStatus: 'HEALTHY',
    pokemonCenterStatus: 'WAF_CHALLENGE_IMPERVA',
    walmartStatus: 'WAF_CHALLENGE_PX',
    bestBuyStatus: '200_OK_0_IN_STOCK',
    costcoStatus: '200_OK_0_IN_STOCK',
    lastCheckAt: Date.now(),
    itemsScanned: 0,
    activeBigBoxCount: 9,
    northStar5: {
        pokemonCenter: {
            name: 'Pokémon Center',
            status: 'WAF CHALLENGE (IMPERVA / PX)',
            lastStatus: 'WAF CHALLENGE (IMPERVA / PX)',
            statusCode: 'WAF_CHALLENGE_IMPERVA',
            itemsExtracted: 0,
            itemsParsed: 0,
            targetRule: '$59.99 PC Exclusive ETBs & Pre-Orders + Queue Radar',
            queueState: 'NORMAL',
            lastCheckedAt: Date.now()
        },
        target: {
            name: 'Target',
            status: '200 OK // 0 IN STOCK',
            lastStatus: '200 OK // 0 IN STOCK',
            statusCode: '200_OK',
            itemsExtracted: 0,
            itemsParsed: 0,
            targetRule: 'RedSky JSON API (Zip 76177 • $49.99–$54.99 ETB / $26.99 Bundle)',
            lastCheckedAt: Date.now()
        },
        walmart: {
            name: 'Walmart',
            status: 'WAF CHALLENGE (IMPERVA / PX)',
            lastStatus: 'WAF CHALLENGE (IMPERVA / PX)',
            statusCode: 'WAF_CHALLENGE_PX',
            itemsExtracted: 0,
            itemsParsed: 0,
            targetRule: 'Sold & Shipped by Walmart Only (<= $55 ETB / <= $30 Bundle)',
            lastCheckedAt: Date.now()
        },
        bestBuy: {
            name: 'Best Buy',
            status: '200 OK // 0 IN STOCK',
            lastStatus: '200 OK // 0 IN STOCK',
            statusCode: '200_OK',
            itemsExtracted: 0,
            itemsParsed: 0,
            targetRule: 'SKU Availability Watch ($49.99–$54.99 ETB / $26.99 Bundle)',
            lastCheckedAt: Date.now()
        },
        costco: {
            name: 'Costco',
            status: '200 OK // 0 IN STOCK',
            lastStatus: '200 OK // 0 IN STOCK',
            statusCode: '200_OK_0_IN_STOCK',
            itemsExtracted: 0,
            itemsParsed: 0,
            targetRule: '$39.99–$64.99 ETB + Tin Multi-Pack Pallet Drops',
            lastCheckedAt: Date.now()
        },
        samsClub: {
            name: "Sam's Club",
            status: '200 OK // 0 IN STOCK',
            lastStatus: '200 OK // 0 IN STOCK',
            statusCode: '200_OK_0_IN_STOCK',
            itemsExtracted: 0,
            itemsParsed: 0,
            targetRule: 'Member Exclusive Sealed Multi-Packs',
            lastCheckedAt: Date.now()
        },
        gamestop: {
            name: 'GameStop',
            status: '200 OK // 0 IN STOCK',
            lastStatus: '200 OK // 0 IN STOCK',
            statusCode: '200_OK_0_IN_STOCK',
            itemsExtracted: 0,
            itemsParsed: 0,
            targetRule: '1P Retail MSRP Sealed Boxes & ETBs',
            lastCheckedAt: Date.now()
        }
    }
};
let isPolling = false;
let fastTier1Telemetry = {
    status: 'ACTIVE_15S_DELTA',
    intervalMs: 15000,
    tier1StoreCount: 25,
    storesPolledLastCycle: 25,
    notModified304Count: 0,
    variantsCheckedLastCycle: 0,
    newOrRestockedHits: 0,
    totalCyclesRun: 0,
    lastSweepAt: Date.now(),
    lastDurationMs: 0
};
try {
    if (fs_1.default.existsSync(STORE_HEALTH_PATH)) {
        const raw = JSON.parse(fs_1.default.readFileSync(STORE_HEALTH_PATH, 'utf-8'));
        if (raw && typeof raw === 'object') {
            if (raw.__bigBoxHealth && typeof raw.__bigBoxHealth === 'object') {
                bigBoxHealthTelemetry = { ...bigBoxHealthTelemetry, ...raw.__bigBoxHealth };
            }
            if (raw.__fastTier1Telemetry && typeof raw.__fastTier1Telemetry === 'object') {
                fastTier1Telemetry = { ...fastTier1Telemetry, ...raw.__fastTier1Telemetry };
            }
            for (const [k, v] of Object.entries(raw)) {
                if (k.startsWith('__'))
                    continue;
                const rec = v;
                rec.status = 'HEALTHY';
                rec.consecutiveFailures = 0;
                rec.cooldownUntil = 0;
                rec.lastError = undefined;
                storeHealthMap.set(k, rec);
            }
        }
    }
}
catch (e) { }
function recordBigBoxCheckTelemetry(patch) {
    const nextNorthStar5 = patch.northStar5
        ? {
            ...(bigBoxHealthTelemetry.northStar5 || {}),
            ...Object.fromEntries(Object.entries(patch.northStar5).map(([k, v]) => [
                k,
                { ...((bigBoxHealthTelemetry.northStar5 || {})[k] || {}), ...(v || {}) }
            ]))
        }
        : bigBoxHealthTelemetry.northStar5;
    bigBoxHealthTelemetry = {
        ...bigBoxHealthTelemetry,
        ...patch,
        northStar5: nextNorthStar5,
        lastCheckAt: Date.now()
    };
    try {
        flushStoreHealthToDisk();
    }
    catch (e) { }
}
function recordFastTier1Telemetry(patch, perStorePatch) {
    fastTier1Telemetry = {
        ...fastTier1Telemetry,
        ...patch,
        lastSweepAt: Date.now()
    };
    if (perStorePatch) {
        for (const [storeName, meta] of perStorePatch.entries()) {
            const rec = storeHealthMap.get(storeName);
            if (rec) {
                rec.lastFastPollAt = meta.lastFastPollAt;
                rec.lastFastLatencyMs = meta.lastFastLatencyMs;
                storeHealthMap.set(storeName, rec);
            }
        }
    }
    try {
        flushStoreHealthToDisk();
    }
    catch (e) { }
}
function getFastTier1Telemetry() {
    return fastTier1Telemetry;
}
function flushStoreHealthToDisk() {
    const activeNames = new Set(exports.MONITORED_STORES.map(s => s.name));
    const out = {};
    for (const [k, v] of storeHealthMap.entries()) {
        if (activeNames.has(k)) {
            out[k] = v;
        }
    }
    out.__bigBoxHealth = bigBoxHealthTelemetry;
    out.__fastTier1Telemetry = fastTier1Telemetry;
    (0, policies_1.atomicWriteJson)(STORE_HEALTH_PATH, out);
}
exports.LGS_STORES = (0, configManager_1.loadActiveLgsStores)();
exports.MONITORED_STORES = exports.LGS_STORES;
const INVALID_COLLECTION_SUBPATH_REGEX = /single|singles|graded|slab|slabs|psa|cgc|bgs|japanese|chinese|korean|event|local|lorcana|digimon|one-piece|magic|mtg|3d-cut|custom|break|bandai|indonesian|thai|spanish|french|german|italian|portuguese|figure|plush|toy|apparel|supply|sleeve|binder|accessories|codes|ptcgo|ptcgl/i;
const NARROW_SUBCOLLECTION_HANDLE_REGEX = /booster-box|blister|elite-trainer|etb|pre-?order|sealed-cases|30th-pokemon|mega-evolution|a-great-place-to-begin|karls-krazy|modern-sealed/i;
const BROAD_PARENT_COLLECTION_HANDLE_REGEX = /^(pokemon|pokemon-tcg|pokemon-sealed|all-pokemon|all-pokemon-sealed|all-pokemon-sealed-products|all-pokemon-sealed-product|pokemon-sealed-products|pokemon-sealed-product|pokemon-trading-card-game|games-pokemon|pokemon-cards|pokemon-english|sealed-pokemon-collection)$/i;
// Ensure all active stores exist in storeHealthMap with HEALTHY status on boot and sync authoritative config/stores.json paths
for (const store of exports.MONITORED_STORES) {
    const existing = storeHealthMap.get(store.name);
    if (existing) {
        if (existing.resolvedPath && (INVALID_COLLECTION_SUBPATH_REGEX.test(existing.resolvedPath) || NARROW_SUBCOLLECTION_HANDLE_REGEX.test(existing.resolvedPath))) {
            existing.resolvedPath = undefined;
        }
        if (store.resolvedPath) {
            existing.resolvedPath = store.resolvedPath;
        }
        else if (existing.resolvedPath) {
            store.resolvedPath = existing.resolvedPath;
        }
        existing.additionalPaths = store.additionalPaths;
        existing.tier = store.tier || 'TIER2_STANDARD';
        existing.status = 'HEALTHY';
        existing.consecutiveFailures = 0;
        existing.cooldownUntil = 0;
    }
    else {
        storeHealthMap.set(store.name, {
            name: store.name,
            baseUrl: store.baseUrl,
            status: 'HEALTHY',
            consecutiveFailures: 0,
            cooldownUntil: 0,
            lastSuccessAt: Date.now(),
            lastProductsCount: 250,
            resolvedPath: store.resolvedPath,
            additionalPaths: store.additionalPaths,
            tier: store.tier || 'TIER2_STANDARD'
        });
    }
}
try {
    flushStoreHealthToDisk();
}
catch (e) { }
exports.variantStateMap = new Map();
const oosVariantStagingMap = new Map();
const seededOosStores = new Set();
const stagingAlertCooldownMap = new Map();
// Two-Tier Smart Deep-Catalog Pagination Cache (10-minute TTL per store, max 10 deep store fetches per sweep)
const DEEP_PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_DEEP_FETCHES_PER_SWEEP = 10;
const deepPaginationCache = new Map();
let deepFetchesThisSweep = 0;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function getRandomJitter(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept: 'application/json',
};
const STORE_POLL_WATCHDOG_MS = 22000;
const SWEEP_WATCHDOG_MS = 135000;
let lastSweepStartedAt = 0;
function withWatchdog(promise, timeoutMs, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Watchdog timeout (${timeoutMs}ms): ${label}`));
        }, timeoutMs);
        promise.then((val) => {
            clearTimeout(timer);
            resolve(val);
        }, (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
async function axiosGetWithAbort(url, timeoutMs, httpsAgent) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await axios_1.default.get(url, {
            timeout: timeoutMs,
            signal: controller.signal,
            httpsAgent,
            headers: HEADERS
        });
    }
    finally {
        clearTimeout(timer);
    }
}
async function smartGetJson(url) {
    try {
        const res = await axiosGetWithAbort(url, REQUEST_TIMEOUT_MS);
        return { data: res.data };
    }
    catch (e) {
        try {
            const proxy = getNextProxy();
            const res = await axiosGetWithAbort(url, REQUEST_TIMEOUT_MS, proxy);
            return { data: res.data };
        }
        catch (e2) {
            const status = e2?.response?.status || e?.response?.status;
            return { data: null, error: status ? `HTTP ${status}` : (e2?.code || e2?.message || 'Timeout/Network Error') };
        }
    }
}
function scorePokemonCollectionCandidate(col) {
    const handle = String(col.handle || '').toLowerCase();
    const title = String(col.title || '').toLowerCase();
    const hay = `${handle} ${title}`;
    if (INVALID_COLLECTION_SUBPATH_REGEX.test(hay))
        return -100;
    if (BROAD_PARENT_COLLECTION_HANDLE_REGEX.test(handle))
        return 100;
    if (NARROW_SUBCOLLECTION_HANDLE_REGEX.test(handle))
        return 10;
    if (/sealed|pokemon-tcg|all-pokemon|^pokemon/i.test(handle))
        return 75;
    if (/pokemon|pkmn/i.test(handle))
        return 45;
    return 20;
}
// Automatically finds the best Pokemon collection feed on each Shopify store and caches resolvedPath to disk
async function resolveBestPokemonFeed(store, health) {
    if (store.resolvedPath && INVALID_COLLECTION_SUBPATH_REGEX.test(store.resolvedPath)) {
        store.resolvedPath = undefined;
    }
    if (health.resolvedPath && (INVALID_COLLECTION_SUBPATH_REGEX.test(health.resolvedPath) || (!store.resolvedPath && NARROW_SUBCOLLECTION_HANDLE_REGEX.test(health.resolvedPath)))) {
        health.resolvedPath = undefined;
    }
    if (store.resolvedPath) {
        health.resolvedPath = store.resolvedPath;
        return { feedPath: store.resolvedPath };
    }
    if (health.resolvedPath) {
        store.resolvedPath = health.resolvedPath;
        return { feedPath: health.resolvedPath };
    }
    // Check store's /collections.json first to see their exact Pokemon collection handle
    const { data: colData } = await smartGetJson(`${store.baseUrl}/collections.json?limit=250`);
    if (colData?.collections && Array.isArray(colData.collections)) {
        const pkmnCols = colData.collections.filter((c) => {
            const hay = `${c.handle || ''} ${c.title || ''}`;
            return ((/pokemon|pkmn/i.test(c.handle || '') || /pokemon/i.test(c.title || '')) &&
                !INVALID_COLLECTION_SUBPATH_REGEX.test(hay));
        });
        pkmnCols.sort((a, b) => {
            const scoreDiff = scorePokemonCollectionCandidate(b) - scorePokemonCollectionCandidate(a);
            if (scoreDiff !== 0)
                return scoreDiff;
            return Number(b.products_count || 0) - Number(a.products_count || 0);
        });
        for (const col of pkmnCols.slice(0, 3)) {
            const testPath = `/collections/${col.handle}/products.json?limit=250`;
            const { data: prodData } = await smartGetJson(`${store.baseUrl}${testPath}`);
            if (prodData?.products && Array.isArray(prodData.products) && prodData.products.length >= 5) {
                store.resolvedPath = testPath;
                health.resolvedPath = testPath;
                if (NARROW_SUBCOLLECTION_HANDLE_REGEX.test(col.handle) && !store.additionalPaths) {
                    const companionPaths = pkmnCols
                        .filter((c) => c.handle !== col.handle && /booster-box|elite-trainer|etb|sealed|bundle/i.test(c.handle))
                        .slice(0, 2)
                        .map((c) => `/collections/${c.handle}/products.json?limit=250`);
                    if (companionPaths.length > 0) {
                        store.additionalPaths = companionPaths;
                        health.additionalPaths = companionPaths;
                    }
                }
                return { feedPath: testPath, initialProducts: prodData.products };
            }
        }
    }
    const fallbackPath = '/products.json?limit=250';
    const { data: fallbackData, error } = await smartGetJson(`${store.baseUrl}${fallbackPath}`);
    if (fallbackData?.products && Array.isArray(fallbackData.products)) {
        store.resolvedPath = fallbackPath;
        health.resolvedPath = fallbackPath;
        return { feedPath: fallbackPath, initialProducts: fallbackData.products };
    }
    return { feedPath: fallbackPath, error };
}
async function pollSingleStore(store) {
    const now = Date.now();
    const health = storeHealthMap.get(store.name) || {
        name: store.name,
        baseUrl: store.baseUrl,
        status: 'HEALTHY',
        consecutiveFailures: 0,
        cooldownUntil: 0,
        lastSuccessAt: 0,
        lastProductsCount: 0
    };
    if (health.cooldownUntil > now) {
        health.status = 'CIRCUIT_OPEN';
        storeHealthMap.set(store.name, health);
        return { hit: false, productsScanned: 0, skippedByCircuit: true };
    }
    try {
        const resolved = await resolveBestPokemonFeed(store, health);
        let products = resolved.initialProducts;
        let error = resolved.error;
        if (!products) {
            const page1Url = resolved.feedPath.includes('page=')
                ? `${store.baseUrl}${resolved.feedPath}`
                : `${store.baseUrl}${resolved.feedPath}${resolved.feedPath.includes('?') ? '&' : '?'}page=1`;
            const fetched = await smartGetJson(page1Url);
            products = fetched.data?.products;
            error = fetched.error;
        }
        if (!Array.isArray(products)) {
            health.consecutiveFailures += 1;
            health.lastError = error || 'Invalid JSON feed';
            if (health.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
                health.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
                health.status = 'CIRCUIT_OPEN';
                console.warn(`[CIRCUIT BREAKER] ${store.name} failed ${health.consecutiveFailures} consecutive polls (${health.lastError}). Cooling down for 15m.`);
            }
            else {
                health.status = 'DEGRADED';
            }
            storeHealthMap.set(store.name, health);
            return { hit: false, productsScanned: 0, skippedByCircuit: false };
        }
        // Multi-Endpoint Sub-Collection Polling (for stores whose ETBs and Booster Boxes span multiple collections):
        if (Array.isArray(store.additionalPaths) && store.additionalPaths.length > 0) {
            const seenIds = new Set(products.map((p) => p.id));
            for (const extraPath of store.additionalPaths) {
                if (!extraPath || extraPath === resolved.feedPath)
                    continue;
                const extraRes = await smartGetJson(`${store.baseUrl}${extraPath}`);
                const extraItems = extraRes.data?.products;
                if (Array.isArray(extraItems)) {
                    for (const ep of extraItems) {
                        if (ep && ep.id && !seenIds.has(ep.id)) {
                            seenIds.add(ep.id);
                            products.push(ep);
                        }
                    }
                }
            }
        }
        // Tier 2 (Staggered 10-Minute Deep Shelf Sweep — Pages 2 to 4):
        // When Page 1 returns a full 250 items, fetch pages 2..4 once every 10 minutes (staggered max 10 stores/sweep)
        // and merge cached deep-page products so totalListingsChecked covers the full 20,000-30,000+ catalog!
        if (products.length >= 250) {
            let deepEntry = deepPaginationCache.get(store.name);
            const needsDeepRefresh = !deepEntry || (now - deepEntry.lastDeepFetchAt >= DEEP_PAGE_CACHE_TTL_MS);
            if (needsDeepRefresh && deepFetchesThisSweep < MAX_DEEP_FETCHES_PER_SWEEP) {
                deepFetchesThisSweep += 1;
                const extraFetched = [];
                const baseFeed = resolved.feedPath.replace(/[?&]page=\d+/g, '');
                const sep = baseFeed.includes('?') ? '&' : '?';
                for (let pageNum = 2; pageNum <= 4; pageNum++) {
                    await sleep(140);
                    const deepRes = await smartGetJson(`${store.baseUrl}${baseFeed}${sep}page=${pageNum}`);
                    const pageItems = deepRes.data?.products;
                    if (!Array.isArray(pageItems) || pageItems.length === 0)
                        break;
                    extraFetched.push(...pageItems);
                    if (pageItems.length < 250)
                        break;
                }
                deepEntry = {
                    lastDeepFetchAt: Date.now(),
                    extraProducts: extraFetched
                };
                deepPaginationCache.set(store.name, deepEntry);
            }
            if (deepEntry && Array.isArray(deepEntry.extraProducts) && deepEntry.extraProducts.length > 0) {
                const seenIds = new Set(products.map((p) => p.id));
                for (const dp of deepEntry.extraProducts) {
                    if (dp && dp.id && !seenIds.has(dp.id)) {
                        seenIds.add(dp.id);
                        products.push(dp);
                    }
                }
            }
        }
        // Success: reset circuit breaker and persist resolvedPath
        const pagesScanned = products.length > 0 ? Math.max(1, Math.ceil(products.length / 250)) : 1;
        health.consecutiveFailures = 0;
        health.cooldownUntil = 0;
        health.status = 'HEALTHY';
        health.lastSuccessAt = Date.now();
        health.lastError = undefined;
        health.lastProductsCount = products.length;
        health.lastPagesScanned = pagesScanned;
        health.lastLatencyMs = Math.max(45, Date.now() - now);
        health.resolvedPath = store.resolvedPath;
        storeHealthMap.set(store.name, health);
        const checkNow = Date.now();
        const fxMultiplier = store.currency === 'CAD' ? 0.73 : 1.0;
        const activeVariantIds = new Set();
        for (const prod of products) {
            const isShopifyMetaSingleOrNonSealed = (0, policies_1.isSingleOrNonSealedShopifyProduct)(prod);
            for (const variant of prod.variants || []) {
                const rawPrice = parseFloat(variant.price);
                const priceNum = fxMultiplier !== 1.0 ? Math.round(rawPrice * fxMultiplier * 100) / 100 : rawPrice;
                if (!priceNum || priceNum < 15)
                    continue;
                if (variant.available) {
                    const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
                    const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
                    const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;
                    // Layer 1 & Layer 2: If single card or non-sealed, route collectibles >= $15 quietly to singlesCache.json and never into sealed cache
                    if (isShopifyMetaSingleOrNonSealed || (0, policies_1.isSingleCardOrNonSealed)(fullTitle, prod.product_type, `${prod.handle || ''} ${tagsStr}`)) {
                        if (priceNum >= 15 && (0, policies_1.isCollectibleSingleCardOrSlab)(fullTitle, prod.product_type, tagsStr)) {
                            const rawCompare = parseFloat(variant.compare_at_price || '0');
                            const compareAtPrice = rawCompare > 0 ? (fxMultiplier !== 1.0 ? Math.round(rawCompare * fxMultiplier * 100) / 100 : rawCompare) : undefined;
                            (0, singlesSniper_1.ingestSingleCardOffer)({
                                title: fullTitle,
                                storeName: store.name,
                                price: priceNum,
                                compareAtPrice,
                                url: productUrl,
                                itemId: String(variant.id),
                                productType: prod.product_type,
                                tags: prod.tags,
                                stock: typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0 ? variant.inventory_quantity : undefined,
                                image: prod.images?.[0]?.src
                            });
                        }
                        continue;
                    }
                    if (priceNum < 18)
                        continue;
                    if (!(0, policies_1.hasMandatorySealedContainerKeyword)(fullTitle))
                        continue;
                    if (!(0, policies_1.isValidSkuForFormFactor)(fullTitle, undefined, priceNum, { handle: `${prod.handle || ''} ${tagsStr}` }))
                        continue;
                    activeVariantIds.add(String(variant.id));
                    const prev = exports.variantStateMap.get(variant.id);
                    const minsSinceCheck = prev ? (checkNow - prev.lastCheckedAt) / (1000 * 60) : 999;
                    if (!prev || priceNum !== prev.price || minsSinceCheck >= 3) {
                        exports.variantStateMap.set(variant.id, { price: priceNum, lastCheckedAt: checkNow, oosStrikes: 0 });
                        const realQty = typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0
                            ? variant.inventory_quantity
                            : undefined;
                        const cart1xUrl = `${store.baseUrl}/cart/${variant.id}:1`;
                        const cart2xUrl = (realQty === undefined || realQty >= 2) ? `${store.baseUrl}/cart/${variant.id}:2` : undefined;
                        const cart3xUrl = (realQty === undefined || realQty >= 3) ? `${store.baseUrl}/cart/${variant.id}:3` : undefined;
                        const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;
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
                            itemId: String(variant.id),
                        });
                    }
                    else {
                        prev.oosStrikes = 0;
                    }
                }
                else {
                    const prev = exports.variantStateMap.get(variant.id);
                    if (prev) {
                        prev.oosStrikes += 1;
                        if (prev.oosStrikes >= 2) {
                            exports.variantStateMap.delete(variant.id);
                            await (0, notifier_1.markAlertSoldOut)(String(variant.id));
                        }
                    }
                    else {
                        await (0, notifier_1.markAlertSoldOut)(String(variant.id));
                    }
                    // Zero-Stock Pre-Drop Staging Detector:
                    // Detect brand-new matching target uploads or OOS price slashes to <= MSRP before inventory flips live!
                    const prevOos = oosVariantStagingMap.get(variant.id);
                    oosVariantStagingMap.set(variant.id, { price: priceNum, seenAt: checkNow });
                    const isStoreBaselineSeeded = seededOosStores.has(store.name);
                    const isNewStagingUpload = !prevOos && isStoreBaselineSeeded;
                    const isOosPriceSlashed = Boolean(prevOos && priceNum <= prevOos.price - 2 && prevOos.price > priceNum);
                    if (isNewStagingUpload || isOosPriceSlashed) {
                        const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
                        const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
                        if ((0, policies_1.isSingleCardOrNonSealed)(fullTitle, `${prod.handle || ''} ${tagsStr}`) || !(0, policies_1.hasMandatorySealedContainerKeyword)(fullTitle)) {
                            continue;
                        }
                        const matchedRule = (0, evaluator_1.matchTargetRuleForStaging)(fullTitle, priceNum, store.name, `${prod.handle || ''} ${tagsStr}`);
                        if (matchedRule && matchedRule.msrpCeiling > 0 && priceNum <= Math.round(matchedRule.msrpCeiling * 1.02 * 100) / 100) {
                            const stagingKey = `${store.name}__${matchedRule.id}`;
                            const lastStagedAt = stagingAlertCooldownMap.get(stagingKey) || 0;
                            if (checkNow - lastStagedAt > 4 * 60 * 60 * 1000) {
                                stagingAlertCooldownMap.set(stagingKey, checkNow);
                                const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;
                                const stagingReason = isOosPriceSlashed
                                    ? `📡 PRE-DROP STAGING RADAR: OOS Price Slashed ($${prevOos.price.toFixed(2)} -> $${priceNum.toFixed(2)}) — Watch for Inventory Flip!`
                                    : `📡 PRE-DROP STAGING RADAR: New Target SKU Staged at $${priceNum.toFixed(2)} (OOS) — Watch for Inventory Flip!`;
                                console.log(`📡 [PRE-DROP STAGING RADAR] ${store.name} staged "${fullTitle}" at $${priceNum.toFixed(2)} (MSRP $${matchedRule.msrpCeiling.toFixed(2)}) -> ${stagingReason}`);
                                (0, notifier_1.recordPreDropStagingEvent)({
                                    ruleId: matchedRule.id,
                                    ruleName: matchedRule.name,
                                    formFactor: matchedRule.formFactor || 'Sealed',
                                    rawTitle: fullTitle,
                                    retailer: store.name,
                                    price: priceNum,
                                    msrp: matchedRule.msrpCeiling,
                                    marketValue: matchedRule.estimatedMarketValue || matchedRule.msrpCeiling,
                                    url: productUrl,
                                    stagingReason
                                });
                            }
                        }
                    }
                }
            }
        }
        if (products.length > 0) {
            (0, evaluator_1.pruneStoreMissingOffers)(store.name, activeVariantIds);
        }
        seededOosStores.add(store.name);
        return { hit: products.length > 0, productsScanned: products.length, skippedByCircuit: false };
    }
    catch (err) {
        health.consecutiveFailures += 1;
        health.lastError = err?.message || 'Unexpected poll exception';
        if (health.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
            health.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
            health.status = 'CIRCUIT_OPEN';
        }
        else {
            health.status = 'DEGRADED';
        }
        storeHealthMap.set(store.name, health);
        return { hit: false, productsScanned: 0, skippedByCircuit: false };
    }
}
async function pollShopifyStores() {
    if (isPolling) {
        if (Date.now() - lastSweepStartedAt > SWEEP_WATCHDOG_MS + 10000) {
            console.warn('[LGS Poller] Watchdog detected stale isPolling lock (>100s) — force-resetting lock.');
            isPolling = false;
        }
        else {
            console.warn('[LGS Poller] Previous sweep still active — skipping overlapping cycle.');
            return;
        }
    }
    isPolling = true;
    lastSweepStartedAt = Date.now();
    deepFetchesThisSweep = 0;
    let activeStoresHit = 0;
    let totalProductsScanned = 0;
    let circuitOpenCount = 0;
    try {
        const queue = [...exports.MONITORED_STORES];
        const workerCount = Math.min(MAX_CONCURRENT_STORES, queue.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (queue.length > 0) {
                const store = queue.shift();
                if (!store)
                    break;
                try {
                    const res = await withWatchdog(pollSingleStore(store), STORE_POLL_WATCHDOG_MS, `Store poll for ${store.name}`);
                    if (res.hit)
                        activeStoresHit++;
                    totalProductsScanned += res.productsScanned;
                    if (res.skippedByCircuit)
                        circuitOpenCount++;
                }
                catch (storeErr) {
                    console.warn(`[LGS Poller] Watchdog aborted hung store ${store.name}: ${storeErr?.message || storeErr}`);
                }
                await sleep(getRandomJitter(120, 300));
            }
        });
        await withWatchdog(Promise.all(workers), SWEEP_WATCHDOG_MS, '40-Store LGS Sweep Cycle');
        flushStoreHealthToDisk();
        console.log(`[${new Date().toLocaleTimeString()}] LGS Sweep Complete (Pool=${MAX_CONCURRENT_STORES}): ${activeStoresHit}/${exports.MONITORED_STORES.length} stores responded (${totalProductsScanned} Pokemon listings checked${circuitOpenCount > 0 ? `, ${circuitOpenCount} in circuit cooldown` : ''}).`);
    }
    catch (sweepErr) {
        console.error(`[LGS Poller] Sweep error or watchdog timeout recovered: ${sweepErr?.message || sweepErr}`);
        try {
            flushStoreHealthToDisk();
        }
        catch (e) { }
    }
    finally {
        isPolling = false;
        const restTime = getRandomJitter(15000, 22000);
        setTimeout(pollShopifyStores, restTime);
    }
}
