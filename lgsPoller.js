"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNextProxy = getNextProxy;
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
dotenv_1.default.config({ path: path_1.default.resolve(process.cwd(), '.env') });
dns_1.default.setDefaultResultOrder('ipv4first');
const WEBSHARE_PROXY_URL = process.env.WEBSHARE_PROXY_URL || '';
const STORE_HEALTH_PATH = path_1.default.resolve(process.cwd(), 'storeHealth.json');
const MAX_CONCURRENT_STORES = 8;
const REQUEST_TIMEOUT_MS = 8000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
function getNextProxy() {
    return new https_proxy_agent_1.HttpsProxyAgent(WEBSHARE_PROXY_URL);
}
const storeHealthMap = new Map();
let isPolling = false;
try {
    if (fs_1.default.existsSync(STORE_HEALTH_PATH)) {
        const raw = JSON.parse(fs_1.default.readFileSync(STORE_HEALTH_PATH, 'utf-8'));
        if (raw && typeof raw === 'object') {
            for (const [k, v] of Object.entries(raw)) {
                storeHealthMap.set(k, v);
            }
        }
    }
}
catch (e) { }
function flushStoreHealthToDisk() {
    const out = {};
    for (const [k, v] of storeHealthMap.entries()) {
        out[k] = v;
    }
    (0, policies_1.atomicWriteJson)(STORE_HEALTH_PATH, out);
}
const MONITORED_STORES = [
    { name: 'Forge & Fire', baseUrl: 'https://forgeandfiregaming.com' },
    { name: 'Smoke & Mirrors', baseUrl: 'https://smokeandmirrorshobby.com' },
    { name: 'Safari Zone', baseUrl: 'https://safari-zone.com' },
    { name: 'Zulus Games', baseUrl: 'https://zulusgames.com' },
    { name: 'Gamers Guild AZ', baseUrl: 'https://gamersguildaz.com' },
    { name: 'MinMaxGames', baseUrl: 'https://minmaxgames.com' },
    { name: 'Card Shop Live', baseUrl: 'https://cardshoplive.com' },
    { name: 'Joshs Cards', baseUrl: 'https://joshscards.com' },
    { name: 'Flipside Gaming', baseUrl: 'https://www.flipsidegaming.com' },
    { name: 'Full Grip Games', baseUrl: 'https://www.fullgripgames.com' },
    { name: 'Over The Brick', baseUrl: 'https://overthebrick.com' },
    { name: 'Knight & Day Games', baseUrl: 'https://knightanddaygames.com' },
    { name: 'PokeNE', baseUrl: 'https://www.pokene.com' },
    { name: 'TCG Stadium', baseUrl: 'https://tcg-stadium.com' },
    { name: 'Rip N Ship Arena', baseUrl: 'https://www.ripnshiparena.com' },
    { name: 'Collector Store', baseUrl: 'https://collectorstore.com' },
    { name: 'Prodigy Games', baseUrl: 'https://prodigygames.com' },
    { name: 'Silver Moon', baseUrl: 'https://silvermooncards.com' },
    { name: 'The Lotusbox', baseUrl: 'https://thelotusbox.com' },
    { name: 'Rare Candy', baseUrl: 'https://rarecandy.com' }
];
const variantStateMap = new Map();
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
async function smartGetJson(url) {
    try {
        const res = await axios_1.default.get(url, { timeout: REQUEST_TIMEOUT_MS, headers: HEADERS });
        return { data: res.data };
    }
    catch (e) {
        try {
            const proxy = getNextProxy();
            const res = await axios_1.default.get(url, { timeout: REQUEST_TIMEOUT_MS, httpsAgent: proxy, headers: HEADERS });
            return { data: res.data };
        }
        catch (e2) {
            const status = e2?.response?.status || e?.response?.status;
            return { data: null, error: status ? `HTTP ${status}` : (e2?.code || e2?.message || 'Timeout/Network Error') };
        }
    }
}
// Automatically finds the best Pokemon collection feed on each Shopify store so we get 250 pure Pokemon items!
async function resolveBestPokemonFeed(store) {
    if (store.resolvedPath)
        return store.resolvedPath;
    const candidateHandles = [
        '/collections/pokemon-sealed/products.json?limit=250',
        '/collections/pokemon-sealed-products/products.json?limit=250',
        '/collections/pokemon-sealed-product/products.json?limit=250',
        '/collections/pokemon/products.json?limit=250',
        '/collections/pokemon-tcg/products.json?limit=250'
    ];
    // Check store's /collections.json first to see their exact Pokemon collection handle
    const { data: colData } = await smartGetJson(`${store.baseUrl}/collections.json?limit=250`);
    if (colData?.collections && Array.isArray(colData.collections)) {
        const pkmnCols = colData.collections.filter((c) => /pokemon|pkmn/i.test(c.handle || '') || /pokemon/i.test(c.title || ''));
        // Prefer "sealed" or main "pokemon" collection
        pkmnCols.sort((a, b) => {
            const aSealed = /sealed|booster|box/i.test(a.handle) ? 1 : 0;
            const bSealed = /sealed|booster|box/i.test(b.handle) ? 1 : 0;
            return bSealed - aSealed;
        });
        for (const col of pkmnCols.slice(0, 3)) {
            const testPath = `/collections/${col.handle}/products.json?limit=250`;
            const { data: prodData } = await smartGetJson(`${store.baseUrl}${testPath}`);
            if (prodData?.products && prodData.products.length >= 5) {
                store.resolvedPath = testPath;
                return testPath;
            }
        }
    }
    // Fallback to testing common candidate handles
    for (const cand of candidateHandles) {
        const { data: prodData } = await smartGetJson(`${store.baseUrl}${cand}`);
        if (prodData?.products && prodData.products.length >= 5) {
            store.resolvedPath = cand;
            return cand;
        }
    }
    store.resolvedPath = '/products.json?limit=250';
    return store.resolvedPath;
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
        const feedPath = await resolveBestPokemonFeed(store);
        const { data, error } = await smartGetJson(`${store.baseUrl}${feedPath}`);
        const products = data?.products;
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
        // Success: reset circuit breaker
        health.consecutiveFailures = 0;
        health.cooldownUntil = 0;
        health.status = 'HEALTHY';
        health.lastSuccessAt = Date.now();
        health.lastError = undefined;
        health.lastProductsCount = products.length;
        storeHealthMap.set(store.name, health);
        const checkNow = Date.now();
        for (const prod of products) {
            for (const variant of prod.variants || []) {
                const priceNum = parseFloat(variant.price);
                if (!priceNum || priceNum < 18)
                    continue;
                if (variant.available) {
                    const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
                    if (!(0, policies_1.isValidSkuForFormFactor)(fullTitle, undefined, priceNum))
                        continue;
                    const prev = variantStateMap.get(variant.id);
                    const minsSinceCheck = prev ? (checkNow - prev.lastCheckedAt) / (1000 * 60) : 999;
                    if (!prev || priceNum !== prev.price || minsSinceCheck >= 3) {
                        variantStateMap.set(variant.id, { price: priceNum, lastCheckedAt: checkNow, oosStrikes: 0 });
                        const cart1xUrl = `${store.baseUrl}/cart/${variant.id}:1`;
                        const cart2xUrl = `${store.baseUrl}/cart/${variant.id}:2`;
                        const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;
                        const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
                        const isPreOrder = /pre-?order|pre-?sale/i.test(`${fullTitle} ${tagsStr} ${prod.handle || ''}`);
                        const realQty = typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0
                            ? variant.inventory_quantity
                            : undefined;
                        await (0, listener_1.processIncomingDrop)({
                            title: fullTitle,
                            retailer: store.name,
                            url: cart1xUrl,
                            productUrl,
                            cart1xUrl,
                            cart2xUrl,
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
                    const prev = variantStateMap.get(variant.id);
                    if (prev) {
                        prev.oosStrikes += 1;
                        if (prev.oosStrikes >= 2) {
                            variantStateMap.delete(variant.id);
                            await (0, notifier_1.markAlertSoldOut)(String(variant.id));
                        }
                    }
                    else {
                        await (0, notifier_1.markAlertSoldOut)(String(variant.id));
                    }
                }
            }
        }
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
        console.warn('[LGS Poller] Previous sweep still active — skipping overlapping cycle.');
        return;
    }
    isPolling = true;
    let activeStoresHit = 0;
    let totalProductsScanned = 0;
    let circuitOpenCount = 0;
    try {
        const queue = [...MONITORED_STORES];
        const workerCount = Math.min(MAX_CONCURRENT_STORES, queue.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (queue.length > 0) {
                const store = queue.shift();
                if (!store)
                    break;
                const res = await pollSingleStore(store);
                if (res.hit)
                    activeStoresHit++;
                totalProductsScanned += res.productsScanned;
                if (res.skippedByCircuit)
                    circuitOpenCount++;
                await sleep(getRandomJitter(120, 300));
            }
        });
        await Promise.all(workers);
        flushStoreHealthToDisk();
        console.log(`[${new Date().toLocaleTimeString()}] LGS Sweep Complete (Pool=${MAX_CONCURRENT_STORES}): ${activeStoresHit}/${MONITORED_STORES.length} stores responded (${totalProductsScanned} Pokemon listings checked${circuitOpenCount > 0 ? `, ${circuitOpenCount} in circuit cooldown` : ''}).`);
    }
    finally {
        isPolling = false;
        const restTime = getRandomJitter(15000, 22000);
        setTimeout(pollShopifyStores, restTime);
    }
}
