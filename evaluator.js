"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateItem = evaluateItem;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const policies_1 = require("./policies");
const marketTelemetry_1 = require("./marketTelemetry");
const ALERT_STATE_PATH = path_1.default.resolve(process.cwd(), 'alertState.json');
let alertMemory = {};
try {
    if (fs_1.default.existsSync(ALERT_STATE_PATH)) {
        alertMemory = JSON.parse(fs_1.default.readFileSync(ALERT_STATE_PATH, 'utf-8'));
    }
}
catch (e) { }
function saveAlertMemory() {
    try {
        fs_1.default.writeFileSync(ALERT_STATE_PATH, JSON.stringify(alertMemory, null, 2), 'utf-8');
    }
    catch (e) { }
}
function evaluateItem(item) {
    const cleanTitle = item.title.trim();
    for (const junkRegex of policies_1.GLOBAL_JUNK_EXCLUSIONS) {
        if (junkRegex.test(cleanTitle)) {
            return { action: 'IGNORE', reason: `Filtered out by global exclusion (${junkRegex})` };
        }
    }
    for (const rule of policies_1.WATCH_POLICIES) {
        const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
        if (!isMatched)
            continue;
        if ((rule.formFactor === 'ETB' || rule.formFactor === 'Booster Box' || rule.formFactor === 'Booster Bundle') && /\bcase\b/i.test(cleanTitle)) {
            continue;
        }
        if (item.price && item.price > 0) {
            (0, marketTelemetry_1.recordObservation)(rule.id, item.price, item.retailer, item.url, rule.msrpCeiling);
        }
        if (rule.active === false) {
            return { action: 'IGNORE', reason: `Rule "${rule.name}" is toggled OFF on dashboard.`, rule };
        }
        if (item.stock !== undefined && item.stock < rule.minStock) {
            return { action: 'IGNORE', reason: `Stock (${item.stock}) below minStock (${rule.minStock}).`, rule };
        }
        const effectiveCeiling = Math.max(rule.msrpCeiling, rule.maxMarketBuyPrice);
        if (item.price !== undefined && item.price > effectiveCeiling) {
            return {
                action: 'IGNORE',
                reason: `Price ($${item.price.toFixed(2)}) exceeds allowable buy threshold ($${effectiveCeiling.toFixed(2)}).`,
                rule
            };
        }
        // Persistent Deduplication per (Rule + Retailer)
        const stateKey = `${rule.id}__${item.retailer}`;
        const prev = alertMemory[stateKey];
        const now = Date.now();
        const currentPrice = item.price ?? effectiveCeiling;
        let alertType = 'NEW_DROP';
        let previousPrice = undefined;
        let previousTimeStr = undefined;
        if (prev) {
            const elapsedHours = (now - prev.timestamp) / (1000 * 60 * 60);
            const isSignificantPriceDrop = currentPrice <= prev.lowestAlertedPrice - 3.00;
            // Block same-price repeats for 12 full hours! Only allow through immediately if the price dropped by $3+
            if (!isSignificantPriceDrop && elapsedHours < 12) {
                return {
                    action: 'IGNORE',
                    reason: `Deduplicated repeat: ${rule.name} at ${item.retailer} already alerted at $${prev.lastPrice.toFixed(2)} (${prev.timeStr}).`,
                    rule
                };
            }
            previousPrice = prev.lastPrice;
            previousTimeStr = prev.timeStr;
            alertType = isSignificantPriceDrop ? 'PRICE_DROP' : 'RESTOCK_REPEAT';
        }
        alertMemory[stateKey] = {
            lastPrice: currentPrice,
            lowestAlertedPrice: prev ? Math.min(prev.lowestAlertedPrice, currentPrice) : currentPrice,
            timestamp: now,
            timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            alertCount: (prev?.alertCount || 0) + 1
        };
        saveAlertMemory();
        const liveTel = (0, marketTelemetry_1.getTelemetry)()[rule.id];
        const marketVal = (liveTel && liveTel.rollingAverage > 0) ? liveTel.rollingAverage : (rule.estimatedMarketValue || effectiveCeiling);
        const savingsDollars = Math.max(0, marketVal - currentPrice);
        const discountPct = marketVal > 0 ? Math.round(((marketVal - currentPrice) / marketVal) * 100) : 0;
        return {
            action: 'BUY',
            reason: `[${alertType}] Matched "${rule.name}" at $${currentPrice.toFixed(2)} (${discountPct}% under market)`,
            rule,
            discountPct,
            savingsDollars,
            alertType,
            previousPrice,
            previousTimeStr
        };
    }
    return { action: 'IGNORE', reason: 'No matching policy rule found.' };
}
