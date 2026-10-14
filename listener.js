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
        console.log(`[INGEST] "${item.title}" ($${item.price?.toFixed(2)}) from ${item.retailer} -> 🎯 BUY [ALERTING DISCORD] | ${result.reason}`);
        await (0, notifier_1.sendAlert)({
            title: item.title,
            retailer: item.retailer,
            url: item.url,
            price: item.price !== undefined ? item.price.toFixed(2) : undefined,
            priceNum: item.price,
            stock: item.stock,
            ruleId: r.id,
            ruleName: r.name,
            formFactor: r.formFactor,
            msrp: r.msrpCeiling,
            marketValue: ((0, marketTelemetry_1.getTelemetry)()[r.id]?.rollingAverage > 0 ? (0, marketTelemetry_1.getTelemetry)()[r.id].rollingAverage : r.estimatedMarketValue),
            maxBuyTarget: r.maxMarketBuyPrice,
            discountPct: result.discountPct,
            savingsDollars: result.savingsDollars,
            ownedInVault: Boolean(r.owned),
            isPriceDropOverride: result.isPriceDropOverride
        });
    }
    else {
        console.log(`[INGEST] "${item.title}" ($${item.price?.toFixed(2)}) from ${item.retailer} -> IGNORE [RUN AWAY] | ${result.reason}`);
    }
}
