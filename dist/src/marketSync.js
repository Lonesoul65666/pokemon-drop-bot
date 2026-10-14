"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketSyncService = void 0;
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const CACHE_FILE = path_1.default.resolve(process.cwd(), 'marketCache.json');
const SYNC_INTERVAL_MS = 1000 * 60 * 30; // 30 minutes
class MarketSyncService {
    cache = {};
    constructor() {
        this.loadCache();
    }
    loadCache() {
        if (fs_extra_1.default.existsSync(CACHE_FILE)) {
            this.cache = fs_extra_1.default.readJsonSync(CACHE_FILE, { throws: false }) || {};
        }
    }
    async persistCache() {
        await fs_extra_1.default.writeJson(CACHE_FILE, this.cache, { spaces: 2 });
    }
    async runSyncCycle(trackedProducts) {
        console.log(`[MarketSync] Starting price sync for ${trackedProducts.length} tracked items...`);
        for (const prod of trackedProducts) {
            try {
                const query = encodeURIComponent(`${prod.name} ${prod.format}`);
                const res = await axios_1.default.get(`https://www.pricecharting.com/api/product?q=${query}`, {
                    timeout: 6000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DropBot-Commander/2.0' }
                });
                const livePrice = res.data?.price ? res.data.price / 100 : null;
                if (!livePrice)
                    continue;
                this.cache[prod.id] = {
                    ...(this.cache[prod.id] || {}),
                    lowestPrice: livePrice,
                    rollingAverage: livePrice,
                    lastUpdated: new Date().toISOString()
                };
                await new Promise(r => setTimeout(r, 1200));
            }
            catch (err) {
                // Silently skip timeouts to keep the event loop clean
            }
        }
        await this.persistCache();
        console.log('[MarketSync] Market sync cycle complete. Cache persisted.');
    }
    startWorker(trackedProducts) {
        this.runSyncCycle(trackedProducts);
        setInterval(() => this.runSyncCycle(trackedProducts), SYNC_INTERVAL_MS);
    }
    getAllMetrics() {
        return this.cache;
    }
}
exports.MarketSyncService = MarketSyncService;
