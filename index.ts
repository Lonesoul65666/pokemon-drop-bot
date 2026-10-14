import 'dotenv/config';
import { pollShopifyStores } from './lgsPoller';
import { pollRedditDeals, pollTcgPlayerUndercuts } from './vampirePoller';
import { WATCH_POLICIES } from './policies';
import { MarketSyncService } from './src/marketSync';

const marketSync = new MarketSyncService();

console.log('[Core] Booting background MarketSyncService...');
marketSync.startWorker(WATCH_POLICIES);

console.log('[Commander] Launching 20-Store Shopify Sniper + Vampiric Deal Pollers (r/PKMNTCGDeals + TCGPlayer)...');
pollShopifyStores();
pollRedditDeals();
pollTcgPlayerUndercuts();
