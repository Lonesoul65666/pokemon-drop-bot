"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFastCheckoutLink = buildFastCheckoutLink;
exports.processIncomingDrop = processIncomingDrop;
const evaluator_1 = require("./evaluator");
const notifier_1 = require("./notifier");
function buildFastCheckoutLink(retailer, rawUrl, itemId) {
    const cleanRetailer = retailer.toLowerCase();
    if (cleanRetailer.includes('target') && itemId) {
        return `https://www.target.com/co-cart?tcin=${itemId}`;
    }
    if (rawUrl.includes('/products/') && itemId) {
        const origin = new URL(rawUrl).origin;
        return `${origin}/cart/${itemId}:1`;
    }
    return rawUrl;
}
async function processIncomingDrop(rawEvent) {
    const fastUrl = buildFastCheckoutLink(rawEvent.retailer, rawEvent.url, rawEvent.itemId);
    const item = {
        title: rawEvent.title,
        retailer: rawEvent.retailer,
        url: fastUrl,
        price: rawEvent.price,
        stock: rawEvent.stock,
    };
    const evalResult = (0, evaluator_1.evaluateItem)(item);
    // Diagnostic log: displays title, price, verdict, and the rejection reason
    console.log(`[INGEST] "${item.title}" ($${item.price.toFixed(2)}) from ${item.retailer} -> ${evalResult.action} [${evalResult.verdict}] | ${evalResult.reason}`);
    if (evalResult.action === 'ALERT' && evalResult.matchedPolicy) {
        await (0, notifier_1.sendEnhancedAlert)(item, evalResult.matchedPolicy, evalResult);
    }
}
