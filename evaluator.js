"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertLiveStock = upsertLiveStock;
exports.markLiveStockOut = markLiveStockOut;
exports.evaluateItem = evaluateItem;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const policies_1 = require("./policies");
const marketTelemetry_1 = require("./marketTelemetry");
const ALERT_STATE_PATH = path_1.default.resolve(process.cwd(), 'alertState.json');
const LIVE_STOCK_PATH = path_1.default.resolve(process.cwd(), 'liveStock.json');
let alertMemory = {};
try {
    if (fs_1.default.existsSync(ALERT_STATE_PATH)) {
        alertMemory = JSON.parse(fs_1.default.readFileSync(ALERT_STATE_PATH, 'utf-8'));
    }
}
catch (e) { }
function saveAlertMemory() {
    (0, policies_1.atomicWriteJson)(ALERT_STATE_PATH, alertMemory);
}
function upsertLiveStock(entry) {
    try {
        let map = {};
        if (fs_1.default.existsSync(LIVE_STOCK_PATH)) {
            try {
                map = JSON.parse(fs_1.default.readFileSync(LIVE_STOCK_PATH, 'utf-8'));
            }
            catch (e) {
                map = {};
            }
        }
        const existing = map[entry.ruleId];
        // Update if same retailer, lower/equal price, or existing entry is > 30 mins old
        if (!existing || !existing.inStock || existing.retailer === entry.retailer || entry.price <= existing.price || (Date.now() - existing.updatedAt > 30 * 60 * 1000)) {
            map[entry.ruleId] = entry;
            (0, policies_1.atomicWriteJson)(LIVE_STOCK_PATH, map);
        }
    }
    catch (e) { }
}
function markLiveStockOut(itemId) {
    try {
        if (!fs_1.default.existsSync(LIVE_STOCK_PATH))
            return;
        const map = JSON.parse(fs_1.default.readFileSync(LIVE_STOCK_PATH, 'utf-8'));
        let changed = false;
        const recentOos = Array.isArray(map.__recentOos)
            ? map.__recentOos.filter((x) => Date.now() - (x.oosAt || 0) < 4 * 60 * 60 * 1000)
            : [];
        for (const key of Object.keys(map)) {
            if (key === '__recentOos')
                continue;
            if (map[key]?.itemId === String(itemId)) {
                recentOos.unshift({
                    ruleName: map[key].ruleName || map[key].title || key,
                    retailer: map[key].retailer || 'Store',
                    price: map[key].price || 0,
                    oosAt: Date.now()
                });
                delete map[key];
                changed = true;
            }
        }
        if (changed) {
            map.__recentOos = recentOos.slice(0, 8);
            (0, policies_1.atomicWriteJson)(LIVE_STOCK_PATH, map);
        }
    }
    catch (e) { }
}
function evaluateItem(item) {
    const cleanTitle = item.title.trim();
    const isPreOrder = Boolean(item.isPreOrder || /pre-?order|pre-?sale/i.test(`${cleanTitle} ${item.url}`));
    for (const junkRegex of policies_1.GLOBAL_JUNK_EXCLUSIONS) {
        if (junkRegex.test(cleanTitle)) {
            return { action: 'IGNORE', reason: `Filtered out by global exclusion (${junkRegex})` };
        }
    }
    for (const rule of policies_1.WATCH_POLICIES) {
        const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
        if (!isMatched)
            continue;
        if (!(0, policies_1.isValidSkuForFormFactor)(cleanTitle, rule.formFactor, item.price)) {
            continue;
        }
        const minFloor = (0, policies_1.getMinPlausiblePriceFloor)(rule.formFactor);
        if (item.price !== undefined && item.price < minFloor) {
            continue;
        }
        if (item.price && item.price >= minFloor) {
            (0, marketTelemetry_1.recordObservation)(rule.id, item.price, item.retailer, item.productUrl || item.url, rule.msrpCeiling);
        }
        if (rule.active === false) {
            return { action: 'IGNORE', reason: `Rule "${rule.name}" is toggled OFF on dashboard.`, rule };
        }
        if (item.stock !== undefined && item.stock < rule.minStock) {
            return { action: 'IGNORE', reason: `Stock (${item.stock}) below minStock (${rule.minStock}).`, rule };
        }
        const policyMaxBuy = Math.max(rule.msrpCeiling, rule.maxMarketBuyPrice);
        // Pre-order strict ceiling: Math.min(policy.maxBuy, Math.round(policy.msrp * 1.05))
        const effectiveCeiling = isPreOrder
            ? Math.min(policyMaxBuy, Math.round(rule.msrpCeiling * 1.05))
            : policyMaxBuy;
        const dropPrice = item.price ?? effectiveCeiling;
        const isFreeShip = Boolean(item.freeShipping || dropPrice >= 150);
        const estimatedShipping = isFreeShip ? 0 : 6.99;
        const landedPrice = Math.round((dropPrice + estimatedShipping) * 100) / 100;
        let freeShipNote = undefined;
        if (dropPrice > effectiveCeiling) {
            return {
                action: 'IGNORE',
                reason: `${isPreOrder ? '[PRE-ORDER] ' : ''}Price ($${dropPrice.toFixed(2)}) exceeds allowable buy threshold ($${effectiveCeiling.toFixed(2)}).`,
                rule
            };
        }
        if (landedPrice > effectiveCeiling) {
            const qtyForFreeShip = Math.ceil(150 / dropPrice);
            const hasEnoughStock = item.stock === undefined || item.stock >= qtyForFreeShip;
            if (qtyForFreeShip <= 4 && hasEnoughStock) {
                freeShipNote = `Buy ${qtyForFreeShip}x to hit $150 Free Shipping -> $${dropPrice.toFixed(2)}/ea landed`;
            }
            else {
                return {
                    action: 'IGNORE',
                    reason: `Landed price ($${landedPrice.toFixed(2)} w/ $${estimatedShipping.toFixed(2)} ship) exceeds buy threshold ($${effectiveCeiling.toFixed(2)}) and qtyForFreeShip (${qtyForFreeShip}x) > 4.`,
                    rule
                };
            }
        }
        const now = Date.now();
        const currentPrice = dropPrice;
        const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        // Valid drop (<= maxBuy): sync immediately to liveStock.json so "In Stock Now" dashboard view stays accurate even if deduplicated for Discord!
        upsertLiveStock({
            ruleId: rule.id,
            ruleName: rule.name,
            formFactor: rule.formFactor || 'Sealed',
            title: cleanTitle,
            retailer: item.retailer,
            price: currentPrice,
            landedPrice,
            freeShipNote,
            isPreOrder,
            url: item.url,
            productUrl: item.productUrl,
            cart1xUrl: item.cart1xUrl,
            cart2xUrl: item.cart2xUrl,
            stock: item.stock,
            itemId: item.itemId,
            inStock: true,
            updatedAt: now,
            timeStr: nowTimeStr
        });
        // Reload alertState from disk if reset via dashboard
        try {
            if (fs_1.default.existsSync(ALERT_STATE_PATH)) {
                alertMemory = JSON.parse(fs_1.default.readFileSync(ALERT_STATE_PATH, 'utf-8'));
            }
            else {
                alertMemory = {};
            }
        }
        catch (e) { }
        // Persistent Deduplication per (Rule + Retailer)
        const stateKey = `${rule.id}__${item.retailer}`;
        const prev = alertMemory[stateKey];
        let alertType = 'NEW_DROP';
        let previousPrice = undefined;
        let previousTimeStr = undefined;
        if (prev) {
            const elapsedHours = (now - prev.timestamp) / (1000 * 60 * 60);
            const isSignificantPriceDrop = currentPrice <= prev.lowestAlertedPrice - 3.00;
            // Block same-price repeats for 4 hours! Only allow through immediately if the price dropped by $3+
            if (!isSignificantPriceDrop && elapsedHours < 4) {
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
            timeStr: nowTimeStr,
            alertCount: (prev?.alertCount || 0) + 1
        };
        saveAlertMemory();
        const liveTel = (0, marketTelemetry_1.getTelemetry)()[rule.id];
        const marketVal = (liveTel && liveTel.rollingAverage > 0) ? liveTel.rollingAverage : (rule.estimatedMarketValue || effectiveCeiling);
        const effectiveComparePrice = freeShipNote ? currentPrice : landedPrice;
        const savingsDollars = Math.max(0, marketVal - effectiveComparePrice);
        const discountPct = marketVal > 0 ? Math.round(((marketVal - effectiveComparePrice) / marketVal) * 100) : 0;
        return {
            action: 'BUY',
            reason: `[${alertType}]${isPreOrder ? ' [⏳ PRE-ORDER]' : ''} Matched "${rule.name}" at $${currentPrice.toFixed(2)} (Landed: $${landedPrice.toFixed(2)} • ${discountPct}% under market)`,
            rule,
            discountPct,
            savingsDollars,
            alertType,
            previousPrice,
            previousTimeStr,
            landedPrice,
            estimatedShipping,
            freeShipNote,
            isPreOrder
        };
    }
    return { action: 'IGNORE', reason: 'No matching policy rule found.' };
}
