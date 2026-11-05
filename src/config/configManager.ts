import fs from 'fs';
import path from 'path';

export interface SkuUserPreference {
  maxMarketBuyPrice: number;
  owned: boolean;
  inVault: boolean;
  active: boolean;
}

export interface GlobalUserSettings {
  muteVaulted: boolean;
  wallHunterMode: boolean;
  liveDigestEnabled: boolean;
  lastDigestSentAt?: number;
  lastDigestHash?: string;
}

export interface UserPreferencesFile {
  schemaVersion: string;
  updatedAt: string;
  muteVaulted: boolean;
  wallHunterMode: boolean;
  liveDigestEnabled: boolean;
  globalSettings: GlobalUserSettings;
  skus: Record<string, SkuUserPreference>;
}

export interface CatalogSkuDefinition {
  id: string;
  name: string;
  era: string;
  formFactor: string;
  packCount: number;
  msrpCeiling: number;
  releaseDate?: string | null;
  matchers: string[];
  image?: string;
  minStock: number;
  priority: 'GRAIL' | 'BULK_DEAL' | 'STANDARD';
  cooldownMins: number;
  defaultMarketBaseline?: number;
  targetTcin?: string | null;
  walmartItemId?: string | null;
  bestBuySku?: string | null;
  pcSlug?: string | null;
  tcgProductId?: string | number | null;
}

export interface StoreRegistryEntry {
  id: string;
  name: string;
  aliases?: string[];
  storeType: 'SHOPIFY_LGS' | 'BIG_BOX';
  baseUrl: string;
  resolvedPath?: string;
  additionalPaths?: string[];
  flatShipping: number;
  freeShipThreshold: number;
  currency?: 'USD' | 'CAD';
  tier: 'TIER1_FAST' | 'TIER2_STANDARD';
  enabled: boolean;
}

export interface StoreShippingProfile {
  freeShipThreshold: number;
  flatShipping: number;
}

const ROOT_DIR = process.cwd();
export const CONFIG_DIR = path.resolve(ROOT_DIR, 'config');
export const CATALOG_PATH = path.resolve(CONFIG_DIR, 'catalog.json');
export const USER_PREFS_PATH = path.resolve(CONFIG_DIR, 'userPreferences.json');
export const STORES_PATH = path.resolve(CONFIG_DIR, 'stores.json');
export const MARKET_CACHE_PATH = path.resolve(ROOT_DIR, 'marketCache.json');
export const LEGACY_POLICIES_PATH = path.resolve(ROOT_DIR, 'policies.json');
export const LEGACY_SETTINGS_PATH = path.resolve(ROOT_DIR, 'botSettings.json');

export function atomicWriteJson(filePath: string, data: any): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (e) {}
    try {
      const fallbackTmp = `${filePath}.tmp`;
      fs.writeFileSync(fallbackTmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(fallbackTmp, filePath);
    } catch (e) {}
  }
}

export function loadCatalog(): CatalogSkuDefinition[] {
  try {
    if (fs.existsSync(CATALOG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
    if (fs.existsSync(LEGACY_POLICIES_PATH)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_POLICIES_PATH, 'utf-8'));
      if (Array.isArray(legacy)) return legacy;
    }
  } catch (e) {}
  return [];
}

