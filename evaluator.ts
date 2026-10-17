import fs from 'fs';
import path from 'path';
import {
  WATCH_POLICIES,
  PolicyRule,
  GLOBAL_JUNK_EXCLUSIONS,
  isValidSkuForFormFactor,
  getMinPlausiblePriceFloor,
  getMaxPlausiblePriceCeiling,
  atomicWriteJson
} from './policies';
import { recordObservation, getTelemetry } from './marketTelemetry';
import { recordDailySnapshot, recordTapeRestock, recordTapeSoldOut } from './marketTape';

export interface RawRestockItem {
  title: string;
  retailer: string;
  url: string;
  productUrl?: string;
  cart1xUrl?: string;
  cart2xUrl?: string;
  price?: number;
  stock?: number;
  itemId?: string;
  isPreOrder?: boolean;
  freeShipping?: boolean;
}

export interface EvaluationResult {
  action: 'BUY' | 'IGNORE';
  reason: string;
  rule?: PolicyRule;
  discountPct?: number;
  savingsDollars?: number;
  alertType?: 'NEW_DROP' | 'PRICE_DROP' | 'RESTOCK_REPEAT';
  previousPrice?: number;
  previousTimeStr?: string;
  landedPrice?: number;
  estimatedShipping?: number;
  freeShipNote?: string;
  isPreOrder?: boolean;
}

interface AlertMemoryEntry {
  lastPrice: number;
  lowestAlertedPrice: number;
  timestamp: number;
  timeStr: string;
  alertCount: number;
}

const ALERT_STATE_PATH = path.resolve(process.cwd(), 'alertState.json');
const LIVE_STOCK_PATH = path.resolve(process.cwd(), 'liveStock.json');
let alertMemory: Record<string, AlertMemoryEntry> = {};

try {
  if (fs.existsSync(ALERT_STATE_PATH)) {
    alertMemory = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf-8'));
  }
} catch (e) {}

function saveAlertMemory() {
  atomicWriteJson(ALERT_STATE_PATH, alertMemory);
}

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
  'costco': { freeShipThreshold: 0, flatShipping: 0 },
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
  'tabletop village': { freeShipThreshold: 150, flatShipping: 6.99 }
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
  landedPrice?: number;
  freeShipNote?: string;
  isPreOrder?: boolean;
  url: string;
  productUrl?: string;
  cart1xUrl?: string;
  cart2xUrl?: string;
  stock?: number;
  itemId?: string;
  inStock: boolean;
  updatedAt: number;
  timeStr: string;
}

