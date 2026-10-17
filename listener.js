"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processIncomingDrop = processIncomingDrop;
const marketTelemetry_1 = require("./marketTelemetry");
const evaluator_1 = require("./evaluator");
const notifier_1 = require("./notifier");
async function processIncomingDrop(item) {
    const result = (0, evaluator_1.evaluateItem)(item);
    if (result.action === 'BUY' && result.rule) {
        const r = result.rule;
        console.log(`🎯 [BUY ALERT] "${item.title}" ($${item.price?.toFixed(2)}) at ${item.retailer} -> [${result.alertType}] ${result.reason}`);
        await (0, notifier_1.sendAlert)({
            title: item.title,
            retailer: item.retailer,
            url: item.url,
            productUrl: item.productUrl,
            cart1xUrl: item.cart1xUrl,
            cart2xUrl: item.cart2xUrl,
            price: item.price !== undefined ? item.price.toFixed(2) : undefined,
            priceNum: item.price,
            landedPrice: result.landedPrice,
            estimatedShipping: result.estimatedShipping,
            freeShipNote: result.freeShipNote,
            isPreOrder: result.isPreOrder,
            stock: item.stock,
            itemId: item.itemId,
            ruleId: r.id,
            ruleName: r.name,
            formFactor: r.formFactor,
            msrp: r.msrpCeiling,
            marketValue: ((0, marketTelemetry_1.getTelemetry)()[r.id]?.rollingAverage > 0 ? (0, marketTelemetry_1.getTelemetry)()[r.id].rollingAverage : r.estimatedMarketValue),
            maxBuyTarget: r.maxMarketBuyPrice,
            discountPct: result.discountPct,
            savingsDollars: result.savingsDollars,
            ownedInVault: Boolean(r.owned),
            alertType: result.alertType,
            previousPrice: result.previousPrice,
            previousTimeStr: result.previousTimeStr
        });
    }
    else if (result.rule && !result.reason.includes('Deduplicated')) {
        // Only log tracked Pokemon SKUs so you can see live store prices vs. your slider targets without non-Pokemon clutter!
        console.log(`   [SEEN] ${item.retailer.padEnd(16)} | $${(item.price || 0).toFixed(2).padStart(7)} | ${result.rule.name} -> ${result.reason}`);
    }
}
