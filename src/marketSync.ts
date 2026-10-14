import fs from 'fs';
import path from 'path';
import axios from 'axios';

const POLICIES_PATH = path.resolve(process.cwd(), 'policies.json');
const CACHE_PATH = path.resolve(process.cwd(), 'marketCache.json');
const SYNC_INTERVAL_MS = 1000 * 60 * 60 * 6; // Refresh every 6 hours (4x daily)

function cleanSearchQuery(name: string): string {
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

export class MarketSyncService {
  private isSyncing = false;

  public async runSyncCycle() {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      if (!fs.existsSync(POLICIES_PATH)) return;
      const policies: any[] = JSON.parse(fs.readFileSync(POLICIES_PATH, 'utf-8'));
      let cache: Record<string, any> = {};
      if (fs.existsSync(CACHE_PATH)) {
        try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')); } catch (e) {}
      }

      console.log(`[MarketSync] Running automated 6-hour TCGPlayer Market Baseline refresh for ${policies.length} items...`);

      const singles = policies.filter(p => p.formFactor !== 'Master Case' && p.formFactor !== 'ETB Case');
      const cases = policies.filter(p => p.formFactor === 'Master Case' || p.formFactor === 'ETB Case');
      const basePriceMap = new Map<string, number>();
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

          const res = await axios.post(url, body, {
            timeout: 7000,
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
          });

          const results = res.data?.results?.[0]?.results || [];
          for (const item of results) {
            if (item.customAttributes?.number) continue;
            const title = (item.productName || '').toLowerCase();
            if (title.includes('code card') || title.includes('empty') || title.includes('sleeves')) continue;

            const isMatch =
              (p.formFactor === 'Booster Box' && title.includes('booster box') && !title.includes('case')) ||
              (p.formFactor === 'ETB' && (title.includes('elite trainer') || title.includes('etb')) && !title.includes('case') && !title.includes('center')) ||
              (p.formFactor === 'Booster Bundle' && title.includes('bundle') && !title.includes('case'));

            if (isMatch) {
              const mkt = parseFloat(item.marketPrice || item.lowestPrice || 0);
              if (mkt > 10) {
                const rounded = Math.round(mkt * 100) / 100;
                p.estimatedMarketValue = rounded;
                basePriceMap.set(p.id, rounded);

                const prodId = Math.floor(Number(item.productId));
                const existing = cache[p.id] || {};
                const hasLiveStoreDrop = existing.inStock === true && existing.lowestStore && !existing.lowestStore.includes('TCGPlayer') && !existing.lowestStore.includes('Catalog');

                cache[p.id] = {
                  ...existing,
                  lowestPrice: hasLiveStoreDrop ? existing.lowestPrice : rounded,
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
        } catch (e) {}
        await new Promise(r => setTimeout(r, 350));
      }

      // Pass 2: Sync Master Cases & 10-ETB Cases (inherit live multiplier from parent Box/ETB so cases are always accurate)
      for (const c of cases) {
        const parentId = c.id.replace(/-case$/, '').replace(/-booster-case$/, '-booster-box');
        const parentMkt = basePriceMap.get(parentId);
        if (parentMkt) {
          const mult = c.formFactor === 'Master Case' ? 6 : 10;
          const caseMkt = Math.round(parentMkt * mult);
          c.estimatedMarketValue = caseMkt;

          const existing = cache[c.id] || {};
          const hasLiveStoreDrop = existing.inStock === true && existing.lowestStore && !existing.lowestStore.includes('TCGPlayer') && !existing.lowestStore.includes('Catalog');
          cache[c.id] = {
            ...existing,
            lowestPrice: hasLiveStoreDrop ? existing.lowestPrice : caseMkt,
            lowestStore: hasLiveStoreDrop ? existing.lowestStore : 'TCGPlayer Case Baseline',
            rollingAverage: caseMkt,
            lastUpdated: new Date().toISOString()
          };
          updatedCount++;
        }
      }

      // Safely update estimatedMarketValue in policies.json while preserving live user slider changes!
      const freshPoliciesOnDisk: any[] = JSON.parse(fs.readFileSync(POLICIES_PATH, 'utf-8'));
      const syncedMap = new Map(policies.map(x => [x.id, x.estimatedMarketValue]));
      freshPoliciesOnDisk.forEach(fp => {
        if (syncedMap.has(fp.id)) {
          fp.estimatedMarketValue = syncedMap.get(fp.id);
        }
      });

      const tmpPol = POLICIES_PATH + '.tmp';
      fs.writeFileSync(tmpPol, JSON.stringify(freshPoliciesOnDisk, null, 2), 'utf-8');
      fs.renameSync(tmpPol, POLICIES_PATH);

      const tmpCache = CACHE_PATH + '.tmp';
      fs.writeFileSync(tmpCache, JSON.stringify(cache, null, 2), 'utf-8');
      fs.renameSync(tmpCache, CACHE_PATH);

      console.log(`[MarketSync] Automated baseline refresh complete (${updatedCount} SKUs synced to latest market value).`);
    } catch (err: any) {
      console.error('[MarketSync] Refresh warning:', err.message);
    } finally {
      this.isSyncing = false;
    }
  }

  public startWorker(_trackedProducts?: any[]) {
    // Wait 60 seconds after boot before first background sync so initial startup is instant, then run every 6 hours
    setTimeout(() => this.runSyncCycle(), 60 * 1000);
    setInterval(() => this.runSyncCycle(), SYNC_INTERVAL_MS);
  }
}
