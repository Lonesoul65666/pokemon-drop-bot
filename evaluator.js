"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STORE_SHIPPING_RULES = exports.PRE_RELEASE_BLEED_TAG = exports.MSRP_TROPHIES_PATH = void 0;
exports.getMsrpTrophies = getMsrpTrophies;
exports.recordMsrpTrophyCatch = recordMsrpTrophyCatch;
exports.isPreReleaseDate = isPreReleaseDate;
exports.getStoreShippingProfile = getStoreShippingProfile;
exports.upsertLiveStock = upsertLiveStock;
exports.markLiveStockOut = markLiveStockOut;
exports.evaluateItem = evaluateItem;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const policies_1 = require("./policies");
const marketTelemetry_1 = require("./marketTelemetry");
const marketTape_1 = require("./marketTape");
const ALERT_STATE_PATH = path_1.default.resolve(process.cwd(), 'alertState.json');
const LIVE_STOCK_PATH = path_1.default.resolve(process.cwd(), 'liveStock.json');
const SETTINGS_PATH = path_1.default.resolve(process.cwd(), 'botSettings.json');
exports.MSRP_TROPHIES_PATH = path_1.default.resolve(process.cwd(), 'data', 'msrpTrophies.json');
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
function isPreReleaseDate(releaseDate, nowTs = Date.now()) {
    if (!releaseDate)
        return false;
    const parsed = Date.parse(`${releaseDate}T00:00:00`);
    if (Number.isNaN(parsed))
        return false;
    return nowTs < parsed;
}
exports.PRE_RELEASE_BLEED_TAG = '⏳ PRE-RELEASE BLEED (Wait for Launch Week)';
exports.STORE_SHIPPING_RULES = {
    // Big Box Retailers
    'target': { freeShipThreshold: 35, flatShipping: 5.99 },
    'walmart': { freeShipThreshold: 35, flatShipping: 5.99 },
    'best buy': { freeShipThreshold: 35, flatShipping: 5.99 },
    'amazon': { freeShipThreshold: 35, flatShipping: 5.99 },
    'gamestop': { freeShipThreshold: 59, flatShipping: 6.99 },
    'costco': { freeShipThreshold: 0, flatShipping: 0 },
    "sam's club": { freeShipThreshold: 50, flatShipping: 4.99 },
    'sams club': { freeShipThreshold: 50, flatShipping: 4.99 },
    'barnes & noble': { freeShipThreshold: 40, flatShipping: 5.99 },
    'pokemon center': { freeShipThreshold: 20, flatShipping: 6.99 },
    // Existing 14 Verified USD Shopify LGS Stores
    'smoke & mirrors': { freeShipThreshold: 150, flatShipping: 6.99 },
    'safari zone': { freeShipThreshold: 150, flatShipping: 6.99 },
    'zulus games': { freeShipThreshold: 100, flatShipping: 5.99 },
    'gamers guild az': { freeShipThreshold: 99, flatShipping: 6.99 },
    'minmaxgames': { freeShipThreshold: 150, flatShipping: 6.99 },
    'card shop live': { freeShipThreshold: 150, flatShipping: 6.99 },
    'joshs cards': { freeShipThreshold: 150, flatShipping: 6.99 },
    'flipside gaming': { freeShipThreshold: 100, flatShipping: 5.99 },
    'over the brick': { freeShipThreshold: 150, flatShipping: 6.99 },
    'knight & day games': { freeShipThreshold: 150, flatShipping: 6.99 },
    'tcg stadium': { freeShipThreshold: 150, flatShipping: 6.99 },
    'rip n ship arena': { freeShipThreshold: 150, flatShipping: 6.99 },
    'collector store': { freeShipThreshold: 100, flatShipping: 6.99 },
    'prodigy games': { freeShipThreshold: 150, flatShipping: 6.99 },
    // Wave 1 Newly Onboarded Verified USD Shopify LGS Stores (17)
    'double infinity gaming': { freeShipThreshold: 150, flatShipping: 6.99 },
    'paladin cards': { freeShipThreshold: 150, flatShipping: 6.99 },
    'pkmn colosseum': { freeShipThreshold: 150, flatShipping: 6.99 },
    'mystic tcg': { freeShipThreshold: 150, flatShipping: 6.99 },
    'top cut central': { freeShipThreshold: 150, flatShipping: 6.99 },
    'poke-collect': { freeShipThreshold: 150, flatShipping: 6.99 },
    'allpoketcg': { freeShipThreshold: 150, flatShipping: 6.99 },
    'the pokecave': { freeShipThreshold: 150, flatShipping: 6.99 },
    'game grid lehi': { freeShipThreshold: 150, flatShipping: 6.99 },
    'card cavern': { freeShipThreshold: 100, flatShipping: 5.99 },
    'galactic toys': { freeShipThreshold: 125, flatShipping: 6.99 },
    '1st edition collectibles': { freeShipThreshold: 150, flatShipping: 6.99 },
    'trading card market': { freeShipThreshold: 150, flatShipping: 6.99 },
    'the gaming goat': { freeShipThreshold: 150, flatShipping: 6.99 },
    'stomping grounds': { freeShipThreshold: 150, flatShipping: 6.99 },
    'red raccoon games': { freeShipThreshold: 150, flatShipping: 6.99 },
    'tabletop village': { freeShipThreshold: 150, flatShipping: 6.99 },
    // Wave 2 Phase A Newly Onboarded Verified Shopify LGS Stores (5)
    'card n all gaming': { freeShipThreshold: 150, flatShipping: 6.99 },
    'the poke court': { freeShipThreshold: 150, flatShipping: 6.99 },
    'awesome ccg': { freeShipThreshold: 150, flatShipping: 6.99 },
    'tanuki games': { freeShipThreshold: 100, flatShipping: 6.99 },
    'hobbiesville': { freeShipThreshold: 175, flatShipping: 9.99 }
};
function getStoreShippingProfile(retailer) {
    const key = (retailer || '').trim().toLowerCase();
    if (exports.STORE_SHIPPING_RULES[key])
        return exports.STORE_SHIPPING_RULES[key];
    for (const [k, profile] of Object.entries(exports.STORE_SHIPPING_RULES)) {
        if (key.includes(k))
            return profile;
    }
    return { freeShipThreshold: 150, flatShipping: 6.99 };
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
        (0, marketTape_1.recordTapeSoldOut)(String(itemId));
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
        const minFloor = (0, policies_1.getMinPlausiblePriceFloor)(rule.formFactor);
        const maxCeiling = (0, policies_1.getMaxPlausiblePriceCeiling)(rule.formFactor, rule.id, rule.name);
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
        // Only record into standard SKU telemetry/snapshots if it is NOT a PC Exclusive variant
        if (!hasPcTerm && !isPcSource && item.price && item.price >= minFloor && item.price <= maxCeiling) {
            (0, marketTelemetry_1.recordObservation)(rule.id, item.price, item.retailer, item.productUrl || item.url, rule.msrpCeiling);
            (0, marketTape_1.recordDailySnapshot)(rule.id, item.price, item.retailer, currentMarketRef);
        }
        if (rule.active === false) {
            return { action: 'IGNORE', reason: `Rule "${rule.name}" is toggled OFF on dashboard.`, rule };
        }
        if (item.stock !== undefined && item.stock < rule.minStock) {
            return { action: 'IGNORE', reason: `Stock (${item.stock}) below minStock (${rule.minStock}).`, rule };
        }
        const policyMaxBuy = Math.max(rule.msrpCeiling, rule.maxMarketBuyPrice);
        // Pre-order strict ceiling: Math.min(policy.maxBuy, Math.round(policy.msrp * 1.05)), except PC Exclusive retail drops up to $69.99
        let effectiveCeiling = isPreOrder
            ? Math.min(policyMaxBuy, Math.round(rule.msrpCeiling * 1.05))
            : policyMaxBuy;
        if (isPcExclusiveRetailDrop) {
            effectiveCeiling = Math.max(effectiveCeiling, 69.99);
        }
        const dropPrice = item.price ?? effectiveCeiling;
        const shipProfile = getStoreShippingProfile(item.retailer);
        let bigBoxTier = undefined;
        let bigBoxBadge = undefined;
        let marketplaceWarning = undefined;
        let priorityFront = false;
        const isBigBoxMsrp = Boolean(bigBoxName && dropPrice <= rule.msrpCeiling * 1.08);
        // Tier A (True Retail MSRP) and PC Exclusive Retail Drops force $0 shipping on Big Box
        const isFreeShip = Boolean(isPcExclusiveRetailDrop ||
            isBigBoxMsrp ||
            item.freeShipping ||
            dropPrice >= shipProfile.freeShipThreshold);
        const estimatedShipping = isFreeShip ? 0 : shipProfile.flatShipping;
        const landedPrice = Math.round((dropPrice + estimatedShipping) * 100) / 100;
        // Tier-A True Retail MSRP: landed price <= MSRP * 1.08 with free/nominal shipping (<= $6.99)
        const isTierAMsrp = Boolean(rule.msrpCeiling > 0 &&
            landedPrice <= Math.round(rule.msrpCeiling * 1.08 * 100) / 100 &&
            estimatedShipping <= 6.99);
        if (isPcExclusiveRetailDrop) {
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
        // Pre-Release Bleed Tagging
        const isPreRelease = isPreReleaseDate(rule.releaseDate);
        const preReleaseStatusTag = isPreRelease ? exports.PRE_RELEASE_BLEED_TAG : undefined;
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
        // Check Vault suppression (inVault / owned + muteVaulted setting), with MSRP Tier-A Defcon-1 Override!
        const isInVault = Boolean(rule.inVault ?? rule.owned);
        const isMsrpUnicorn = Boolean(isTierAMsrp || isPcExclusiveRetailDrop);
        let muteVaulted = false;
        try {
            if (fs_1.default.existsSync(SETTINGS_PATH)) {
                const settings = JSON.parse(fs_1.default.readFileSync(SETTINGS_PATH, 'utf-8'));
                muteVaulted = Boolean(settings?.muteVaulted);
            }
        }
        catch (e) { }
        const { packCount, pricePerPack, isRipValueLeader } = (0, policies_1.computeRipMetrics)(landedPrice, rule.id, rule.formFactor, `${rule.name} ${cleanTitle}`, rule.packCount);
        let freeShipNote = undefined;
        if (dropPrice > effectiveCeiling) {
            return {
                action: 'IGNORE',
                reason: `${isPreOrder ? '[PRE-ORDER] ' : ''}${isPreRelease ? `[${exports.PRE_RELEASE_BLEED_TAG}] ` : ''}Price ($${dropPrice.toFixed(2)}) exceeds allowable buy threshold ($${effectiveCeiling.toFixed(2)}).`,
                rule,
                packCount,
                pricePerPack,
                isRipValueLeader,
                isPreRelease,
                preReleaseStatusTag,
                releaseDate: rule.releaseDate
            };
        }
        if (landedPrice > effectiveCeiling) {
            const qtyForFreeShip = Math.ceil(shipProfile.freeShipThreshold / dropPrice);
            const hasEnoughStock = item.stock === undefined || item.stock >= qtyForFreeShip;
            if (qtyForFreeShip <= 4 && hasEnoughStock) {
                freeShipNote = `Buy ${qtyForFreeShip}x to hit $${shipProfile.freeShipThreshold} Free Shipping -> $${dropPrice.toFixed(2)}/ea landed`;
            }
            else {
                return {
                    action: 'IGNORE',
                    reason: `Landed price ($${landedPrice.toFixed(2)} w/ $${estimatedShipping.toFixed(2)} ship) exceeds buy threshold ($${effectiveCeiling.toFixed(2)}) and qtyForFreeShip (${qtyForFreeShip}x) > 4.`,
                    rule,
                    packCount,
                    pricePerPack,
                    isRipValueLeader,
                    isPreRelease,
                    preReleaseStatusTag,
                    releaseDate: rule.releaseDate
                };
            }
        }
        const now = Date.now();
        const currentPrice = dropPrice;
        const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        (0, marketTape_1.recordTapeRestock)({
            itemId: String(item.itemId || `${rule.id}__${item.retailer}`),
            targetId: rule.id,
            targetName: rule.name,
            store: item.retailer,
            price: currentPrice,
            landedPrice,
            marketPrice: currentMarketRef,
            url: item.productUrl || item.url,
            bigBoxTier,
            bigBoxBadge
        });
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
                reason: `Suppressed by Vault Mute (inVault=true and above MSRP Tier-A ceiling).`,
                rule,
                packCount,
                pricePerPack,
                isRipValueLeader,
                isPreRelease,
                preReleaseStatusTag,
                releaseDate: rule.releaseDate
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
                    rule,
                    packCount,
                    pricePerPack,
                    isRipValueLeader,
                    isPreRelease,
                    preReleaseStatusTag,
                    releaseDate: rule.releaseDate
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
        // Record persistent Trophy Catch if Tier-A True Retail MSRP hit!
        if (isMsrpUnicorn) {
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
            reason: `[${alertType}]${bigBoxBadge ? ` [${bigBoxBadge}]` : ''}${isPreRelease ? ` [${exports.PRE_RELEASE_BLEED_TAG}]` : ''}${isPreOrder ? ' [⏳ PRE-ORDER]' : ''} Matched "${rule.name}" at $${currentPrice.toFixed(2)} (Landed: $${landedPrice.toFixed(2)} • $${pricePerPack.toFixed(2)}/pk • ${discountPct}% under market)`,
            rule,
            discountPct,
            savingsDollars,
            alertType,
            previousPrice,
            previousTimeStr,
            landedPrice,
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
            priorityFront
        };
    }
    return { action: 'IGNORE', reason: 'No matching policy rule found.' };
}
