"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketSyncService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const marketComps_1 = require("../marketComps");
const lgsPoller_1 = require("../lgsPoller");
const policies_1 = require("../policies");
const POLICIES_PATH = path_1.default.resolve(process.cwd(), 'policies.json');
const CACHE_PATH = path_1.default.resolve(process.cwd(), 'marketCache.json');
const SYNC_INTERVAL_MS = 1000 * 60 * 60 * 6; // Refresh every 6 hours (4x daily)
function cleanSearchQuery(name) {
    return name
        .replace(/\(36-Pack\)/gi, '')
        .replace(/\(6 Boxes \/ 216 Packs\)/gi, '')
        .replace(/\(10 ETBs\)/gi, '')
        .replace(/6-Pack /gi, '')
        .replace(/Sealed /gi, '')
        .replace(/Mega Evolution:/gi, '')
        .replace(/Scarlet & Violet:/gi, '')
        .replace(/25th Anniversary/gi, '')
        .trim();
}
class MarketSyncService {
    isSyncing = false;
    async runSyncCycle() {
        if (this.isSyncing)
            return;
        this.isSyncing = true;
        try {
            if (!fs_1.default.existsSync(POLICIES_PATH))
                return;
            const policies = JSON.parse(fs_1.default.readFileSync(POLICIES_PATH, 'utf-8'));
            let cache = {};
            if (fs_1.default.existsSync(CACHE_PATH)) {
                try {
                    cache = JSON.parse(fs_1.default.readFileSync(CACHE_PATH, 'utf-8'));
                }
                catch (e) { }
            }
            console.log(`[MarketSync] Running automated 6-hour TCGPlayer Market Baseline refresh for ${policies.length} items...`);
            const singles = policies.filter(p => p.formFactor !== 'Master Case' && p.formFactor !== 'ETB Case');
            const cases = policies.filter(p => p.formFactor === 'Master Case' || p.formFactor === 'ETB Case');
            const basePriceMap = new Map();
            let updatedCount = 0;
            // Pass 1: Sync all single boxes, ETBs, and bundles via TCGPlayer API
            for (const p of singles) {
                try {
                    const q = cleanSearchQuery(p.name);
                    const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(q)}&isList=false`;
                    const body = {
                        algorithm: "sales_synonym_v2",
                        from: 0,
                        size: 10,
                        filters: { term: { productLineName: ["pokemon"] }, range: {}, match: {} },
                        listingSearch: { context: { cart: {} }, filters: { term: { sellerStatus: "Live", channelId: 0 }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } } },
                        context: { cart: {}, shippingCountry: "US" },
                        settings: { useFuzzySearch: false, didYouMean: {} },
                        sort: {}
                    };
                    let res;
                    try {
                        res = await axios_1.default.post(url, body, {
                            timeout: 7000,
                            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
                        });
                    }
                    catch (err) {
                        res = await axios_1.default.post(url, body, {
                            timeout: 7000,
                            httpsAgent: (0, lgsPoller_1.getNextProxy)(),
                            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
                        });
                    }
                    const results = res.data?.results?.[0]?.results || [];
                    for (const item of results) {
                        if (item.customAttributes?.number)
                            continue;
                        const rawTitle = item.productName || '';
                        const title = rawTitle.toLowerCase();
                        if (!(0, marketComps_1.isValidCompTitle)(rawTitle, p.name, p.formFactor))
                            continue;
                        const isMatch = (p.formFactor === 'Booster Box' && title.includes('booster box')) ||
                            (p.formFactor === 'ETB' && (title.includes('elite trainer') || title.includes('etb'))) ||
                            (p.formFactor === 'Booster Bundle' && title.includes('bundle'));
                        if (isMatch) {
                            const mkt = parseFloat(item.marketPrice || item.lowestPrice || 0);
                            if (mkt > 10) {
                                const baselineRef = p.estimatedMarketValue || p.msrpCeiling || 50;
                                const rounded = (0, marketComps_1.applySyncSanityGuard)(mkt, p.formFactor, undefined, {
                                    sampleCount: results.length,
                                    ruleId: p.id,
                                    policyBaseline: baselineRef
                                });
                                p.estimatedMarketValue = rounded;
                                basePriceMap.set(p.id, rounded);
                                const prodId = Math.floor(Number(item.productId));
                                const existing = cache[p.id] || {};
                                const hasLiveStoreDrop = existing.inStock === true && existing.lowestStore && !existing.lowestStore.includes('TCGPlayer') && !existing.lowestStore.includes('Catalog');
                                const safeLowest = hasLiveStoreDrop ? Math.min(existing.lowestPrice, rounded) : rounded;
                                cache[p.id] = {
                                    ...existing,
                                    lowestPrice: safeLowest,
                                    lowestStore: hasLiveStoreDrop ? existing.lowestStore : 'TCGPlayer SKU Baseline',
                                    lowestUrl: hasLiveStoreDrop ? existing.lowestUrl : `https://www.tcgplayer.com/product/${prodId}`,
                                    inStock: hasLiveStoreDrop ? true : false,
                                    rollingAverage: rounded,
                                    lastUpdated: new Date().toISOString()
                                };
                                updatedCount++;
                            }
                            break;
                        }
                    }
                }
                catch (e) { }
                await new Promise(r => setTimeout(r, 350));
            }
            // Pass 2: Sync Master Cases & 10-ETB Cases (inherit live multiplier from parent Box/ETB so cases are always accurate)
            for (const c of cases) {
                const parentId = c.id.replace(/-case$/, '').replace(/-booster-case$/, '-booster-box');
                const parentPolicy = singles.find(s => s.id === parentId);
                const parentMkt = basePriceMap.get(parentId) || parentPolicy?.estimatedMarketValue;
                if (parentMkt) {
                    const mult = c.formFactor === 'Master Case' ? 6 : 10;
                    const caseMkt = (0, marketComps_1.applySyncSanityGuard)(Math.round(parentMkt * mult), c.formFactor, parentMkt);
                    c.estimatedMarketValue = caseMkt;
                    const existing = cache[c.id] || {};
                    const hasLiveStoreDrop = existing.inStock === true && existing.lowestStore && !existing.lowestStore.includes('TCGPlayer') && !existing.lowestStore.includes('Catalog');
                    const safeLowest = hasLiveStoreDrop ? Math.min(existing.lowestPrice, caseMkt) : caseMkt;
                    cache[c.id] = {
                        ...existing,
                        lowestPrice: safeLowest,
                        lowestStore: hasLiveStoreDrop ? existing.lowestStore : 'TCGPlayer Case Baseline',
                        rollingAverage: caseMkt,
                        lastUpdated: new Date().toISOString()
                    };
                    updatedCount++;
                }
            }
            // Safely update estimatedMarketValue in policies.json while preserving live user slider changes!
            const freshPoliciesOnDisk = JSON.parse(fs_1.default.readFileSync(POLICIES_PATH, 'utf-8'));
            const syncedMap = new Map(policies.map(x => [x.id, x.estimatedMarketValue]));
            freshPoliciesOnDisk.forEach(fp => {
                if (syncedMap.has(fp.id)) {
                    fp.estimatedMarketValue = syncedMap.get(fp.id);
                }
            });
            (0, policies_1.atomicWriteJson)(POLICIES_PATH, freshPoliciesOnDisk);
            (0, policies_1.atomicWriteJson)(CACHE_PATH, cache);
            console.log(`[MarketSync] Automated baseline refresh complete (${updatedCount} SKUs synced to latest market value).`);
        }
        catch (err) {
            console.error('[MarketSync] Refresh warning:', err.message);
        }
        finally {
            this.isSyncing = false;
        }
    }
    startWorker(_trackedProducts) {
        // Wait 60 seconds after boot before first background sync so initial startup is instant, then run every 6 hours
        setTimeout(() => this.runSyncCycle(), 60 * 1000);
        setInterval(() => this.runSyncCycle(), SYNC_INTERVAL_MS);
    }
}
exports.MarketSyncService = MarketSyncService;
