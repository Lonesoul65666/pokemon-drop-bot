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
const listener_1 = require("./listener");
dns_1.default.setDefaultResultOrder('ipv4first');
const USE_PROXIES = true;
const PROXY_LIST = [
    'http://uowcnblq:a5qiuyuv2hfk@45.38.107.97:6014',
    'http://uowcnblq:a5qiuyuv2hfk@64.137.96.74:6641',
    'http://uowcnblq:a5qiuyuv2hfk@198.23.243.226:6361',
    'http://uowcnblq:a5qiuyuv2hfk@38.154.185.97:6370',
    'http://uowcnblq:a5qiuyuv2hfk@84.247.60.125:6095',
    'http://uowcnblq:a5qiuyuv2hfk@191.96.254.138:6185',
    'http://uowcnblq:a5qiuyuv2hfk@198.46.161.42:5092',
    'http://uowcnblq:a5qiuyuv2hfk@64.137.10.153:5803',
    'http://uowcnblq:a5qiuyuv2hfk@104.164.49.38:7693',
    'http://uowcnblq:a5qiuyuv2hfk@23.26.71.145:5628'
];
let proxyIndex = 0;
function getNextProxy() {
    if (!USE_PROXIES || PROXY_LIST.length === 0)
        return undefined;
    const proxyUrl = PROXY_LIST[proxyIndex];
    proxyIndex = (proxyIndex + 1) % PROXY_LIST.length;
    return new https_proxy_agent_1.HttpsProxyAgent(proxyUrl);
}
const MONITORED_STORES = [
    { name: 'Forge & Fire', baseUrl: 'https://forgeandfiregaming.com', collectionPath: '/products.json?limit=250' },
    { name: 'Smoke & Mirrors', baseUrl: 'https://smokeandmirrorshobby.com', collectionPath: '/products.json?limit=250' },
    { name: 'Safari Zone', baseUrl: 'https://safari-zone.com', collectionPath: '/products.json?limit=250' },
    { name: 'Zulus Games', baseUrl: 'https://zulusgames.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
    { name: 'Gamers Guild AZ', baseUrl: 'https://gamersguildaz.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
    { name: 'MinMaxGames', baseUrl: 'https://minmaxgames.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
    { name: 'Card Shop Live', baseUrl: 'https://cardshoplive.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
    { name: 'Joshs Cards', baseUrl: 'https://joshscards.com', collectionPath: '/products.json?limit=250' },
    { name: 'Flipside Gaming', baseUrl: 'https://www.flipsidegaming.com', collectionPath: '/collections/pokemon-sealed-product/products.json?limit=250' },
    { name: 'Full Grip Games', baseUrl: 'https://www.fullgripgames.com', collectionPath: '/products.json?limit=250' },
    { name: 'Over The Brick', baseUrl: 'https://overthebrick.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
    { name: 'Knight & Day Games', baseUrl: 'https://knightanddaygames.com', collectionPath: '/products.json?limit=250' },
    { name: 'PokeNE', baseUrl: 'https://www.pokene.com', collectionPath: '/products.json?limit=250' },
    { name: 'TCG Stadium', baseUrl: 'https://tcg-stadium.com', collectionPath: '/products.json?limit=250' },
    { name: 'Rip N Ship Arena', baseUrl: 'https://www.ripnshiparena.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
    { name: 'Collector Store', baseUrl: 'https://collectorstore.com', collectionPath: '/products.json?limit=250' },
    { name: 'Prodigy Games', baseUrl: 'https://prodigygames.com', collectionPath: '/products.json?limit=250' },
    { name: 'Silver Moon', baseUrl: 'https://silvermooncards.com', collectionPath: '/products.json?limit=250' },
    { name: 'The Lotusbox', baseUrl: 'https://thelotusbox.com', collectionPath: '/products.json?limit=250' },
    { name: 'Rare Candy', baseUrl: 'https://rarecandy.com', collectionPath: '/products.json?limit=250' }
];
// Track variant availability + price (NEVER trigger just because Shopify POS touched updated_at!)
const variantStateMap = new Map();
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function getRandomJitter(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}
async function pollShopifyStores() {
    let activeStoresHit = 0;
    let totalProductsScanned = 0;
    for (const store of MONITORED_STORES) {
        try {
            const endpoint = `${store.baseUrl}${store.collectionPath}`;
            const currentProxy = getNextProxy();
            const res = await axios_1.default.get(endpoint, {
                timeout: 8000,
                httpsAgent: currentProxy,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                    Accept: 'application/json',
                }
            });
            const products = res.data?.products || [];
            if (products.length > 0) {
                activeStoresHit++;
                totalProductsScanned += products.length;
            }
            for (const prod of products) {
                for (const variant of prod.variants || []) {
                    const priceNum = parseFloat(variant.price);
                    if (!priceNum || priceNum <= 0)
                        continue;
                    if (variant.available) {
                        const prev = variantStateMap.get(variant.id);
                        // Only emit to evaluator if:
                        // 1) Never seen in stock during this session, OR
                        // 2) Price dropped by at least $1.00 while in stock
                        if (!prev || priceNum < prev.price - 0.99) {
                            variantStateMap.set(variant.id, { price: priceNum, oosStrikes: 0 });
                            const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
                            const fastCheckoutUrl = `${store.baseUrl}/cart/${variant.id}:1`;
                            const realQty = typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0
                                ? variant.inventory_quantity
                                : undefined;
                            await (0, listener_1.processIncomingDrop)({
                                title: fullTitle,
                                retailer: store.name,
                                url: fastCheckoutUrl,
                                price: priceNum,
                                stock: realQty,
                                itemId: String(variant.id),
                            });
                        }
                        else {
                            // Still sitting in stock at the same (or higher) price -> reset OOS strikes and DO NOT re-emit!
                            prev.oosStrikes = 0;
                        }
                    }
                    else {
                        // Require 3 consecutive Out-Of-Stock sweeps (~1 minute) before clearing from memory so brief flickers don't re-alert
                        const prev = variantStateMap.get(variant.id);
                        if (prev) {
                            prev.oosStrikes += 1;
                            if (prev.oosStrikes >= 3) {
                                variantStateMap.delete(variant.id);
                            }
                        }
                    }
                }
            }
        }
        catch (err) { }
        await sleep(getRandomJitter(400, 1100));
    }
    console.log(`[${new Date().toLocaleTimeString()}] LGS Sweep Complete: ${activeStoresHit}/${MONITORED_STORES.length} stores responded (${totalProductsScanned} listings checked).`);
    const restTime = getRandomJitter(15000, 22000);
    setTimeout(pollShopifyStores, restTime);
}
