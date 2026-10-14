import fs from 'fs-extra';
import path from 'path';
import axios from 'axios';

const CACHE_FILE = path.resolve(process.cwd(), 'marketCache.json');
const SYNC_INTERVAL_MS = 1000 * 60 * 30; // 30 minutes

export class MarketSyncService {
  private cache: Record<string, any> = {};

  constructor() {
    this.loadCache();
  }

  private loadCache() {
    if (fs.existsSync(CACHE_FILE)) {
      this.cache = fs.readJsonSync(CACHE_FILE, { throws: false }) || {};
    }
  }

  public async persistCache() {
    await fs.writeJson(CACHE_FILE, this.cache, { spaces: 2 });
  }

  public async runSyncCycle(trackedProducts: any[]) {
    console.log(`[MarketSync] Starting price sync for ${trackedProducts.length} tracked items...`);
    
    for (const prod of trackedProducts) {
      try {
        const query = encodeURIComponent(`${prod.name} ${prod.format}`);
        const res = await axios.get(`https://www.pricecharting.com/api/product?q=${query}`, {
          timeout: 6000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DropBot-Commander/2.0' }
        });
        
        const livePrice = res.data?.price ? res.data.price / 100 : null;
        if (!livePrice) continue;

        this.cache[prod.id] = {
          ...(this.cache[prod.id] || {}),
          lowestPrice: livePrice,
          rollingAverage: livePrice, 
          lastUpdated: new Date().toISOString()
        };

        await new Promise(r => setTimeout(r, 1200)); 
      } catch (err: any) {
        // Silently skip timeouts to keep the event loop clean
      }
    }
    
    await this.persistCache();
    console.log('[MarketSync] Market sync cycle complete. Cache persisted.');
  }

  public startWorker(trackedProducts: any[]) {
    this.runSyncCycle(trackedProducts);
    setInterval(() => this.runSyncCycle(trackedProducts), SYNC_INTERVAL_MS);
  }

  public getAllMetrics() {
    return this.cache;
  }
}