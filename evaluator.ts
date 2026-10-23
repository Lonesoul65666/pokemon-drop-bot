import fs from 'fs';
import path from 'path';
import {
  WATCH_POLICIES,
  PolicyRule,
  GLOBAL_JUNK_EXCLUSIONS,
  isValidSkuForFormFactor,
  getMinPlausiblePriceFloor,
  getMaxPlausiblePriceCeiling,
  detectBigBoxRetailer,
  isPokemonCenterSource,
  hasPcExclusiveTerms,
  getPackCountForSku,
  computeRipMetrics,
  atomicWriteJson
} from './policies';
import { recordObservation, getTelemetry } from './marketTelemetry';
import { recordDailySnapshot, recordTapeRestock, recordTapeSoldOut } from './marketTape';

export type BigBoxTier = 'MSRP_TIER_A' | 'PC_EXCLUSIVE_MSRP' | '3P_TIER_B' | 'BIG_BOX_RESTOCK_RADAR';

export interface MsrpTrophyCatch {
  productName: string;
  ruleId?: string;
  store: string;
  price: number;
  landedPrice: number;
  msrp: number;
  url: string;
  timestamp: number;
  timeStr: string;
}

export interface MsrpTrophiesState {
  totalMsrpHits: number;
  catches: MsrpTrophyCatch[];
}

export interface RawRestockItem {
  title: string;
  retailer: string;
  url: string;
  productUrl?: string;
  cart1xUrl?: string;
  cart2xUrl?: string;
  cart3xUrl?: string;
  price?: number;
  itemPrice?: number;
  shippingPrice?: number;
  shippingNoteOverride?: string;
  stock?: number;
  itemId?: string;
  isPreOrder?: boolean;
  freeShipping?: boolean;
  isBigBoxRestockRadar?: boolean;
}

export interface EvaluationResult {
  action: 'BUY' | 'IGNORE';
  reason: string;
  rule?: PolicyRule;
  discountPct?: number;
  savingsDollars?: number;
  alertType?: 'NEW_DROP' | 'PRICE_DROP' | 'RESTOCK_REPEAT' | 'PRE_DROP_STAGING';
  previousPrice?: number;
  previousTimeStr?: string;
  landedPrice?: number;
  itemPrice?: number;
  shippingPrice?: number;
  estimatedShipping?: number;
  freeShipNote?: string;
  packCount?: number;
  pricePerPack?: number;
  isRipValueLeader?: boolean;
  isPreOrder?: boolean;
  isPreRelease?: boolean;
  preReleaseStatusTag?: string;
  releaseDate?: string;
  isMsrpUnicorn?: boolean;
  bypassVaultMute?: boolean;
  cart1xUrl?: string;
  cart2xUrl?: string;
  cart3xUrl?: string;
  bigBoxTier?: BigBoxTier;
  bigBoxBadge?: string;
  marketplaceWarning?: string;
  priorityFront?: boolean;
}

interface AlertMemoryEntry {
  lastPrice: number;
  lowestAlertedPrice: number;
  timestamp: number;
  timeStr: string;
  alertCount: number;
  wasOutOfStockSinceLastAlert?: boolean;
  itemId?: string;
}

export interface BestOfferEntry {
  ruleId: string;
  ruleName: string;
  formFactor: string;
  era?: string;
  title: string;
  retailer: string;
  price: number;
  itemPrice?: number;
  shippingPrice?: number;
  landedPrice: number;
  freeShipNote?: string;
  triggerPrice: number;
  msrp: number;
  marketValue: number;
  gapDollars: number;
  gapPct: number;
  rawGapDollars: number;
  rawGapPct: number;
  packCount: number;
  pricePerPack: number;
  isRipValueLeader: boolean;
  owned: boolean;
  isPreOrder: boolean;
  isPreRelease: boolean;
  preReleaseStatusTag?: string;
  url: string;
  productUrl?: string;
  cart1xUrl?: string;
  cart2xUrl?: string;
  cart3xUrl?: string;
  itemId?: string;
  updatedAt: number;
  timeStr: string;
}

