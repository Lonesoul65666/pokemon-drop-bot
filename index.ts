import 'dotenv/config';
import { pollShopifyStores } from './lgsPoller';
import { pollRedditDeals, pollTcgPlayerUndercuts, pollBigBoxAggregators } from './vampirePoller';
import { WATCH_POLICIES } from './policies';
import { MarketSyncService } from './src/marketSync';
import { startStockDigestScheduler } from './notifier';

const marketSync = new MarketSyncService();

console.log('[Core] Booting background MarketSyncService...');
marketSync.startWorker(WATCH_POLICIES);

console.log('[Commander v3.0] Launching 20-Store Shopify Sniper + Big-Box Aggregator + Reddit + TCGPlayer Pollers + 4h Live Shelf Digest...');
pollShopifyStores();
pollBigBoxAggregators();
pollRedditDeals();
pollTcgPlayerUndercuts();
startStockDigestScheduler();
