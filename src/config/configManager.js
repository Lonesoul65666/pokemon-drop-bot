"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_SETTINGS_PATH = exports.LEGACY_POLICIES_PATH = exports.SALES_HISTORY_PATH = exports.STORE_OFFERS_CACHE_PATH = exports.MARKET_CACHE_PATH = exports.STORES_PATH = exports.USER_PREFS_PATH = exports.CATALOG_PATH = exports.CONFIG_DIR = void 0;
exports.atomicWriteJson = atomicWriteJson;
exports.normalizeSkuPref = normalizeSkuPref;
exports.loadCatalog = loadCatalog;
exports.loadUserPreferences = loadUserPreferences;
exports.loadMarketCache = loadMarketCache;
exports.computeLiveStoreOfferMedian = computeLiveStoreOfferMedian;
exports.loadMergedPoliciesRaw = loadMergedPoliciesRaw;
exports.syncLegacyPoliciesFallback = syncLegacyPoliciesFallback;
exports.saveUserPoliciesFromUi = saveUserPoliciesFromUi;
exports.updateSkuFamilySlotsFromUi = updateSkuFamilySlotsFromUi;
exports.markSkuOwnedFromUi = markSkuOwnedFromUi;
exports.loadGlobalSettings = loadGlobalSettings;
exports.saveGlobalSettingsFromUi = saveGlobalSettingsFromUi;
exports.saveMarketBaselineSync = saveMarketBaselineSync;
exports.loadStoresRegistry = loadStoresRegistry;
exports.loadActiveLgsStores = loadActiveLgsStores;
exports.loadTier1FastLgsStores = loadTier1FastLgsStores;
exports.loadShippingRulesMap = loadShippingRulesMap;
exports.getStoreShippingProfileFromRegistry = getStoreShippingProfileFromRegistry;
exports.watchConfigFiles = watchConfigFiles;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ROOT_DIR = process.cwd();
exports.CONFIG_DIR = path_1.default.resolve(ROOT_DIR, 'config');
exports.CATALOG_PATH = path_1.default.resolve(exports.CONFIG_DIR, 'catalog.json');
exports.USER_PREFS_PATH = path_1.default.resolve(exports.CONFIG_DIR, 'userPreferences.json');
exports.STORES_PATH = path_1.default.resolve(exports.CONFIG_DIR, 'stores.json');
exports.MARKET_CACHE_PATH = path_1.default.resolve(ROOT_DIR, 'marketCache.json');
exports.STORE_OFFERS_CACHE_PATH = path_1.default.resolve(ROOT_DIR, 'storeOffersCache.json');
exports.SALES_HISTORY_PATH = path_1.default.resolve(ROOT_DIR, 'salesHistory.json');
exports.LEGACY_POLICIES_PATH = path_1.default.resolve(ROOT_DIR, 'policies.json');
exports.LEGACY_SETTINGS_PATH = path_1.default.resolve(ROOT_DIR, 'botSettings.json');
function atomicWriteJson(filePath, data) {
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
        const dir = path_1.default.dirname(filePath);
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        fs_1.default.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs_1.default.renameSync(tmpPath, filePath);
    }
    catch {
        try {
            if (fs_1.default.existsSync(tmpPath))
                fs_1.default.unlinkSync(tmpPath);
        }
        catch { }
        try {
            const fallbackTmp = `${filePath}.tmp`;
            fs_1.default.writeFileSync(fallbackTmp, JSON.stringify(data, null, 2), 'utf-8');
            fs_1.default.renameSync(fallbackTmp, filePath);
        }
        catch { }
    }
}
function normalizeSkuPref(raw, fallbackMsrp = 0) {
    const p = raw || {};
    const wallOwned = Boolean(p.wallOwned ?? p.owned ?? p.inVault ?? false);
    return {
        maxMarketBuyPrice: p.maxMarketBuyPrice !== undefined ? Number(p.maxMarketBuyPrice) : Number(fallbackMsrp || 0),
        owned: wallOwned, inVault: wallOwned, wallOwned,
        dadRipOwned: Boolean(p.dadRipOwned ?? false),
        loganRipOwned: Boolean(p.loganRipOwned ?? false),
        autoPilotEnabled: p.autoPilotEnabled !== undefined ? Boolean(p.autoPilotEnabled) : true,
        active: p.active !== undefined ? Boolean(p.active) : true
    };
}
function loadCatalog() {
    try {
        if (fs_1.default.existsSync(exports.CATALOG_PATH)) {
            const parsed = JSON.parse(fs_1.default.readFileSync(exports.CATALOG_PATH, 'utf-8'));
            if (Array.isArray(parsed) && parsed.length > 0)
                return parsed;
        }
        if (fs_1.default.existsSync(exports.LEGACY_POLICIES_PATH)) {
            const legacy = JSON.parse(fs_1.default.readFileSync(exports.LEGACY_POLICIES_PATH, 'utf-8'));
            if (Array.isArray(legacy))
                return legacy;
        }
    }
    catch { }
    return [];
}
function loadUserPreferences() {
    try {
        if (fs_1.default.existsSync(exports.USER_PREFS_PATH)) {
            const parsed = JSON.parse(fs_1.default.readFileSync(exports.USER_PREFS_PATH, 'utf-8'));
            if (parsed && typeof parsed === 'object' && parsed.skus) {
                const gs = parsed.globalSettings || {};
                const favs = Array.isArray(parsed.favoritePokemonWatchlist) ? parsed.favoritePokemonWatchlist : (Array.isArray(gs.favoritePokemonWatchlist) ? gs.favoritePokemonWatchlist : ['Gyarados']);
                const normalizedSkus = {};
                for (const [k, v] of Object.entries(parsed.skus))
                    normalizedSkus[k] = normalizeSkuPref(v);
                return {
                    ...parsed,
                    liveDigestEnabled: Boolean(parsed.liveDigestEnabled ?? gs.liveDigestEnabled ?? true),
                    singlesAlertsEnabled: false,
                    favoritePokemonWatchlist: favs,
                    minSinglesTrackPrice: Number(parsed.minSinglesTrackPrice ?? gs.minSinglesTrackPrice ?? 15),
                    skus: normalizedSkus
                };
            }
        }
    }
    catch { }
    return {
        schemaVersion: '5.7.0', updatedAt: new Date().toISOString(),
        muteVaulted: true, wallHunterMode: false, liveDigestEnabled: true, singlesAlertsEnabled: false,
        favoritePokemonWatchlist: ['Gyarados'], minSinglesTrackPrice: 15,
        globalSettings: { muteVaulted: true, wallHunterMode: false, liveDigestEnabled: true, singlesAlertsEnabled: false, favoritePokemonWatchlist: ['Gyarados'], minSinglesTrackPrice: 15 },
        skus: {}
    };
}
function loadMarketCache() {
    try {
        if (fs_1.default.existsSync(exports.MARKET_CACHE_PATH))
            return JSON.parse(fs_1.default.readFileSync(exports.MARKET_CACHE_PATH, 'utf-8')) || {};
    }
    catch { }
    return {};
}
function computeLiveStoreOfferMedian(skuId, minPlausible = 18, socCache, salesArr, maxPlausible = 99999) {
    try {
        const soc = socCache || (fs_1.default.existsSync(exports.STORE_OFFERS_CACHE_PATH) ? JSON.parse(fs_1.default.readFileSync(exports.STORE_OFFERS_CACHE_PATH, 'utf-8')) : {});
        const offersMap = soc?.[skuId] || {};
        let prices = Object.values(offersMap).map((o) => Number(o?.price || o?.dropPrice || o?.landedPrice || 0)).filter((p) => Number.isFinite(p) && p >= minPlausible && p <= maxPlausible).sort((a, b) => a - b);
        if (prices.length < 2) {
            const sales = salesArr || (fs_1.default.existsSync(exports.SALES_HISTORY_PATH) ? JSON.parse(fs_1.default.readFileSync(exports.SALES_HISTORY_PATH, 'utf-8')) : []);
            if (Array.isArray(sales)) {
                const recent = sales.filter((s) => s && s.targetId === skuId).map((s) => Number(s.price || s.landedPrice || 0)).filter((p) => Number.isFinite(p) && p >= minPlausible && p <= maxPlausible);
                prices = [...prices, ...recent].sort((a, b) => a - b);
            }
        }
        if (prices.length < 2)
            return null;
        const lowestSlice = prices.slice(0, Math.min(5, prices.length));
        const mid = Math.floor(lowestSlice.length / 2);
        const median = lowestSlice.length % 2 === 1 ? lowestSlice[mid] : (lowestSlice[mid - 1] + lowestSlice[mid]) / 2;
        return Math.round(median * 100) / 100;
    }
    catch {
        return null;
    }
}
function loadMergedPoliciesRaw() {
    const catalog = loadCatalog();
    const userPrefs = loadUserPreferences();
    const marketCache = loadMarketCache();
    let socCache = {};
    let salesArr = [];
    try {
        if (fs_1.default.existsSync(exports.STORE_OFFERS_CACHE_PATH))
            socCache = JSON.parse(fs_1.default.readFileSync(exports.STORE_OFFERS_CACHE_PATH, 'utf-8')) || {};
    }
    catch { }
    try {
        if (fs_1.default.existsSync(exports.SALES_HISTORY_PATH))
            salesArr = JSON.parse(fs_1.default.readFileSync(exports.SALES_HISTORY_PATH, 'utf-8')) || [];
    }
    catch { }
    return catalog.map((cat) => {
        const msrpCeiling = Number(cat.msrpCeiling || 0);
        const pref = normalizeSkuPref(userPrefs.skus?.[cat.id], msrpCeiling);
        const mc = marketCache[cat.id] || {};
        const completionCount = (pref.wallOwned ? 1 : 0) + (pref.dadRipOwned ? 1 : 0) + (pref.loganRipOwned ? 1 : 0);
        const fullyConquered = Boolean(pref.wallOwned && pref.dadRipOwned && pref.loganRipOwned);
        const catBase = Number(cat.defaultMarketBaseline || msrpCeiling);
        const maxPlausible = catBase > 0 ? Math.round(catBase * 1.35 * 100) / 100 : 99999;
        const liveMedian = computeLiveStoreOfferMedian(cat.id, Math.max(18, msrpCeiling * 0.45), socCache, salesArr, maxPlausible);
        const rawMcVal = Number((Number(mc.rollingAverage) > 0 ? Number(mc.rollingAverage) : 0) || mc.estimatedMarketValue || 0);
        const isStale115Placeholder = (rawMcVal === 115 || rawMcVal === 1150 || rawMcVal > maxPlausible) && catBase !== 115 && catBase !== 1150;
        const estimatedMarketValue = liveMedian !== null ? liveMedian : (rawMcVal > 0 && !isStale115Placeholder ? rawMcVal : catBase);
        const merged = {
            id: cat.id, name: cat.name, era: cat.era, formFactor: cat.formFactor, image: cat.image || '',
            matchers: Array.isArray(cat.matchers) ? cat.matchers : [], minStock: Number(cat.minStock ?? 1),
            msrpCeiling, maxMarketBuyPrice: pref.maxMarketBuyPrice || msrpCeiling, estimatedMarketValue,
            priority: cat.priority || 'STANDARD', cooldownMins: Number(cat.cooldownMins ?? 30),
            active: pref.active, owned: pref.wallOwned, inVault: pref.wallOwned,
            wallOwned: pref.wallOwned, dadRipOwned: pref.dadRipOwned, loganRipOwned: pref.loganRipOwned,
            completionCount, fullyConquered, autoPilotEnabled: pref.autoPilotEnabled !== false,
            packCount: Number(cat.packCount || 36)
        };
        if (cat.releaseDate)
            merged.releaseDate = cat.releaseDate;
        if (cat.targetTcin)
            merged.targetTcin = cat.targetTcin;
        if (cat.walmartItemId)
            merged.walmartItemId = cat.walmartItemId;
        if (cat.bestBuySku)
            merged.bestBuySku = cat.bestBuySku;
        if (cat.amazonAsin)
            merged.amazonAsin = cat.amazonAsin;
        if (cat.pcSlug)
            merged.pcSlug = cat.pcSlug;
        if (cat.barnesNobleEan)
            merged.barnesNobleEan = cat.barnesNobleEan;
        if (cat.retailSearchQuery)
            merged.retailSearchQuery = cat.retailSearchQuery;
        if (cat.tcgProductId)
            merged.tcgProductId = cat.tcgProductId;
        return merged;
    });
}
function syncLegacyPoliciesFallback() {
    const merged = loadMergedPoliciesRaw();
    try {
        atomicWriteJson(exports.LEGACY_POLICIES_PATH, merged);
    }
    catch { }
    return merged;
}
function saveUserPoliciesFromUi(incomingPolicies) {
    if (!Array.isArray(incomingPolicies))
        throw new Error('Incoming policies payload must be an array.');
    const prefs = loadUserPreferences();
    if (!prefs.skus)
        prefs.skus = {};
    for (const item of incomingPolicies) {
        if (!item || !item.id)
            continue;
        const existing = normalizeSkuPref(prefs.skus[item.id], Number(item.msrpCeiling || 0));
        const wallOwned = item.wallOwned !== undefined ? Boolean(item.wallOwned) : (item.owned !== undefined ? Boolean(item.owned) : (item.inVault !== undefined ? Boolean(item.inVault) : existing.wallOwned));
        const dadRipOwned = item.dadRipOwned !== undefined ? Boolean(item.dadRipOwned) : existing.dadRipOwned;
        const loganRipOwned = item.loganRipOwned !== undefined ? Boolean(item.loganRipOwned) : existing.loganRipOwned;
        const newPrice = item.maxMarketBuyPrice !== undefined ? Number(item.maxMarketBuyPrice) : existing.maxMarketBuyPrice;
        const priceChangedManually = item.maxMarketBuyPrice !== undefined && Math.abs(newPrice - existing.maxMarketBuyPrice) >= 0.5;
        const autoPilotEnabled = item.autoPilotEnabled !== undefined ? Boolean(item.autoPilotEnabled) : (priceChangedManually ? false : existing.autoPilotEnabled);
        prefs.skus[item.id] = {
            maxMarketBuyPrice: newPrice, owned: wallOwned, inVault: wallOwned, wallOwned, dadRipOwned, loganRipOwned, autoPilotEnabled,
            active: item.active !== undefined ? Boolean(item.active) : existing.active
        };
    }
    prefs.updatedAt = new Date().toISOString();
    atomicWriteJson(exports.USER_PREFS_PATH, prefs);
    return syncLegacyPoliciesFallback();
}
function updateSkuFamilySlotsFromUi(skuId, patch) {
    if (!skuId)
        throw new Error('Missing skuId');
    const prefs = loadUserPreferences();
    if (!prefs.skus)
        prefs.skus = {};
    const existing = normalizeSkuPref(prefs.skus[skuId]);
    let wallOwned = patch.wallOwned !== undefined ? Boolean(patch.wallOwned) : existing.wallOwned;
    let dadRipOwned = patch.dadRipOwned !== undefined ? Boolean(patch.dadRipOwned) : existing.dadRipOwned;
    let loganRipOwned = patch.loganRipOwned !== undefined ? Boolean(patch.loganRipOwned) : existing.loganRipOwned;
    if (patch.toggleAll !== undefined) {
        const targetState = Boolean(patch.toggleAll);
        wallOwned = targetState;
        dadRipOwned = targetState;
        loganRipOwned = targetState;
    }
    prefs.skus[skuId] = {
        ...existing,
        maxMarketBuyPrice: patch.maxMarketBuyPrice !== undefined ? Number(patch.maxMarketBuyPrice) : existing.maxMarketBuyPrice,
        owned: wallOwned, inVault: wallOwned, wallOwned, dadRipOwned, loganRipOwned,
        autoPilotEnabled: patch.autoPilotEnabled !== undefined ? Boolean(patch.autoPilotEnabled) : existing.autoPilotEnabled
    };
    prefs.updatedAt = new Date().toISOString();
    atomicWriteJson(exports.USER_PREFS_PATH, prefs);
    const all = syncLegacyPoliciesFallback();
    return all.find((p) => p.id === skuId) || prefs.skus[skuId];
}
function markSkuOwnedFromUi(skuId, owned = true) {
    if (skuId)
        updateSkuFamilySlotsFromUi(skuId, { wallOwned: Boolean(owned) });
}
function loadGlobalSettings() {
    const prefs = loadUserPreferences();
    const gs = prefs.globalSettings || {};
    const favs = Array.isArray(prefs.favoritePokemonWatchlist) ? prefs.favoritePokemonWatchlist : (Array.isArray(gs.favoritePokemonWatchlist) ? gs.favoritePokemonWatchlist : ['Gyarados']);
    return {
        muteVaulted: Boolean(prefs.muteVaulted ?? gs.muteVaulted ?? true),
        wallHunterMode: Boolean(prefs.wallHunterMode ?? gs.wallHunterMode ?? false),
        liveDigestEnabled: Boolean(prefs.liveDigestEnabled ?? gs.liveDigestEnabled ?? true),
        singlesAlertsEnabled: false, favoritePokemonWatchlist: favs,
        minSinglesTrackPrice: Number(prefs.minSinglesTrackPrice ?? gs.minSinglesTrackPrice ?? 15)
    };
}
function saveGlobalSettingsFromUi(patch) {
    const prefs = loadUserPreferences();
    const current = loadGlobalSettings();
    const next = { ...current, ...(patch || {}), singlesAlertsEnabled: false };
    prefs.muteVaulted = Boolean(next.muteVaulted);
    prefs.wallHunterMode = Boolean(next.wallHunterMode);
    prefs.liveDigestEnabled = Boolean(next.liveDigestEnabled);
    prefs.singlesAlertsEnabled = false;
    prefs.favoritePokemonWatchlist = Array.isArray(next.favoritePokemonWatchlist) ? next.favoritePokemonWatchlist : ['Gyarados'];
    prefs.minSinglesTrackPrice = Number(next.minSinglesTrackPrice ?? 15);
    prefs.globalSettings = {
        muteVaulted: prefs.muteVaulted, wallHunterMode: prefs.wallHunterMode, liveDigestEnabled: prefs.liveDigestEnabled,
        singlesAlertsEnabled: false, favoritePokemonWatchlist: prefs.favoritePokemonWatchlist, minSinglesTrackPrice: prefs.minSinglesTrackPrice
    };
    prefs.updatedAt = new Date().toISOString();
    atomicWriteJson(exports.USER_PREFS_PATH, prefs);
    atomicWriteJson(exports.LEGACY_SETTINGS_PATH, next);
    return next;
}
function saveMarketBaselineSync(syncedBaselines, updatedCache) {
    for (const [skuId, mktVal] of syncedBaselines.entries()) {
        if (!updatedCache[skuId]) {
            updatedCache[skuId] = { lowestPrice: mktVal, lowestStore: 'TCGPlayer SKU Baseline', lowestUrl: '', lastSeen: Date.now(), rollingAverage: mktVal, estimatedMarketValue: mktVal, lastUpdated: new Date().toISOString() };
        }
        else {
            updatedCache[skuId].estimatedMarketValue = mktVal;
            updatedCache[skuId].rollingAverage = mktVal;
        }
    }
    atomicWriteJson(exports.MARKET_CACHE_PATH, updatedCache);
    syncLegacyPoliciesFallback();
}
function loadStoresRegistry() {
    try {
        if (fs_1.default.existsSync(exports.STORES_PATH)) {
            const p = JSON.parse(fs_1.default.readFileSync(exports.STORES_PATH, 'utf-8'));
            if (Array.isArray(p))
                return p;
        }
    }
    catch { }
    return [];
}
function loadActiveLgsStores() {
    return loadStoresRegistry().filter((s) => s && s.storeType !== 'BIG_BOX' && s.enabled !== false && Boolean(s.baseUrl));
}
function loadTier1FastLgsStores() {
    return loadActiveLgsStores().filter((s) => s.tier === 'TIER1_FAST');
}
let cachedShippingRulesMap = null;
function loadShippingRulesMap(forceReload = false) {
    if (cachedShippingRulesMap && !forceReload)
        return cachedShippingRulesMap;
    const map = {};
    for (const st of loadStoresRegistry()) {
        if (!st || !st.name)
            continue;
        const profile = { freeShipThreshold: Number(st.freeShipThreshold ?? 150), flatShipping: Number(st.flatShipping ?? 6.99) };
        map[st.name.trim().toLowerCase()] = profile;
        if (Array.isArray(st.aliases))
            for (const alias of st.aliases)
                if (alias)
                    map[String(alias).trim().toLowerCase()] = profile;
    }
    cachedShippingRulesMap = map;
    return map;
}
function getStoreShippingProfileFromRegistry(retailer) {
    const rules = loadShippingRulesMap();
    const key = (retailer || '').trim().toLowerCase();
    if (rules[key])
        return rules[key];
    for (const [k, profile] of Object.entries(rules))
        if (key.includes(k))
            return profile;
    return { freeShipThreshold: 150, flatShipping: 6.99 };
}
function watchConfigFiles(onReload) {
    let debounceTimer = null;
    const trigger = () => {
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => { debounceTimer = null; cachedShippingRulesMap = null; onReload(); }, 150);
    };
    for (const filePath of [exports.USER_PREFS_PATH, exports.CATALOG_PATH, exports.LEGACY_POLICIES_PATH]) {
        if (fs_1.default.existsSync(filePath)) {
            try {
                fs_1.default.watch(filePath, () => trigger());
            }
            catch { }
        }
    }
}
