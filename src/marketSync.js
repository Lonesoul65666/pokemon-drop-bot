"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketSyncService = void 0;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const CACHE_FILE = path_1.default.resolve(process.cwd(), 'data', 'market_cache.json');
const SYNC_INTERVAL_MS = 1000 * 60 * 30; // 30 minutes
class MarketSyncService {
    cache = new Map();
    constructor() {
        this.loadCache();
    }
    loadCache() {
        try {
            if (fs_extra_1.default.existsSync(CACHE_FILE)) {
                const raw = fs_extra_1.default.readJsonSync(CACHE_FILE);
                Object.entries(raw).forEach(([k, v]) => this.cache.set(k, v));
            }
        }
        catch (err) {
            console.error('[MarketSync] Failed to read market cache:', err);
        }
    }
    async persistCache() {
        try {
            await fs_extra_1.default.ensureDir(path_1.default.dirname(CACHE_FILE));
            const serialized = Object.fromEntries(this.cache.entries());
            await fs_extra_1.default.writeJson(CACHE_FILE, serialized, { spaces: 2 });
        }
        catch (err) {
            console.error('[MarketSync] Failed to persist market cache:', err);
        }
    }
    async fetchMarketPrice(setSlug, format) {
        try {
            const query = encodeURIComponent(`${setSlug.replace(/-/g, ' ')} ${format.replace(/_/g, ' ')}`);
            const res = await axios_1.default.get(`https://www.pricecharting.com/api/product?q=${query}`, {
                timeout: 6000,
                headers: { 'User-Agent': 'DropBot-Commander/2.0' }
            });
            return res.data?.price ? res.data.price / 100 : null;
        }
        catch {
            return null;
        }
    }
    async runSyncCycle(trackedProducts) {
        console.log(`[MarketSync] Running price sync for ${trackedProducts.length} tracked items...`);
        for (const prod of trackedProducts) {
            const livePrice = await this.fetchMarketPrice(prod.setSlug, prod.format);
            if (!livePrice)
                continue;
            const existing = this.cache.get(prod.id) || {
                productId: prod.id,
                msrp: prod.msrp,
                currentMarket: livePrice,
                deltaVsMsrpPct: 0,
                lastSync: new Date().toISOString(),
                history: [],
                asset: {
                    format: prod.format,
                    setSlug: prod.setSlug,
                    localPath: `/art/${prod.setSlug}-${prod.format}.webp`
                }
            };
            existing.currentMarket = livePrice;
            existing.deltaVsMsrpPct = Number((((livePrice - prod.msrp) / prod.msrp) * 100).toFixed(2));
            existing.lastSync = new Date().toISOString();
            existing.history.push({
                timestamp: existing.lastSync,
                marketPrice: livePrice,
                source: 'pricecharting'
            });
            if (existing.history.length > 30) {
                existing.history.shift();
            }
            this.cache.set(prod.id, existing);
            await new Promise(r => setTimeout(r, 1200));
        }
        await this.persistCache();
        console.log('[MarketSync] Market cache updated successfully.');
    }
    startWorker(trackedProducts) {
        this.runSyncCycle(trackedProducts);
        setInterval(() => this.runSyncCycle(trackedProducts), SYNC_INTERVAL_MS);
    }
    getProductMetrics(id) {
        return this.cache.get(id);
    }
    getAllMetrics() {
        return Object.fromEntries(this.cache.entries());
    }
}
exports.MarketSyncService = MarketSyncService;
