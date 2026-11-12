import fs from 'fs';
import path from 'path';
import {
  WATCH_POLICIES,
  PolicyRule,
  GLOBAL_JUNK_EXCLUSIONS,
  isValidSkuForFormFactor,
  isSingleCardOrNonSealed,
  hasMandatorySealedContainerKeyword,
  matchProductToSku,
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
import { recordDailySnapshot, recordTapeRestock, recordTapeSoldOut, SALES_HISTORY_PATH } from './marketTape';
import {
  loadShippingRulesMap,
  getStoreShippingProfileFromRegistry,
  loadGlobalSettings
} from './src/config/configManager';
import {
  evaluateSkuTrendAndTiming,
  computeAutoPilotTarget,
  getLiveStoreOfferMedian,
  isPreReleaseDate,
  TrendSignal
} from './src/engine/trendAdvisor';
import { buildEarnedWatermarkSummary } from './src/engine/watermarkHistory';

export { isPreReleaseDate, TrendSignal, computeAutoPilotTarget, getLiveStoreOfferMedian };

export function isCaseSkuFormat(formFactor?: string, ruleId?: string, productName?: string, url?: string): boolean {
  return /\bcase\b|\b10[-\s]*etb\b|\b6[-\s]*box\b|\b216[-\s]*pack\b/i.test(
    `${formFactor || ''} ${ruleId || ''} ${productName || ''} ${url || ''}`
  );
}

export function isVerified1PBigBoxOrPc(retailer?: string, url?: string, isMarketplace3P = false): boolean {
  if (isMarketplace3P) return false;
  const hay = `${retailer || ''} ${url || ''}`.toLowerCase();
  if (/tcgplayer|ebay|target\s*plus|3rd[-\s]*party|marketplace/i.test(hay)) return false;
  return /pok[eé]mon\s*center|pokemoncenter\.com|\btarget\b|target\.com|\bwalmart\b|walmart\.com|best\s*buy|bestbuy\.com|\bamazon\b|amazon\.com|\bcostco\b|costco\.com|sam'?s\s*club|samsclub\.com|\bgamestop\b|gamestop\.com|barnes\s*(&|and)\s*noble|barnesandnoble\.com/i.test(hay);
}

export function buildShopifyDirectCartLinks(params: {
  url?: string;
  productUrl?: string;
  cart1xUrl?: string;
  cart2xUrl?: string;
  cart3xUrl?: string;
  itemId?: string | number;
  stock?: number;
  retailer?: string;
  formFactor?: string;
  ruleId?: string;
  productName?: string;
}): { cart1xUrl?: string; cart2xUrl?: string; cart3xUrl?: string } {
  const { url = '', productUrl = '', cart1xUrl, cart2xUrl, cart3xUrl, itemId, stock, retailer = '', formFactor, ruleId, productName } = params;
  const isCase = isCaseSkuFormat(formFactor, ruleId, productName, `${url} ${productUrl}`);
  const hay = `${retailer} ${url} ${productUrl}`.toLowerCase();
  if (/tcgplayer|ebay|target\.com|walmart\.com|bestbuy\.com|amazon\.com|costco\.com|samsclub\.com|gamestop\.com|barnesandnoble\.com|pokemoncenter\.com|reddit\.com/i.test(hay)) {
    return { cart1xUrl, cart2xUrl: isCase ? undefined : cart2xUrl, cart3xUrl: isCase ? undefined : cart3xUrl };
  }
  let baseRoot = '';
  const candidateCart = cart1xUrl || (url.includes('/cart/') ? url : '');
  if (candidateCart && candidateCart.includes('/cart/')) {
    baseRoot = candidateCart.split('?')[0].replace(/:\d+$/, '');
  } else if (itemId && /^\d{8,18}$/.test(String(itemId))) {
    const u = productUrl || url;
    const m = u.match(/^(https?:\/\/[^/]+)/i);
    if (m) baseRoot = `${m[1]}/cart/${String(itemId)}`;
  }
  if (!baseRoot) return { cart1xUrl, cart2xUrl: isCase ? undefined : cart2xUrl, cart3xUrl: isCase ? undefined : cart3xUrl };
  return {
    cart1xUrl: `${baseRoot}:1?payment=shop_pay`,
    cart2xUrl: (!isCase && (stock === undefined || stock >= 2)) ? `${baseRoot}:2?payment=shop_pay` : undefined,
    cart3xUrl: (!isCase && (stock === undefined || stock >= 3)) ? `${baseRoot}:3?payment=shop_pay` : undefined
  };
}

export function buildMobileRetailerLinks(params: {
  retailer?: string;
  url?: string;
  productUrl?: string;
  itemId?: string | number;
}): { primaryCheckoutUrl: string; secondaryPdpUrl?: string; mobileActionMarkdown?: string } {
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

export type BigBoxTier = 'MSRP_TIER_A' | 'PC_EXCLUSIVE_MSRP' | '3P_TIER_B' | 'BIG_BOX_RESTOCK_RADAR';
export type OfferStatusTier = 'UNDER_TARGET' | 'CLOSE_CALL' | 'NEAR_MISS' | 'MUTED_OWNED' | 'ABOVE_TARGET';

export function getCloseCallGraceBuffer(formFactor?: string): number {
  const ff = String(formFactor || '').toLowerCase();
  if (ff === 'booster box' || ff === 'etb case' || ff === 'master case' || ff.includes('box') || ff.includes('case')) {
    return 10.00;
  }
  return 5.00;
}

export function computeOfferShelfStatus(params: {
  dropPrice: number;
  landedPrice: number;
  estimatedShipping: number;
  triggerPrice: number;
  msrpCeiling: number;
  marketValue: number;
  formFactor?: string;
  owned?: boolean;
  wallOwned?: boolean;
  fullyConquered?: boolean;
  completionCount?: number;
  ripHuntCeiling?: number;
  stock?: number;
  muteVaulted?: boolean;
  isMsrpUnicorn?: boolean;
  isRetailFlipBypass?: boolean;
  isMarketplace3P?: boolean;
}): {
  statusTier: OfferStatusTier;
  statusTag: string;
  isCloseCall: boolean;
  closeCallDelta: number;
  comparePrice: number;
  ripPairReady: boolean;
  ripPairBadge?: string;
} {
  const {
    dropPrice,
    landedPrice,
    estimatedShipping,
    triggerPrice,
    msrpCeiling,
    marketValue,
    formFactor,
    owned = false,
    wallOwned = owned,
    fullyConquered = false,
    completionCount = wallOwned ? 1 : 0,
    ripHuntCeiling,
    stock,
    muteVaulted = false,
    isMsrpUnicorn = false,
    isRetailFlipBypass = false,
    isMarketplace3P = false
  } = params;

  const isRipHuntMode = Boolean((wallOwned || completionCount >= 1) && !fullyConquered);
  const effTrigger = triggerPrice;
  const ffLower = String(formFactor || '').toLowerCase();
  const ripPairReady = Boolean(
    isRipHuntMode &&
    ((stock !== undefined && stock >= 2) || stock === undefined || ffLower.includes('booster box'))
  );
  const ripPairBadge = ripPairReady ? '◈ ⟦ NEED RIP PAIR (QTY 2+) ⟧' : undefined;

  const graceBuffer = getCloseCallGraceBuffer(formFactor);
  const canUseShelfPrice = !isMarketplace3P && estimatedShipping <= 10.00;
  const comparePrice = (canUseShelfPrice && dropPrice <= effTrigger + graceBuffer) ? dropPrice : landedPrice;

  const isUnderOrAtTarget = comparePrice <= effTrigger || landedPrice <= effTrigger || isMsrpUnicorn || isRetailFlipBypass;
  const rawOver = Math.round((comparePrice - effTrigger) * 100) / 100;
  const withinGraceBuffer = rawOver > 0 && rawOver <= graceBuffer;
  const withinMarketOrMsrpGuard =
    (marketValue > 0 && comparePrice <= marketValue * 0.93) ||
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

  if (wallOwned && !isRipHuntMode && muteVaulted && !isMsrpUnicorn && !isRetailFlipBypass) {
    const isSingleEtb = /\b(etb|elite\s*trainer\s*box)\b/i.test(ffLower) && !/\bcase\b/i.test(ffLower);
    return {
      statusTier: 'MUTED_OWNED',
      statusTag: isSingleEtb ? '⟦ MUTED: OWNED ON WALL ⟧' : '⟦ MUTED: OWNED IN VAULT ⟧',
      isCloseCall: false,
      closeCallDelta: 0,
      comparePrice: landedPrice,
      ripPairReady: false
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

export function isMarketplaceScamOrShippingTrap(
  item: { retailer?: string; url?: string; productUrl?: string; stock?: number; sellerVerified?: boolean; isMarketplace3P?: boolean },
  dropPrice: number,
  shippingPrice: number,
  marketValue: number
): { blocked: boolean; reason?: string } {
  const combinedSource = `${item.retailer || ''} ${item.url || ''} ${item.productUrl || ''}`;
  const isMarketplace3P = Boolean(
    item.isMarketplace3P ||
    /tcgplayer|ebay|target\s*plus|walmart.*3p|3rd[-\s]*party|marketplace/i.test(combinedSource)
  );

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
  imageUrl?: string;
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
  sellerVerified?: boolean;
  sellerSales?: number;
  isMarketplace3P?: boolean;
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
  imageUrl?: string;
  bigBoxTier?: BigBoxTier;
  bigBoxBadge?: string;
  marketplaceWarning?: string;
  priorityFront?: boolean;
  statusTier?: OfferStatusTier;
  statusTag?: string;
  isCloseCall?: boolean;
  closeCallDelta?: number;
  trendSignal?: TrendSignal;
  trendVerdictLabel?: string;
  isElasticDip?: boolean;
  pendingAlertCommit?: PendingAlertCommit;
}

export interface AlertMemoryEntry {
  lastPrice: number;
  lastLandedPrice?: number;
  lowestAlertedPrice: number;
  lowestAlertedLandedPrice?: number;
  timestamp: number;
  timeStr: string;
  alertCount: number;
  wasOutOfStockSinceLastAlert?: boolean;
  itemId?: string;
}

export interface PendingAlertCommit {
  stateKey: string;
  entry: AlertMemoryEntry;
  trophyCatch?: {
    productName: string;
    ruleId: string;
    store: string;
    price: number;
    landedPrice: number;
    msrp: number;
    url: string;
    timestamp: number;
    timeStr: string;
  };
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
  statusTier?: OfferStatusTier;
  statusTag?: string;
  isCloseCall?: boolean;
  closeCallDelta?: number;
  trendSignal?: TrendSignal;
  trendVerdictLabel?: string;
  isElasticDip?: boolean;
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
  statusTier?: OfferStatusTier;
  statusTag?: string;
  isCloseCall?: boolean;
  closeCallDelta?: number;
  trendSignal?: TrendSignal;
  trendVerdictLabel?: string;
  isElasticDip?: boolean;
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
let storeOffersLastMtimeMs = 0;

function syncStoreOffersFromDiskIfNewer(): void {
  try {
    if (!fs.existsSync(STORE_OFFERS_CACHE_PATH)) return;
    const stat = fs.statSync(STORE_OFFERS_CACHE_PATH);
    if (stat.mtimeMs > storeOffersLastMtimeMs) {
      const parsed = JSON.parse(fs.readFileSync(STORE_OFFERS_CACHE_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        storeOffersCacheMem = parsed;
        storeOffersLastMtimeMs = stat.mtimeMs;
      }
    }
  } catch (e) {}
}

function flushStoreOffersToDiskNow(): void {
  try {
    atomicWriteJson(STORE_OFFERS_CACHE_PATH, storeOffersCacheMem);
    if (fs.existsSync(STORE_OFFERS_CACHE_PATH)) {
      storeOffersLastMtimeMs = fs.statSync(STORE_OFFERS_CACHE_PATH).mtimeMs;
    }
  } catch (e) {}
}

syncStoreOffersFromDiskIfNewer();

function scheduleStoreOffersFlush() {
  if (storeOffersFlushTimer) return;
  storeOffersFlushTimer = setTimeout(() => {
    storeOffersFlushTimer = null;
    flushStoreOffersToDiskNow();
  }, 2000);
}

export function upsertStoreOfferCache(entry: Omit<StoreOfferRecord, 'firstSeenAt' | 'priceDelta' | 'isFreshRestock' | 'previousPrice'>) {
  if (!entry.skuId || !entry.storeName) return;
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

export const REDDIT_OFFER_TTL_MS = 4 * 60 * 60 * 1000; // 4-hour TTL for Reddit / PKMNTCGDeals restock tips
const IN_FLIGHT_ALERT_LOCK_TTL_MS = 45 * 1000;
const inFlightAlertLocks = new Map<string, number>();
let lastRedditTtlPruneAt = 0;

export function isExpiredRedditGhostOffer(storeKey: string, rec: any, nowTs = Date.now()): boolean {
  if (!rec || typeof rec !== 'object') return false;
  const idStr = String(rec.itemId || '');
  const sourceHay = `${storeKey || ''} ${rec.storeName || ''} ${rec.retailer || ''} ${rec.store || ''} ${rec.url || ''}`;
  const isWireOrRedditOffer =
    idStr.startsWith('reddit_') ||
    idStr.startsWith('bsky_') ||
    idStr.startsWith('wire_') ||
    /PKMNTCGDeals|BIG-BOX RESTOCK RADAR|RESTOCK WIRE|Bluesky|reddit\.com/i.test(sourceHay);
  if (!isWireOrRedditOffer) return false;
  const originTs = Number(rec.firstSeenAt || rec.restockedAt || rec.updatedAt || rec.lastSeenAt || 0);
  if (originTs <= 0) return true;
  return (nowTs - originTs) > REDDIT_OFFER_TTL_MS;
}

export function pruneExpiredRedditOffers(nowTs = Date.now()): boolean {
  syncStoreOffersFromDiskIfNewer();
  let mutated = false;
  for (const [skuId, skuOffers] of Object.entries(storeOffersCacheMem)) {
    if (!skuOffers || typeof skuOffers !== 'object') continue;
    for (const [storeKey, rec] of Object.entries(skuOffers)) {
      if (isExpiredRedditGhostOffer(storeKey, rec, nowTs)) {
        delete skuOffers[storeKey];
        mutated = true;
      }
    }
  }
  if (mutated) {
    scheduleStoreOffersFlush();
  }
  return mutated;
}

export function pruneStoreMissingOffers(storeName: string, activeItemIds: Set<string>) {
  if (!storeName) return;
  syncStoreOffersFromDiskIfNewer();
  const now = Date.now();
  let mutated = false;
  for (const [skuId, skuOffers] of Object.entries(storeOffersCacheMem)) {
    if (!skuOffers || typeof skuOffers !== 'object') continue;
    const rec = skuOffers[storeName];
    if (rec && rec.itemId && !activeItemIds.has(String(rec.itemId))) {
      delete skuOffers[storeName];
      mutated = true;
    }
    if (now - lastRedditTtlPruneAt > 5 * 60 * 1000) {
      for (const [stKey, stRec] of Object.entries(skuOffers)) {
        if (isExpiredRedditGhostOffer(stKey, stRec, now)) {
          delete skuOffers[stKey];
          mutated = true;
        }
      }
    }
  }
  if (now - lastRedditTtlPruneAt > 5 * 60 * 1000) {
    lastRedditTtlPruneAt = now;
  }
  if (mutated) {
    scheduleStoreOffersFlush();
  }
}

try {
  if (fs.existsSync(ALERT_STATE_PATH)) {
    const rawMem = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf-8'));
    if (rawMem && typeof rawMem === 'object') {
      let migrated = false;
      const nextMem: Record<string, AlertMemoryEntry> = {};
      for (const [k, v] of Object.entries(rawMem)) {
        if (!v || typeof v !== 'object') continue;
        if (k.includes('__')) {
          const [skuId, storePart] = k.split('__');
          if (/^TCGPlayer Verified Seller$/i.test(storePart || '')) {
            migrated = true;
            continue;
          }
          const normSt = normalizeAlertRetailerKey(storePart || '');
          const newKey = `${normSt}::${skuId}`;
          nextMem[newKey] = v as AlertMemoryEntry;
          migrated = true;
        } else {
          nextMem[k] = v as AlertMemoryEntry;
        }
      }
      alertMemory = nextMem;
      if (migrated) {
        atomicWriteJson(ALERT_STATE_PATH, alertMemory);
      }
    }
  }
} catch (e) {}

function saveAlertMemory() {
  atomicWriteJson(ALERT_STATE_PATH, alertMemory);
}

export function commitAlertDelivery(commit?: PendingAlertCommit): void {
  if (!commit || !commit.stateKey || !commit.entry) return;
  inFlightAlertLocks.delete(commit.stateKey);
  try {
    if (fs.existsSync(ALERT_STATE_PATH)) {
      const diskMem = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf-8'));
      if (diskMem && typeof diskMem === 'object') {
        alertMemory = diskMem;
      }
    }
  } catch (e) {}
  alertMemory[commit.stateKey] = commit.entry;
  saveAlertMemory();
  if (commit.trophyCatch) {
    recordMsrpTrophyCatch(commit.trophyCatch);
  }
}

export function releasePendingAlertLock(stateKey?: string): void {
  if (!stateKey) return;
  inFlightAlertLocks.delete(stateKey);
}

export function normalizeAlertRetailerKey(retailer: string): string {
  const r = (retailer || '').trim();
  if (/tcgplayer/i.test(r)) {
    return r
      .replace(/\s*\(TCGPlayer.*?\)$/i, ' (TCGPlayer)')
      .replace(/\s*\(\$[\d.,]+\)$/i, '')
      .trim();
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

export function refreshCachedStoreOffersStatus(): void {
  try {
    syncStoreOffersFromDiskIfNewer();
    let muteVaulted = false;
    try {
      const settings = loadGlobalSettings();
      muteVaulted = Boolean(settings?.muteVaulted);
    } catch (e) {}

    const now = Date.now();
    // Backfill recent ACTIVE salesHistory records (last 48h) into storeOffersCacheMem so lowest active comps (e.g. Game Grid Lehi $79.99) stay indexed
    try {
      if (fs.existsSync(SALES_HISTORY_PATH)) {
        const salesArr = JSON.parse(fs.readFileSync(SALES_HISTORY_PATH, 'utf-8'));
        if (Array.isArray(salesArr)) {
          for (const ev of salesArr) {
            if (!ev || !ev.targetId || ev.status !== 'ACTIVE' || !ev.store || !ev.price) continue;
            const seenTs = Number(ev.lastSeenAt || ev.restockedAt || 0);
            if (now - seenTs > 48 * 3600 * 1000) continue;
            if (isExpiredRedditGhostOffer(ev.store, ev, now)) continue;
            const rule = WATCH_POLICIES.find(r => r.id === ev.targetId);
            if (!rule) continue;
            const cleanStoreKey = String(ev.store).replace(/\s*\(TCGPlayer.*?\)$/i, ' (TCGPlayer)').trim();
            const skuMap = storeOffersCacheMem[rule.id] || {};
            if (!skuMap[cleanStoreKey]) {
              const p = Number(ev.price);
              const l = Number(ev.landedPrice || p);
              const sh = Math.max(0, Math.round((l - p) * 100) / 100);
              const rip = computeRipMetrics(l, rule.id, rule.formFactor, rule.name, rule.packCount);
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
    } catch (e) {}

    let mutated = false;
    for (const [skuId, skuOffers] of Object.entries(storeOffersCacheMem)) {
      if (!skuOffers || typeof skuOffers !== 'object') continue;
      const rule = WATCH_POLICIES.find(r => r.id === skuId);
      for (const [storeKey, rec] of Object.entries(skuOffers)) {
        if (!rec || typeof rec !== 'object') continue;
        if (isExpiredRedditGhostOffer(storeKey, rec, now)) {
          delete skuOffers[storeKey];
          mutated = true;
          continue;
        }
        const candidateTitle = String(rec.rawTitle || rec.productName || '');
        const candidateFormFactor = rule?.formFactor || rec.formFactor;
        if (
          isSingleCardOrNonSealed(candidateTitle, undefined, rec.url) ||
          !hasMandatorySealedContainerKeyword(candidateTitle, candidateFormFactor)
        ) {
          delete skuOffers[storeKey];
          mutated = true;
          continue;
        }
        const rawShip = Number(rec.shipping || 0);
        const rawItemPrice = (rawShip > 0 && Math.abs(rec.price - rec.landedPrice) < 0.01 && rec.price > rawShip)
          ? Math.round((rec.landedPrice - rawShip) * 100) / 100
          : Number(rec.price || 0);
        const marketVal = Number(rule?.estimatedMarketValue || rec.marketValue || 0);
        const scamCheck = isMarketplaceScamOrShippingTrap(
          { retailer: rec.storeName || storeKey, url: rec.url, stock: rec.stock },
          rawItemPrice,
          rawShip,
          marketVal
        );
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
        const is3P = /tcgplayer|ebay|3p/i.test(rec.storeName || storeKey);
        const is1PBigBox = isVerified1PBigBoxOrPc(rec.storeName || storeKey, rec.url, is3P);
        const isMsrpUnicorn = Boolean(is1PBigBox && msrp > 0 && rawItemPrice <= Math.round(msrp * 1.08 * 100) / 100 && rawShip <= 10.00);
        const isRetailFlipBypass = Boolean(is1PBigBox && isMsrpUnicorn && (marketVal >= rawItemPrice * 1.30 || isPokemonCenterSource(rec.storeName || storeKey, rec.url)));
        const landedVal = Number(rec.landedPrice || rawItemPrice + rawShip);
        const activeStoreCount = Object.keys(skuOffers).length;
        const trend = evaluateSkuTrendAndTiming({
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
    if (fs.existsSync(LIVE_STOCK_PATH)) {
      try {
        const liveMap = JSON.parse(fs.readFileSync(LIVE_STOCK_PATH, 'utf-8')) || {};
        const bestOffers = (liveMap.__bestOffers && typeof liveMap.__bestOffers === 'object') ? liveMap.__bestOffers : {};
        let liveMutated = false;

        // Purge any leaked singles, slabs, or expired >4h Reddit ghosts from liveStock.json and __bestOffers
        for (const [k, v] of Object.entries(liveMap)) {
          if (k.startsWith('__') || !v || typeof v !== 'object') continue;
          const lsEntry = v as any;
          const t = String(lsEntry.title || '');
          const ff = String(lsEntry.formFactor || '');
          if (isExpiredRedditGhostOffer(lsEntry.retailer || k, lsEntry, now) || isSingleCardOrNonSealed(t, undefined, lsEntry.url) || !hasMandatorySealedContainerKeyword(t, ff)) {
            delete liveMap[k];
            liveMutated = true;
          }
        }
        for (const [bKey, bVal] of Object.entries(bestOffers)) {
          if (!bVal || typeof bVal !== 'object') continue;
          const boEntry = bVal as any;
          const t = String(boEntry.title || '');
          const ff = String(boEntry.formFactor || '');
          if (isExpiredRedditGhostOffer(boEntry.retailer || bKey, boEntry, now) || isSingleCardOrNonSealed(t, undefined, boEntry.url) || !hasMandatorySealedContainerKeyword(t, ff)) {
            delete bestOffers[bKey];
            liveMutated = true;
          }
        }

        for (const [skuId, skuOffers] of Object.entries(storeOffersCacheMem)) {
          const offersList = Object.values(skuOffers || {}).filter(o => o && o.landedPrice > 0);
          if (offersList.length === 0) continue;
          offersList.sort((a, b) => a.landedPrice - b.landedPrice);
          const cheapest = offersList[0];
          const rule = WATCH_POLICIES.find(r => r.id === skuId);
          if (!rule) continue;
          const trig = Math.max(rule.msrpCeiling, rule.maxMarketBuyPrice);
          const trend = evaluateSkuTrendAndTiming({
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
            const lsTrend = evaluateSkuTrendAndTiming({
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
          atomicWriteJson(LIVE_STOCK_PATH, liveMap);
        }
      } catch (e) {}
    }
  } catch (e) {}
}

refreshCachedStoreOffersStatus();

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

export interface StoreShippingProfile {
  freeShipThreshold: number;
  flatShipping: number;
}

export const STORE_SHIPPING_RULES: Record<string, StoreShippingProfile> = loadShippingRulesMap();

export function getStoreShippingProfile(retailer: string): StoreShippingProfile {
  return getStoreShippingProfileFromRegistry(retailer);
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
  statusTier?: OfferStatusTier;
  statusTag?: string;
  isCloseCall?: boolean;
  closeCallDelta?: number;
  trendSignal?: TrendSignal;
  trendVerdictLabel?: string;
  isElasticDip?: boolean;
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
  if (isSingleCardOrNonSealed(cleanTitle, handleAndUrl) || !hasMandatorySealedContainerKeyword(cleanTitle)) {
    return null;
  }
  const matched = matchProductToSku(cleanTitle, price, {
    handle: handleAndUrl,
    retailer,
    sourceUrl: handleAndUrl,
    allowPcRetailUnlock: false
  });
  if (!matched) return null;
  const minFloor = getMinPlausiblePriceFloor(matched.formFactor);
  const maxCeiling = getMaxPlausiblePriceCeiling(matched.formFactor, matched.id, matched.name);
  if (price < minFloor || price > maxCeiling) return null;
  return matched;
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

const tcgOosStrikesByItem = new Map<string, number>();

export function clearTcgOosStrikes(itemId?: string) {
  if (!itemId) return;
  tcgOosStrikesByItem.delete(String(itemId));
}

export function markLiveStockOut(itemId: string, options?: { confirmedTcgThreeStrikes?: boolean }) {
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
    recordTapeSoldOut(strId);
  } catch (e) {}

  try {
    markAlertKeyOutOfStock(strId);
  } catch (e) {}

  try {
    let offersMutated = false;
    for (const skuOffers of Object.values(storeOffersCacheMem)) {
      if (!skuOffers || typeof skuOffers !== 'object') continue;
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

function getCachedVerifiedTcgLowestShipped(skuId: string, minFloor: number, maxCeiling: number, nowTs = Date.now()): number {
  const skuOffers = storeOffersCacheMem[skuId] || {};
  let bestTcgOffer = 0;
  for (const [stKey, rec] of Object.entries(skuOffers)) {
    if (!rec || !/tcgplayer/i.test(`${stKey} ${rec.storeName || ''}`)) continue;
    if (nowTs - Number(rec.updatedAt || 0) > 48 * 3600 * 1000) continue;
    const lp = Number(rec.landedPrice || rec.price || 0);
    if (lp >= minFloor && lp <= maxCeiling && (bestTcgOffer === 0 || lp < bestTcgOffer)) {
      bestTcgOffer = lp;
    }
  }
  if (bestTcgOffer > 0) return bestTcgOffer;

  const tel: any = getTelemetry()[skuId];
  if (tel && Number(tel.lowestPrice || 0) >= minFloor && Number(tel.lowestPrice || 0) <= maxCeiling) {
    const lowStore = String(tel.lowestStore || '');
    const lowUrl = String(tel.lowestUrl || '');
    if ((/tcgplayer\.com\/product\/\d+/i.test(lowUrl) || /tcgplayer/i.test(lowStore)) && !/Case Baseline/i.test(lowStore)) {
      return Number(tel.lowestPrice);
    }
  }
  return 0;
}

export function evaluateItem(item: RawRestockItem): EvaluationResult {
  const cleanTitle = item.title.trim();
  const isPreOrder = Boolean(item.isPreOrder || /pre-?order|pre-?sale/i.test(`${cleanTitle} ${item.url}`));
  const handleAndUrl = `${item.url || ''} ${item.productUrl || ''}`;
  const bigBoxName = detectBigBoxRetailer(item.retailer, handleAndUrl);
  const isPcSource = isPokemonCenterSource(item.retailer, handleAndUrl);
  const hasPcTerm = hasPcExclusiveTerms(cleanTitle, handleAndUrl);

  // Layer 2 & Layer 3: Hard Anti-Singles / Slab / Loose-Pack Shield + Positive Sealed Container Gate
  if (isSingleCardOrNonSealed(cleanTitle, undefined, handleAndUrl)) {
    return { action: 'IGNORE', reason: 'Blocked by V5 Sealed-Only / Anti-Singles Shield (Single Card, Slab, or Loose Pack).' };
  }
  if (!hasMandatorySealedContainerKeyword(cleanTitle)) {
    return { action: 'IGNORE', reason: 'Blocked by V5 Sealed-Only Shield (Missing mandatory positive sealed container keyword).' };
  }

  for (const junkRegex of GLOBAL_JUNK_EXCLUSIONS) {
    if (junkRegex.test(cleanTitle)) {
      return { action: 'IGNORE', reason: `Filtered out by global exclusion (${junkRegex})` };
    }
  }

  for (const rule of WATCH_POLICIES) {
    const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
    if (!isMatched) continue;

    if (!hasMandatorySealedContainerKeyword(cleanTitle, rule.formFactor)) {
      continue;
    }

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
    const maxCeiling = getMaxPlausiblePriceCeiling(rule.formFactor, rule.id, rule.name, rule);
    if (item.price !== undefined && (item.price < minFloor || item.price > maxCeiling)) {
      continue;
    }

    // Identify Pokemon Center Exclusive Retail Unlock (strictly pokemoncenter.com 1P retail drop)
    const isEtbRule = rule.formFactor === 'ETB' || rule.formFactor === 'ETB Case';
    const isPcExclusiveRetailDrop = isEtbRule && isPcSource && (item.price === undefined || item.price <= 75);

    const liveTelPre = getTelemetry()[rule.id];
    const maxMedianPlausible = rule.estimatedMarketValue > 0
      ? Math.min(maxCeiling, Math.round(rule.estimatedMarketValue * 1.35 * 100) / 100)
      : maxCeiling;
    const cachedSkuOffers = Object.values(storeOffersCacheMem[rule.id] || {})
      .map((o: any) => Number(o?.price || o?.landedPrice || 0))
      .filter((p) => Number.isFinite(p) && p >= minFloor && p <= maxMedianPlausible)
      .sort((a, b) => a - b);
    let liveStoreOfferMedian: number | null = null;
    if (cachedSkuOffers.length >= 2) {
      const lowSlice = cachedSkuOffers.slice(0, Math.min(5, cachedSkuOffers.length));
      const midIdx = Math.floor(lowSlice.length / 2);
      liveStoreOfferMedian = lowSlice.length % 2 === 1
        ? lowSlice[midIdx]
        : Math.round(((lowSlice[midIdx - 1] + lowSlice[midIdx]) / 2) * 100) / 100;
    } else {
      liveStoreOfferMedian = getLiveStoreOfferMedian(rule.id, minFloor, Date.now(), maxMedianPlausible);
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
    const isFreeShip = Boolean(
      isPcExclusiveRetailDrop ||
      isBigBoxMsrp ||
      (hasExplicitShipping ? Number(item.shippingPrice) === 0 : item.freeShipping) ||
      (!hasExplicitShipping && dropPrice >= shipProfile.freeShipThreshold)
    );
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
      recordObservation(rule.id, dropPrice, item.retailer, item.productUrl || item.url, rule.msrpCeiling);
      recordDailySnapshot(rule.id, dropPrice, item.retailer, currentMarketRef);
    }

    if ((rule as any).active === false) {
      return { action: 'IGNORE', reason: `Rule "${rule.name}" is toggled OFF on dashboard.`, rule };
    }

    if (item.stock !== undefined && item.stock < rule.minStock) {
      return { action: 'IGNORE', reason: `Stock (${item.stock}) below minStock (${rule.minStock}).`, rule };
    }

    let bigBoxTier: BigBoxTier | undefined = undefined;
    let bigBoxBadge: string | undefined = undefined;
    let marketplaceWarning: string | undefined = undefined;
    let priorityFront = false;

    const isMarketplace3P = Boolean(
      item.isMarketplace3P ||
      /tcgplayer|ebay|target\s*plus|walmart.*3p|3rd[-\s]*party|marketplace/i.test(`${item.retailer} ${handleAndUrl}`)
    );
    const is1PBigBoxOrPc = isVerified1PBigBoxOrPc(item.retailer, handleAndUrl, isMarketplace3P);

    // Phase 2 Strict 1P Gate: NEVER emit MSRP_TIER_A / MSRP OVERRIDE on an LGS store; strictly reserve for verified 1st-Party Big-Box & Pokemon Center
    const isTierAMsrp = Boolean(
      is1PBigBoxOrPc &&
      rule.msrpCeiling > 0 &&
      dropPrice <= Math.round(rule.msrpCeiling * 1.08 * 100) / 100 &&
      estimatedShipping <= 10.00
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
      if (/^gamestop$/i.test(bigBoxName)) {
        bigBoxBadge = '◈ ⟦ GAMESTOP 1P IN-STOCK (SLIDER CHECK) ⟧';
      } else {
        bigBoxBadge = '⚠️ BIG-BOX 3P UNDERCUT';
        if (/walmart|amazon|target|best\s*buy|marketplace/i.test(`${bigBoxName} ${item.retailer} ${handleAndUrl}`)) {
          marketplaceWarning = '⚠️ 3P MARKETPLACE CHECK: Price is above MSRP — verify Sold & Shipped by 1st-Party Retailer before buying';
        }
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
    const isMsrpUnicorn = Boolean(is1PBigBoxOrPc && (isTierAMsrp || isPcExclusiveRetailDrop));
    let muteVaulted = false;
    let wallHunterMode = false;
    try {
      const settings = loadGlobalSettings();
      muteVaulted = Boolean(settings?.muteVaulted);
      wallHunterMode = Boolean(settings?.wallHunterMode);
    } catch (e) {}

    const isRetailFlipBypass = Boolean(
      is1PBigBoxOrPc &&
      ((dropPrice <= Math.round(rule.msrpCeiling * 1.08 * 100) / 100 && currentMarketRef >= dropPrice * 1.30) || isPcExclusiveRetailDrop || isPcSource)
    );
    if (isRetailFlipBypass && (fullyConquered || (wallOwned && muteVaulted))) {
      const gainPct = dropPrice > 0 ? Math.max(30, Math.round(((currentMarketRef - dropPrice) / dropPrice) * 100)) : 30;
      bigBoxBadge = `◈ ⟦ RETAIL MSRP FLIP / TRADE BAIT // $${dropPrice.toFixed(2)} RETAIL VS $${Math.round(currentMarketRef)} MARKET (+${gainPct}%) ⟧`;
      priorityFront = true;
    }

    const now = Date.now();
    const activeStoreCount = Object.keys(storeOffersCacheMem[rule.id] || {}).length;
    // V5 Slice 3.5 & Slice 6: Data-Driven Auto-Pilot, Rip Hunt Mode, & 30/60/90d Rolling Trend Evaluation
    const trendEval = evaluateSkuTrendAndTiming({
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
      isCloseCall: false,
      isMarketplace3P,
      nowTs: now
    });
    const {
      trendSignal,
      trendVerdictLabel,
      isElasticDip,
      qualifiesForElasticDipAlert,
      isPreRelease,
      preReleaseStatusTag,
      effectiveTargetCeiling,
      ripHuntCeiling
    } = trendEval;

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

    const { packCount, pricePerPack, isRipValueLeader } = computeRipMetrics(
      landedPrice,
      rule.id,
      rule.formFactor,
      `${rule.name} ${cleanTitle}`,
      rule.packCount
    );

    const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let freeShipNote: string | undefined = item.shippingNoteOverride;

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
    const qualifiesByElasticDip = Boolean(
      !isInVault &&
      isElasticDip &&
      qualifiesForElasticDipAlert &&
      item.sellerVerified !== false
    );

    if (!qualifiesOnShelfPrice && !qualifiesOnLandedPrice && !isCloseCall && !qualifiesByElasticDip) {
      if (dropPrice <= effectiveCeiling && landedPrice > effectiveCeiling) {
        const qtyForFreeShip = Math.ceil(shipProfile.freeShipThreshold / dropPrice);
        const hasEnoughStock = item.stock === undefined || item.stock >= qtyForFreeShip;
        if (qtyForFreeShip <= 4 && hasEnoughStock && !isMarketplace3P) {
          freeShipNote = `Buy ${qtyForFreeShip}x to hit $${shipProfile.freeShipThreshold} Free Shipping -> $${dropPrice.toFixed(2)}/ea landed`;
        } else {
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
      } else {
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
      } else {
        freeShipNote = `$${dropPrice.toFixed(2)} Shelf + $${estimatedShipping.toFixed(2)} Est. Ship ($${landedPrice.toFixed(2)} Landed)`;
      }
    }

    if (isCloseCall && !bigBoxBadge) {
      bigBoxBadge = `◈ ⟦ CLOSE CALL: WITHIN +$${closeCallDelta.toFixed(2)} OF TARGET ⟧`;
    } else if (qualifiesByElasticDip && !qualifiesOnShelfPrice && !qualifiesOnLandedPrice && !bigBoxBadge) {
      bigBoxBadge = '◈ ⟦ ELASTIC DIP OPPORTUNITY ⟧';
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

    // Phase 2 & 2B Alert Quality Gate: Kill Worse-Than-Market & <8% Falling-Knife LGS Alerts
    if (!is1PBigBoxOrPc) {
      const cachedTcgFloor = getCachedVerifiedTcgLowestShipped(rule.id, minFloor, maxCeiling, now);
      if (cachedTcgFloor > 0 && landedPrice > cachedTcgFloor + 0.01) {
        return {
          action: 'IGNORE',
          reason: `Suppressed worse-than-TCGPlayer LGS offer: $${landedPrice.toFixed(2)} landed exceeds verified TCGPlayer ($${cachedTcgFloor.toFixed(2)}).`,
          rule, packCount, pricePerPack, isRipValueLeader, isPreRelease, preReleaseStatusTag,
          releaseDate: rule.releaseDate, statusTier, statusTag, isCloseCall, closeCallDelta, trendSignal, trendVerdictLabel, isElasticDip
        };
      }
      const wmEval = buildEarnedWatermarkSummary(rule.id, landedPrice, now);
      const isActivelySliding = wmEval.isSlidingDown || trendSignal === 'FALLING_KNIFE_WAIT' || /BLEEDING[_\s-]*DOWN/i.test(`${trendSignal || ''} ${trendVerdictLabel || ''}`);
      const refSlideFloor = cachedTcgFloor > 0 ? cachedTcgFloor : currentMarketRef;
      const slideUndercutRatio = refSlideFloor > 0 ? (refSlideFloor - landedPrice) / refSlideFloor : 0;
      if (isActivelySliding && slideUndercutRatio < 0.08 && (rule.msrpCeiling <= 0 || landedPrice > rule.msrpCeiling)) {
        return {
          action: 'IGNORE',
          reason: `Suppressed falling-knife LGS offer (<8% undercut while sliding: $${landedPrice.toFixed(2)} vs $${refSlideFloor.toFixed(2)}).`,
          rule, packCount, pricePerPack, isRipValueLeader, isPreRelease, preReleaseStatusTag,
          releaseDate: rule.releaseDate, statusTier, statusTag, isCloseCall, closeCallDelta, trendSignal, trendVerdictLabel, isElasticDip
        };
      }
    }

    // Reload alertState from disk if reset via dashboard
    try {
      if (fs.existsSync(ALERT_STATE_PATH)) {
        alertMemory = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf-8'));
      } else {
        alertMemory = {};
      }
    } catch (e) {}

    // V5 Slice 3: Strict Per-Store Alert Deduplication scoped to `${storeName}::${skuId}`
    const normRetailer = normalizeAlertRetailerKey(item.retailer);
    const stateKey = `${normRetailer}::${rule.id}`;
    const inFlightUntil = inFlightAlertLocks.get(stateKey) || 0;
    if (inFlightUntil > now) {
      return {
        action: 'IGNORE',
        reason: `Deduplicated in-flight alert dispatch: ${rule.name} at ${item.retailer}.`,
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
    const prev =
      alertMemory[stateKey] ||
      alertMemory[`${item.retailer}::${rule.id}`] ||
      alertMemory[`${rule.id}__${normRetailer}`] ||
      alertMemory[`${rule.id}__${item.retailer}`];

    let alertType: 'NEW_DROP' | 'PRICE_DROP' | 'RESTOCK_REPEAT' = 'NEW_DROP';
    let previousPrice: number | undefined = undefined;
    let previousTimeStr: string | undefined = undefined;
    const prevLastLanded = prev ? Number(prev.lastLandedPrice ?? prev.lastPrice ?? landedPrice) : landedPrice;
    const prevLowestLanded = prev ? Number(prev.lowestAlertedLandedPrice ?? prev.lowestAlertedPrice ?? prevLastLanded) : landedPrice;
    const stepDownAnchor = Math.min(prevLastLanded, prevLowestLanded);

    if (prev) {
      const elapsedHours = (now - prev.timestamp) / (1000 * 60 * 60);
      const minStepDown = Math.round(Math.max(5.00, prevLastLanded * 0.04) * 100) / 100;
      const isSignificantPriceDrop = landedPrice <= Math.round((stepDownAnchor - minStepDown) * 100) / 100;

      // Minimum Re-Alert Step-Down Guard: Block $1-$4 wiggles within the cooldown window
      if (elapsedHours < 12 && !isSignificantPriceDrop && (!prev.wasOutOfStockSinceLastAlert || (!is1PBigBoxOrPc && elapsedHours < Math.max(2, (rule.cooldownMins || 120) / 60)))) {
        return {
          action: 'IGNORE',
          reason: `Deduplicated cooldown wiggle: ${rule.name} at ${item.retailer} ($${landedPrice.toFixed(2)} vs last $${prevLastLanded.toFixed(2)} — needs -$${minStepDown.toFixed(2)} step-down).`,
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

      const minRestockHours = is1PBigBoxOrPc ? 0.25 : Math.max(2, (rule.cooldownMins || 120) / 60);
      const isTrueRestock = Boolean(prev.wasOutOfStockSinceLastAlert) && elapsedHours >= minRestockHours;
      const isDailyReminder = elapsedHours >= 24;

      if (!isTrueRestock && !isSignificantPriceDrop && !isDailyReminder) {
        return {
          action: 'IGNORE',
          reason: `Deduplicated static shelf stock: ${rule.name} at ${item.retailer} already alerted at $${prevLastLanded.toFixed(2)} (${prev.timeStr}).`,
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

      previousPrice = prevLastLanded;
      previousTimeStr = prev.timeStr;
      alertType = isSignificantPriceDrop ? 'PRICE_DROP' : 'RESTOCK_REPEAT';
    }

    // Commit-After-Send Guard: Reserve 45s in-flight lock, and ONLY persist alertState.json after Discord/Telegram confirms HTTP 2xx delivery!
    inFlightAlertLocks.set(stateKey, now + IN_FLIGHT_ALERT_LOCK_TTL_MS);
    const pendingAlertCommit: PendingAlertCommit = {
      stateKey,
      entry: {
        lastPrice: currentPrice,
        lastLandedPrice: landedPrice,
        lowestAlertedPrice: prev ? Math.min(prev.lowestAlertedPrice, currentPrice) : currentPrice,
        lowestAlertedLandedPrice: prev ? Math.min(stepDownAnchor, landedPrice) : landedPrice,
        timestamp: now,
        timeStr: nowTimeStr,
        alertCount: (prev?.alertCount || 0) + 1,
        wasOutOfStockSinceLastAlert: false,
        itemId: item.itemId ? String(item.itemId) : prev?.itemId
      },
      trophyCatch: (is1PBigBoxOrPc && isMsrpUnicorn && !item.isBigBoxRestockRadar)
        ? {
            productName: rule.name,
            ruleId: rule.id,
            store: item.retailer,
            price: currentPrice,
            landedPrice,
            msrp: rule.msrpCeiling,
            url: item.productUrl || item.url,
            timestamp: now,
            timeStr: new Date(now).toISOString()
          }
        : undefined
    };

    const liveTel = getTelemetry()[rule.id];
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
      imageUrl: item.imageUrl || rule.image || undefined,
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
      isElasticDip,
      pendingAlertCommit
    };
  }

  return { action: 'IGNORE', reason: 'No matching policy rule found.' };
}
