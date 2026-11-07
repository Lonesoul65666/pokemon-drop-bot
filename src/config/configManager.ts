import fs from 'fs';
import path from 'path';

export interface SkuUserPreference {
  maxMarketBuyPrice: number;
  owned: boolean;
  inVault: boolean;
  wallOwned: boolean;
  dadRipOwned: boolean;
  loganRipOwned: boolean;
  autoPilotEnabled?: boolean;
  active: boolean;
}

export interface GlobalUserSettings {
  muteVaulted: boolean;
  wallHunterMode: boolean;
  liveDigestEnabled: boolean;
  singlesAlertsEnabled: boolean;
  favoritePokemonWatchlist: string[];
  minSinglesTrackPrice: number;
  lastDigestSentAt?: number;
  lastDigestHash?: string;
}

export interface UserPreferencesFile {
  schemaVersion: string;
  updatedAt: string;
  muteVaulted: boolean;
  wallHunterMode: boolean;
  liveDigestEnabled: boolean;
  singlesAlertsEnabled: boolean;
  favoritePokemonWatchlist: string[];
  minSinglesTrackPrice: number;
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
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    try {
      const fallbackTmp = `${filePath}.tmp`;
      fs.writeFileSync(fallbackTmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(fallbackTmp, filePath);
    } catch {}
  }
}

export function normalizeSkuPref(raw: Partial<SkuUserPreference> | undefined, fallbackMsrp = 0): SkuUserPreference {
  const p = raw || {};
  const wallOwned = Boolean(p.wallOwned ?? p.owned ?? p.inVault ?? false);
  return {
    maxMarketBuyPrice: p.maxMarketBuyPrice !== undefined ? Number(p.maxMarketBuyPrice) : Number(fallbackMsrp || 0),
    owned: wallOwned,
    inVault: wallOwned,
    wallOwned,
    dadRipOwned: Boolean(p.dadRipOwned ?? false),
    loganRipOwned: Boolean(p.loganRipOwned ?? false),
    autoPilotEnabled: p.autoPilotEnabled !== undefined ? Boolean(p.autoPilotEnabled) : true,
    active: p.active !== undefined ? Boolean(p.active) : true
  };
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
  } catch {}
  return [];
}