export function loadUserPreferences(): UserPreferencesFile {
  try {
    if (fs.existsSync(USER_PREFS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(USER_PREFS_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object' && parsed.skus) {
        return parsed;
      }
    }
  } catch (e) {}

  const skus: Record<string, SkuUserPreference> = {};
  try {
    if (fs.existsSync(LEGACY_POLICIES_PATH)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_POLICIES_PATH, 'utf-8'));
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
  } catch (e) {}

  let botSettings: any = {};
  try {
    if (fs.existsSync(LEGACY_SETTINGS_PATH)) {
      botSettings = JSON.parse(fs.readFileSync(LEGACY_SETTINGS_PATH, 'utf-8')) || {};
    }
  } catch (e) {}

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

export function loadMarketCache(): Record<string, any> {
  try {
    if (fs.existsSync(MARKET_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(MARKET_CACHE_PATH, 'utf-8')) || {};
    }
  } catch (e) {}
  return {};
}

export function loadMergedPoliciesRaw(): any[] {
  const catalog = loadCatalog();
  const userPrefs = loadUserPreferences();
  const marketCache = loadMarketCache();

  return catalog.map((cat) => {
    const pref = userPrefs.skus?.[cat.id] || ({} as Partial<SkuUserPreference>);
    const mc = marketCache[cat.id] || {};
    const msrpCeiling = Number(cat.msrpCeiling || 0);
    const maxMarketBuyPrice = pref.maxMarketBuyPrice !== undefined
      ? Number(pref.maxMarketBuyPrice)
      : msrpCeiling;
    const owned = Boolean(pref.owned ?? pref.inVault ?? false);
    const inVault = Boolean(pref.inVault ?? pref.owned ?? false);
    const active = pref.active !== undefined ? Boolean(pref.active) : true;
    const estimatedMarketValue = Number(
      (Number(mc.rollingAverage) > 0 ? Number(mc.rollingAverage) : 0) ||
      mc.estimatedMarketValue ||
      cat.defaultMarketBaseline ||
      msrpCeiling
    );

    const merged: Record<string, any> = {
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

    if (cat.releaseDate) merged.releaseDate = cat.releaseDate;
    if (cat.targetTcin) merged.targetTcin = cat.targetTcin;
    if (cat.walmartItemId) merged.walmartItemId = cat.walmartItemId;
    if (cat.bestBuySku) merged.bestBuySku = cat.bestBuySku;
    if (cat.pcSlug) merged.pcSlug = cat.pcSlug;
    if (cat.tcgProductId) merged.tcgProductId = cat.tcgProductId;

    return merged;
  });
}

export function syncLegacyPoliciesFallback(): any[] {
  const merged = loadMergedPoliciesRaw();
  try {
    atomicWriteJson(LEGACY_POLICIES_PATH, merged);
  } catch (e) {}
  return merged;
}

/**
 * HARD LAW: ONLY explicit user actions from the dashboard UI (slider edits, Wall/Vault checkboxes,
 * bulk matrix calibrations, or trophy claims) may call this function to update config/userPreferences.json.
 */
export function saveUserPoliciesFromUi(incomingPolicies: any[]): any[] {
  if (!Array.isArray(incomingPolicies)) {
    throw new Error('Incoming policies payload must be an array.');
  }
  const prefs = loadUserPreferences();
  if (!prefs.skus) prefs.skus = {};

  for (const item of incomingPolicies) {
    if (!item || !item.id) continue;
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
  atomicWriteJson(USER_PREFS_PATH, prefs);
  return syncLegacyPoliciesFallback();
}

export function markSkuOwnedFromUi(skuId: string, owned = true): void {
  if (!skuId) return;
  const prefs = loadUserPreferences();
  if (!prefs.skus) prefs.skus = {};
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
  atomicWriteJson(USER_PREFS_PATH, prefs);
  syncLegacyPoliciesFallback();
}

export function loadGlobalSettings(): GlobalUserSettings {
  const prefs = loadUserPreferences();
  let legacySettings: any = {};
  try {
    if (fs.existsSync(LEGACY_SETTINGS_PATH)) {
      legacySettings = JSON.parse(fs.readFileSync(LEGACY_SETTINGS_PATH, 'utf-8')) || {};
    }
  } catch (e) {}

  const gs = prefs.globalSettings || ({} as Partial<GlobalUserSettings>);
  return {
    ...legacySettings,
    muteVaulted: Boolean(prefs.muteVaulted ?? gs.muteVaulted ?? legacySettings.muteVaulted ?? true),
    wallHunterMode: Boolean(prefs.wallHunterMode ?? gs.wallHunterMode ?? legacySettings.wallHunterMode ?? false),
    liveDigestEnabled: Boolean(prefs.liveDigestEnabled ?? gs.liveDigestEnabled ?? legacySettings.liveDigestEnabled ?? false)
  };
}

export function saveGlobalSettingsFromUi(patch: Partial<GlobalUserSettings>): GlobalUserSettings {
  const prefs = loadUserPreferences();
  const current = loadGlobalSettings();
  const next: GlobalUserSettings = {
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

  atomicWriteJson(USER_PREFS_PATH, prefs);
  atomicWriteJson(LEGACY_SETTINGS_PATH, next);
  return next;
}

/**
 * HARD LAW: Background MarketSync updates write ONLY to marketCache.json
 * (and refresh read-only legacy policies.json fallback). NEVER touches userPreferences.json!
 */
export function saveMarketBaselineSync(
  syncedBaselines: Map<string, number>,
  updatedCache: Record<string, any>
): void {
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
    } else {
      updatedCache[skuId].estimatedMarketValue = mktVal;
      updatedCache[skuId].rollingAverage = mktVal;
    }
  }
  atomicWriteJson(MARKET_CACHE_PATH, updatedCache);
  syncLegacyPoliciesFallback();
}

export function loadStoresRegistry(): StoreRegistryEntry[] {
  try {
    if (fs.existsSync(STORES_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORES_PATH, 'utf-8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {}
  return [];
}

export function loadActiveLgsStores(): StoreRegistryEntry[] {
  return loadStoresRegistry().filter(
    (s) => s && s.storeType !== 'BIG_BOX' && s.enabled !== false && Boolean(s.baseUrl)
  );
}

export function loadTier1FastLgsStores(): StoreRegistryEntry[] {
  return loadActiveLgsStores().filter((s) => s.tier === 'TIER1_FAST');
}

let cachedShippingRulesMap: Record<string, StoreShippingProfile> | null = null;

export function loadShippingRulesMap(forceReload = false): Record<string, StoreShippingProfile> {
  if (cachedShippingRulesMap && !forceReload) return cachedShippingRulesMap;
  const stores = loadStoresRegistry();
  const map: Record<string, StoreShippingProfile> = {};
  for (const st of stores) {
    if (!st || !st.name) continue;
    const profile: StoreShippingProfile = {
      freeShipThreshold: Number(st.freeShipThreshold ?? 150),
      flatShipping: Number(st.flatShipping ?? 6.99)
    };
    map[st.name.trim().toLowerCase()] = profile;
    if (Array.isArray(st.aliases)) {
      for (const alias of st.aliases) {
        if (alias) map[String(alias).trim().toLowerCase()] = profile;
      }
    }
  }
  cachedShippingRulesMap = map;
  return map;
}

export function getStoreShippingProfileFromRegistry(retailer: string): StoreShippingProfile {
  const rules = loadShippingRulesMap();
  const key = (retailer || '').trim().toLowerCase();
  if (rules[key]) return rules[key];
  for (const [k, profile] of Object.entries(rules)) {
    if (key.includes(k)) return profile;
  }
  return { freeShipThreshold: 150, flatShipping: 6.99 };
}

export function watchConfigFiles(onReload: () => void): void {
  let debounceTimer: any = null;
  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      cachedShippingRulesMap = null;
      onReload();
    }, 150);
  };

  for (const filePath of [USER_PREFS_PATH, CATALOG_PATH, LEGACY_POLICIES_PATH]) {
    if (fs.existsSync(filePath)) {
      try {
        fs.watch(filePath, () => trigger());
      } catch (e) {}
    }
  }
}
