"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_SETTINGS_PATH = exports.LEGACY_POLICIES_PATH = exports.MARKET_CACHE_PATH = exports.STORES_PATH = exports.USER_PREFS_PATH = exports.CATALOG_PATH = exports.CONFIG_DIR = void 0;
exports.atomicWriteJson = atomicWriteJson;
exports.loadCatalog = loadCatalog;
exports.loadUserPreferences = loadUserPreferences;
exports.loadMarketCache = loadMarketCache;
exports.loadMergedPoliciesRaw = loadMergedPoliciesRaw;
exports.syncLegacyPoliciesFallback = syncLegacyPoliciesFallback;
exports.saveUserPoliciesFromUi = saveUserPoliciesFromUi;
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
exports.LEGACY_POLICIES_PATH = path_1.default.resolve(ROOT_DIR, 'policies.json');
exports.LEGACY_SETTINGS_PATH = path_1.default.resolve(ROOT_DIR, 'botSettings.json');
function atomicWriteJson(filePath, data) {
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
        const dir = path_1.default.dirname(filePath);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        fs_1.default.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs_1.default.renameSync(tmpPath, filePath);
    }
    catch (err) {
        try {
            if (fs_1.default.existsSync(tmpPath))
                fs_1.default.unlinkSync(tmpPath);
        }
        catch (e) { }
        try {
            const fallbackTmp = `${filePath}.tmp`;
            fs_1.default.writeFileSync(fallbackTmp, JSON.stringify(data, null, 2), 'utf-8');
            fs_1.default.renameSync(fallbackTmp, filePath);
        }
        catch (e) { }
    }
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
    catch (e) { }
    return [];
}
function loadUserPreferences() {
    try {
        if (fs_1.default.existsSync(exports.USER_PREFS_PATH)) {
            const parsed = JSON.parse(fs_1.default.readFileSync(exports.USER_PREFS_PATH, 'utf-8'));
            if (parsed && typeof parsed === 'object' && parsed.skus) {
                return parsed;
            }
        }
    }
    catch (e) { }
    const skus = {};
    try {
        if (fs_1.default.existsSync(exports.LEGACY_POLICIES_PATH)) {
            const legacy = JSON.parse(fs_1.default.readFileSync(exports.LEGACY_POLICIES_PATH, 'utf-8'));
            if (Array.isArray(legacy)) {
                for (const p of legacy) {
                    skus[p.id] = {
                        maxMarketBuyPrice: Number(p.maxMarketBuyPrice || p.msrpCeiling || 0),
                        owned: Boolean(p.owned || p.inVault),
                        inVault: Boolean(p.inVault ?? p.owned ?? false),
                        active: p.active !== false
                    };
                }
            }
        }
    }
    catch (e) { }
    let botSettings = {};
    try {
        if (fs_1.default.existsSync(exports.LEGACY_SETTINGS_PATH)) {
            botSettings = JSON.parse(fs_1.default.readFileSync(exports.LEGACY_SETTINGS_PATH, 'utf-8')) || {};
        }
    }
    catch (e) { }
    const muteVaulted = Boolean(botSettings.muteVaulted ?? true);
    const wallHunterMode = Boolean(botSettings.wallHunterMode ?? false);
    const liveDigestEnabled = Boolean(botSettings.liveDigestEnabled ?? false);
    return {
        schemaVersion: '5.0.0',
        updatedAt: new Date().toISOString(),
        muteVaulted,
        wallHunterMode,
        liveDigestEnabled,
        globalSettings: { muteVaulted, wallHunterMode, liveDigestEnabled },
        skus
    };
}
function loadMarketCache() {
    try {
        if (fs_1.default.existsSync(exports.MARKET_CACHE_PATH)) {
            return JSON.parse(fs_1.default.readFileSync(exports.MARKET_CACHE_PATH, 'utf-8')) || {};
        }
    }
    catch (e) { }
    return {};
}
function loadMergedPoliciesRaw() {
    const catalog = loadCatalog();
    const userPrefs = loadUserPreferences();
    const marketCache = loadMarketCache();
    return catalog.map((cat) => {
        const pref = userPrefs.skus?.[cat.id] || {};
        const mc = marketCache[cat.id] || {};
        const msrpCeiling = Number(cat.msrpCeiling || 0);
        const maxMarketBuyPrice = pref.maxMarketBuyPrice !== undefined
            ? Number(pref.maxMarketBuyPrice)
            : msrpCeiling;
        const owned = Boolean(pref.owned ?? pref.inVault ?? false);
        const inVault = Boolean(pref.inVault ?? pref.owned ?? false);
        const active = pref.active !== undefined ? Boolean(pref.active) : true;
        const estimatedMarketValue = Number((Number(mc.rollingAverage) > 0 ? Number(mc.rollingAverage) : 0) ||
            mc.estimatedMarketValue ||
            cat.defaultMarketBaseline ||
            msrpCeiling);
        const merged = {
            id: cat.id,
            name: cat.name,
            era: cat.era,
            formFactor: cat.formFactor,
            image: cat.image || '',
            matchers: Array.isArray(cat.matchers) ? cat.matchers : [],
            minStock: Number(cat.minStock ?? 1),
            msrpCeiling,
            maxMarketBuyPrice,
            estimatedMarketValue,
            priority: cat.priority || 'STANDARD',
            cooldownMins: Number(cat.cooldownMins ?? 30),
            active,
            owned,
            inVault,
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
        if (cat.pcSlug)
            merged.pcSlug = cat.pcSlug;
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
    catch (e) { }
    return merged;
}
/**
 * HARD LAW: ONLY explicit user actions from the dashboard UI (slider edits, Wall/Vault checkboxes,
 * bulk matrix calibrations, or trophy claims) may call this function to update config/userPreferences.json.
 */
function saveUserPoliciesFromUi(incomingPolicies) {
    if (!Array.isArray(incomingPolicies)) {
        throw new Error('Incoming policies payload must be an array.');
    }
    const prefs = loadUserPreferences();
    if (!prefs.skus)
        prefs.skus = {};
    for (const item of incomingPolicies) {
        if (!item || !item.id)
            continue;
        const existing = prefs.skus[item.id] || {
            maxMarketBuyPrice: Number(item.msrpCeiling || 0),
            owned: false,
            inVault: false,
            active: true
        };
        const ownedVal = item.owned !== undefined
            ? Boolean(item.owned)
            : (item.inVault !== undefined ? Boolean(item.inVault) : existing.owned);
        const inVaultVal = item.inVault !== undefined
            ? Boolean(item.inVault)
            : (item.owned !== undefined ? Boolean(item.owned) : existing.inVault);
        prefs.skus[item.id] = {
            maxMarketBuyPrice: item.maxMarketBuyPrice !== undefined
                ? Number(item.maxMarketBuyPrice)
                : existing.maxMarketBuyPrice,
            owned: ownedVal,
            inVault: inVaultVal,
            active: item.active !== undefined ? Boolean(item.active) : existing.active
        };
    }
    prefs.updatedAt = new Date().toISOString();
    atomicWriteJson(exports.USER_PREFS_PATH, prefs);
    return syncLegacyPoliciesFallback();
}
function markSkuOwnedFromUi(skuId, owned = true) {
    if (!skuId)
        return;
    const prefs = loadUserPreferences();
    if (!prefs.skus)
        prefs.skus = {};
    const existing = prefs.skus[skuId] || {
        maxMarketBuyPrice: 0,
        owned: false,
        inVault: false,
        active: true
    };
    prefs.skus[skuId] = {
        ...existing,
        owned: Boolean(owned),
        inVault: Boolean(owned)
    };
    prefs.updatedAt = new Date().toISOString();
    atomicWriteJson(exports.USER_PREFS_PATH, prefs);
    syncLegacyPoliciesFallback();
}
function loadGlobalSettings() {
    const prefs = loadUserPreferences();
    let legacySettings = {};
    try {
        if (fs_1.default.existsSync(exports.LEGACY_SETTINGS_PATH)) {
            legacySettings = JSON.parse(fs_1.default.readFileSync(exports.LEGACY_SETTINGS_PATH, 'utf-8')) || {};
        }
    }
    catch (e) { }
    const gs = prefs.globalSettings || {};
    return {
        ...legacySettings,
        muteVaulted: Boolean(prefs.muteVaulted ?? gs.muteVaulted ?? legacySettings.muteVaulted ?? true),
        wallHunterMode: Boolean(prefs.wallHunterMode ?? gs.wallHunterMode ?? legacySettings.wallHunterMode ?? false),
        liveDigestEnabled: Boolean(prefs.liveDigestEnabled ?? gs.liveDigestEnabled ?? legacySettings.liveDigestEnabled ?? false)
    };
}
function saveGlobalSettingsFromUi(patch) {
    const prefs = loadUserPreferences();
    const current = loadGlobalSettings();
    const next = {
        ...current,
        ...(patch || {})
    };
    prefs.muteVaulted = Boolean(next.muteVaulted);
    prefs.wallHunterMode = Boolean(next.wallHunterMode);
    prefs.liveDigestEnabled = Boolean(next.liveDigestEnabled);
    prefs.globalSettings = {
        muteVaulted: prefs.muteVaulted,
        wallHunterMode: prefs.wallHunterMode,
        liveDigestEnabled: prefs.liveDigestEnabled
    };
    prefs.updatedAt = new Date().toISOString();
    atomicWriteJson(exports.USER_PREFS_PATH, prefs);
    atomicWriteJson(exports.LEGACY_SETTINGS_PATH, next);
    return next;
}
/**
 * HARD LAW: Background MarketSync updates write ONLY to marketCache.json
 * (and refresh read-only legacy policies.json fallback). NEVER touches userPreferences.json!
 */
function saveMarketBaselineSync(syncedBaselines, updatedCache) {
    for (const [skuId, mktVal] of syncedBaselines.entries()) {
        if (!updatedCache[skuId]) {
            updatedCache[skuId] = {
                lowestPrice: mktVal,
                lowestStore: 'TCGPlayer SKU Baseline',
                lowestUrl: '',
                lastSeen: Date.now(),
                rollingAverage: mktVal,
                estimatedMarketValue: mktVal,
                lastUpdated: new Date().toISOString()
            };
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
            const parsed = JSON.parse(fs_1.default.readFileSync(exports.STORES_PATH, 'utf-8'));
            if (Array.isArray(parsed))
                return parsed;
        }
    }
    catch (e) { }
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
    const stores = loadStoresRegistry();
    const map = {};
    for (const st of stores) {
        if (!st || !st.name)
            continue;
        const profile = {
            freeShipThreshold: Number(st.freeShipThreshold ?? 150),
            flatShipping: Number(st.flatShipping ?? 6.99)
        };
        map[st.name.trim().toLowerCase()] = profile;
        if (Array.isArray(st.aliases)) {
            for (const alias of st.aliases) {
                if (alias)
                    map[String(alias).trim().toLowerCase()] = profile;
            }
        }
    }
    cachedShippingRulesMap = map;
    return map;
}
function getStoreShippingProfileFromRegistry(retailer) {
    const rules = loadShippingRulesMap();
    const key = (retailer || '').trim().toLowerCase();
    if (rules[key])
        return rules[key];
    for (const [k, profile] of Object.entries(rules)) {
        if (key.includes(k))
            return profile;
    }
    return { freeShipThreshold: 150, flatShipping: 6.99 };
}
function watchConfigFiles(onReload) {
    let debounceTimer = null;
    const trigger = () => {
        if (debounceTimer)
            clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            cachedShippingRulesMap = null;
            onReload();
        }, 150);
    };
    for (const filePath of [exports.USER_PREFS_PATH, exports.CATALOG_PATH, exports.LEGACY_POLICIES_PATH]) {
        if (fs_1.default.existsSync(filePath)) {
            try {
                fs_1.default.watch(filePath, () => trigger());
            }
            catch (e) { }
        }
    }
}
