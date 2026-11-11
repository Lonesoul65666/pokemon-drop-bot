"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORE_SHIPPING_RULES = exports.MSRP_TROPHIES_PATH = exports.getLiveStoreOfferMedian = exports.computeAutoPilotTarget = exports.isPreReleaseDate = void 0;
exports.isVerified1PBigBoxOrPc = isVerified1PBigBoxOrPc;
exports.buildShopifyDirectCartLinks = buildShopifyDirectCartLinks;
exports.buildMobileRetailerLinks = buildMobileRetailerLinks;
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
Object.defineProperty(exports, "computeAutoPilotTarget", { enumerable: true, get: function () { return trendAdvisor_1.computeAutoPilotTarget; } });
Object.defineProperty(exports, "getLiveStoreOfferMedian", { enumerable: true, get: function () { return trendAdvisor_1.getLiveStoreOfferMedian; } });
Object.defineProperty(exports, "isPreReleaseDate", { enumerable: true, get: function () { return trendAdvisor_1.isPreReleaseDate; } });
function isVerified1PBigBoxOrPc(retailer, url, isMarketplace3P = false) {
    if (isMarketplace3P)
        return false;
    const hay = `${retailer || ''} ${url || ''}`.toLowerCase();
    if (/tcgplayer|ebay|target\s*plus|3rd[-\s]*party|marketplace/i.test(hay))
        return false;
    return /pok[eé]mon\s*center|pokemoncenter\.com|\btarget\b|target\.com|\bwalmart\b|walmart\.com|best\s*buy|bestbuy\.com|\bamazon\b|amazon\.com|\bcostco\b|costco\.com|sam'?s\s*club|samsclub\.com|\bgamestop\b|gamestop\.com|barnes\s*(&|and)\s*noble|barnesandnoble\.com/i.test(hay);
}
function buildShopifyDirectCartLinks(params) {
    const { url = '', productUrl = '', cart1xUrl, cart2xUrl, cart3xUrl, itemId, stock, retailer = '' } = params;
    const hay = `${retailer} ${url} ${productUrl}`.toLowerCase();
    if (/tcgplayer|ebay|target\.com|walmart\.com|bestbuy\.com|amazon\.com|costco\.com|samsclub\.com|gamestop\.com|barnesandnoble\.com|pokemoncenter\.com|reddit\.com/i.test(hay)) {
        return { cart1xUrl, cart2xUrl, cart3xUrl };
    }
    let baseRoot = '';
    const candidateCart = cart1xUrl || (url.includes('/cart/') ? url : '');
    if (candidateCart && candidateCart.includes('/cart/')) {
        baseRoot = candidateCart.split('?')[0].replace(/:\d+$/, '');
    }
    else if (itemId && /^\d{8,18}$/.test(String(itemId))) {
        const u = productUrl || url;
        const m = u.match(/^(https?:\/\/[^/]+)/i);
        if (m)
            baseRoot = `${m[1]}/cart/${String(itemId)}`;
    }
    if (!baseRoot)
        return { cart1xUrl, cart2xUrl, cart3xUrl };
    return {
        cart1xUrl: `${baseRoot}:1?payment=shop_pay`,
        cart2xUrl: (stock === undefined || stock >= 2) ? `${baseRoot}:2?payment=shop_pay` : undefined,
        cart3xUrl: (stock === undefined || stock >= 3) ? `${baseRoot}:3?payment=shop_pay` : undefined
    };
}
function buildMobileRetailerLinks(params) {
    const rawUrl = String(params.productUrl || params.url || '').trim();
    const hay = `${params.retailer || ''} ${rawUrl}`.toLowerCase();
    const idStr = params.itemId !== undefined ? String(params.itemId).trim() : '';
    if (hay.includes('target')) {
        const tcinMatch = rawUrl.match(/A-(\d{8,10})/i) || idStr.match(/^(?:target_)?(\d{8,10})$/i);
        if (tcinMatch) {
            const tcin = tcinMatch[1];
            const cleanTargetUrl = `https://www.target.com/p/-/A-${tcin}`;
            return {
                primaryCheckoutUrl: cleanTargetUrl,
                secondaryPdpUrl: cleanTargetUrl,
                mobileActionMarkdown: `[**⟦ 📱 OPEN TARGET APP (A-${tcin}) ↗ ⟧**](${cleanTargetUrl})`
            };
        }
    }
    if (hay.includes('best buy') || hay.includes('bestbuy.com')) {
        const skuMatch = rawUrl.match(/skuId=(\d{7})/i) || rawUrl.match(/\/(\d{7})(?:\.p|\/cart)/i) || idStr.match(/^(?:bestbuy_)?(\d{7})$/i);
        if (skuMatch) {
            const sku = skuMatch[1];
            const atcUrl = `https://api.bestbuy.com/click/-/${sku}/cart`;
            const pdpUrl = `https://www.bestbuy.com/site/-/${sku}.p?skuId=${sku}`;
            return {
                primaryCheckoutUrl: atcUrl,
                secondaryPdpUrl: pdpUrl,
                mobileActionMarkdown: `[**⟦ ⚡ BEST BUY 1-TAP ATC ↗ ⟧**](${atcUrl})   •   [**⟦ 📱 APP PDP ↗ ⟧**](${pdpUrl})`
            };
        }
    }
    if (hay.includes('walmart')) {
        const wmMatch = rawUrl.match(/\/ip\/(?:[^/?#]+\/)?(\d{8,14})/i) || rawUrl.match(/[?&](?:id|item(?:Id)?)=(\d{8,14})/i) || idStr.match(/^(?:walmart_)?(\d{8,14})$/i);
        if (wmMatch) {
            const wmId = wmMatch[1];
            const pacUrl = `https://www.walmart.com/pac?id=${wmId}&quantity=1`;
            const buyNowUrl = `https://affil.walmart.com/cart/buynow?items=${wmId}`;
            const pdpUrl = `https://www.walmart.com/ip/${wmId}`;
            return {
                primaryCheckoutUrl: pacUrl,
                secondaryPdpUrl: pdpUrl,
                mobileActionMarkdown: `[**⟦ ⚡ WALMART 1-TAP CART ↗ ⟧**](${pacUrl})   •   [**⟦ BUY NOW ⟧**](${buyNowUrl})   •   [**⟦ 📱 APP ↗ ⟧**](${pdpUrl})`
            };
        }
    }
    if (hay.includes('amazon')) {
        const asinMatch = rawUrl.match(/(?:\/dp\/|\/gp\/product\/|ASIN\.1=)(B0[A-Z0-9]{8})\b/i) || idStr.match(/^(?:amazon_)?(B0[A-Z0-9]{8})$/i);
        if (asinMatch) {
            const asin = asinMatch[1].toUpperCase();
            const atcUrl = `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${asin}&Quantity.1=1`;
            const pdpUrl = `https://www.amazon.com/dp/${asin}?smid=ATVPDKIKX0DER`;
            return {
                primaryCheckoutUrl: atcUrl,
                secondaryPdpUrl: pdpUrl,
                mobileActionMarkdown: `[**⟦ ⚡ AMAZON 1P 1-TAP ATC ↗ ⟧**](${atcUrl})   •   [**⟦ 📱 1P OFFER (ATVPDKIKX0DER) ↗ ⟧**](${pdpUrl})`
            };
        }
    }
    if (hay.includes('pokemon center') || hay.includes('pokémon center') || hay.includes('pokemoncenter.com')) {
        const pcUrl = rawUrl || 'https://www.pokemoncenter.com';
        return {
            primaryCheckoutUrl: pcUrl,
            secondaryPdpUrl: pcUrl,
            mobileActionMarkdown: `[**⟦ ⚡ POKÉMON CENTER DIRECT CHECKOUT ↗ ⟧**](${pcUrl})`
        };
    }
    if (hay.includes('gamestop')) {
        return {
            primaryCheckoutUrl: rawUrl,
            secondaryPdpUrl: rawUrl,
            mobileActionMarkdown: `[**⟦ ⚡ GAMESTOP 1P CHECKOUT ↗ ⟧**](${rawUrl})`
        };
    }
    if (hay.includes('barnes') || hay.includes('barnesandnoble.com')) {
        return {
            primaryCheckoutUrl: rawUrl,
            secondaryPdpUrl: rawUrl,
            mobileActionMarkdown: `[**⟦ ⚡ BARNES & NOBLE 1P CHECKOUT ↗ ⟧**](${rawUrl})`
        };
    }
    if (hay.includes('costco')) {
        return {
            primaryCheckoutUrl: rawUrl,
            secondaryPdpUrl: rawUrl,
            mobileActionMarkdown: `[**⟦ ⚡ COSTCO MEMBER CHECKOUT ↗ ⟧**](${rawUrl})`
        };
    }
    if (hay.includes("sam's club") || hay.includes('sams club') || hay.includes('samsclub.com')) {
        return {
            primaryCheckoutUrl: rawUrl,
            secondaryPdpUrl: rawUrl,
            mobileActionMarkdown: `[**⟦ ⚡ SAM'S CLUB CHECKOUT ↗ ⟧**](${rawUrl})`
        };
    }
    return { primaryCheckoutUrl: rawUrl };
}
function getCloseCallGraceBuffer(formFactor) {
    const ff = String(formFactor || '').toLowerCase();
    if (ff === 'booster box' || ff === 'etb case' || ff === 'master case' || ff.includes('box') || ff.includes('case')) {
        return 10.00;
    }
    return 5.00;
}
function computeOfferShelfStatus(params) {
    const { dropPrice, landedPrice, estimatedShipping, triggerPrice, msrpCeiling, marketValue, formFactor, owned = false, wallOwned = owned, fullyConquered = false, completionCount = wallOwned ? 1 : 0, ripHuntCeiling, stock, muteVaulted = false, isMsrpUnicorn = false, isRetailFlipBypass = false, isMarketplace3P = false } = params;
    const isRipHuntMode = Boolean((wallOwned || completionCount >= 1) && !fullyConquered);
    const effTrigger = (isRipHuntMode && ripHuntCeiling && ripHuntCeiling > 0) ? ripHuntCeiling : triggerPrice;
    const ffLower = String(formFactor || '').toLowerCase();
    const ripPairReady = Boolean(isRipHuntMode &&
        ((stock !== undefined && stock >= 2) || stock === undefined || ffLower.includes('booster box')));
    const ripPairBadge = ripPairReady ? '◈ ⟦ RIP PAIR READY (QTY 2+) ⟧' : undefined;
    const graceBuffer = getCloseCallGraceBuffer(formFactor);
    const canUseShelfPrice = !isMarketplace3P && estimatedShipping <= 10.00;
    const comparePrice = (canUseShelfPrice && dropPrice <= effTrigger + graceBuffer) ? dropPrice : landedPrice;
    const isUnderOrAtTarget = comparePrice <= effTrigger || landedPrice <= effTrigger || isMsrpUnicorn || isRetailFlipBypass;
    const rawOver = Math.round((comparePrice - effTrigger) * 100) / 100;
    const withinGraceBuffer = rawOver > 0 && rawOver <= graceBuffer;
    const withinMarketOrMsrpGuard = (marketValue > 0 && comparePrice <= marketValue * 0.93) ||
        (msrpCeiling > 0 && comparePrice <= msrpCeiling * 1.10);
    const isCloseCall = !isUnderOrAtTarget && withinGraceBuffer && withinMarketOrMsrpGuard;
    const closeCallDelta = isCloseCall ? rawOver : 0;
    if (fullyConquered && muteVaulted && !isMsrpUnicorn && !isRetailFlipBypass) {
        return {
            statusTier: 'MUTED_OWNED',
            statusTag: '⟦ MUTED: 3/3 FAMILY COMPLETE ⟧',
            isCloseCall,
            closeCallDelta,
            comparePrice,
            ripPairReady: false
        };
    }
    if (isUnderOrAtTarget) {
        const refPrice = landedPrice <= effTrigger ? landedPrice : dropPrice;
        const underDollars = Math.max(0, Math.round((effTrigger - refPrice) * 100) / 100);
        return {
            statusTier: 'UNDER_TARGET',
            statusTag: isRipHuntMode
                ? `⟦ RIP TARGET HIT (-$${underDollars.toFixed(2)}) ⟧`
                : `⟦ UNDER TARGET (-$${underDollars.toFixed(2)}) ⟧`,
            isCloseCall: false,
            closeCallDelta: 0,
            comparePrice: refPrice,
            ripPairReady,
            ripPairBadge
        };
    }
    if (isCloseCall) {
        return {
            statusTier: 'CLOSE_CALL',
            statusTag: `⟦ CLOSE CALL (+$${closeCallDelta.toFixed(2)} OVER TARGET — IN CUSHION) ⟧`,
            isCloseCall: true,
            closeCallDelta,
            comparePrice,
            ripPairReady,
            ripPairBadge
        };
    }
    if (wallOwned && muteVaulted && !isMsrpUnicorn && !isRetailFlipBypass) {
        return {
            statusTier: 'MUTED_OWNED',
            statusTag: isRipHuntMode ? `⟦ WALL LOCKED (${completionCount}/3) // WAIT FOR $${effTrigger.toFixed(0)} RIP DIP ⟧` : '⟦ MUTED: OWNED ON WALL ⟧',
            isCloseCall: false,
            closeCallDelta: 0,
            comparePrice: landedPrice,
            ripPairReady,
            ripPairBadge
        };
    }
    const overDollars = Math.max(0.01, Math.round((landedPrice - effTrigger) * 100) / 100);
    return {
        statusTier: 'NEAR_MISS',
        statusTag: `⟦ NEAR MISS (+$${overDollars.toFixed(2)} OVER TARGET) ⟧`,
        isCloseCall: false,
        closeCallDelta: 0,
        comparePrice: landedPrice,
        ripPairReady,
        ripPairBadge
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
let storeOffersLastMtimeMs = 0;
function syncStoreOffersFromDiskIfNewer() {
    try {
        if (!fs_1.default.existsSync(STORE_OFFERS_CACHE_PATH))
            return;
        const stat = fs_1.default.statSync(STORE_OFFERS_CACHE_PATH);
        if (stat.mtimeMs > storeOffersLastMtimeMs) {
            const parsed = JSON.parse(fs_1.default.readFileSync(STORE_OFFERS_CACHE_PATH, 'utf-8'));
            if (parsed && typeof parsed === 'object') {
                storeOffersCacheMem = parsed;
                storeOffersLastMtimeMs = stat.mtimeMs;
            }
        }
    }
    catch (e) { }
}
function flushStoreOffersToDiskNow() {
    try {
        (0, policies_1.atomicWriteJson)(STORE_OFFERS_CACHE_PATH, storeOffersCacheMem);
        if (fs_1.default.existsSync(STORE_OFFERS_CACHE_PATH)) {
            storeOffersLastMtimeMs = fs_1.default.statSync(STORE_OFFERS_CACHE_PATH).mtimeMs;
        }
    }
    catch (e) { }
}
syncStoreOffersFromDiskIfNewer();
function scheduleStoreOffersFlush() {
    if (storeOffersFlushTimer)
        return;
    storeOffersFlushTimer = setTimeout(() => {
        storeOffersFlushTimer = null;
        flushStoreOffersToDiskNow();
    }, 2000);
}
function upsertStoreOfferCache(entry) {
    if (!entry.skuId || !entry.storeName)
        return;
    syncStoreOffersFromDiskIfNewer();
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
    syncStoreOffersFromDiskIfNewer();
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
        syncStoreOffersFromDiskIfNewer();
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
                const candidateTitle = String(rec.rawTitle || rec.productName || '');
                const candidateFormFactor = rule?.formFactor || rec.formFactor;
                if ((0, policies_1.isSingleCardOrNonSealed)(candidateTitle, undefined, rec.url) ||
                    !(0, policies_1.hasMandatorySealedContainerKeyword)(candidateTitle, candidateFormFactor)) {
                    delete skuOffers[storeKey];
                    mutated = true;
                    continue;
                }
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
                const wallOwned = rule ? Boolean(rule.wallOwned ?? rule.inVault ?? rule.owned) : Boolean(rec.owned);
                const dadRipOwned = rule ? Boolean(rule.dadRipOwned) : false;
                const loganRipOwned = rule ? Boolean(rule.loganRipOwned) : false;
                const completionCount = (wallOwned ? 1 : 0) + (dadRipOwned ? 1 : 0) + (loganRipOwned ? 1 : 0);
                const fullyConquered = Boolean(wallOwned && dadRipOwned && loganRipOwned);
                const isMsrpUnicorn = Boolean(msrp > 0 && rawItemPrice <= Math.round(msrp * 1.08 * 100) / 100 && rawShip <= 10.00);
                const is3P = /tcgplayer|ebay|3p/i.test(rec.storeName || storeKey);
                const is1PBigBox = isVerified1PBigBoxOrPc(rec.storeName || storeKey, rec.url, is3P);
                const isRetailFlipBypass = Boolean(is1PBigBox && isMsrpUnicorn && (marketVal >= rawItemPrice * 1.30 || (0, policies_1.isPokemonCenterSource)(rec.storeName || storeKey, rec.url)));
                const landedVal = Number(rec.landedPrice || rawItemPrice + rawShip);
                const activeStoreCount = Object.keys(skuOffers).length;
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
                    owned: wallOwned,
                    wallOwned,
                    dadRipOwned,
                    loganRipOwned,
                    completionCount,
                    fullyConquered,
                    autoPilotEnabled: rule?.autoPilotEnabled !== false,
                    activeStoreCount,
                    lowestShelfPrice: rawItemPrice,
                    isCloseCall: false,
                    isMarketplace3P: is3P,
                    nowTs: now
                });
                const status = computeOfferShelfStatus({
                    dropPrice: rawItemPrice,
                    landedPrice: landedVal,
                    estimatedShipping: rawShip,
                    triggerPrice: trend.effectiveTargetCeiling || triggerPrice,
                    msrpCeiling: msrp,
                    marketValue: marketVal,
                    formFactor: rule?.formFactor || rec.formFactor,
                    owned: wallOwned,
                    wallOwned,
                    fullyConquered,
                    completionCount,
                    ripHuntCeiling: trend.ripHuntCeiling,
                    stock: rec.stock,
                    muteVaulted,
                    isMsrpUnicorn,
                    isRetailFlipBypass,
                    isMarketplace3P: is3P
                });
                const cartLinks = buildShopifyDirectCartLinks({
                    url: rec.url,
                    productUrl: rec.productUrl,
                    cart1xUrl: rec.cart1xUrl,
                    cart2xUrl: rec.cart2xUrl,
                    cart3xUrl: rec.cart3xUrl,
                    itemId: rec.itemId,
                    stock: rec.stock,
                    retailer: rec.storeName || storeKey
                });
                rec.price = rawItemPrice;
                rec.triggerPrice = trend.effectiveTargetCeiling || triggerPrice;
                rec.msrp = msrp;
                rec.marketValue = marketVal || rec.marketValue;
                rec.owned = wallOwned;
                rec.cart1xUrl = cartLinks.cart1xUrl;
                rec.cart2xUrl = cartLinks.cart2xUrl;
                rec.cart3xUrl = cartLinks.cart3xUrl;
                rec.statusTier = status.statusTier;
                rec.statusTag = status.ripPairBadge ? `${status.statusTag} • ${status.ripPairBadge}` : status.statusTag;
                rec.isCloseCall = status.isCloseCall;
                rec.closeCallDelta = status.closeCallDelta;
                rec.trendSignal = trend.trendSignal;
                rec.trendVerdictLabel = trend.trendVerdictLabel;
                rec.isElasticDip = trend.isElasticDip;
                mutated = true;
            }
        }
        if (mutated) {
            flushStoreOffersToDiskNow();
        }
        // Sync liveStock.json & __bestOffers with lowest storeOffersCacheMem offers & data-driven trendVerdictLabel
        if (fs_1.default.existsSync(LIVE_STOCK_PATH)) {
            try {
                const liveMap = JSON.parse(fs_1.default.readFileSync(LIVE_STOCK_PATH, 'utf-8')) || {};
                const bestOffers = (liveMap.__bestOffers && typeof liveMap.__bestOffers === 'object') ? liveMap.__bestOffers : {};
                let liveMutated = false;
                // Purge any leaked singles or slabs from liveStock.json and __bestOffers
                for (const [k, v] of Object.entries(liveMap)) {
                    if (k.startsWith('__') || !v || typeof v !== 'object')
                        continue;
                    const lsEntry = v;
                    const t = String(lsEntry.title || '');
                    const ff = String(lsEntry.formFactor || '');
                    if ((0, policies_1.isSingleCardOrNonSealed)(t, undefined, lsEntry.url) || !(0, policies_1.hasMandatorySealedContainerKeyword)(t, ff)) {
                        delete liveMap[k];
                        liveMutated = true;
                    }
                }
                for (const [bKey, bVal] of Object.entries(bestOffers)) {
                    if (!bVal || typeof bVal !== 'object')
                        continue;
                    const boEntry = bVal;
                    const t = String(boEntry.title || '');
                    const ff = String(boEntry.formFactor || '');
                    if ((0, policies_1.isSingleCardOrNonSealed)(t, undefined, boEntry.url) || !(0, policies_1.hasMandatorySealedContainerKeyword)(t, ff)) {
                        delete bestOffers[bKey];
                        liveMutated = true;
                    }
                }
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
    if ((0, policies_1.isSingleCardOrNonSealed)(cleanTitle, handleAndUrl) || !(0, policies_1.hasMandatorySealedContainerKeyword)(cleanTitle)) {
        return null;
    }
    const matched = (0, policies_1.matchProductToSku)(cleanTitle, price, {
        handle: handleAndUrl,
        retailer,
        sourceUrl: handleAndUrl,
        allowPcRetailUnlock: false
    });
    if (!matched)
        return null;
    const minFloor = (0, policies_1.getMinPlausiblePriceFloor)(matched.formFactor);
    const maxCeiling = (0, policies_1.getMaxPlausiblePriceCeiling)(matched.formFactor, matched.id, matched.name);
    if (price < minFloor || price > maxCeiling)
        return null;
    return matched;
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
    // Layer 2 & Layer 3: Hard Anti-Singles / Slab / Loose-Pack Shield + Positive Sealed Container Gate
    if ((0, policies_1.isSingleCardOrNonSealed)(cleanTitle, undefined, handleAndUrl)) {
        return { action: 'IGNORE', reason: 'Blocked by V5 Sealed-Only / Anti-Singles Shield (Single Card, Slab, or Loose Pack).' };
    }
    if (!(0, policies_1.hasMandatorySealedContainerKeyword)(cleanTitle)) {
        return { action: 'IGNORE', reason: 'Blocked by V5 Sealed-Only Shield (Missing mandatory positive sealed container keyword).' };
    }
    for (const junkRegex of policies_1.GLOBAL_JUNK_EXCLUSIONS) {
        if (junkRegex.test(cleanTitle)) {
            return { action: 'IGNORE', reason: `Filtered out by global exclusion (${junkRegex})` };
        }
    }
    for (const rule of policies_1.WATCH_POLICIES) {
        const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
        if (!isMatched)
            continue;
        if (!(0, policies_1.hasMandatorySealedContainerKeyword)(cleanTitle, rule.formFactor)) {
            continue;
        }
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
        const maxMedianPlausible = rule.estimatedMarketValue > 0
            ? Math.min(maxCeiling, Math.round(rule.estimatedMarketValue * 1.35 * 100) / 100)
            : maxCeiling;
        const cachedSkuOffers = Object.values(storeOffersCacheMem[rule.id] || {})
            .map((o) => Number(o?.price || o?.landedPrice || 0))
            .filter((p) => Number.isFinite(p) && p >= minFloor && p <= maxMedianPlausible)
            .sort((a, b) => a - b);
        let liveStoreOfferMedian = null;
        if (cachedSkuOffers.length >= 2) {
            const lowSlice = cachedSkuOffers.slice(0, Math.min(5, cachedSkuOffers.length));
            const midIdx = Math.floor(lowSlice.length / 2);
            liveStoreOfferMedian = lowSlice.length % 2 === 1
                ? lowSlice[midIdx]
                : Math.round(((lowSlice[midIdx - 1] + lowSlice[midIdx]) / 2) * 100) / 100;
        }
        else {
            liveStoreOfferMedian = (0, trendAdvisor_1.getLiveStoreOfferMedian)(rule.id, minFloor, Date.now(), maxMedianPlausible);
        }
        const rawTelRoll = (liveTelPre && liveTelPre.rollingAverage > 0 && liveTelPre.rollingAverage !== 115 && liveTelPre.rollingAverage <= maxMedianPlausible)
            ? liveTelPre.rollingAverage
            : 0;
        const currentMarketRef = liveStoreOfferMedian !== null
            ? Math.min(maxCeiling, liveStoreOfferMedian)
            : (rawTelRoll > 0
                ? Math.min(maxCeiling, rawTelRoll)
                : Math.min(maxCeiling, rule.estimatedMarketValue || rule.msrpCeiling));
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
        // Rule of 3 Family Pack Instant-Cart Links for ALL Shopify LGS drops with a variantId
        const directCartLinks = buildShopifyDirectCartLinks({
            url: item.url,
            productUrl: item.productUrl,
            cart1xUrl: item.cart1xUrl,
            cart2xUrl: item.cart2xUrl,
            cart3xUrl: item.cart3xUrl,
            itemId: item.itemId,
            stock: item.stock,
            retailer: item.retailer
        });
        const cart1xUrl = directCartLinks.cart1xUrl;
        const cart2xUrl = directCartLinks.cart2xUrl;
        const cart3xUrl = directCartLinks.cart3xUrl;
        // Rule of 3 Family Completion state & 1P Big-Box / Pokemon Center Retail MSRP Flip Bypass
        const wallOwned = Boolean(rule.wallOwned ?? rule.inVault ?? rule.owned);
        const dadRipOwned = Boolean(rule.dadRipOwned);
        const loganRipOwned = Boolean(rule.loganRipOwned);
        const completionCount = (wallOwned ? 1 : 0) + (dadRipOwned ? 1 : 0) + (loganRipOwned ? 1 : 0);
        const fullyConquered = Boolean(wallOwned && dadRipOwned && loganRipOwned);
        const isRipHuntMode = Boolean((wallOwned || completionCount >= 1) && !fullyConquered);
        const isInVault = wallOwned;
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
        const is1PBigBoxOrPc = isVerified1PBigBoxOrPc(item.retailer, handleAndUrl, isMarketplace3P);
        const isRetailFlipBypass = Boolean(is1PBigBoxOrPc &&
            ((dropPrice <= Math.round(rule.msrpCeiling * 1.08 * 100) / 100 && currentMarketRef >= dropPrice * 1.30) || isPcExclusiveRetailDrop || isPcSource));
        if (isRetailFlipBypass && (fullyConquered || (wallOwned && muteVaulted))) {
            const gainPct = dropPrice > 0 ? Math.max(30, Math.round(((currentMarketRef - dropPrice) / dropPrice) * 100)) : 30;
            bigBoxBadge = `◈ ⟦ RETAIL MSRP FLIP / TRADE BAIT // $${dropPrice.toFixed(2)} RETAIL VS $${Math.round(currentMarketRef)} MARKET (+${gainPct}%) ⟧`;
            priorityFront = true;
        }
        const now = Date.now();
        const activeStoreCount = Object.keys(storeOffersCacheMem[rule.id] || {}).length;
        // V5 Slice 3.5 & Slice 6: Data-Driven Auto-Pilot, Rip Hunt Mode, & 30/60/90d Rolling Trend Evaluation
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
            owned: wallOwned,
            wallOwned,
            dadRipOwned,
            loganRipOwned,
            completionCount,
            fullyConquered,
            autoPilotEnabled: rule.autoPilotEnabled !== false,
            activeStoreCount,
            lowestShelfPrice: dropPrice,
            isCloseCall: false,
            isMarketplace3P,
            nowTs: now
        });
        const { trendSignal, trendVerdictLabel, isElasticDip, qualifiesForElasticDipAlert, isPreRelease, preReleaseStatusTag, effectiveTargetCeiling, ripHuntCeiling } = trendEval;
        if (effectiveTargetCeiling > 0 && !isPcExclusiveRetailDrop) {
            effectiveCeiling = effectiveTargetCeiling;
        }
        const shelfStatus = computeOfferShelfStatus({
            dropPrice,
            landedPrice,
            estimatedShipping,
            triggerPrice: effectiveCeiling,
            msrpCeiling: rule.msrpCeiling,
            marketValue: currentMarketRef,
            formFactor: rule.formFactor,
            owned: wallOwned,
            wallOwned,
            fullyConquered,
            completionCount,
            ripHuntCeiling,
            stock: item.stock,
            muteVaulted,
            isMsrpUnicorn,
            isRetailFlipBypass,
            isMarketplace3P
        });
        const { statusTier, isCloseCall, closeCallDelta, ripPairReady, ripPairBadge } = shelfStatus;
        const statusTag = ripPairBadge ? `${shelfStatus.statusTag} • ${ripPairBadge}` : shelfStatus.statusTag;
        if (ripPairBadge && !bigBoxBadge) {
            bigBoxBadge = ripPairBadge;
        }
        if (item.itemId && String(item.itemId).startsWith('tcg_')) {
            clearTcgOosStrikes(String(item.itemId));
        }
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
        // Vault & Rule of 3 suppression check:
        // - 3/3 COMPLETE (fullyConquered): Mutes standard LGS and 3rd-party alerts UNLESS it triggers 1P Big-Box/PC Retail Flip Bypass or MSRP Unicorn!
        // - 1/3 or 2/3 (Rip Hunt Mode): Stays active at ripHuntCeiling; only mutes if above ripHuntCeiling.
        if (fullyConquered && muteVaulted && !isRetailFlipBypass && !isMsrpUnicorn) {
            return {
                action: 'IGNORE',
                reason: `[${statusTag}] Suppressed by 3/3 Family Complete Mute (above 1P Retail Flip Bypass).`,
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
        if (wallOwned && !isRipHuntMode && muteVaulted && !isMsrpUnicorn && !isRetailFlipBypass) {
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
            bypassVaultMute: Boolean((isInVault || fullyConquered) && (isMsrpUnicorn || isRetailFlipBypass)),
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
