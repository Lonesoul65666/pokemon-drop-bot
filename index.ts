import 'dotenv/config';
import { pollShopifyStores } from './lgsPoller';
import { pollRedditDeals, pollTcgPlayerUndercuts, pollBigBoxAggregators } from './vampirePoller';
import { WATCH_POLICIES } from './policies';
import { MarketSyncService } from './src/marketSync';
import { startStockDigestScheduler } from './notifier';
import { startMarketTapeScheduler } from './marketTape';

const marketSync = new MarketSyncService();

console.log('[Core] Booting background MarketSyncService & 14-Day Market Tape NRT Engine...');
marketSync.startWorker(WATCH_POLICIES);
startMarketTapeScheduler();

console.log('[Commander v3.0] Launching 31-Store Shopify Sniper + Big-Box Aggregator + Reddit + TCGPlayer Pollers + 4h Live Shelf Digest...');
pollShopifyStores();
pollBigBoxAggregators();
pollRedditDeals();
pollTcgPlayerUndercuts();
startStockDigestScheduler();
