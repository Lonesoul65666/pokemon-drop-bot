import express from 'express';
import path from 'path';
import { pollShopifyStores } from './lgsPoller';
import { WATCH_POLICIES } from './policies';
import { MarketSyncService } from './src/marketSync';

const app = express();
const PORT = 3000;

// 1. Initialize Market Sync Worker
const marketSync = new MarketSyncService();

const trackedItems = WATCH_POLICIES.map((policy: any) => ({
  id: policy.id,
  setSlug: policy.name || policy.id,
  format: policy.formFactor || 'etb',
  msrp: policy.msrpCeiling || policy.maxPrice || 50
}));

console.log('[Core] Booting background MarketSyncService...');
marketSync.startWorker(trackedItems);

// 2. Dashboard Static Files & Asset Directory
const dashboardDir = path.resolve(process.cwd(), 'dashboard', 'public');
const artDir = path.resolve(dashboardDir, 'art');

app.use(express.static(dashboardDir));
app.use('/art', express.static(artDir));

// 3. API Telemetry Route
app.get('/api/market', (_req, res) => {
  res.json(marketSync.getAllMetrics());
});

// 4. Start Server & Sniper
app.listen(PORT, () => {
  console.log(`[Commander] Dashboard & API running at http://127.0.0.1:${PORT}`);
});

console.log('[Commander] Launching Shopify sniper poller...');
pollShopifyStores();