export function upsertLiveStock(entry: LiveStockEntry) {
  try {
    let map: Record<string, LiveStockEntry> = {};
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

  try {
    if (!fs.existsSync(LIVE_STOCK_PATH)) return;
    const map: Record<string, any> = JSON.parse(fs.readFileSync(LIVE_STOCK_PATH, 'utf-8'));
    let changed = false;
    const recentOos: Array<{ ruleName: string; retailer: string; price: number; oosAt: number }> = Array.isArray(map.__recentOos)
      ? map.__recentOos.filter((x: any) => Date.now() - (x.oosAt || 0) < 4 * 60 * 60 * 1000)
      : [];

    for (const key of Object.keys(map)) {
      if (key === '__recentOos') continue;
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
      atomicWriteJson(LIVE_STOCK_PATH, map);
    }
  } catch (e) {}
}

export function evaluateItem(item: RawRestockItem): EvaluationResult {
  const cleanTitle = item.title.trim();
  const isPreOrder = Boolean(item.isPreOrder || /pre-?order|pre-?sale/i.test(`${cleanTitle} ${item.url}`));

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
      handle: `${item.url || ''} ${item.productUrl || ''}`
    })) {
      continue;
    }

    const minFloor = getMinPlausiblePriceFloor(rule.formFactor);
    const maxCeiling = getMaxPlausiblePriceCeiling(rule.formFactor, rule.id, rule.name);
    if (item.price !== undefined && (item.price < minFloor || item.price > maxCeiling)) {
      continue;
    }

    const liveTelPre = getTelemetry()[rule.id];
    const currentMarketRef = (liveTelPre && liveTelPre.rollingAverage > 0)
      ? Math.min(maxCeiling, liveTelPre.rollingAverage)
      : Math.min(maxCeiling, rule.estimatedMarketValue || rule.msrpCeiling);

    if (item.price && item.price >= minFloor && item.price <= maxCeiling) {
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
    // Pre-order strict ceiling: Math.min(policy.maxBuy, Math.round(policy.msrp * 1.05))
    const effectiveCeiling = isPreOrder
      ? Math.min(policyMaxBuy, Math.round(rule.msrpCeiling * 1.05))
      : policyMaxBuy;

    const dropPrice = item.price ?? effectiveCeiling;
    const shipProfile = getStoreShippingProfile(item.retailer);
    const isFreeShip = Boolean(item.freeShipping || dropPrice >= shipProfile.freeShipThreshold);
    const estimatedShipping = isFreeShip ? 0 : shipProfile.flatShipping;
    const landedPrice = Math.round((dropPrice + estimatedShipping) * 100) / 100;

    let freeShipNote: string | undefined = undefined;

    if (dropPrice > effectiveCeiling) {
      return {
        action: 'IGNORE',
        reason: `${isPreOrder ? '[PRE-ORDER] ' : ''}Price ($${dropPrice.toFixed(2)}) exceeds allowable buy threshold ($${effectiveCeiling.toFixed(2)}).`,
        rule
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
          rule
        };
      }
    }

    const now = Date.now();
    const currentPrice = dropPrice;
    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    recordTapeRestock({
      itemId: String(item.itemId || `${rule.id}__${item.retailer}`),
      targetId: rule.id,
      targetName: rule.name,
      store: item.retailer,
      price: currentPrice,
      landedPrice,
      marketPrice: currentMarketRef,
      url: item.productUrl || item.url
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
      isPreOrder,
      url: item.url,
      productUrl: item.productUrl,
      cart1xUrl: item.cart1xUrl,
      cart2xUrl: item.cart2xUrl,
      stock: item.stock,
      itemId: item.itemId,
      inStock: true,
      updatedAt: now,
      timeStr: nowTimeStr
    });

    // Reload alertState from disk if reset via dashboard
    try {
      if (fs.existsSync(ALERT_STATE_PATH)) {
        alertMemory = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf-8'));
      } else {
        alertMemory = {};
      }
    } catch (e) {}

    // Persistent Deduplication per (Rule + Retailer)
    const stateKey = `${rule.id}__${item.retailer}`;
    const prev = alertMemory[stateKey];

    let alertType: 'NEW_DROP' | 'PRICE_DROP' | 'RESTOCK_REPEAT' = 'NEW_DROP';
    let previousPrice: number | undefined = undefined;
    let previousTimeStr: string | undefined = undefined;

    if (prev) {
      const elapsedHours = (now - prev.timestamp) / (1000 * 60 * 60);
      const isSignificantPriceDrop = currentPrice <= prev.lowestAlertedPrice - 3.00;

      // Block same-price repeats for 4 hours! Only allow through immediately if the price dropped by $3+
      if (!isSignificantPriceDrop && elapsedHours < 4) {
        return {
          action: 'IGNORE',
          reason: `Deduplicated repeat: ${rule.name} at ${item.retailer} already alerted at $${prev.lastPrice.toFixed(2)} (${prev.timeStr}).`,
          rule
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

    const liveTel = getTelemetry()[rule.id];
    const marketVal = (liveTel && liveTel.rollingAverage > 0) ? liveTel.rollingAverage : (rule.estimatedMarketValue || effectiveCeiling);
    const effectiveComparePrice = freeShipNote ? currentPrice : landedPrice;
    const savingsDollars = Math.max(0, marketVal - effectiveComparePrice);
    const discountPct = marketVal > 0 ? Math.round(((marketVal - effectiveComparePrice) / marketVal) * 100) : 0;

    return {
      action: 'BUY',
      reason: `[${alertType}]${isPreOrder ? ' [⏳ PRE-ORDER]' : ''} Matched "${rule.name}" at $${currentPrice.toFixed(2)} (Landed: $${landedPrice.toFixed(2)} • ${discountPct}% under market)`,
      rule,
      discountPct,
      savingsDollars,
      alertType,
      previousPrice,
      previousTimeStr,
      landedPrice,
      estimatedShipping,
      freeShipNote,
      isPreOrder
    };
  }

  return { action: 'IGNORE', reason: 'No matching policy rule found.' };
}
