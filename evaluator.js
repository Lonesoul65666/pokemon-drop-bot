"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORE_SHIPPING_RULES = exports.MSRP_TROPHIES_PATH = exports.isPreReleaseDate = void 0;
exports.getCloseCallGraceBuffer = getCloseCallGraceBuffer;
exports.computeOfferShelfStatus = computeOfferShelfStatus;
exports.isMarketplaceScamOrShippingTrap = isMarketplaceScamOrShippingTrap;
exports.upsertStoreOfferCache = upsertStoreOfferCache;
exports.pruneStoreMissingOffers = pruneStoreMissingOffers;
exports.normalizeAlertRetailerKey = normalizeAlertRetailerKey;
exports.markAlertKeyOutOfStock = markAlertKeyOutOfStock;
exports.refreshCachedStoreOffersStatus = refreshCachedStoreOffersStatus;
exports.getMsrpTrophies = getMsrpTrophies;
exports.recordMsrpTrophyCatch = recordMsrpTrophyCatch;
exports.getStoreShippingProfile = getStoreShippingProfile;
exports.upsertBestCurrentOffer = upsertBestCurrentOffer;
exports.matchTargetRuleForStaging = matchTargetRuleForStaging;
exports.upsertLiveStock = upsertLiveStock;
exports.clearTcgOosStrikes = clearTcgOosStrikes;
exports.markLiveStockOut = markLiveStockOut;
exports.evaluateItem = evaluateItem;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const policies_1 = require("./policies");
const marketTelemetry_1 = require("./marketTelemetry");
const marketTape_1 = require("./marketTape");
const configManager_1 = require("./src/config/configManager");
const trendAdvisor_1 = require("./src/engine/trendAdvisor");
Object.defineProperty(exports, "isPreReleaseDate", { enumerable: true, get: function () { return trendAdvisor_1.isPreReleaseDate; } });
function getCloseCallGraceBuffer(formFactor) {
    const ff = String(formFactor || '').toLowerCase();
    if (ff === 'booster box' || ff === 'etb case' || ff === 'master case' || ff.includes('box') || ff.includes('case')) {
        return 10.00;
    }
    return 5.00;
}
function computeOfferShelfStatus(params) {
    const { dropPrice, landedPrice, estimatedShipping, triggerPrice, msrpCeiling, marketValue, formFactor, owned = false, muteVaulted = false, isMsrpUnicorn = false, isMarketplace3P = false } = params;
    const graceBuffer = getCloseCallGraceBuffer(formFactor);
    // Standard LGS flat shipping (<= $10) does not penalize shelf comparison when evaluating target / close-call
    const canUseShelfPrice = !isMarketplace3P && estimatedShipping <= 10.00;
    const comparePrice = (canUseShelfPrice && dropPrice <= triggerPrice + graceBuffer) ? dropPrice : landedPrice;
    const isUnderOrAtTarget = comparePrice <= triggerPrice || landedPrice <= triggerPrice || isMsrpUnicorn;
    const rawOver = Math.round((comparePrice - triggerPrice) * 100) / 100;
    const withinGraceBuffer = rawOver > 0 && rawOver <= graceBuffer;
    const withinMarketOrMsrpGuard = (marketValue > 0 && comparePrice <= marketValue * 0.93) ||
        (msrpCeiling > 0 && comparePrice <= msrpCeiling * 1.10);
    const isCloseCall = !isUnderOrAtTarget && withinGraceBuffer && withinMarketOrMsrpGuard;
    const closeCallDelta = isCloseCall ? rawOver : 0;
    if (owned && muteVaulted && !isMsrpUnicorn) {
        return {
            statusTier: 'MUTED_OWNED',
            statusTag: '⟦ MUTED: OWNED ON WALL ⟧',
            isCloseCall,
            closeCallDelta,
            comparePrice
        };
    }
    if (isUnderOrAtTarget) {
        const refPrice = landedPrice <= triggerPrice ? landedPrice : dropPrice;
        const underDollars = Math.max(0, Math.round((triggerPrice - refPrice) * 100) / 100);
        return {
            statusTier: 'UNDER_TARGET',
            statusTag: `⟦ UNDER TARGET (-$${underDollars.toFixed(2)}) ⟧`,
            isCloseCall: false,
            closeCallDelta: 0,
            comparePrice: refPrice
        };
    }
    if (isCloseCall) {
        return {
            statusTier: 'CLOSE_CALL',
            statusTag: `⟦ CLOSE CALL (+$${closeCallDelta.toFixed(2)} OVER TARGET — IN CUSHION) ⟧`,
            isCloseCall: true,
            closeCallDelta,
            comparePrice
        };
    }
    const overDollars = Math.max(0.01, Math.round((landedPrice - triggerPrice) * 100) / 100);
    return {
        statusTier: 'NEAR_MISS',
        statusTag: `⟦ NEAR MISS (+$${overDollars.toFixed(2)} OVER TARGET) ⟧`,
        isCloseCall: false,
        closeCallDelta: 0,
        comparePrice: landedPrice
    };
}
function isMarketplaceScamOrShippingTrap(item, dropPrice, shippingPrice, marketValue) {
    const combinedSource = `${item.retailer || ''} ${item.url || ''} ${item.productUrl || ''}`;
    const isMarketplace3P = Boolean(item.isMarketplace3P ||
        /tcgplayer|ebay|target\s*plus|walmart.*3p|3rd[-\s]*party|marketplace/i.test(combinedSource));
    if (shippingPrice > 35.00) {
        return {
            blocked: true,
            reason: `Blocked by Shipping Trap Shield: shipping ($${shippingPrice.toFixed(2)}) exceeds $35.00 max cap.`
        };
    }
    if (isMarketplace3P && dropPrice > 0 && shippingPrice > dropPrice * 0.20) {
        return {
            blocked: true,
            reason: `Blocked by Marketplace Shipping Inflation Shield: shipping ($${shippingPrice.toFixed(2)}) exceeds 20% of item price ($${dropPrice.toFixed(2)}).`
        };
    }
    const landed = dropPrice + shippingPrice;
    const isUnverifiedOr1Qty = item.sellerVerified === false || (item.stock !== undefined && item.stock <= 1) || /crawford/i.test(combinedSource);
    if (isMarketplace3P && isUnverifiedOr1Qty && marketValue > 200 && landed < marketValue * 0.65) {
        return {
            blocked: true,
            reason: `Blocked by Marketplace Bait-and-Switch Shield: unverified/1-qty listing ($${landed.toFixed(2)}) is >35% below $${marketValue.toFixed(2)} market value.`
        };
    }
    return { blocked: false };
}
const ALERT_STATE_PATH = path_1.default.resolve(process.cwd(), 'alertState.json');
const LIVE_STOCK_PATH = path_1.default.resolve(process.cwd(), 'liveStock.json');
const STORE_OFFERS_CACHE_PATH = path_1.default.resolve(process.cwd(), 'storeOffersCache.json');
const SETTINGS_PATH = path_1.default.resolve(process.cwd(), 'botSettings.json');
exports.MSRP_TROPHIES_PATH = path_1.default.resolve(process.cwd(), 'data', 'msrpTrophies.json');
let alertMemory = {};
let storeOffersCacheMem = {};
let storeOffersFlushTimer = null;
try {
    if (fs_1.default.existsSync(STORE_OFFERS_CACHE_PATH)) {
        const parsed = JSON.parse(fs_1.default.readFileSync(STORE_OFFERS_CACHE_PATH, 'utf-8'));
        if (parsed && typeof parsed === 'object') {
            storeOffersCacheMem = parsed;
        }
    }
}
catch (e) { }
function scheduleStoreOffersFlush() {
    if (storeOffersFlushTimer)
        return;
    storeOffersFlushTimer = setTimeout(() => {
        storeOffersFlushTimer = null;
        try {
            (0, policies_1.atomicWriteJson)(STORE_OFFERS_CACHE_PATH, storeOffersCacheMem);
        }
        catch (e) { }
    }, 2000);
}
function upsertStoreOfferCache(entry) {
    if (!entry.skuId || !entry.storeName)
        return;
    const skuMap = storeOffersCacheMem[entry.skuId] || {};
    const cleanStoreKey = entry.storeName.replace(/\s*\(TCGPlayer.*?\)$/i, ' (TCGPlayer)').trim();
    const existing = skuMap[cleanStoreKey];
    const now = entry.updatedAt || Date.now();
    const isStalePrior = existing ? (now - (existing.updatedAt || 0) > 12 * 60 * 60 * 1000) : true;
    const firstSeenAt = (!isStalePrior && existing?.firstSeenAt) ? existing.firstSeenAt : now;
    const previousPrice = (!isStalePrior && existing?.landedPrice) ? existing.landedPrice : entry.landedPrice;
    const priceDelta = Math.round((entry.landedPrice - previousPrice) * 100) / 100;
    const isFreshRestock = Boolean((now - firstSeenAt) <= 6 * 60 * 60 * 1000 || priceDelta <= -0.50);
    skuMap[cleanStoreKey] = {
        ...entry,
        storeName: entry.storeName,
        firstSeenAt,
        updatedAt: now,
        previousPrice,
        priceDelta,
        isFreshRestock
    };
    storeOffersCacheMem[entry.skuId] = skuMap;
    scheduleStoreOffersFlush();
}
function pruneStoreMissingOffers(storeName, activeItemIds) {
    if (!storeName)
        return;
    let mutated = false;
    for (const [skuId, skuOffers] of Object.entries(storeOffersCacheMem)) {
        if (!skuOffers || typeof skuOffers !== 'object')
            continue;
        const rec = skuOffers[storeName];
        if (rec && rec.itemId && !activeItemIds.has(String(rec.itemId))) {
            delete skuOffers[storeName];
            mutated = true;
        }
    }
    if (mutated) {
        scheduleStoreOffersFlush();
    }
}
try {
    if (fs_1.default.existsSync(ALERT_STATE_PATH)) {
        const rawMem = JSON.parse(fs_1.default.readFileSync(ALERT_STATE_PATH, 'utf-8'));
        if (rawMem && typeof rawMem === 'object') {
            let migrated = false;
            const nextMem = {};
            for (const [k, v] of Object.entries(rawMem)) {
                if (!v || typeof v !== 'object')
                    continue;
                if (k.includes('__')) {
                    const [skuId, storePart] = k.split('__');
                    if (/^TCGPlayer Verified Seller$/i.test(storePart || '')) {
                        migrated = true;
                        continue;
                    }
                    const normSt = normalizeAlertRetailerKey(storePart || '');
                    const newKey = `${normSt}::${skuId}`;
                    nextMem[newKey] = v;
                    migrated = true;
                }
                else {
                    nextMem[k] = v;
                }
            }
            alertMemory = nextMem;
            if (migrated) {
                (0, policies_1.atomicWriteJson)(ALERT_STATE_PATH, alertMemory);
            }
        }
    }
}
catch (e) { }
function saveAlertMemory() {
    (0, policies_1.atomicWriteJson)(ALERT_STATE_PATH, alertMemory);
}
function normalizeAlertRetailerKey(retailer) {
    const r = (retailer || '').trim();
    if (/tcgplayer/i.test(r)) {
        return r
            .replace(/\s*\(TCGPlayer.*?\)$/i, ' (TCGPlayer)')
            .replace(/\s*\(\$[\d.,]+\)$/i, '')
            .trim();
    }
    return r;
}
function markAlertKeyOutOfStock(ruleIdOrItemId, retailer) {
    try {
        if (fs_1.default.existsSync(ALERT_STATE_PATH)) {
            alertMemory = JSON.parse(fs_1.default.readFileSync(ALERT_STATE_PATH, 'utf-8'));
        }
    }
    catch (e) { }
    let changed = false;
    if (retailer) {
        const normRet = normalizeAlertRetailerKey(retailer);
        for (const candidateKey of [
            `${normRet}::${ruleIdOrItemId}`,
            `${retailer}::${ruleIdOrItemId}`,
            `${ruleIdOrItemId}__${normRet}`,
            `${ruleIdOrItemId}__${retailer}`
        ]) {
            const entry = alertMemory[candidateKey];
            if (entry && typeof entry === 'object' && !entry.wasOutOfStockSinceLastAlert) {
                entry.wasOutOfStockSinceLastAlert = true;
                changed = true;
            }
        }
    }
    else {
        for (const [key, entry] of Object.entries(alertMemory)) {
            if (key.startsWith('__') || !entry || typeof entry !== 'object')
                continue;
            if (entry.itemId && String(entry.itemId) === String(ruleIdOrItemId) && !entry.wasOutOfStockSinceLastAlert) {
                entry.wasOutOfStockSinceLastAlert = true;
                changed = true;
            }
        }
    }
    if (changed) {
        saveAlertMemory();
    }
}
function refreshCachedStoreOffersStatus() {
    try {
        let muteVaulted = false;
        try {
            const settings = (0, configManager_1.loadGlobalSettings)();
            muteVaulted = Boolean(settings?.muteVaulted);
        }
        catch (e) { }
        const now = Date.now();
        // Backfill recent ACTIVE salesHistory records (last 48h) into storeOffersCacheMem so lowest active comps (e.g. Game Grid Lehi $79.99) stay indexed
        try {
            if (fs_1.default.existsSync(marketTape_1.SALES_HISTORY_PATH)) {
                const salesArr = JSON.parse(fs_1.default.readFileSync(marketTape_1.SALES_HISTORY_PATH, 'utf-8'));
                if (Array.isArray(salesArr)) {
                    for (const ev of salesArr) {
                        if (!ev || !ev.targetId || ev.status !== 'ACTIVE' || !ev.store || !ev.price)
                            continue;
                        const seenTs = Number(ev.lastSeenAt || ev.restockedAt || 0);
                        if (now - seenTs > 48 * 3600 * 1000)
                            continue;
                        const rule = policies_1.WATCH_POLICIES.find(r => r.id === ev.targetId);
                        if (!rule)
                            continue;
                        const cleanStoreKey = String(ev.store).replace(/\s*\(TCGPlayer.*?\)$/i, ' (TCGPlayer)').trim();
                        const skuMap = storeOffersCacheMem[rule.id] || {};
                        if (!skuMap[cleanStoreKey]) {
                            const p = Number(ev.price);
                            const l = Number(ev.landedPrice || p);
                            const sh = Math.max(0, Math.round((l - p) * 100) / 100);
                            const rip = (0, policies_1.computeRipMetrics)(l, rule.id, rule.formFactor, rule.name, rule.packCount);
                            skuMap[cleanStoreKey] = {
                                skuId: rule.id,
                                productName: rule.name,
                                rawTitle: ev.targetName || rule.name,
                                formFactor: rule.formFactor || 'ETB',
                                era: rule.era,
                                owned: Boolean(rule.inVault ?? rule.owned),
                                msrp: rule.msrpCeiling,
                                triggerPrice: Math.max(rule.msrpCeiling, rule.maxMarketBuyPrice),
                                marketValue: Number(ev.marketPrice || rule.estimatedMarketValue || rule.msrpCeiling),
                                storeName: ev.store,
                                price: p,
                                shipping: sh,
                                landedPrice: l,
                                freeShipNote: sh > 0 ? `$${p.toFixed(2)} Shelf + $${sh.toFixed(2)} Est. Ship ($${l.toFixed(2)} Landed)` : '+FREE Shipping',
                                url: ev.url,
                                productUrl: ev.url,
                                itemId: ev.itemId,
                                packCount: rip.packCount,
                                pricePerPack: rip.pricePerPack,
                                isRipValueLeader: rip.isRipValueLeader,
                                firstSeenAt: Number(ev.restockedAt || seenTs),
                                updatedAt: seenTs,
                                previousPrice: l,
                                priceDelta: 0,
                                isFreshRestock: false
                            };
                            storeOffersCacheMem[rule.id] = skuMap;
                        }
                    }
                }
            }
        }
        catch (e) { }
        let mutated = false;
        for (const [skuId, skuOffers] of Object.entries(storeOffersCacheMem)) {
            if (!skuOffers || typeof skuOffers !== 'object')
                continue;
            const rule = policies_1.WATCH_POLICIES.find(r => r.id === skuId);
            for (const [storeKey, rec] of Object.entries(skuOffers)) {
                if (!rec || typeof rec !== 'object')
                    continue;
                const rawShip = Number(rec.shipping || 0);
                const rawItemPrice = (rawShip > 0 && Math.abs(rec.price - rec.landedPrice) < 0.01 && rec.price > rawShip)
                    ? Math.round((rec.landedPrice - rawShip) * 100) / 100
                    : Number(rec.price || 0);
                const marketVal = Number(rule?.estimatedMarketValue || rec.marketValue || 0);
                const scamCheck = isMarketplaceScamOrShippingTrap({ retailer: rec.storeName || storeKey, url: rec.url, stock: rec.stock }, rawItemPrice, rawShip, marketVal);
                if (scamCheck.blocked || (/^TCGPlayer Verified Seller/i.test(rec.storeName || storeKey) && rawShip > 0)) {
                    delete skuOffers[storeKey];
                    mutated = true;
                    continue;
                }
                const msrp = Number(rule?.msrpCeiling || rec.msrp || 0);
                const triggerPrice = rule
                    ? Math.max(rule.msrpCeiling, rule.maxMarketBuyPrice)
                    : Number(rec.triggerPrice || msrp);
                const owned = rule ? Boolean(rule.inVault ?? rule.owned) : Boolean(rec.owned);
                const isMsrpUnicorn = Boolean(msrp > 0 && rawItemPrice <= Math.round(msrp * 1.08 * 100) / 100 && rawShip <= 10.00);
                const is3P = /tcgplayer|ebay|3p/i.test(rec.storeName || storeKey);
                const landedVal = Number(rec.landedPrice || rawItemPrice + rawShip);
                const status = computeOfferShelfStatus({
                    dropPrice: rawItemPrice,
                    landedPrice: landedVal,
                    estimatedShipping: rawShip,
                    triggerPrice,
                    msrpCeiling: msrp,
                    marketValue: marketVal,
                    formFactor: rule?.formFactor || rec.formFactor,
                    owned,
                    muteVaulted,
                    isMsrpUnicorn,
                    isMarketplace3P: is3P
                });
                const trend = (0, trendAdvisor_1.evaluateSkuTrendAndTiming)({
                    skuId,
                    formFactor: rule?.formFactor || rec.formFactor,
                    dropPrice: rawItemPrice,
                    landedPrice: landedVal,
                    estimatedShipping: rawShip,
                    policyMaxBuy: triggerPrice,
                    msrpCeiling: msrp,
                    marketBaseline: marketVal,
                    releaseDate: rule?.releaseDate,
                    owned,
                    isCloseCall: status.isCloseCall,
                    isMarketplace3P: is3P,
                    nowTs: now
                });
                rec.price = rawItemPrice;
                rec.triggerPrice = triggerPrice;
                rec.msrp = msrp;
                rec.marketValue = marketVal || rec.marketValue;
                rec.owned = owned;
                rec.statusTier = status.statusTier;
                rec.statusTag = status.statusTag;
                rec.isCloseCall = status.isCloseCall;
                rec.closeCallDelta = status.closeCallDelta;
                rec.trendSignal = trend.trendSignal;
                rec.trendVerdictLabel = trend.trendVerdictLabel;
                rec.isElasticDip = trend.isElasticDip;
                mutated = true;
            }
        }
        if (mutated) {
            try {
                (0, policies_1.atomicWriteJson)(STORE_OFFERS_CACHE_PATH, storeOffersCacheMem);
            }
            catch (e) { }
        }
        // Sync liveStock.json & __bestOffers with lowest storeOffersCacheMem offers & data-driven trendVerdictLabel
        if (fs_1.default.existsSync(LIVE_STOCK_PATH)) {
            try {
                const liveMap = JSON.parse(fs_1.default.readFileSync(LIVE_STOCK_PATH, 'utf-8')) || {};
                const bestOffers = (liveMap.__bestOffers && typeof liveMap.__bestOffers === 'object') ? liveMap.__bestOffers : {};
                let liveMutated = false;
                for (const [skuId, skuOffers] of Object.entries(storeOffersCacheMem)) {
                    const offersList = Object.values(skuOffers || {}).filter(o => o && o.landedPrice > 0);
                    if (offersList.length === 0)
                        continue;
                    offersList.sort((a, b) => a.landedPrice - b.landedPrice);
                    const cheapest = offersList[0];
                    const rule = policies_1.WATCH_POLICIES.find(r => r.id === skuId);
                    if (!rule)
                        continue;
                    const trig = Math.max(rule.msrpCeiling, rule.maxMarketBuyPrice);
                    const trend = (0, trendAdvisor_1.evaluateSkuTrendAndTiming)({
                        skuId,
                        formFactor: rule.formFactor,
                        dropPrice: cheapest.price,
                        landedPrice: cheapest.landedPrice,
                        estimatedShipping: cheapest.shipping,
                        policyMaxBuy: trig,
                        msrpCeiling: rule.msrpCeiling,
                        marketBaseline: cheapest.marketValue || rule.estimatedMarketValue,
                        releaseDate: rule.releaseDate,
                        owned: cheapest.owned,
                        isCloseCall: cheapest.isCloseCall,
                        nowTs: now
                    });
                    const curBest = bestOffers[skuId];
                    if (!curBest || cheapest.landedPrice <= Number(curBest.landedPrice || 999999) || curBest.preReleaseStatusTag?.includes('BLEED')) {
                        bestOffers[skuId] = {
                            ...(curBest || {}),
                            ruleId: skuId,
                            ruleName: rule.name,
                            formFactor: rule.formFactor || 'ETB',
                            era: rule.era,
                            title: cheapest.rawTitle || rule.name,
                            retailer: cheapest.storeName,
                            price: cheapest.price,
                            shippingPrice: cheapest.shipping,
                            landedPrice: cheapest.landedPrice,
                            freeShipNote: cheapest.freeShipNote,
                            triggerPrice: trig,
                            msrp: rule.msrpCeiling,
                            marketValue: cheapest.marketValue,
                            gapDollars: Math.round((cheapest.landedPrice - trig) * 100) / 100,
                            gapPct: trig > 0 ? Math.round(((cheapest.landedPrice - trig) / trig) * 1000) / 10 : 0,
                            rawGapDollars: Math.round((cheapest.price - trig) * 100) / 100,
                            rawGapPct: trig > 0 ? Math.round(((cheapest.price - trig) / trig) * 1000) / 10 : 0,
                            packCount: cheapest.packCount,
                            pricePerPack: cheapest.pricePerPack,
                            isRipValueLeader: cheapest.isRipValueLeader,
                            owned: cheapest.owned,
                            isPreOrder: Boolean(curBest?.isPreOrder),
                            isPreRelease: trend.isPreRelease,
                            preReleaseStatusTag: trend.preReleaseStatusTag,
                            statusTier: cheapest.statusTier,
                            statusTag: cheapest.statusTag,
                            isCloseCall: cheapest.isCloseCall,
                            closeCallDelta: cheapest.closeCallDelta,
                            trendSignal: trend.trendSignal,
                            trendVerdictLabel: trend.trendVerdictLabel,
                            isElasticDip: trend.isElasticDip,
                            url: cheapest.url,
                            productUrl: cheapest.productUrl || cheapest.url,
                            cart1xUrl: cheapest.cart1xUrl,
                            cart2xUrl: cheapest.cart2xUrl,
                            cart3xUrl: cheapest.cart3xUrl,
                            itemId: cheapest.itemId,
                            updatedAt: cheapest.updatedAt || now,
                            timeStr: curBest?.timeStr || 'Live Radar'
                        };
                        liveMutated = true;
                    }
                    if (liveMap[skuId] && typeof liveMap[skuId] === 'object') {
                        const ls = liveMap[skuId];
                        const lsTrend = (0, trendAdvisor_1.evaluateSkuTrendAndTiming)({
                            skuId,
                            formFactor: rule.formFactor,
                            dropPrice: Number(ls.price || cheapest.price),
                            landedPrice: Number(ls.landedPrice || ls.price || cheapest.landedPrice),
                            estimatedShipping: Math.max(0, Number(ls.landedPrice || ls.price) - Number(ls.price)),
                            policyMaxBuy: trig,
                            msrpCeiling: rule.msrpCeiling,
                            marketBaseline: cheapest.marketValue || rule.estimatedMarketValue,
                            releaseDate: rule.releaseDate,
                            owned: cheapest.owned,
                            isCloseCall: ls.isCloseCall,
                            nowTs: now
                        });
                        ls.preReleaseStatusTag = lsTrend.preReleaseStatusTag;
                        ls.trendSignal = lsTrend.trendSignal;
                        ls.trendVerdictLabel = lsTrend.trendVerdictLabel;
                        ls.isElasticDip = lsTrend.isElasticDip;
                        if (ls.bigBoxBadge && ls.bigBoxBadge.includes('🎯')) {
                            ls.bigBoxBadge = ls.bigBoxBadge.replace('🎯 CLOSE CALL (', '◈ ⟦ CLOSE CALL: ').replace(/\)$/, ' ⟧');
                        }
                        liveMutated = true;
                    }
                }
                if (liveMutated) {
                    liveMap.__bestOffers = bestOffers;
                    (0, policies_1.atomicWriteJson)(LIVE_STOCK_PATH, liveMap);
                }
            }
            catch (e) { }
        }
    }
    catch (e) { }
}
refreshCachedStoreOffersStatus();
function getMsrpTrophies() {
    try {
        if (fs_1.default.existsSync(exports.MSRP_TROPHIES_PATH)) {
            const parsed = JSON.parse(fs_1.default.readFileSync(exports.MSRP_TROPHIES_PATH, 'utf-8'));
            if (parsed && typeof parsed.totalMsrpHits === 'number' && Array.isArray(parsed.catches)) {
                return parsed;
            }
        }
    }
    catch (e) { }
    return { totalMsrpHits: 0, catches: [] };
}
function recordMsrpTrophyCatch(entry) {
    try {
        const dir = path_1.default.dirname(exports.MSRP_TROPHIES_PATH);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        const state = getMsrpTrophies();
        state.totalMsrpHits = (state.totalMsrpHits || 0) + 1;
        state.catches.unshift(entry);
        if (state.catches.length > 20) {
            state.catches = state.catches.slice(0, 20);
        }
        (0, policies_1.atomicWriteJson)(exports.MSRP_TROPHIES_PATH, state);
        return state;
    }
    catch (e) {
        return getMsrpTrophies();
    }
}
exports.STORE_SHIPPING_RULES = (0, configManager_1.loadShippingRulesMap)();
function getStoreShippingProfile(retailer) {
    return (0, configManager_1.getStoreShippingProfileFromRegistry)(retailer);
}
let bestOffersFlushTimer = null;
const pendingBestOffers = new Map();
function flushBestOffersToLiveStock() {
    bestOffersFlushTimer = null;
    if (pendingBestOffers.size === 0)
        return;
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
        const bestOffers = (map.__bestOffers && typeof map.__bestOffers === 'object')
            ? map.__bestOffers
            : {};
        const now = Date.now();
        for (const [ruleId, entry] of pendingBestOffers.entries()) {
            const existing = bestOffers[ruleId];
            if (!existing ||
                existing.retailer === entry.retailer ||
                entry.landedPrice <= existing.landedPrice ||
                (now - (existing.updatedAt || 0) > 20 * 60 * 1000)) {
                bestOffers[ruleId] = entry;
            }
        }
        pendingBestOffers.clear();
        map.__bestOffers = bestOffers;
        (0, policies_1.atomicWriteJson)(LIVE_STOCK_PATH, map);
    }
    catch (e) { }
}
function upsertBestCurrentOffer(entry) {
    const existingPending = pendingBestOffers.get(entry.ruleId);
    if (!existingPending || existingPending.retailer === entry.retailer || entry.landedPrice <= existingPending.landedPrice) {
        pendingBestOffers.set(entry.ruleId, entry);
    }
    if (!bestOffersFlushTimer) {
        bestOffersFlushTimer = setTimeout(flushBestOffersToLiveStock, 2500);
    }
}
function matchTargetRuleForStaging(title, price, retailer, handleAndUrl) {
    const cleanTitle = (title || '').trim();
    for (const junkRegex of policies_1.GLOBAL_JUNK_EXCLUSIONS) {
        if (junkRegex.test(cleanTitle))
            return null;
    }
    for (const rule of policies_1.WATCH_POLICIES) {
        if (rule.active === false)
            continue;
        const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
        if (!isMatched)
            continue;
        if (!(0, policies_1.isValidSkuForFormFactor)(cleanTitle, rule.formFactor, price, {
            ruleId: rule.id,
            targetName: rule.name,
            handle: handleAndUrl,
            retailer,
            sourceUrl: handleAndUrl,
            allowPcRetailUnlock: false
        })) {
            continue;
        }
        const minFloor = (0, policies_1.getMinPlausiblePriceFloor)(rule.formFactor);
        const maxCeiling = (0, policies_1.getMaxPlausiblePriceCeiling)(rule.formFactor, rule.id, rule.name);
        if (price < minFloor || price > maxCeiling)
            continue;
        return rule;
    }
    return null;
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
const tcgOosStrikesByItem = new Map();
function clearTcgOosStrikes(itemId) {
    if (!itemId)
        return;
    tcgOosStrikesByItem.delete(String(itemId));
}
function markLiveStockOut(itemId, options) {
    const strId = String(itemId);
    const isTcgItem = strId.startsWith('tcg_');
    if (isTcgItem) {
        const strikes = (tcgOosStrikesByItem.get(strId) || 0) + 1;
        tcgOosStrikesByItem.set(strId, strikes);
        if (!options?.confirmedTcgThreeStrikes && strikes < 3) {
            return;
        }
        tcgOosStrikesByItem.delete(strId);
    }
    try {
        (0, marketTape_1.recordTapeSoldOut)(strId);
    }
    catch (e) { }
    try {
        markAlertKeyOutOfStock(strId);
    }
    catch (e) { }
    try {
        let offersMutated = false;
        for (const skuOffers of Object.values(storeOffersCacheMem)) {
            if (!skuOffers || typeof skuOffers !== 'object')
                continue;
            for (const [stKey, rec] of Object.entries(skuOffers)) {
                if (rec && String(rec.itemId) === strId) {
                    delete skuOffers[stKey];
                    offersMutated = true;
                }
            }
        }
        if (offersMutated) {
            scheduleStoreOffersFlush();
        }
    }
    catch (e) { }
    try {
        if (!fs_1.default.existsSync(LIVE_STOCK_PATH))
            return;
        const map = JSON.parse(fs_1.default.readFileSync(LIVE_STOCK_PATH, 'utf-8'));
        let changed = false;
        const recentOos = Array.isArray(map.__recentOos)
            ? map.__recentOos.filter((x) => Date.now() - (x.oosAt || 0) < 4 * 60 * 60 * 1000)
            : [];
        for (const key of Object.keys(map)) {
            if (key === '__recentOos' || key === '__bestOffers')
                continue;
            if (map[key]?.itemId === strId) {
                const matchedEntry = map[key];
                if (matchedEntry.retailer) {
                    markAlertKeyOutOfStock(key, matchedEntry.retailer);
                }
                recentOos.unshift({
                    ruleName: matchedEntry.ruleName || matchedEntry.title || key,
                    retailer: matchedEntry.retailer || 'Store',
                    price: matchedEntry.price || 0,
                    oosAt: Date.now()
                });
                delete map[key];
                changed = true;
            }
        }
        if (map.__bestOffers && typeof map.__bestOffers === 'object') {
            for (const [bKey, bVal] of Object.entries(map.__bestOffers)) {
                if (bVal?.itemId === String(itemId)) {
                    delete map.__bestOffers[bKey];
                    changed = true;
                }
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
    const handleAndUrl = `${item.url || ''} ${item.productUrl || ''}`;
    const bigBoxName = (0, policies_1.detectBigBoxRetailer)(item.retailer, handleAndUrl);
    const isPcSource = (0, policies_1.isPokemonCenterSource)(item.retailer, handleAndUrl);
    const hasPcTerm = (0, policies_1.hasPcExclusiveTerms)(cleanTitle, handleAndUrl);
    for (const junkRegex of policies_1.GLOBAL_JUNK_EXCLUSIONS) {
        if (junkRegex.test(cleanTitle)) {
            return { action: 'IGNORE', reason: `Filtered out by global exclusion (${junkRegex})` };
        }
    }
    for (const rule of policies_1.WATCH_POLICIES) {
        const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
        if (!isMatched)
            continue;
        if (!(0, policies_1.isValidSkuForFormFactor)(cleanTitle, rule.formFactor, item.price, {
            ruleId: rule.id,
            targetName: rule.name,
            handle: handleAndUrl,
            retailer: item.retailer,
            sourceUrl: item.url,
            allowPcRetailUnlock: true
        })) {
            continue;
        }
        const minFloor = Math.max((0, policies_1.getMinPlausiblePriceFloor)(rule.formFactor), Math.round((rule.msrpCeiling || 0) * 0.40 * 100) / 100);
        const maxCeiling = (0, policies_1.getMaxPlausiblePriceCeiling)(rule.formFactor, rule.id, rule.name, rule);
        if (item.price !== undefined && (item.price < minFloor || item.price > maxCeiling)) {
            continue;
        }
        // Identify Pokemon Center Exclusive Retail Unlock (pokemoncenter.com or <= $69.99 retail PC ETB)
        const isEtbRule = rule.formFactor === 'ETB' || rule.formFactor === 'ETB Case';
        const isPcExclusiveRetailDrop = isEtbRule && ((isPcSource && (item.price === undefined || item.price <= 75)) ||
            (hasPcTerm && item.price !== undefined && item.price <= 69.99));
        const liveTelPre = (0, marketTelemetry_1.getTelemetry)()[rule.id];
        const currentMarketRef = (liveTelPre && liveTelPre.rollingAverage > 0)
            ? Math.min(maxCeiling, liveTelPre.rollingAverage)
            : Math.min(maxCeiling, rule.estimatedMarketValue || rule.msrpCeiling);
        const policyMaxBuy = Math.max(rule.msrpCeiling, rule.maxMarketBuyPrice);
        // V5 Slice 3: Never lower Scott's explicit maxMarketBuyPrice slider down to msrpCeiling * 1.05 on pre-orders!
        let effectiveCeiling = policyMaxBuy;
        if (isPcExclusiveRetailDrop) {
            effectiveCeiling = Math.max(effectiveCeiling, 69.99);
        }
        const dropPrice = (item.itemPrice !== undefined && item.itemPrice > 0)
            ? item.itemPrice
            : (item.price ?? effectiveCeiling);
        const shipProfile = getStoreShippingProfile(item.retailer);
        const hasExplicitShipping = item.shippingPrice !== undefined && Number.isFinite(Number(item.shippingPrice));
        const isBigBoxMsrp = Boolean(bigBoxName && dropPrice <= rule.msrpCeiling * 1.08);
        // Tier A (True Retail MSRP) and PC Exclusive Retail Drops force $0 shipping on Big Box
        const isFreeShip = Boolean(isPcExclusiveRetailDrop ||
            isBigBoxMsrp ||
            (hasExplicitShipping ? Number(item.shippingPrice) === 0 : item.freeShipping) ||
            (!hasExplicitShipping && dropPrice >= shipProfile.freeShipThreshold));
        const estimatedShipping = isFreeShip
            ? 0
            : (hasExplicitShipping ? Number(item.shippingPrice) : shipProfile.flatShipping);
        const landedPrice = Math.round((dropPrice + estimatedShipping) * 100) / 100;
        // V5 Slice 3: Marketplace Scam & Shipping Trap Shield
        const scamCheck = isMarketplaceScamOrShippingTrap(item, dropPrice, estimatedShipping, currentMarketRef);
        if (scamCheck.blocked) {
            return { action: 'IGNORE', reason: scamCheck.reason || 'Blocked by Marketplace Scam & Shipping Trap Shield.', rule };
        }
        // Only record into standard SKU telemetry/snapshots if it is NOT a PC Exclusive variant and passed scam checks
        if (!hasPcTerm && !isPcSource && dropPrice >= minFloor && dropPrice <= maxCeiling) {
            (0, marketTelemetry_1.recordObservation)(rule.id, dropPrice, item.retailer, item.productUrl || item.url, rule.msrpCeiling);
            (0, marketTape_1.recordDailySnapshot)(rule.id, dropPrice, item.retailer, currentMarketRef);
        }
        if (rule.active === false) {
            return { action: 'IGNORE', reason: `Rule "${rule.name}" is toggled OFF on dashboard.`, rule };
        }
        if (item.stock !== undefined && item.stock < rule.minStock) {
            return { action: 'IGNORE', reason: `Stock (${item.stock}) below minStock (${rule.minStock}).`, rule };
        }
        let bigBoxTier = undefined;
        let bigBoxBadge = undefined;
        let marketplaceWarning = undefined;
        let priorityFront = false;
        // V5 Slice 3: Evaluate Tier-A True Retail MSRP against raw shelf price (dropPrice <= msrpCeiling * 1.08) when shipping <= $10.00
        const isTierAMsrp = Boolean(rule.msrpCeiling > 0 &&
            dropPrice <= Math.round(rule.msrpCeiling * 1.08 * 100) / 100 &&
            estimatedShipping <= 10.00);
        if (item.isBigBoxRestockRadar) {
            bigBoxTier = 'BIG_BOX_RESTOCK_RADAR';
            bigBoxBadge = '📡🚨 BIG-BOX RESTOCK RADAR (MSRP ASSUMED) 🚨📡';
            priorityFront = true;
        }
        else if (isPcExclusiveRetailDrop) {
            bigBoxTier = 'PC_EXCLUSIVE_MSRP';
            bigBoxBadge = '💎 POKÉMON CENTER EXCLUSIVE MSRP DROP';
            priorityFront = true;
        }
        else if (isTierAMsrp) {
            bigBoxTier = 'MSRP_TIER_A';
            bigBoxBadge = '🚨💎 UNICORN RETAIL MSRP HIT 💎🚨';
            priorityFront = true;
        }
        else if (bigBoxName && dropPrice > rule.msrpCeiling * 1.08) {
            bigBoxTier = '3P_TIER_B';
            bigBoxBadge = '⚠️ BIG-BOX 3P UNDERCUT';
            if (/walmart|amazon|target|best\s*buy|marketplace/i.test(`${bigBoxName} ${item.retailer} ${handleAndUrl}`)) {
                marketplaceWarning = '⚠️ 3P MARKETPLACE CHECK: Price is above MSRP — verify Sold & Shipped by 1st-Party Retailer before buying';
            }
        }
        // Rule of 3 Family Pack Instant-Cart Links for Shopify LGS drops on ETBs
        const baseCartUrl = item.cart1xUrl || (item.url && item.url.includes('/cart/') ? item.url : undefined);
        let cart1xUrl = item.cart1xUrl;
        let cart2xUrl = item.cart2xUrl;
        let cart3xUrl = item.cart3xUrl;
        if (baseCartUrl) {
            const cleanCartRoot = baseCartUrl.replace(/:\d+$/, '');
            cart1xUrl = `${cleanCartRoot}:1`;
            cart2xUrl = (item.stock === undefined || item.stock >= 2) ? `${cleanCartRoot}:2` : undefined;
            if (rule.formFactor === 'ETB') {
                cart3xUrl = (item.stock === undefined || item.stock >= 3) ? `${cleanCartRoot}:3` : undefined;
            }
            else {
                cart3xUrl = undefined;
            }
        }
        // Check Vault suppression (inVault / owned + muteVaulted setting + wallHunterMode), with MSRP Tier-A Defcon-1 Override!
        const isInVault = Boolean(rule.inVault ?? rule.owned);
        const isMsrpUnicorn = Boolean(isTierAMsrp || isPcExclusiveRetailDrop);
        let muteVaulted = false;
        let wallHunterMode = false;
        try {
            const settings = (0, configManager_1.loadGlobalSettings)();
            muteVaulted = Boolean(settings?.muteVaulted);
            wallHunterMode = Boolean(settings?.wallHunterMode);
        }
        catch (e) { }
        const isMarketplace3P = Boolean(item.isMarketplace3P ||
            /tcgplayer|ebay|target\s*plus|walmart.*3p|3rd[-\s]*party|marketplace/i.test(`${item.retailer} ${handleAndUrl}`));
        const shelfStatus = computeOfferShelfStatus({
            dropPrice,
            landedPrice,
            estimatedShipping,
            triggerPrice: effectiveCeiling,
            msrpCeiling: rule.msrpCeiling,
            marketValue: currentMarketRef,
            formFactor: rule.formFactor,
            owned: isInVault,
            muteVaulted,
            isMsrpUnicorn,
            isMarketplace3P
        });
        const { statusTier, statusTag, isCloseCall, closeCallDelta } = shelfStatus;
        if (item.itemId && String(item.itemId).startsWith('tcg_')) {
            clearTcgOosStrikes(String(item.itemId));
        }
        const now = Date.now();
        // V5 Slice 3.5: Data-Driven Pre-Release & 30/60/90d Rolling Trend Evaluation via src/engine/trendAdvisor.ts
        const trendEval = (0, trendAdvisor_1.evaluateSkuTrendAndTiming)({
            skuId: rule.id,
            formFactor: rule.formFactor,
            dropPrice,
            landedPrice,
            estimatedShipping,
            policyMaxBuy: effectiveCeiling,
            msrpCeiling: rule.msrpCeiling,
            marketBaseline: currentMarketRef,
            releaseDate: rule.releaseDate,
            owned: isInVault,
            isCloseCall,
            isMarketplace3P,
            nowTs: now
        });
        const { trendSignal, trendVerdictLabel, isElasticDip, qualifiesForElasticDipAlert, isPreRelease, preReleaseStatusTag } = trendEval;
        const { packCount, pricePerPack, isRipValueLeader } = (0, policies_1.computeRipMetrics)(landedPrice, rule.id, rule.formFactor, `${rule.name} ${cleanTitle}`, rule.packCount);
        const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let freeShipNote = item.shippingNoteOverride;
        // Record ALL matched in-stock store offers (even above trigger) into storeOffersCache.json & bestCurrentOffers!
        if (!item.isBigBoxRestockRadar && policyMaxBuy > 0 && landedPrice >= minFloor) {
            const gapDollars = Math.round((landedPrice - policyMaxBuy) * 100) / 100;
            const gapPct = Math.round(((landedPrice - policyMaxBuy) / policyMaxBuy) * 1000) / 10;
            const rawGapDollars = Math.round((dropPrice - policyMaxBuy) * 100) / 100;
            const rawGapPct = Math.round(((dropPrice - policyMaxBuy) / policyMaxBuy) * 1000) / 10;
            const resolvedShipNote = freeShipNote || (estimatedShipping > 0 ? `$${dropPrice.toFixed(2)} Shelf + $${estimatedShipping.toFixed(2)} Est. Ship ($${landedPrice.toFixed(2)} Landed)` : '+FREE Shipping');
            upsertStoreOfferCache({
                skuId: rule.id,
                productName: rule.name,
                rawTitle: cleanTitle,
                formFactor: rule.formFactor || 'Sealed',
                era: rule.era,
                owned: isInVault,
                msrp: rule.msrpCeiling,
                triggerPrice: policyMaxBuy,
                marketValue: currentMarketRef,
                storeName: item.retailer,
                price: dropPrice,
                shipping: item.shippingPrice ?? estimatedShipping,
                landedPrice,
                freeShipNote: resolvedShipNote,
                statusTier,
                statusTag,
                isCloseCall,
                closeCallDelta,
                trendSignal,
                trendVerdictLabel,
                isElasticDip,
                url: item.productUrl || item.url,
                productUrl: item.productUrl || item.url,
                cart1xUrl,
                cart2xUrl,
                cart3xUrl,
                stock: item.stock,
                itemId: item.itemId,
                packCount,
                pricePerPack,
                isRipValueLeader,
                updatedAt: now
            });
            upsertBestCurrentOffer({
                ruleId: rule.id,
                ruleName: rule.name,
                formFactor: rule.formFactor || 'Sealed',
                era: rule.era,
                title: cleanTitle,
                retailer: item.retailer,
                price: dropPrice,
                itemPrice: item.itemPrice,
                shippingPrice: item.shippingPrice ?? estimatedShipping,
                landedPrice,
                freeShipNote: resolvedShipNote,
                triggerPrice: policyMaxBuy,
                msrp: rule.msrpCeiling,
                marketValue: currentMarketRef,
                gapDollars,
                gapPct,
                rawGapDollars,
                rawGapPct,
                packCount,
                pricePerPack,
                isRipValueLeader,
                owned: isInVault,
                isPreOrder,
                isPreRelease,
                preReleaseStatusTag,
                statusTier,
                statusTag,
                isCloseCall,
                closeCallDelta,
                trendSignal,
                trendVerdictLabel,
                isElasticDip,
                url: item.url,
                productUrl: item.productUrl,
                cart1xUrl,
                cart2xUrl,
                cart3xUrl,
                itemId: item.itemId,
                updatedAt: now,
                timeStr: nowTimeStr
            });
        }
        // V5 Slice 3 & 3.5: Allow UNDER_TARGET, MSRP Unicorns, Close-Call Grace Cushion (+$5 ETB / +$10 Box), and verified 60D Elastic Dips to pass!
        const qualifiesOnShelfPrice = (dropPrice <= effectiveCeiling || isMsrpUnicorn) && !isMarketplace3P && estimatedShipping <= 10.00;
        const qualifiesOnLandedPrice = landedPrice <= effectiveCeiling;
        const qualifiesByElasticDip = Boolean(!isInVault &&
            isElasticDip &&
            qualifiesForElasticDipAlert &&
            item.sellerVerified !== false);
        if (!qualifiesOnShelfPrice && !qualifiesOnLandedPrice && !isCloseCall && !qualifiesByElasticDip) {
            if (dropPrice <= effectiveCeiling && landedPrice > effectiveCeiling) {
                const qtyForFreeShip = Math.ceil(shipProfile.freeShipThreshold / dropPrice);
                const hasEnoughStock = item.stock === undefined || item.stock >= qtyForFreeShip;
                if (qtyForFreeShip <= 4 && hasEnoughStock && !isMarketplace3P) {
                    freeShipNote = `Buy ${qtyForFreeShip}x to hit $${shipProfile.freeShipThreshold} Free Shipping -> $${dropPrice.toFixed(2)}/ea landed`;
                }
                else {
                    return {
                        action: 'IGNORE',
                        reason: `[${statusTag}] Landed price ($${landedPrice.toFixed(2)} w/ $${estimatedShipping.toFixed(2)} ship) exceeds buy threshold ($${effectiveCeiling.toFixed(2)}).`,
                        rule,
                        packCount,
                        pricePerPack,
                        isRipValueLeader,
                        isPreRelease,
                        preReleaseStatusTag,
                        releaseDate: rule.releaseDate,
                        statusTier,
                        statusTag,
                        isCloseCall,
                        closeCallDelta,
                        trendSignal,
                        trendVerdictLabel,
                        isElasticDip
                    };
                }
            }
            else {
                return {
                    action: 'IGNORE',
                    reason: `[${statusTag}] ${isPreOrder ? '[PRE-ORDER] ' : ''}${trendVerdictLabel ? `[${trendVerdictLabel}] ` : ''}Price ($${dropPrice.toFixed(2)} shelf / $${landedPrice.toFixed(2)} landed) exceeds target ($${effectiveCeiling.toFixed(2)}) and Close-Call Cushion.`,
                    rule,
                    packCount,
                    pricePerPack,
                    isRipValueLeader,
                    isPreRelease,
                    preReleaseStatusTag,
                    releaseDate: rule.releaseDate,
                    statusTier,
                    statusTag,
                    isCloseCall,
                    closeCallDelta,
                    trendSignal,
                    trendVerdictLabel,
                    isElasticDip
                };
            }
        }
        if (estimatedShipping > 0 && !freeShipNote) {
            const qtyForFreeShip = Math.ceil(shipProfile.freeShipThreshold / dropPrice);
            const hasEnoughStock = item.stock === undefined || item.stock >= qtyForFreeShip;
            if (qtyForFreeShip <= 4 && hasEnoughStock && shipProfile.freeShipThreshold < 900 && !isMarketplace3P) {
                freeShipNote = `$${dropPrice.toFixed(2)} Shelf + $${estimatedShipping.toFixed(2)} Est. Ship ($${landedPrice.toFixed(2)} Landed • Buy ${qtyForFreeShip}x for $${shipProfile.freeShipThreshold} Free Ship)`;
            }
            else {
                freeShipNote = `$${dropPrice.toFixed(2)} Shelf + $${estimatedShipping.toFixed(2)} Est. Ship ($${landedPrice.toFixed(2)} Landed)`;
            }
        }
        if (isCloseCall && !bigBoxBadge) {
            bigBoxBadge = `◈ ⟦ CLOSE CALL: WITHIN +$${closeCallDelta.toFixed(2)} OF TARGET ⟧`;
        }
        else if (qualifiesByElasticDip && !qualifiesOnShelfPrice && !qualifiesOnLandedPrice && !bigBoxBadge) {
            bigBoxBadge = '◈ ⟦ ELASTIC DIP OPPORTUNITY ⟧';
        }
        const currentPrice = dropPrice;
        (0, marketTape_1.recordTapeRestock)({
            itemId: String(item.itemId || `${rule.id}__${item.retailer}`),
            targetId: rule.id,
            targetName: rule.name,
            store: item.retailer,
            price: currentPrice,
            landedPrice,
            marketPrice: currentMarketRef,
            url: item.productUrl || item.url,
            bigBoxTier: bigBoxTier === 'BIG_BOX_RESTOCK_RADAR' ? 'MSRP_TIER_A' : bigBoxTier,
            bigBoxBadge
        });
        // Valid drop (<= maxBuy, Close-Call Cushion, or 60D Elastic Dip): sync immediately to liveStock.json!
        upsertLiveStock({
            ruleId: rule.id,
            ruleName: rule.name,
            formFactor: rule.formFactor || 'Sealed',
            title: cleanTitle,
            retailer: item.retailer,
            price: currentPrice,
            itemPrice: item.itemPrice,
            shippingPrice: item.shippingPrice,
            landedPrice,
            freeShipNote,
            packCount,
            pricePerPack,
            isRipValueLeader,
            isPreOrder,
            isPreRelease,
            preReleaseStatusTag,
            releaseDate: rule.releaseDate,
            isMsrpUnicorn,
            bigBoxTier,
            bigBoxBadge,
            marketplaceWarning,
            statusTier,
            statusTag,
            isCloseCall,
            closeCallDelta,
            trendSignal,
            trendVerdictLabel,
            isElasticDip,
            url: item.url,
            productUrl: item.productUrl,
            cart1xUrl,
            cart2xUrl,
            cart3xUrl,
            stock: item.stock,
            itemId: item.itemId,
            inStock: true,
            updatedAt: now,
            timeStr: nowTimeStr
        });
        // Vault suppression check: If item is marked inVault/owned AND muteVaulted is enabled, suppress alert UNLESS it's a Tier-A True Retail MSRP Unicorn!
        if (isInVault && muteVaulted && !isMsrpUnicorn) {
            return {
                action: 'IGNORE',
                reason: `[${statusTag}] Suppressed by Vault Mute (inVault=true and above MSRP Tier-A ceiling).`,
                rule,
                packCount,
                pricePerPack,
                isRipValueLeader,
                isPreRelease,
                preReleaseStatusTag,
                releaseDate: rule.releaseDate,
                statusTier,
                statusTag,
                isCloseCall,
                closeCallDelta,
                trendSignal,
                trendVerdictLabel,
                isElasticDip
            };
        }
        // Wall Hunter Mode: strictly filter active Discord alerts to unowned Single Wall ETBs (formFactor === 'etb' && !isInVault)
        const isNeededSingleWallEtb = String(rule.formFactor || '').toLowerCase() === 'etb' && !isInVault;
        if (wallHunterMode && !isNeededSingleWallEtb) {
            return {
                action: 'IGNORE',
                reason: `Suppressed by Wall Hunter Mode (Only alerting on the 30 unowned Single Wall ETBs).`,
                rule,
                packCount,
                pricePerPack,
                isRipValueLeader,
                isPreRelease,
                preReleaseStatusTag,
                releaseDate: rule.releaseDate,
                statusTier,
                statusTag,
                isCloseCall,
                closeCallDelta,
                trendSignal,
                trendVerdictLabel,
                isElasticDip
            };
        }
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
        // V5 Slice 3: Strict Per-Store Alert Deduplication scoped to `${storeName}::${skuId}`
        const normRetailer = normalizeAlertRetailerKey(item.retailer);
        const stateKey = `${normRetailer}::${rule.id}`;
        const prev = alertMemory[stateKey] ||
            alertMemory[`${item.retailer}::${rule.id}`] ||
            alertMemory[`${rule.id}__${normRetailer}`] ||
            alertMemory[`${rule.id}__${item.retailer}`];
        let alertType = 'NEW_DROP';
        let previousPrice = undefined;
        let previousTimeStr = undefined;
        if (prev) {
            const elapsedHours = (now - prev.timestamp) / (1000 * 60 * 60);
            const prevLowest = prev.lowestAlertedPrice || prev.lastPrice;
            const isSignificantPriceDrop = (currentPrice <= prevLowest - 3.00 ||
                currentPrice <= Math.round(prevLowest * 0.98 * 100) / 100);
            // 12-Hour Anti-Echo Lock: Never re-alert on the same SKU + Store within 12h if price hasn't moved by >= $1.00
            if (elapsedHours < 12 && Math.abs(landedPrice - prev.lastPrice) < 1.00 && Math.abs(currentPrice - prev.lastPrice) < 1.00 && !isSignificantPriceDrop) {
                return {
                    action: 'IGNORE',
                    reason: `Deduplicated 12h repeat echo: ${rule.name} at ${item.retailer} unchanged at $${prev.lastPrice.toFixed(2)} (${prev.timeStr}).`,
                    rule,
                    packCount,
                    pricePerPack,
                    isRipValueLeader,
                    isPreRelease,
                    preReleaseStatusTag,
                    releaseDate: rule.releaseDate,
                    statusTier,
                    statusTag,
                    isCloseCall,
                    closeCallDelta,
                    trendSignal,
                    trendVerdictLabel,
                    isElasticDip
                };
            }
            const isTrueRestock = Boolean(prev.wasOutOfStockSinceLastAlert) && elapsedHours >= 0.25;
            const isDailyReminder = elapsedHours >= 24;
            if (!isTrueRestock && !isSignificantPriceDrop && !isDailyReminder) {
                return {
                    action: 'IGNORE',
                    reason: `Deduplicated static shelf stock: ${rule.name} at ${item.retailer} already alerted at $${prev.lastPrice.toFixed(2)} (${prev.timeStr}).`,
                    rule,
                    packCount,
                    pricePerPack,
                    isRipValueLeader,
                    isPreRelease,
                    preReleaseStatusTag,
                    releaseDate: rule.releaseDate,
                    statusTier,
                    statusTag,
                    isCloseCall,
                    closeCallDelta,
                    trendSignal,
                    trendVerdictLabel,
                    isElasticDip
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
            alertCount: (prev?.alertCount || 0) + 1,
            wasOutOfStockSinceLastAlert: false,
            itemId: item.itemId ? String(item.itemId) : prev?.itemId
        };
        saveAlertMemory();
        // Record persistent Trophy Catch if Tier-A True Retail MSRP hit!
        if (isMsrpUnicorn && !item.isBigBoxRestockRadar) {
            recordMsrpTrophyCatch({
                productName: rule.name,
                ruleId: rule.id,
                store: item.retailer,
                price: currentPrice,
                landedPrice,
                msrp: rule.msrpCeiling,
                url: item.productUrl || item.url,
                timestamp: now,
                timeStr: new Date(now).toISOString()
            });
        }
        const liveTel = (0, marketTelemetry_1.getTelemetry)()[rule.id];
        const marketVal = (liveTel && liveTel.rollingAverage > 0) ? liveTel.rollingAverage : (rule.estimatedMarketValue || effectiveCeiling);
        const effectiveComparePrice = freeShipNote ? currentPrice : landedPrice;
        const savingsDollars = Math.max(0, marketVal - effectiveComparePrice);
        const discountPct = marketVal > 0 ? Math.round(((marketVal - effectiveComparePrice) / marketVal) * 100) : 0;
        return {
            action: 'BUY',
            reason: `[${alertType}]${bigBoxBadge ? ` [${bigBoxBadge}]` : ''} [${statusTag}] [${trendVerdictLabel}]${isPreOrder ? ' [◈ PRE-ORDER]' : ''} Matched "${rule.name}" at $${currentPrice.toFixed(2)} (Landed: $${landedPrice.toFixed(2)} • $${pricePerPack.toFixed(2)}/pk • ${discountPct}% under market)`,
            rule,
            discountPct,
            savingsDollars,
            alertType,
            previousPrice,
            previousTimeStr,
            landedPrice,
            itemPrice: item.itemPrice,
            shippingPrice: item.shippingPrice,
            estimatedShipping,
            freeShipNote,
            packCount,
            pricePerPack,
            isRipValueLeader,
            isPreOrder,
            isPreRelease,
            preReleaseStatusTag,
            releaseDate: rule.releaseDate,
            isMsrpUnicorn,
            bypassVaultMute: Boolean(isInVault && isMsrpUnicorn),
            cart1xUrl,
            cart2xUrl,
            cart3xUrl,
            bigBoxTier,
            bigBoxBadge,
            marketplaceWarning,
            priorityFront,
            statusTier,
            statusTag,
            isCloseCall,
            closeCallDelta,
            trendSignal,
            trendVerdictLabel,
            isElasticDip
        };
    }
    return { action: 'IGNORE', reason: 'No matching policy rule found.' };
}