const ALERT_STATE_PATH = path.resolve(process.cwd(), 'alertState.json');
const LIVE_STOCK_PATH = path.resolve(process.cwd(), 'liveStock.json');
const STORE_OFFERS_CACHE_PATH = path.resolve(process.cwd(), 'storeOffersCache.json');
const SETTINGS_PATH = path.resolve(process.cwd(), 'botSettings.json');
export const MSRP_TROPHIES_PATH = path.resolve(process.cwd(), 'data', 'msrpTrophies.json');
let alertMemory: Record<string, AlertMemoryEntry> = {};

export interface StoreOfferRecord {
  skuId: string;
  productName: string;
  rawTitle: string;
  formFactor: string;
  era?: string;
  owned: boolean;
  msrp: number;
  triggerPrice: number;
  marketValue: number;
  storeName: string;
  price: number;
  shipping: number;
  landedPrice: number;
  freeShipNote?: string;
  url: string;
  productUrl?: string;
  cart1xUrl?: string;
  cart2xUrl?: string;
  cart3xUrl?: string;
  stock?: number;
  itemId?: string;
  packCount: number;
  pricePerPack: number;
  isRipValueLeader: boolean;
  firstSeenAt: number;
  updatedAt: number;
  previousPrice?: number;
  priceDelta: number;
  isFreshRestock: boolean;
}

let storeOffersCacheMem: Record<string, Record<string, StoreOfferRecord>> = {};
let storeOffersFlushTimer: any = null;

try {
  if (fs.existsSync(STORE_OFFERS_CACHE_PATH)) {
    const parsed = JSON.parse(fs.readFileSync(STORE_OFFERS_CACHE_PATH, 'utf-8'));
    if (parsed && typeof parsed === 'object') {
      storeOffersCacheMem = parsed;
    }
  }
} catch (e) {}

function scheduleStoreOffersFlush() {
  if (storeOffersFlushTimer) return;
  storeOffersFlushTimer = setTimeout(() => {
    storeOffersFlushTimer = null;
    try {
      atomicWriteJson(STORE_OFFERS_CACHE_PATH, storeOffersCacheMem);
    } catch (e) {}
  }, 2000);
}

