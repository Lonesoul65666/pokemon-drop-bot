"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const lgsPoller_1 = require("./lgsPoller");
const policies_1 = require("./policies");
const marketSync_1 = require("./src/marketSync");
const app = (0, express_1.default)();
const PORT = 3000;
// 1. Initialize Market Sync Worker
const marketSync = new marketSync_1.MarketSyncService();
const trackedItems = policies_1.WATCH_POLICIES.map((policy) => ({
    id: policy.id,
    setSlug: policy.name || policy.id,
    format: policy.formFactor || 'etb',
    msrp: policy.msrpCeiling || policy.maxPrice || 50
}));
console.log('[Core] Booting background MarketSyncService...');
marketSync.startWorker(trackedItems);
// 2. Dashboard Static Files & Asset Directory
const dashboardDir = path_1.default.resolve(process.cwd(), 'dashboard', 'public');
const artDir = path_1.default.resolve(dashboardDir, 'art');
app.use(express_1.default.static(dashboardDir));
app.use('/art', express_1.default.static(artDir));
// 3. API Telemetry Route
app.get('/api/market', (_req, res) => {
    res.json(marketSync.getAllMetrics());
});
// 4. Start Server & Sniper
app.listen(PORT, () => {
    console.log(`[Commander] Dashboard & API running at http://127.0.0.1:${PORT}`);
});
console.log('[Commander] Launching Shopify sniper poller...');
(0, lgsPoller_1.pollShopifyStores)();
