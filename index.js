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
// ==========================================
// 1. INITIALIZE MARKET SYNC WORKER
// ==========================================
const marketSync = new marketSync_1.MarketSyncService();
// Map your existing policies into the format the pricing worker expects
const trackedItems = policies_1.WATCH_POLICIES.filter(p => p.active).map(policy => ({
    id: policy.id,
    setSlug: policy.name, // Send the full name to PriceCharting
    format: policy.formFactor || 'etb',
    msrp: policy.msrpCeiling || 50
}));
console.log('[MarketSync] Booting background pricing worker...');
marketSync.startWorker(trackedItems);
// ==========================================
// 2. EXPRESS DASHBOARD & API ROUTES
// ==========================================
const dashboardDir = path_1.default.resolve(process.cwd(), 'dashboard', 'public');
const artDir = path_1.default.resolve(dashboardDir, 'art');
// Serve the main dashboard UI
app.use(express_1.default.static(dashboardDir));
// Serve the generated .webp sealed box art
app.use('/art', express_1.default.static(artDir));
// Endpoint for the dashboard to pull live market prices and deltas
app.get('/api/market', (_req, res) => {
    res.json(marketSync.getAllMetrics());
});
// ==========================================
// 3. START SERVICES
// ==========================================
app.listen(PORT, () => {
    console.log(`[Commander] Dashboard & API live at http://127.0.0.1:${PORT}`);
});
console.log('[Commander] Starting Sniper Engine / LGS Poller...');
(0, lgsPoller_1.pollShopifyStores)();