export function upsertStoreOfferCache(entry: Omit<StoreOfferRecord, 'firstSeenAt' | 'priceDelta' | 'isFreshRestock' | 'previousPrice'>) {
  if (!entry.skuId || !entry.storeName) return;
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

export function pruneStoreMissingOffers(storeName: string, activeItemIds: Set<string>) {
  if (!storeName) return;
  let mutated = false;
  for (const [skuId, skuOffers] of Object.entries(storeOffersCacheMem)) {
    if (!skuOffers || typeof skuOffers !== 'object') continue;
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
  if (fs.existsSync(ALERT_STATE_PATH)) {
    alertMemory = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf-8'));
  }
} catch (e) {}

function saveAlertMemory() {
  atomicWriteJson(ALERT_STATE_PATH, alertMemory);
}

export function normalizeAlertRetailerKey(retailer: string): string {
  const r = (retailer || '').trim();
  if (/tcgplayer/i.test(r)) {
    return 'TCGPlayer Verified Seller';
  }
  return r;
}

export function markAlertKeyOutOfStock(ruleIdOrItemId: string, retailer?: string): void {
  try {
    if (fs.existsSync(ALERT_STATE_PATH)) {
      alertMemory = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf-8'));
    }
  } catch (e) {}

  let changed = false;
  if (retailer) {
    const normRet = normalizeAlertRetailerKey(retailer);
    for (const candidateKey of [`${ruleIdOrItemId}__${normRet}`, `${ruleIdOrItemId}__${retailer}`]) {
      const entry = alertMemory[candidateKey];
      if (entry && typeof entry === 'object' && !entry.wasOutOfStockSinceLastAlert) {
        entry.wasOutOfStockSinceLastAlert = true;
        changed = true;
      }
    }
  } else {
    for (const [key, entry] of Object.entries(alertMemory)) {
      if (key.startsWith('__') || !entry || typeof entry !== 'object') continue;
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

export function getMsrpTrophies(): MsrpTrophiesState {
  try {
    if (fs.existsSync(MSRP_TROPHIES_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(MSRP_TROPHIES_PATH, 'utf-8'));
      if (parsed && typeof parsed.totalMsrpHits === 'number' && Array.isArray(parsed.catches)) {
        return parsed;
      }
    }
  } catch (e) {}
  return { totalMsrpHits: 0, catches: [] };
}

export function recordMsrpTrophyCatch(entry: MsrpTrophyCatch): MsrpTrophiesState {
  try {
    const dir = path.dirname(MSRP_TROPHIES_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const state = getMsrpTrophies();
    state.totalMsrpHits = (state.totalMsrpHits || 0) + 1;
    state.catches.unshift(entry);
    if (state.catches.length > 20) {
      state.catches = state.catches.slice(0, 20);
    }
    atomicWriteJson(MSRP_TROPHIES_PATH, state);
    return state;
  } catch (e) {
    return getMsrpTrophies();
  }
}

export function isPreReleaseDate(releaseDate?: string, nowTs = Date.now()): boolean {
  if (!releaseDate) return false;
  const parsed = Date.parse(`${releaseDate}T00:00:00`);
  if (Number.isNaN(parsed)) return false;
  return nowTs < parsed;
}

export const PRE_RELEASE_BLEED_TAG = '⏳ PRE-RELEASE BLEED (Wait for Launch Week)';

export interface StoreShippingProfile {
  freeShipThreshold: number;
  flatShipping: number;
}

export const STORE_SHIPPING_RULES: Record<string, StoreShippingProfile> = {
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
  'hobbiesville': { freeShipThreshold: 175, flatShipping: 9.99 },
  // Wave 2 Overnight Discovery Newly Onboarded Verified Shopify LGS Stores (4)
  'pokebox usa': { freeShipThreshold: 150, flatShipping: 6.99 },
  '401 games': { freeShipThreshold: 175, flatShipping: 9.99 },
  'kanzen games': { freeShipThreshold: 150, flatShipping: 6.99 },
  'the card vault': { freeShipThreshold: 150, flatShipping: 6.99 },
  // Wave 3 V4 Autopilot Regional & Mom-and-Pop Verified Shopify LGS Stores (11)
  'level one game shop': { freeShipThreshold: 125, flatShipping: 6.99 },
  'mox boarding house': { freeShipThreshold: 100, flatShipping: 6.99 },
  'taps games': { freeShipThreshold: 175, flatShipping: 9.99 },
  'sports card junction': { freeShipThreshold: 150, flatShipping: 6.99 },
  'gnome games': { freeShipThreshold: 125, flatShipping: 6.99 },
  'silver goblin': { freeShipThreshold: 175, flatShipping: 9.99 },
  'face to face games': { freeShipThreshold: 175, flatShipping: 9.99 },
  'miraj trading': { freeShipThreshold: 175, flatShipping: 9.99 },
  'untouchables': { freeShipThreshold: 175, flatShipping: 9.99 },
  'a&c games': { freeShipThreshold: 175, flatShipping: 9.99 },
  'tistaminis': { freeShipThreshold: 175, flatShipping: 9.99 },
  // Wave 4 V4 Phase E Verified Shopify TCG & Hobby Expansion (40 -> 91 Total Verified Stores)
  'spankys card shop': { freeShipThreshold: 150, flatShipping: 6.99 },
  'forge and fire': { freeShipThreshold: 150, flatShipping: 6.99 },
  'kanto cards': { freeShipThreshold: 150, flatShipping: 6.99 },
  'shinobi collectibles': { freeShipThreshold: 150, flatShipping: 6.99 },
  'the awesome card shop': { freeShipThreshold: 150, flatShipping: 6.99 },
  'pokegirl cc': { freeShipThreshold: 150, flatShipping: 6.99 },
  'moxie card shop': { freeShipThreshold: 150, flatShipping: 6.99 },
  'sealed and sleeved': { freeShipThreshold: 150, flatShipping: 6.99 },
  'pro collect shop': { freeShipThreshold: 150, flatShipping: 6.99 },
  'drpm collectors': { freeShipThreshold: 150, flatShipping: 6.99 },
  'gorge poke shop': { freeShipThreshold: 150, flatShipping: 6.99 },
  'squirtle squad card shop': { freeShipThreshold: 150, flatShipping: 6.99 },
  'cardshq': { freeShipThreshold: 150, flatShipping: 6.99 },
  'collectors cafe': { freeShipThreshold: 150, flatShipping: 6.99 },
  'poke unlimited': { freeShipThreshold: 150, flatShipping: 6.99 },
  'j&j gaming factory': { freeShipThreshold: 150, flatShipping: 6.99 },
  'victory road collections': { freeShipThreshold: 150, flatShipping: 6.99 },
  'puzzled gamer': { freeShipThreshold: 150, flatShipping: 6.99 },
  'cardpop usa': { freeShipThreshold: 150, flatShipping: 6.99 },
  'missingno games': { freeShipThreshold: 150, flatShipping: 6.99 },
  'common lands': { freeShipThreshold: 150, flatShipping: 6.99 },
  'ipoketcg': { freeShipThreshold: 150, flatShipping: 6.99 },
  'ava tcg': { freeShipThreshold: 150, flatShipping: 6.99 },
  'lets play tcg': { freeShipThreshold: 150, flatShipping: 6.99 },
  'moonshot games': { freeShipThreshold: 150, flatShipping: 6.99 },
  'stonebrook collectibles': { freeShipThreshold: 150, flatShipping: 6.99 },
  'carddog tcg': { freeShipThreshold: 150, flatShipping: 6.99 },
  'elite4 tcg': { freeShipThreshold: 150, flatShipping: 6.99 },
  'jbs emporium': { freeShipThreshold: 150, flatShipping: 6.99 },
  'derium and wifey': { freeShipThreshold: 150, flatShipping: 6.99 },
  'oaks poke box': { freeShipThreshold: 150, flatShipping: 6.99 },
  'nova break': { freeShipThreshold: 150, flatShipping: 6.99 },
  'epic trading collectibles': { freeShipThreshold: 150, flatShipping: 6.99 },
  'bam cards': { freeShipThreshold: 150, flatShipping: 6.99 },
  'boxed vinyl': { freeShipThreshold: 150, flatShipping: 6.99 },
  'mini collects': { freeShipThreshold: 150, flatShipping: 6.99 },
  'black wolf collectibles': { freeShipThreshold: 150, flatShipping: 6.99 },
  'pentix games': { freeShipThreshold: 150, flatShipping: 6.99 },
  'top shop collectibles': { freeShipThreshold: 150, flatShipping: 6.99 },
  'lvl up games': { freeShipThreshold: 175, flatShipping: 9.99 }
};

export function getStoreShippingProfile(retailer: string): StoreShippingProfile {
  const key = (retailer || '').trim().toLowerCase();
  if (STORE_SHIPPING_RULES[key]) return STORE_SHIPPING_RULES[key];
  for (const [k, profile] of Object.entries(STORE_SHIPPING_RULES)) {
    if (key.includes(k)) return profile;
  }
  return { freeShipThreshold: 150, flatShipping: 6.99 };
}

export interface LiveStockEntry {
  ruleId: string;
  ruleName: string;
  formFactor: string;
  title: string;
  retailer: string;
  price: number;
  itemPrice?: number;
  shippingPrice?: number;
  landedPrice?: number;
  freeShipNote?: string;
  packCount?: number;
  pricePerPack?: number;
  isRipValueLeader?: boolean;
  isPreOrder?: boolean;
  isPreRelease?: boolean;
  preReleaseStatusTag?: string;
  releaseDate?: string;
  isMsrpUnicorn?: boolean;
  bigBoxTier?: BigBoxTier;
  bigBoxBadge?: string;
  marketplaceWarning?: string;
  url: string;
  productUrl?: string;
  cart1xUrl?: string;
  cart2xUrl?: string;
  cart3xUrl?: string;
  stock?: number;
  itemId?: string;
  inStock: boolean;
  updatedAt: number;
  timeStr: string;
}

let bestOffersFlushTimer: any = null;
const pendingBestOffers = new Map<string, BestOfferEntry>();

function flushBestOffersToLiveStock() {
  bestOffersFlushTimer = null;
  if (pendingBestOffers.size === 0) return;
  try {
    let map: Record<string, any> = {};
    if (fs.existsSync(LIVE_STOCK_PATH)) {
      try { map = JSON.parse(fs.readFileSync(LIVE_STOCK_PATH, 'utf-8')); } catch (e) { map = {}; }
    }
    const bestOffers: Record<string, BestOfferEntry> = (map.__bestOffers && typeof map.__bestOffers === 'object')
      ? map.__bestOffers
      : {};
    const now = Date.now();
    for (const [ruleId, entry] of pendingBestOffers.entries()) {
      const existing = bestOffers[ruleId];
      if (
        !existing ||
        existing.retailer === entry.retailer ||
        entry.landedPrice <= existing.landedPrice ||
        (now - (existing.updatedAt || 0) > 20 * 60 * 1000)
      ) {
        bestOffers[ruleId] = entry;
      }
    }
    pendingBestOffers.clear();
    map.__bestOffers = bestOffers;
    atomicWriteJson(LIVE_STOCK_PATH, map);
  } catch (e) {}
}

export function upsertBestCurrentOffer(entry: BestOfferEntry) {
  const existingPending = pendingBestOffers.get(entry.ruleId);
  if (!existingPending || existingPending.retailer === entry.retailer || entry.landedPrice <= existingPending.landedPrice) {
    pendingBestOffers.set(entry.ruleId, entry);
  }
  if (!bestOffersFlushTimer) {
    bestOffersFlushTimer = setTimeout(flushBestOffersToLiveStock, 2500);
  }
}

export function matchTargetRuleForStaging(title: string, price: number, retailer: string, handleAndUrl: string): PolicyRule | null {
  const cleanTitle = (title || '').trim();
  for (const junkRegex of GLOBAL_JUNK_EXCLUSIONS) {
    if (junkRegex.test(cleanTitle)) return null;
  }
  for (const rule of WATCH_POLICIES) {
    if ((rule as any).active === false) continue;
    const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
    if (!isMatched) continue;
    if (!isValidSkuForFormFactor(cleanTitle, rule.formFactor, price, {
      ruleId: rule.id,
      targetName: rule.name,
      handle: handleAndUrl,
      retailer,
      sourceUrl: handleAndUrl,
      allowPcRetailUnlock: false
    })) {
      continue;
    }
    const minFloor = getMinPlausiblePriceFloor(rule.formFactor);
    const maxCeiling = getMaxPlausiblePriceCeiling(rule.formFactor, rule.id, rule.name);
    if (price < minFloor || price > maxCeiling) continue;
    return rule;
  }
  return null;
}

export function upsertLiveStock(entry: LiveStockEntry) {
  try {
    let map: Record<string, any> = {};
    if (fs.existsSync(LIVE_STOCK_PATH)) {
      try { map = JSON.parse(fs.readFileSync(LIVE_STOCK_PATH, 'utf-8')); } catch (e) { map = {}; }
    }
    const existing = map[entry.ruleId];
    // Update if same retailer, lower/equal price, or existing entry is > 30 mins old
    if (!existing || !existing.inStock || existing.retailer === entry.retailer || entry.price <= existing.price || (Date.now() - existing.updatedAt > 30 * 60 * 1000)) {
      map[entry.ruleId] = entry;
      atomicWriteJson(LIVE_STOCK_PATH, map);
    }
  } catch (e) {}
}

export function markLiveStockOut(itemId: string) {
  try {
    recordTapeSoldOut(String(itemId));
  } catch (e) {}

  // Never flip wasOutOfStockSinceLastAlert on a single TCGPlayer scrape or timeout!
  if (!String(itemId).startsWith('tcg_')) {
    try {
      markAlertKeyOutOfStock(String(itemId));
    } catch (e) {}
  }

  try {
    let offersMutated = false;
    for (const skuOffers of Object.values(storeOffersCacheMem)) {
      if (!skuOffers || typeof skuOffers !== 'object') continue;
      for (const [stKey, rec] of Object.entries(skuOffers)) {
        if (rec && String(rec.itemId) === String(itemId)) {
          delete skuOffers[stKey];
          offersMutated = true;
        }
      }
    }
    if (offersMutated) {
      scheduleStoreOffersFlush();
    }
  } catch (e) {}

  try {
    if (!fs.existsSync(LIVE_STOCK_PATH)) return;
    const map: Record<string, any> = JSON.parse(fs.readFileSync(LIVE_STOCK_PATH, 'utf-8'));
    let changed = false;
    const recentOos: Array<{ ruleName: string; retailer: string; price: number; oosAt: number }> = Array.isArray(map.__recentOos)
      ? map.__recentOos.filter((x: any) => Date.now() - (x.oosAt || 0) < 4 * 60 * 60 * 1000)
      : [];

    for (const key of Object.keys(map)) {
      if (key === '__recentOos' || key === '__bestOffers') continue;
      if (map[key]?.itemId === String(itemId)) {
        const matchedEntry = map[key];
        if (matchedEntry.retailer && !String(itemId).startsWith('tcg_')) {
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
      for (const [bKey, bVal] of Object.entries(map.__bestOffers as Record<string, any>)) {
        if (bVal?.itemId === String(itemId)) {
          delete map.__bestOffers[bKey];
          changed = true;
        }
      }
    }
    if (changed) {
      map.__recentOos = recentOos.slice(0, 8);
      atomicWriteJson(LIVE_STOCK_PATH, map);
    }
  } catch (e) {}
}

export function evaluateItem(item: RawRestockItem): EvaluationResult {
  const cleanTitle = item.title.trim();
  const isPreOrder = Boolean(item.isPreOrder || /pre-?order|pre-?sale/i.test(`${cleanTitle} ${item.url}`));
  const handleAndUrl = `${item.url || ''} ${item.productUrl || ''}`;
  const bigBoxName = detectBigBoxRetailer(item.retailer, handleAndUrl);
  const isPcSource = isPokemonCenterSource(item.retailer, handleAndUrl);
  const hasPcTerm = hasPcExclusiveTerms(cleanTitle, handleAndUrl);

  for (const junkRegex of GLOBAL_JUNK_EXCLUSIONS) {
    if (junkRegex.test(cleanTitle)) {
      return { action: 'IGNORE', reason: `Filtered out by global exclusion (${junkRegex})` };
    }
  }

  for (const rule of WATCH_POLICIES) {
    const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
    if (!isMatched) continue;

    if (!isValidSkuForFormFactor(cleanTitle, rule.formFactor, item.price, {
      ruleId: rule.id,
      targetName: rule.name,
      handle: handleAndUrl,
      retailer: item.retailer,
      sourceUrl: item.url,
      allowPcRetailUnlock: true
    })) {
      continue;
    }

    const minFloor = Math.max(
      getMinPlausiblePriceFloor(rule.formFactor),
      Math.round((rule.msrpCeiling || 0) * 0.40 * 100) / 100
    );
    const maxCeiling = getMaxPlausiblePriceCeiling(rule.formFactor, rule.id, rule.name);
    if (item.price !== undefined && (item.price < minFloor || item.price > maxCeiling)) {
      continue;
    }

    // Identify Pokemon Center Exclusive Retail Unlock (pokemoncenter.com or <= $69.99 retail PC ETB)
    const isEtbRule = rule.formFactor === 'ETB' || rule.formFactor === 'ETB Case';
    const isPcExclusiveRetailDrop = isEtbRule && (
      (isPcSource && (item.price === undefined || item.price <= 75)) ||
      (hasPcTerm && item.price !== undefined && item.price <= 69.99)
    );

    const liveTelPre = getTelemetry()[rule.id];
    const currentMarketRef = (liveTelPre && liveTelPre.rollingAverage > 0)
      ? Math.min(maxCeiling, liveTelPre.rollingAverage)
      : Math.min(maxCeiling, rule.estimatedMarketValue || rule.msrpCeiling);

    // Only record into standard SKU telemetry/snapshots if it is NOT a PC Exclusive variant
    if (!hasPcTerm && !isPcSource && item.price && item.price >= minFloor && item.price <= maxCeiling) {
      recordObservation(rule.id, item.price, item.retailer, item.productUrl || item.url, rule.msrpCeiling);
      recordDailySnapshot(rule.id, item.price, item.retailer, currentMarketRef);
    }

    if ((rule as any).active === false) {
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

    let bigBoxTier: BigBoxTier | undefined = undefined;
    let bigBoxBadge: string | undefined = undefined;
    let marketplaceWarning: string | undefined = undefined;
    let priorityFront = false;

    const isBigBoxMsrp = Boolean(bigBoxName && dropPrice <= rule.msrpCeiling * 1.08);

    // Tier A (True Retail MSRP) and PC Exclusive Retail Drops force $0 shipping on Big Box
    const isFreeShip = Boolean(
      isPcExclusiveRetailDrop ||
      isBigBoxMsrp ||
      item.freeShipping ||
      dropPrice >= shipProfile.freeShipThreshold
    );
    const estimatedShipping = isFreeShip ? 0 : shipProfile.flatShipping;
    const landedPrice = Math.round((dropPrice + estimatedShipping) * 100) / 100;

    // Tier-A True Retail MSRP: landed price <= MSRP * 1.08 with free/nominal shipping (<= $6.99)
    const isTierAMsrp = Boolean(
      rule.msrpCeiling > 0 &&
      landedPrice <= Math.round(rule.msrpCeiling * 1.08 * 100) / 100 &&
      estimatedShipping <= 6.99
    );

    if (item.isBigBoxRestockRadar) {
      bigBoxTier = 'BIG_BOX_RESTOCK_RADAR';
      bigBoxBadge = '📡🚨 BIG-BOX RESTOCK RADAR (MSRP ASSUMED) 🚨📡';
      priorityFront = true;
    } else if (isPcExclusiveRetailDrop) {
      bigBoxTier = 'PC_EXCLUSIVE_MSRP';
      bigBoxBadge = '💎 POKÉMON CENTER EXCLUSIVE MSRP DROP';
      priorityFront = true;
    } else if (isTierAMsrp) {
      bigBoxTier = 'MSRP_TIER_A';
      bigBoxBadge = '🚨💎 UNICORN RETAIL MSRP HIT 💎🚨';
      priorityFront = true;
    } else if (bigBoxName && dropPrice > rule.msrpCeiling * 1.08) {
      bigBoxTier = '3P_TIER_B';
      bigBoxBadge = '⚠️ BIG-BOX 3P UNDERCUT';
      if (/walmart|amazon|target|best\s*buy|marketplace/i.test(`${bigBoxName} ${item.retailer} ${handleAndUrl}`)) {
        marketplaceWarning = '⚠️ 3P MARKETPLACE CHECK: Price is above MSRP — verify Sold & Shipped by 1st-Party Retailer before buying';
      }
    }

    // Pre-Release Bleed Tagging
    const isPreRelease = isPreReleaseDate(rule.releaseDate);
    const preReleaseStatusTag = isPreRelease ? PRE_RELEASE_BLEED_TAG : undefined;

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
      } else {
        cart3xUrl = undefined;
      }
    }

    // Check Vault suppression (inVault / owned + muteVaulted setting + wallHunterMode), with MSRP Tier-A Defcon-1 Override!
    const isInVault = Boolean(rule.inVault ?? rule.owned);
    const isMsrpUnicorn = Boolean(isTierAMsrp || isPcExclusiveRetailDrop);
    let muteVaulted = false;
    let wallHunterMode = false;
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        muteVaulted = Boolean(settings?.muteVaulted);
        wallHunterMode = Boolean(settings?.wallHunterMode);
      }
    } catch (e) {}

    const { packCount, pricePerPack, isRipValueLeader } = computeRipMetrics(
      landedPrice,
      rule.id,
      rule.formFactor,
      `${rule.name} ${cleanTitle}`,
      rule.packCount
    );

    const now = Date.now();
    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let freeShipNote: string | undefined = item.shippingNoteOverride;

    // Record ALL matched in-stock store offers (even above trigger) into storeOffersCache.json & bestCurrentOffers!
    if (!item.isBigBoxRestockRadar && policyMaxBuy > 0 && landedPrice >= minFloor) {
      const gapDollars = Math.round((landedPrice - policyMaxBuy) * 100) / 100;
      const gapPct = Math.round(((landedPrice - policyMaxBuy) / policyMaxBuy) * 1000) / 10;
      const rawGapDollars = Math.round((dropPrice - policyMaxBuy) * 100) / 100;
      const rawGapPct = Math.round(((dropPrice - policyMaxBuy) / policyMaxBuy) * 1000) / 10;
      const resolvedShipNote = freeShipNote || (estimatedShipping > 0 ? `$${dropPrice.toFixed(2)} + $${estimatedShipping.toFixed(2)} Est. Ship ($${landedPrice.toFixed(2)} Landed)` : '+FREE Shipping');

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

    if (dropPrice > effectiveCeiling) {
      return {
        action: 'IGNORE',
        reason: `${isPreOrder ? '[PRE-ORDER] ' : ''}${isPreRelease ? `[${PRE_RELEASE_BLEED_TAG}] ` : ''}Price ($${dropPrice.toFixed(2)}) exceeds allowable buy threshold ($${effectiveCeiling.toFixed(2)}).`,
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
      } else {
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

    const currentPrice = dropPrice;

    recordTapeRestock({
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

    // Valid drop (<= maxBuy): sync immediately to liveStock.json so "In Stock Now" dashboard view stays accurate even if deduplicated for Discord!
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
        releaseDate: rule.releaseDate
      };
    }

    // Reload alertState from disk if reset via dashboard
    try {
      if (fs.existsSync(ALERT_STATE_PATH)) {
        alertMemory = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf-8'));
      } else {
        alertMemory = {};
      }
    } catch (e) {}

    // Persistent Deduplication per (Rule + Normalized Retailer)
    const normRetailer = normalizeAlertRetailerKey(item.retailer);
    const stateKey = `${rule.id}__${normRetailer}`;
    const prev = alertMemory[stateKey] || alertMemory[`${rule.id}__${item.retailer}`];

    let alertType: 'NEW_DROP' | 'PRICE_DROP' | 'RESTOCK_REPEAT' = 'NEW_DROP';
    let previousPrice: number | undefined = undefined;
    let previousTimeStr: string | undefined = undefined;

    if (prev) {
      const elapsedHours = (now - prev.timestamp) / (1000 * 60 * 60);
      const prevLowest = prev.lowestAlertedPrice || prev.lastPrice;
      const isSignificantPriceDrop = (
        currentPrice <= prevLowest - 3.00 ||
        currentPrice <= Math.round(prevLowest * 0.98 * 100) / 100
      );

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
          releaseDate: rule.releaseDate
        };
      }

      const isTrueRestock = Boolean(prev.wasOutOfStockSinceLastAlert) && elapsedHours >= 0.25;
      const isDailyReminder = elapsedHours >= 24;

      // Once an alert has fired for a SKU + Store, ONLY fire a subsequent alert if:
      // 1. True Restock (wasOutOfStockSinceLastAlert === true), OR
      // 2. Meaningful Price Drop (<= lowestAlertedPrice - $3.00 or <= lowestAlertedPrice * 0.98), OR
      // 3. 24-Hour Daily Reminder (elapsedHours >= 24 if still under trigger)
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

    const liveTel = getTelemetry()[rule.id];
    const marketVal = (liveTel && liveTel.rollingAverage > 0) ? liveTel.rollingAverage : (rule.estimatedMarketValue || effectiveCeiling);
    const effectiveComparePrice = freeShipNote ? currentPrice : landedPrice;
    const savingsDollars = Math.max(0, marketVal - effectiveComparePrice);
    const discountPct = marketVal > 0 ? Math.round(((marketVal - effectiveComparePrice) / marketVal) * 100) : 0;

    return {
      action: 'BUY',
      reason: `[${alertType}]${bigBoxBadge ? ` [${bigBoxBadge}]` : ''}${isPreRelease ? ` [${PRE_RELEASE_BLEED_TAG}]` : ''}${isPreOrder ? ' [⏳ PRE-ORDER]' : ''} Matched "${rule.name}" at $${currentPrice.toFixed(2)} (Landed: $${landedPrice.toFixed(2)} • $${pricePerPack.toFixed(2)}/pk • ${discountPct}% under market)`,
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
      priorityFront
    };
  }

  return { action: 'IGNORE', reason: 'No matching policy rule found.' };
}
