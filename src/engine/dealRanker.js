"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankAndEnrichDealOffer = rankAndEnrichDealOffer;
exports.sortDealsByTierAndPriority = sortDealsByTierAndPriority;
exports.summarizeDealBuckets = summarizeDealBuckets;
exports.buildBestLiveOfferAndBuyAction = buildBestLiveOfferAndBuyAction;
const watermarkHistory_1 = require("./watermarkHistory");
const purchaseMemory_1 = require("./purchaseMemory");
const evaluator_1 = require("../../evaluator");
const policies_1 = require("../../policies");
const TIER_ORDER = {
    BUY_NOW_PINNED: 0,
    CAUTIOUS_WATCH: 1,
    MUTED_DRAWER: 2
};
const watermarkMemo = new Map();
function getMemoizedWatermarks(skuId, landedPrice, nowTs = Date.now()) {
    const hit = watermarkMemo.get(skuId);
    if (hit && hit.expiresAt > nowTs)
        return hit.summary;
    const summary = (0, watermarkHistory_1.buildEarnedWatermarkSummary)(skuId, landedPrice, nowTs);
    watermarkMemo.set(skuId, { expiresAt: nowTs + 30000, summary });
    return summary;
}
function buildTcgSearchFallbackUrl(name) {
    const q = encodeURIComponent(String(name || 'Pokemon Sealed').replace(/\(.*?\)/g, '').trim());
    return `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${q}&view=grid&ProductTypeName=Sealed+Products`;
}
function rankAndEnrichDealOffer(offer, policy, context) {
    const skuId = String(offer.skuId || offer.ruleId || policy?.id || '');
    const formFactor = String(policy?.formFactor || offer.formFactor || 'ETB');
    const title = String(offer.ruleName || offer.productName || policy?.name || offer.title || skuId);
    const storeName = String(offer.storeName || offer.retailer || offer.store || 'Store');
    const rawUrl = String(offer.productUrl || offer.url || '');
    const landedPrice = Math.round(Number(offer.landedPrice ?? offer.price ?? 0) * 100) / 100;
    const packCount = Number(offer.packCount || policy?.packCount || (0, policies_1.getPackCountForSku)(skuId, formFactor, title) || 0);
    const pricePerPack = packCount > 0 && landedPrice > 0
        ? Math.round((landedPrice / packCount) * 100) / 100
        : Number(offer.pricePerPack || 0);
    const isWallFormat = (0, purchaseMemory_1.isSingleEtbFormat)(formFactor, skuId, title);
    const isCaseSku = (0, evaluator_1.isCaseSkuFormat)(formFactor, skuId, title, rawUrl);
    const isBundleFormat = !isCaseSku && (formFactor === 'Booster Bundle' || /\bbundle\b|\b6[- ]?pack\b/i.test(`${formFactor} ${skuId} ${title}`));
    const isBoosterBox36 = !isCaseSku && (formFactor === 'Booster Box' || /\bbooster[-_\s]*(box|display)\b/i.test(`${formFactor} ${skuId} ${title}`));
    const isOverpricedBundle = isBundleFormat && pricePerPack > 7.50;
    const effectivePriceForMem = landedPrice > 0 ? landedPrice : Number(policy?.msrpCeiling || 54.99);
    const mem = (0, purchaseMemory_1.lookupPurchaseMemory)({ skuId, landedPrice: effectivePriceForMem, formFactor, productName: title });
    const effectiveWallQty = isWallFormat
        ? Math.min(3, Math.max(Number(context?.wallQty ?? policy?.completionCount ?? (policy?.owned ? 1 : 0)), mem ? 1 : 0))
        : 0;
    const wallStatusLabel = isWallFormat
        ? effectiveWallQty <= 0
            ? "0/3 Needed: Logan's Rip + Office Sealed"
            : effectiveWallQty === 1
                ? "1/3 Logan's Wall Done — Need Office Sealed"
                : effectiveWallQty === 2
                    ? '2/3 Walls Done — Bonus Dad Rip'
                    : '3/3 Stacked'
        : null;
    const ruleWithCount = policy ? { ...policy, completionCount: effectiveWallQty, fullyConquered: effectiveWallQty >= 3 } : null;
    const ledgerLine = (0, purchaseMemory_1.formatCollectionAndCostLine)({
        skuId,
        formFactor,
        productName: title,
        landedPrice: effectivePriceForMem,
        packCount,
        pricePerPack,
        rule: ruleWithCount,
        ownedFallback: effectiveWallQty >= 1
    });
    const earnedWatermarks = getMemoizedWatermarks(skuId, landedPrice > 0 ? landedPrice : undefined, context?.nowTs ?? Date.now());
    const msrp = Number(policy?.msrpCeiling || offer.msrp || 0);
    const policyMaxBuy = Number(policy?.maxMarketBuyPrice || offer.triggerPrice || msrp || 0);
    const tcgComp = Number(offer.tcgplayerLowestShipped || context?.tcgComp || 0);
    const marketRef = tcgComp > 0 ? tcgComp : Number(offer.marketValue || offer.marketPrice || policy?.estimatedMarketValue || 0);
    const inStock = offer.inStock !== false && !offer.soldOut && !offer.isPreDropStaging && landedPrice > 0;
    const is1PBigBox = (0, evaluator_1.isVerified1PBigBoxOrPc)(storeName, rawUrl, Boolean(offer.marketplaceWarning));
    const is1PMsrpHit = inStock && is1PBigBox && msrp > 0 && landedPrice <= Math.round(msrp * 1.08 * 100) / 100;
    const undercutVsCompPct = marketRef > 0 && landedPrice > 0 ? Math.round(((marketRef - landedPrice) / marketRef) * 1000) / 10 : 0;
    const undercutVsTcgPct = tcgComp > 0 && landedPrice > 0 ? ((tcgComp - landedPrice) / tcgComp) * 100 : undercutVsCompPct;
    const statusText = `${offer.preReleaseStatusTag || ''} ${offer.trendVerdictLabel || ''} ${offer.statusTag || ''}`;
    const isSliding = Boolean(offer.trendSignal === 'BLEEDING_DOWN' || /HOLD\s*OFF|BLEED/i.test(statusText) || earnedWatermarks.isSlidingDown);
    const isStacked3of3 = isWallFormat && effectiveWallQty >= 3;
    const beatsComp = tcgComp > 0 ? landedPrice < tcgComp : (marketRef > 0 ? landedPrice < marketRef : true);
    const withinMaxBuy = policyMaxBuy <= 0 || landedPrice <= policyMaxBuy;
    let actionTier = 'MUTED_DRAWER';
    if (inStock && !isOverpricedBundle) {
        if (is1PMsrpHit) {
            actionTier = 'BUY_NOW_PINNED';
        }
        else if (!isStacked3of3 && !(isWallFormat && effectiveWallQty === 2) && beatsComp && withinMaxBuy && (!isSliding || undercutVsTcgPct >= 12)) {
            actionTier = 'BUY_NOW_PINNED';
        }
        else if (!isStacked3of3 &&
            beatsComp &&
            ((isSliding && undercutVsTcgPct >= 8 && (policyMaxBuy <= 0 || landedPrice <= policyMaxBuy * 1.05)) ||
                (isWallFormat && effectiveWallQty === 2 && withinMaxBuy) ||
                (!isSliding && withinMaxBuy && undercutVsTcgPct >= 5))) {
            actionTier = 'CAUTIOUS_WATCH';
        }
    }
    let priorityScore = is1PMsrpHit ? 400 : 0;
    if (isWallFormat && effectiveWallQty === 0)
        priorityScore += 250;
    else if (isWallFormat && effectiveWallQty === 1)
        priorityScore += 175;
    else if (isWallFormat && effectiveWallQty === 2)
        priorityScore += 60;
    else if (isStacked3of3 && !is1PMsrpHit)
        priorityScore -= 150;
    if (isBoosterBox36 && pricePerPack > 0 && pricePerPack <= 5.0)
        priorityScore += 120;
    else if (isBoosterBox36 && pricePerPack > 0 && pricePerPack <= 5.75)
        priorityScore += 75;
    priorityScore += Math.round(Math.max(-60, Math.min(150, undercutVsTcgPct * 3)));
    if (isOverpricedBundle)
        priorityScore -= 250;
    if (!withinMaxBuy && !is1PMsrpHit)
        priorityScore -= 120;
    if (!inStock)
        priorityScore -= 500;
    let verdictLabel = 'HOLD OFF — MUTED';
    if (!inStock)
        verdictLabel = 'OUT OF STOCK';
    else if (is1PMsrpHit)
        verdictLabel = '1P RETAIL MSRP HIT — BUY NOW';
    else if (actionTier === 'BUY_NOW_PINNED') {
        if (isSliding && undercutVsTcgPct >= 12)
            verdictLabel = `DEEP DIP BUY (-${Math.round(undercutVsTcgPct)}% vs. TCGPlayer)`;
        else if (isWallFormat && effectiveWallQty === 0)
            verdictLabel = 'PRIORITY WALL BUY (0/3 — Need Logan + Office)';
        else if (isWallFormat && effectiveWallQty === 1)
            verdictLabel = 'WALL COMPLETER BUY (1/3 — Need Office Sealed)';
        else if (isBoosterBox36 && pricePerPack > 0)
            verdictLabel = `STRONG RIP VALUE ($${pricePerPack.toFixed(2)}/pk • -${Math.max(1, Math.round(undercutVsTcgPct))}% vs. Comp)`;
        else
            verdictLabel = `SUGGESTED BUY (-${Math.max(1, Math.round(undercutVsTcgPct))}% vs. Comp)`;
    }
    else if (actionTier === 'CAUTIOUS_WATCH') {
        if (isSliding)
            verdictLabel = `CAUTIOUS DIP — STILL SLIDING (-${Math.round(undercutVsTcgPct)}% vs. TCGPlayer)`;
        else if (isWallFormat && effectiveWallQty === 2)
            verdictLabel = 'BONUS RIP WATCH (2/3 Walls Done)';
        else
            verdictLabel = `WATCHLIST DIP (-${Math.max(1, Math.round(undercutVsTcgPct))}% vs. Comp)`;
    }
    else if (isOverpricedBundle)
        verdictLabel = `OVERPRICED BUNDLE ($${pricePerPack.toFixed(2)}/pk > $7.50 cap)`;
    else if (isStacked3of3)
        verdictLabel = 'MUTED — 3/3 WALL STACKED';
    else if (tcgComp > 0 && landedPrice >= tcgComp)
        verdictLabel = `ABOVE TCGPLAYER (+$${(landedPrice - tcgComp).toFixed(2)} vs. Comp)`;
    else if (isSliding)
        verdictLabel = 'HOLD OFF — BLEEDING DOWN (<8% spread)';
    else if (!withinMaxBuy && policyMaxBuy > 0)
        verdictLabel = `ABOVE MAX BUY ($${landedPrice.toFixed(2)} vs. $${policyMaxBuy.toFixed(2)} target)`;
    return {
        ...offer,
        actionTier,
        priorityScore,
        verdictLabel,
        isWallFormat,
        pricePerPack,
        earnedWatermarks,
        purchaseMemory: {
            completionCount: effectiveWallQty,
            lastPaidLanded: mem?.lastPaid,
            deltaDollars: mem?.deltaDollars,
            beatsPriorBuy: mem?.beatsPriorBuy,
            formattedComparison: mem?.formattedComparison,
            ledgerLine,
            wallStatusLabel
        },
        isCaseSku,
        disqualifiesSmartBuy: isOverpricedBundle || actionTier === 'MUTED_DRAWER',
        is1PMsrpHit,
        undercutVsCompPct
    };
}
function sortDealsByTierAndPriority(items) {
    return [...items].sort((a, b) => {
        const tierDiff = (TIER_ORDER[a.actionTier || 'MUTED_DRAWER'] ?? 2) - (TIER_ORDER[b.actionTier || 'MUTED_DRAWER'] ?? 2);
        if (tierDiff !== 0)
            return tierDiff;
        const scoreDiff = Number(b.priorityScore ?? 0) - Number(a.priorityScore ?? 0);
        if (scoreDiff !== 0)
            return scoreDiff;
        return Number(a.landedPrice ?? a.price ?? 999999) - Number(b.landedPrice ?? b.price ?? 999999);
    });
}
function summarizeDealBuckets(items) {
    let buyNowPinned = 0, cautiousWatch = 0, mutedDrawer = 0;
    for (const item of items) {
        if (item.actionTier === 'BUY_NOW_PINNED')
            buyNowPinned += 1;
        else if (item.actionTier === 'CAUTIOUS_WATCH')
            cautiousWatch += 1;
        else
            mutedDrawer += 1;
    }
    return { buyNowPinned, cautiousWatch, mutedDrawer, total: items.length };
}
function buildBestLiveOfferAndBuyAction(params) {
    const tcgUrl = params.tcgplayerUrl || buildTcgSearchFallbackUrl(params.policy?.name || params.skuId);
    const comp = Number(params.tcgComp || params.marketPrice || params.policy?.estimatedMarketValue || 0);
    const validInStock = (params.offers || [])
        .filter((o) => o && o.inStock !== false && !o.soldOut && !o.isPreDropStaging && !/tcgplayer/i.test(String(o.storeName || o.retailer || o.store || '')) && Number(o.landedPrice || o.price || 0) > 0)
        .sort((a, b) => Number(a.landedPrice || a.price) - Number(b.landedPrice || b.price));
    const actionable = comp > 0 ? validInStock.filter((o) => Number(o.landedPrice || o.price) <= Math.round(comp * 1.03 * 100) / 100) : validInStock;
    const best = actionable[0] || null;
    const lowestAny = validInStock[0] || null;
    const shopLinks = best ? (0, evaluator_1.buildShopifyDirectCartLinks)({
        url: best.url, productUrl: best.productUrl || best.url, cart1xUrl: best.cart1xUrl, itemId: best.itemId, stock: best.stock, retailer: best.storeName || best.retailer || best.store
    }) : {};
    const bestBuyUrl = best ? (shopLinks.cart1xUrl || best.cart1xUrl || best.productUrl || best.url) : tcgUrl;
    return {
        bestLiveOffer: best
            ? {
                inStock: true, storeName: best.storeName || best.retailer || best.store, price: Number(best.price || best.landedPrice),
                shipping: Number(best.shipping || 0), landedPrice: Number(best.landedPrice || best.price),
                buyUrl: bestBuyUrl, productUrl: shopLinks.productUrl || best.productUrl || best.url, tcgplayerUrl: tcgUrl, statusLabel: 'Verified In-Stock <= Comp'
            }
            : {
                inStock: false, storeName: null, landedPrice: null,
                uncompetitiveLowestLanded: lowestAny ? Number(lowestAny.landedPrice || lowestAny.price) : null,
                uncompetitiveStoreName: lowestAny ? (lowestAny.storeName || lowestAny.retailer || lowestAny.store) : null,
                tcgplayerUrl: tcgUrl, statusLabel: 'No LGS Stock <= Comp'
            },
        bestBuyAction: {
            lowestLanded: best ? Number(best.landedPrice || best.price) : null,
            storeName: best ? (best.storeName || best.retailer || best.store) : null,
            buyUrl: bestBuyUrl, isDirectLgsBuy: Boolean(best), tcgplayerUrl: tcgUrl, marketPrice: comp > 0 ? Math.round(comp * 100) / 100 : null
        }
    };
}
