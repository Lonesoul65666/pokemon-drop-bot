import 'dotenv/config';
import { pollShopifyStores, LGS_STORES } from './lgsPoller';
import { pollRedditDeals, pollTcgPlayerUndercuts, pollBigBoxAggregators } from './vampirePoller';
import { WATCH_POLICIES } from './policies';
import { MarketSyncService } from './src/marketSync';
import { startStockDigestScheduler } from './notifier';
import { startMarketTapeScheduler } from './marketTape';
import { registerProcessSafetyHandlers } from './listener';
import { startFastTier1Poller } from './src/pollers/fastTier1Poller';

registerProcessSafetyHandlers('pokemon-drop-bot');

const marketSync = new MarketSyncService();

console.log('[Core] Booting background MarketSyncService & 14-Day Market Tape NRT Engine...');
marketSync.startWorker(WATCH_POLICIES);
startMarketTapeScheduler();

console.log(`[Commander v5.0] Launching ${LGS_STORES.length}-Store Shopify Sniper + 15s Tier-1 Fast Delta Poller + Big-Box Aggregator + Reddit + TCGPlayer Pollers + 4h Live Shelf Digest...`);
pollShopifyStores().catch(err => console.error('[Core] pollShopifyStores top-level catch:', err));
startFastTier1Poller();
pollBigBoxAggregators().catch(err => console.error('[Core] pollBigBoxAggregators top-level catch:', err));
pollRedditDeals().catch(err => console.error('[Core] pollRedditDeals top-level catch:', err));
pollTcgPlayerUndercuts().catch(err => console.error('[Core] pollTcgPlayerUndercuts top-level catch:', err));
startStockDigestScheduler();