export function loadUserPreferences(): UserPreferencesFile {
  try {
    if (fs.existsSync(USER_PREFS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(USER_PREFS_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object' && parsed.skus) {
        const gs = parsed.globalSettings || {};
        const favs = Array.isArray(parsed.favoritePokemonWatchlist) ? parsed.favoritePokemonWatchlist : (Array.isArray(gs.favoritePokemonWatchlist) ? gs.favoritePokemonWatchlist : ['Gyarados']);
        const normalizedSkus: Record<string, SkuUserPreference> = {};
        for (const [k, v] of Object.entries(parsed.skus)) normalizedSkus[k] = normalizeSkuPref(v as Partial<SkuUserPreference>);
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
  } catch {}
  const skus: Record<string, SkuUserPreference> = {};
  try {
    if (fs.existsSync(LEGACY_POLICIES_PATH)) {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_POLICIES_PATH, 'utf-8'));
      if (Array.isArray(legacy)) for (const p of legacy) skus[p.id] = normalizeSkuPref(p, Number(p.msrpCeiling || 0));
    }
  } catch {}
  return {
    schemaVersion: '5.6.0',
    updatedAt: new Date().toISOString(),
    muteVaulted: true,
    wallHunterMode: false,
    liveDigestEnabled: true,
    singlesAlertsEnabled: false,
    favoritePokemonWatchlist: ['Gyarados'],
    minSinglesTrackPrice: 15,
    globalSettings: { muteVaulted: true, wallHunterMode: false, liveDigestEnabled: true, singlesAlertsEnabled: false, favoritePokemonWatchlist: ['Gyarados'], minSinglesTrackPrice: 15 },
    skus
  };
}

export function loadMarketCache(): Record<string, any> {
  try { if (fs.existsSync(MARKET_CACHE_PATH)) return JSON.parse(fs.readFileSync(MARKET_CACHE_PATH, 'utf-8')) || {}; } catch {}
  return {};
}

export function loadMergedPoliciesRaw(): any[] {
  const catalog = loadCatalog();
  const userPrefs = loadUserPreferences();
  const marketCache = loadMarketCache();
  return catalog.map((cat) => {
    const msrpCeiling = Number(cat.msrpCeiling || 0);
    const pref = normalizeSkuPref(userPrefs.skus?.[cat.id], msrpCeiling);
    const mc = marketCache[cat.id] || {};
    const completionCount = (pref.wallOwned ? 1 : 0) + (pref.dadRipOwned ? 1 : 0) + (pref.loganRipOwned ? 1 : 0);
    const fullyConquered = Boolean(pref.wallOwned && pref.dadRipOwned && pref.loganRipOwned);
    const estimatedMarketValue = Number((Number(mc.rollingAverage) > 0 ? Number(mc.rollingAverage) : 0) || mc.estimatedMarketValue || cat.defaultMarketBaseline || msrpCeiling);
    const merged: Record<string, any> = {
      id: cat.id, name: cat.name, era: cat.era, formFactor: cat.formFactor, image: cat.image || '',
      matchers: Array.isArray(cat.matchers) ? cat.matchers : [], minStock: Number(cat.minStock ?? 1),
      msrpCeiling, maxMarketBuyPrice: pref.maxMarketBuyPrice || msrpCeiling, estimatedMarketValue,
      priority: cat.priority || 'STANDARD', cooldownMins: Number(cat.cooldownMins ?? 30),
      active: pref.active, owned: pref.wallOwned, inVault: pref.wallOwned,
      wallOwned: pref.wallOwned, dadRipOwned: pref.dadRipOwned, loganRipOwned: pref.loganRipOwned,
      completionCount, fullyConquered, autoPilotEnabled: pref.autoPilotEnabled !== false,
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
  try { atomicWriteJson(LEGACY_POLICIES_PATH, merged); } catch {}
  return merged;
}

export function saveUserPoliciesFromUi(incomingPolicies: any[]): any[] {
  if (!Array.isArray(incomingPolicies)) throw new Error('Incoming policies payload must be an array.');
  const prefs = loadUserPreferences();
  if (!prefs.skus) prefs.skus = {};
  for (const item of incomingPolicies) {
    if (!item || !item.id) continue;
    const existing = normalizeSkuPref(prefs.skus[item.id], Number(item.msrpCeiling || 0));
    const wallOwned = item.wallOwned !== undefined ? Boolean(item.wallOwned) : (item.owned !== undefined ? Boolean(item.owned) : (item.inVault !== undefined ? Boolean(item.inVault) : existing.wallOwned));
    const dadRipOwned = item.dadRipOwned !== undefined ? Boolean(item.dadRipOwned) : existing.dadRipOwned;
    const loganRipOwned = item.loganRipOwned !== undefined ? Boolean(item.loganRipOwned) : existing.loganRipOwned;
    const newPrice = item.maxMarketBuyPrice !== undefined ? Number(item.maxMarketBuyPrice) : existing.maxMarketBuyPrice;
    const priceChangedManually = item.maxMarketBuyPrice !== undefined && Math.abs(newPrice - existing.maxMarketBuyPrice) >= 0.5;
    const autoPilotEnabled = item.autoPilotEnabled !== undefined ? Boolean(item.autoPilotEnabled) : (priceChangedManually ? false : existing.autoPilotEnabled);
    prefs.skus[item.id] = {
      maxMarketBuyPrice: newPrice, owned: wallOwned, inVault: wallOwned,
      wallOwned, dadRipOwned, loganRipOwned, autoPilotEnabled,
      active: item.active !== undefined ? Boolean(item.active) : existing.active
    };
  }
  prefs.updatedAt = new Date().toISOString();
  atomicWriteJson(USER_PREFS_PATH, prefs);
  return syncLegacyPoliciesFallback();
}

export function updateSkuFamilySlotsFromUi(skuId: string, patch: { wallOwned?: boolean; dadRipOwned?: boolean; loganRipOwned?: boolean; toggleAll?: boolean; autoPilotEnabled?: boolean; maxMarketBuyPrice?: number; }): any {
  if (!skuId) throw new Error('Missing skuId');
  const prefs = loadUserPreferences();
  if (!prefs.skus) prefs.skus = {};
  const existing = normalizeSkuPref(prefs.skus[skuId]);
  let wallOwned = patch.wallOwned !== undefined ? Boolean(patch.wallOwned) : existing.wallOwned;
  let dadRipOwned = patch.dadRipOwned !== undefined ? Boolean(patch.dadRipOwned) : existing.dadRipOwned;
  let loganRipOwned = patch.loganRipOwned !== undefined ? Boolean(patch.loganRipOwned) : existing.loganRipOwned;
  if (patch.toggleAll !== undefined) {
    const targetState = Boolean(patch.toggleAll);
    wallOwned = targetState; dadRipOwned = targetState; loganRipOwned = targetState;
  }
  prefs.skus[skuId] = {
    ...existing,
    maxMarketBuyPrice: patch.maxMarketBuyPrice !== undefined ? Number(patch.maxMarketBuyPrice) : existing.maxMarketBuyPrice,
    owned: wallOwned, inVault: wallOwned, wallOwned, dadRipOwned, loganRipOwned,
    autoPilotEnabled: patch.autoPilotEnabled !== undefined ? Boolean(patch.autoPilotEnabled) : existing.autoPilotEnabled
  };
  prefs.updatedAt = new Date().toISOString();
  atomicWriteJson(USER_PREFS_PATH, prefs);
  const all = syncLegacyPoliciesFallback();
  return all.find((p) => p.id === skuId) || prefs.skus[skuId];
}

export function markSkuOwnedFromUi(skuId: string, owned = true): void {
  if (skuId) updateSkuFamilySlotsFromUi(skuId, { wallOwned: Boolean(owned) });
}

export function loadGlobalSettings(): GlobalUserSettings {
  const prefs = loadUserPreferences();
  const gs = prefs.globalSettings || ({} as Partial<GlobalUserSettings>);
  const favs = Array.isArray(prefs.favoritePokemonWatchlist) ? prefs.favoritePokemonWatchlist : (Array.isArray(gs.favoritePokemonWatchlist) ? gs.favoritePokemonWatchlist : ['Gyarados']);
  return {
    muteVaulted: Boolean(prefs.muteVaulted ?? gs.muteVaulted ?? true),
    wallHunterMode: Boolean(prefs.wallHunterMode ?? gs.wallHunterMode ?? false),
    liveDigestEnabled: Boolean(prefs.liveDigestEnabled ?? gs.liveDigestEnabled ?? true),
    singlesAlertsEnabled: false,
    favoritePokemonWatchlist: favs,
    minSinglesTrackPrice: Number(prefs.minSinglesTrackPrice ?? gs.minSinglesTrackPrice ?? 15)
  };
}

export function saveGlobalSettingsFromUi(patch: Partial<GlobalUserSettings>): GlobalUserSettings {
  const prefs = loadUserPreferences();
  const current = loadGlobalSettings();
  const next: GlobalUserSettings = { ...current, ...(patch || {}), singlesAlertsEnabled: false };
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
  atomicWriteJson(USER_PREFS_PATH, prefs);
  atomicWriteJson(LEGACY_SETTINGS_PATH, next);
  return next;
}

export function saveMarketBaselineSync(syncedBaselines: Map<string, number>, updatedCache: Record<string, any>): void {
  for (const [skuId, mktVal] of syncedBaselines.entries()) {
    if (!updatedCache[skuId]) {
      updatedCache[skuId] = { lowestPrice: mktVal, lowestStore: 'TCGPlayer SKU Baseline', lowestUrl: '', lastSeen: Date.now(), rollingAverage: mktVal, estimatedMarketValue: mktVal, lastUpdated: new Date().toISOString() };
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
  } catch {}
  return [];
}

export function loadActiveLgsStores(): StoreRegistryEntry[] {
  return loadStoresRegistry().filter((s) => s && s.storeType !== 'BIG_BOX' && s.enabled !== false && Boolean(s.baseUrl));
}

export function loadTier1FastLgsStores(): StoreRegistryEntry[] {
  return loadActiveLgsStores().filter((s) => s.tier === 'TIER1_FAST');
}

let cachedShippingRulesMap: Record<string, StoreShippingProfile> | null = null;

export function loadShippingRulesMap(forceReload = false): Record<string, StoreShippingProfile> {
  if (cachedShippingRulesMap && !forceReload) return cachedShippingRulesMap;
  const map: Record<string, StoreShippingProfile> = {};
  for (const st of loadStoresRegistry()) {
    if (!st || !st.name) continue;
    const profile: StoreShippingProfile = { freeShipThreshold: Number(st.freeShipThreshold ?? 150), flatShipping: Number(st.flatShipping ?? 6.99) };
    map[st.name.trim().toLowerCase()] = profile;
    if (Array.isArray(st.aliases)) for (const alias of st.aliases) if (alias) map[String(alias).trim().toLowerCase()] = profile;
  }
  cachedShippingRulesMap = map;
  return map;
}

export function getStoreShippingProfileFromRegistry(retailer: string): StoreShippingProfile {
  const rules = loadShippingRulesMap();
  const key = (retailer || '').trim().toLowerCase();
  if (rules[key]) return rules[key];
  for (const [k, profile] of Object.entries(rules)) if (key.includes(k)) return profile;
  return { freeShipThreshold: 150, flatShipping: 6.99 };
}

export function watchConfigFiles(onReload: () => void): void {
  let debounceTimer: any = null;
  const trigger = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { debounceTimer = null; cachedShippingRulesMap = null; onReload(); }, 150);
  };
  for (const filePath of [USER_PREFS_PATH, CATALOG_PATH, LEGACY_POLICIES_PATH]) {
    if (fs.existsSync(filePath)) { try { fs.watch(filePath, () => trigger()); } catch {} }
  }
}
