import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { processIncomingDrop } from './listener';
import { markAlertSoldOut, recordPreDropStagingEvent } from './notifier';
import {
  isValidSkuForFormFactor,
  isSingleOrNonSealedShopifyProduct,
  isSingleCardOrNonSealed,
  isCollectibleSingleCardOrSlab,
  hasMandatorySealedContainerKeyword,
  atomicWriteJson
} from './policies';
import { matchTargetRuleForStaging, pruneStoreMissingOffers } from './evaluator';
import { loadActiveLgsStores } from './src/config/configManager';
import { ingestSingleCardOffer } from './src/engine/singlesSniper';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dns.setDefaultResultOrder('ipv4first');

const WEBSHARE_PROXY_URL = process.env.WEBSHARE_PROXY_URL || '';
const STORE_HEALTH_PATH = path.resolve(process.cwd(), 'storeHealth.json');
const MAX_CONCURRENT_STORES = 4;
const REQUEST_TIMEOUT_MS = 7000;
const CIRCUIT_BREAKER_THRESHOLD = 8;
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
const DYNAMIC_PROXY_FIRST_TTL_MS = 10 * 60 * 1000;
const MIN_DOMAIN_GAP_MS = 950;
const DIRECT_HTTP2_MIN_SPACING_MS = 320; // ~2.7 req/sec HTTP/2 ALPN residential cadence
const PROXY_FALLBACK_MIN_SPACING_MS = 1400;

export type ShopifyEgressLane = 'DIRECT' | 'PROXY';

const dynamicProxyFirstUntilMap = new Map<string, number>();
const store429CooldownUntilMap = new Map<string, number>();
const domainLastHitMap = new Map<string, number>();
const lgsFeedEtagCache = new Map<string, { etag?: string; lastModified?: string; cachedProducts?: any[] }>();
const laneNextAvailableAt: Record<ShopifyEgressLane, number> = { DIRECT: 0, PROXY: 0 };
let sharedProxyAgent: HttpsProxyAgent<string> | undefined;

export function getSharedProxyAgent(): HttpsProxyAgent<string> | undefined {
  if (!WEBSHARE_PROXY_URL) return undefined;
  if (!sharedProxyAgent) {
    sharedProxyAgent = new HttpsProxyAgent(WEBSHARE_PROXY_URL, { keepAlive: true, maxSockets: 6 });
  }
  return sharedProxyAgent;
}

export function getNextProxy(): HttpsProxyAgent<string> {
  return getSharedProxyAgent() || new HttpsProxyAgent(WEBSHARE_PROXY_URL, { keepAlive: true, maxSockets: 6 });
}

export function getPreferredLaneForStore(storeName: string): ShopifyEgressLane {
  if (WEBSHARE_PROXY_URL && (dynamicProxyFirstUntilMap.get(storeName) || 0) > Date.now()) {
    return 'PROXY';
  }
  return 'DIRECT';
}

export function shouldUseProxyFirstForStore(storeName: string): boolean {
  return getPreferredLaneForStore(storeName) === 'PROXY';
}

export function flagStoreDirectRateLimited(storeName: string): void {
  if (!storeName) return;
  dynamicProxyFirstUntilMap.set(storeName, Date.now() + DYNAMIC_PROXY_FIRST_TTL_MS);
}

export interface MonitoredStore {
  id?: string;
  name: string;
  baseUrl: string;
  freeShipThreshold: number;
  flatShipping: number;
  currency?: 'USD' | 'CAD';
  resolvedPath?: string;
  additionalPaths?: string[];
  tier?: 'TIER1_FAST' | 'TIER2_STANDARD';
}

export interface StoreHealthRecord {
  name: string;
  baseUrl: string;
  status: 'HEALTHY' | 'DEGRADED' | 'CIRCUIT_OPEN';
  consecutiveFailures: number;
  cooldownUntil: number;
  lastSuccessAt: number;
  lastError?: string;
  lastProductsCount: number;
  lastPagesScanned?: number;
  lastLatencyMs?: number;
  resolvedPath?: string;
  additionalPaths?: string[];
  tier?: 'TIER1_FAST' | 'TIER2_STANDARD';
  lastFastPollAt?: number;
  lastFastLatencyMs?: number;
}

const storeHealthMap = new Map<string, StoreHealthRecord>();
let bigBoxHealthTelemetry: Record<string, any> = {
  targetRedskyStatus: 'HEALTHY',
  redditRssStatus: 'HEALTHY',
  pokemonCenterStatus: 'WAF_CHALLENGE_IMPERVA',
  walmartStatus: 'WAF_CHALLENGE_PX',
  bestBuyStatus: '200_OK_0_IN_STOCK',
  costcoStatus: '200_OK_0_IN_STOCK',
  lastCheckAt: Date.now(),
  itemsScanned: 0,
  activeBigBoxCount: 9,
  northStar5: {
    pokemonCenter: {
      name: 'Pokémon Center',
      status: 'WAF CHALLENGE (IMPERVA / PX)',
      lastStatus: 'WAF CHALLENGE (IMPERVA / PX)',
      statusCode: 'WAF_CHALLENGE_IMPERVA',
      itemsExtracted: 0,
      itemsParsed: 0,
      targetRule: '$59.99 PC Exclusive ETBs & Pre-Orders + Queue Radar',
      queueState: 'NORMAL',
      lastCheckedAt: Date.now()
    },
    target: {
      name: 'Target',
      status: '200 OK // 0 IN STOCK',
      lastStatus: '200 OK // 0 IN STOCK',
      statusCode: '200_OK',
      itemsExtracted: 0,
      itemsParsed: 0,
      targetRule: 'RedSky JSON API (Zip 76177 • $49.99–$54.99 ETB / $26.99 Bundle)',
      lastCheckedAt: Date.now()
    },
    walmart: {
      name: 'Walmart',
      status: 'WAF CHALLENGE (IMPERVA / PX)',
      lastStatus: 'WAF CHALLENGE (IMPERVA / PX)',
      statusCode: 'WAF_CHALLENGE_PX',
      itemsExtracted: 0,
      itemsParsed: 0,
      targetRule: 'Sold & Shipped by Walmart Only (<= $55 ETB / <= $30 Bundle)',
      lastCheckedAt: Date.now()
    },
    bestBuy: {
      name: 'Best Buy',
      status: '200 OK // 0 IN STOCK',
      lastStatus: '200 OK // 0 IN STOCK',
      statusCode: '200_OK',
      itemsExtracted: 0,
      itemsParsed: 0,
      targetRule: 'SKU Availability Watch ($49.99–$54.99 ETB / $26.99 Bundle)',
      lastCheckedAt: Date.now()
    },
    costco: {
      name: 'Costco',
      status: '200 OK // 0 IN STOCK',
      lastStatus: '200 OK // 0 IN STOCK',
      statusCode: '200_OK_0_IN_STOCK',
      itemsExtracted: 0,
      itemsParsed: 0,
      targetRule: '$39.99–$64.99 ETB + Tin Multi-Pack Pallet Drops',
      lastCheckedAt: Date.now()
    },
    samsClub: {
      name: "Sam's Club",
      status: '200 OK // 0 IN STOCK',
      lastStatus: '200 OK // 0 IN STOCK',
      statusCode: '200_OK_0_IN_STOCK',
      itemsExtracted: 0,
      itemsParsed: 0,
      targetRule: 'Member Exclusive Sealed Multi-Packs',
      lastCheckedAt: Date.now()
    },
    gamestop: {
      name: 'GameStop',
      status: '200 OK // 0 IN STOCK',
      lastStatus: '200 OK // 0 IN STOCK',
      statusCode: '200_OK_0_IN_STOCK',
      itemsExtracted: 0,
      itemsParsed: 0,
      targetRule: '1P Retail MSRP Sealed Boxes & ETBs',
      lastCheckedAt: Date.now()
    },
    amazon: {
      name: 'Amazon (1P MSRP)',
      status: '200 OK // 0 IN STOCK',
      lastStatus: '200 OK // 0 IN STOCK',
      statusCode: '200_OK_0_IN_STOCK',
      itemsExtracted: 0,
      itemsParsed: 0,
      targetRule: 'Ships & Sold by Amazon.com (smid=ATVPDKIKX0DER)',
      lastCheckedAt: Date.now()
    },
    barnesNoble: {
      name: 'Barnes & Noble',
      status: '200 OK // 0 IN STOCK',
      lastStatus: '200 OK // 0 IN STOCK',
      statusCode: '200_OK_0_IN_STOCK',
      itemsExtracted: 0,
      itemsParsed: 0,
      targetRule: '1P Retail MSRP ETBs & Booster Bundles',
      lastCheckedAt: Date.now()
    }
  }
};
let isPolling = false;
let fastTier1Telemetry: Record<string, any> = {
  status: 'ACTIVE_15S_DELTA',
  intervalMs: 15000,
  tier1StoreCount: 25,
  storesPolledLastCycle: 25,
  notModified304Count: 0,
  variantsCheckedLastCycle: 0,
  newOrRestockedHits: 0,
  totalCyclesRun: 0,
  lastSweepAt: Date.now(),
  lastDurationMs: 0
};

try {
  if (fs.existsSync(STORE_HEALTH_PATH)) {
    const raw = JSON.parse(fs.readFileSync(STORE_HEALTH_PATH, 'utf-8'));
    if (raw && typeof raw === 'object') {
      if (raw.__bigBoxHealth && typeof raw.__bigBoxHealth === 'object') {
        bigBoxHealthTelemetry = { ...bigBoxHealthTelemetry, ...raw.__bigBoxHealth };
      }
      if (raw.__fastTier1Telemetry && typeof raw.__fastTier1Telemetry === 'object') {
        fastTier1Telemetry = { ...fastTier1Telemetry, ...raw.__fastTier1Telemetry };
      }
      for (const [k, v] of Object.entries(raw)) {
        if (k.startsWith('__')) continue;
        const rec = v as StoreHealthRecord;
        rec.status = 'HEALTHY';
        rec.consecutiveFailures = 0;
        rec.cooldownUntil = 0;
        rec.lastError = undefined;
        storeHealthMap.set(k, rec);
      }
    }
  }
} catch (e) {}

export function recordBigBoxCheckTelemetry(patch: Record<string, any>) {
  const nextNorthStar5 = patch.northStar5
    ? {
        ...(bigBoxHealthTelemetry.northStar5 || {}),
        ...Object.fromEntries(
          Object.entries(patch.northStar5).map(([k, v]: [string, any]) => [
            k,
            { ...((bigBoxHealthTelemetry.northStar5 || {})[k] || {}), ...(v || {}) }
          ])
        )
      }
    : bigBoxHealthTelemetry.northStar5;

  bigBoxHealthTelemetry = {
    ...bigBoxHealthTelemetry,
    ...patch,
    northStar5: nextNorthStar5,
    lastCheckAt: Date.now()
  };
  try {
    flushStoreHealthToDisk();
  } catch (e) {}
}

export function recordFastTier1Telemetry(
  patch: Record<string, any>,
  perStorePatch?: Map<string, { lastFastPollAt: number; lastFastLatencyMs: number; productsCount?: number }>
) {
  fastTier1Telemetry = {
    ...fastTier1Telemetry,
    ...patch,
    lastSweepAt: Date.now()
  };
  if (perStorePatch) {
    for (const [storeName, meta] of perStorePatch.entries()) {
      const rec = storeHealthMap.get(storeName);
      if (rec) {
        rec.lastFastPollAt = meta.lastFastPollAt;
        rec.lastFastLatencyMs = meta.lastFastLatencyMs;
        rec.lastLatencyMs = meta.lastFastLatencyMs;
        rec.lastSuccessAt = meta.lastFastPollAt;
        rec.status = 'HEALTHY';
        rec.consecutiveFailures = 0;
        rec.cooldownUntil = 0;
        rec.lastError = undefined;
        if (meta.productsCount && meta.productsCount > 0) {
          rec.lastProductsCount = Math.max(rec.lastProductsCount || 0, meta.productsCount);
        }
        storeHealthMap.set(storeName, rec);
      }
    }
  }
  try {
    flushStoreHealthToDisk();
  } catch (e) {}
}

export function getFastTier1Telemetry() {
  return fastTier1Telemetry;
}

function flushStoreHealthToDisk() {
  const activeNames = new Set(MONITORED_STORES.map(s => s.name));
  const out: Record<string, any> = {};
  for (const [k, v] of storeHealthMap.entries()) {
    if (activeNames.has(k)) {
      out[k] = v;
    }
  }
  out.__bigBoxHealth = bigBoxHealthTelemetry;
  out.__fastTier1Telemetry = fastTier1Telemetry;
  atomicWriteJson(STORE_HEALTH_PATH, out);
}

export const LGS_STORES: MonitoredStore[] = loadActiveLgsStores();

export const MONITORED_STORES: MonitoredStore[] = LGS_STORES;

export const CAD_TO_USD_FX = Number(process.env.CAD_TO_USD_RATE || 0.73);

export function resolveShopifyFxMultiplier(store: { name: string; baseUrl: string; currency?: string }): number {
  const explicit = String(store.currency || '').toUpperCase();
  if (explicit === 'CAD' || /\.ca(\/|$)/i.test(store.baseUrl)) {
    store.currency = 'CAD';
    return CAD_TO_USD_FX;
  }
  return 1.0;
}

const INVALID_COLLECTION_SUBPATH_REGEX = /single|singles|graded|slab|slabs|psa|cgc|bgs|japanese|chinese|korean|event|local|lorcana|digimon|one-piece|magic|mtg|3d-cut|custom|break|bandai|indonesian|thai|spanish|french|german|italian|portuguese|figure|plush|toy|apparel|supply|sleeve|binder|accessories|codes|ptcgo|ptcgl/i;
const NARROW_SUBCOLLECTION_HANDLE_REGEX = /booster-box|blister|elite-trainer|etb|pre-?order|sealed-cases|30th-pokemon|mega-evolution|a-great-place-to-begin|karls-krazy|modern-sealed/i;
const SEALED_PRIORITY_COLLECTION_HANDLE_REGEX = /^(pokemon-sealed-in-stock|pokemon-sealed|all-pokemon-sealed|all-pokemon-sealed-products|all-pokemon-sealed-product|pokemon-sealed-products|pokemon-sealed-product|sealed-pokemon-collection|in-stock-pokemon-sealed)$/i;
const BROAD_PARENT_COLLECTION_HANDLE_REGEX = /^(pokemon-sealed-in-stock|pokemon-sealed|all-pokemon-sealed|all-pokemon-sealed-products|all-pokemon-sealed-product|pokemon-sealed-products|pokemon-sealed-product|sealed-pokemon-collection|pokemon|pokemon-tcg|all-pokemon|pokemon-trading-card-game|games-pokemon|pokemon-cards|pokemon-english)$/i;

// Ensure all active stores exist in storeHealthMap with HEALTHY status on boot and sync authoritative config/stores.json paths
for (const store of MONITORED_STORES) {
  const existing = storeHealthMap.get(store.name);
  if (existing) {
    if (existing.resolvedPath && (INVALID_COLLECTION_SUBPATH_REGEX.test(existing.resolvedPath) || NARROW_SUBCOLLECTION_HANDLE_REGEX.test(existing.resolvedPath))) {
      existing.resolvedPath = undefined;
    }
    if (store.resolvedPath) {
      existing.resolvedPath = store.resolvedPath;
    } else if (existing.resolvedPath) {
      store.resolvedPath = existing.resolvedPath;
    }
    existing.additionalPaths = store.additionalPaths;
    existing.tier = store.tier || 'TIER2_STANDARD';
    existing.status = 'HEALTHY';
    existing.consecutiveFailures = 0;
    existing.cooldownUntil = 0;
  } else {
    storeHealthMap.set(store.name, {
      name: store.name,
      baseUrl: store.baseUrl,
      status: 'HEALTHY',
      consecutiveFailures: 0,
      cooldownUntil: 0,
      lastSuccessAt: Date.now(),
      lastProductsCount: 0,
      resolvedPath: store.resolvedPath,
      additionalPaths: store.additionalPaths,
      tier: store.tier || 'TIER2_STANDARD'
    });
  }
}
try {
  flushStoreHealthToDisk();
} catch (e) {}

export const variantStateMap = new Map<number, { price: number; lastCheckedAt: number; oosStrikes: number }>();
const oosVariantStagingMap = new Map<number, { price: number; seenAt: number }>();
const seededOosStores = new Set<string>();
const stagingAlertCooldownMap = new Map<string, number>();

// Two-Tier Smart Deep-Catalog Pagination Cache (10-minute TTL per store, max 2 deep store fetches per sweep starting Sweep #2)
const DEEP_PAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_DEEP_FETCHES_PER_SWEEP = 2;
const deepPaginationCache = new Map<string, { lastDeepFetchAt: number; extraProducts: any[] }>();
let deepFetchesThisSweep = 0;
let lgsSweepNumber = 0;
let initialLgsSweepDone = false;

export function isInitialLgsSweepComplete(): boolean {
  return initialLgsSweepDone;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomJitter(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

export async function acquireShopifyEgressSlot(lane: ShopifyEgressLane, urlForDomainGap?: string): Promise<boolean> {
  if (lane === 'PROXY' && !WEBSHARE_PROXY_URL) return false;
  const now = Date.now();
  const baseSpacing = lane === 'DIRECT' ? DIRECT_HTTP2_MIN_SPACING_MS : PROXY_FALLBACK_MIN_SPACING_MS;
  const spacing = baseSpacing + getRandomJitter(30, 95);
  let earliest = Math.max(now, laneNextAvailableAt[lane]);
  if (urlForDomainGap) {
    try {
      const host = new URL(urlForDomainGap).hostname.toLowerCase();
      const domainReadyAt = (domainLastHitMap.get(host) || 0) + MIN_DOMAIN_GAP_MS;
      if (domainReadyAt > earliest) earliest = domainReadyAt;
      domainLastHitMap.set(host, earliest);
    } catch (e) {}
  }
  laneNextAvailableAt[lane] = earliest + spacing;
  const waitMs = earliest - now;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
  return true;
}

// Full Chrome Document Navigation Headers: pairs with Node 26 Undici HTTP/2 ALPN fetch() so Cloudflare Bot Fight
// classifies Shopify storefront JSON reads as normal browser navigation instead of HTTP/1.1 API scraper (Bot Score 1 -> 429).
const BROWSER_NAV_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1'
};

const STORE_POLL_WATCHDOG_MS = 30000;
const SWEEP_WATCHDOG_MS = 150000;
let lastSweepStartedAt = 0;

function withWatchdog<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Watchdog timeout (${timeoutMs}ms): ${label}`));
    }, timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function performLaneJsonRequest(
  url: string,
  timeoutMs: number,
  lane: ShopifyEgressLane,
  conditionalHeaders?: Record<string, string>
): Promise<{ status: number; data: any; etag?: string; lastModified?: string; retryAfter?: string }> {
  const reqHeaders = conditionalHeaders ? { ...BROWSER_NAV_HEADERS, ...conditionalHeaders } : BROWSER_NAV_HEADERS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (lane === 'DIRECT') {
      const res = await fetch(url, {
        method: 'GET',
        headers: reqHeaders,
        signal: controller.signal,
        redirect: 'follow'
      });
      const etag = res.headers.get('etag') || undefined;
      const lastModified = res.headers.get('last-modified') || undefined;
      const retryAfter = res.headers.get('retry-after') || undefined;
      if (res.status === 304) {
        return { status: 304, data: null, etag, lastModified, retryAfter };
      }
      if (res.status < 200 || res.status >= 300) {
        const err: any = new Error(`HTTP ${res.status}`);
        err.httpStatus = res.status;
        err.retryAfter = retryAfter;
        throw err;
      }
      const data = await res.json();
      return { status: res.status, data, etag, lastModified, retryAfter };
    }

    const res = await axios.get(url, {
      timeout: timeoutMs,
      signal: controller.signal,
      httpsAgent: getSharedProxyAgent(),
      proxy: false,
      headers: reqHeaders,
      validateStatus: (s) => (s >= 200 && s < 300) || s === 304
    });
    return {
      status: res.status,
      data: res.status === 304 ? null : res.data,
      etag: res.headers?.etag,
      lastModified: res.headers?.['last-modified']
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function smartGetJson(
  url: string,
  opts?: { storeName?: string; allowEtag304?: boolean; reuseCachedProductsOn304?: boolean }
): Promise<{ data: any; notModified304?: boolean; status?: number; error?: string }> {
  const storeName = opts?.storeName || '';
  if (storeName && (store429CooldownUntilMap.get(storeName) || 0) > Date.now()) {
    return { data: null, status: 429, error: 'HTTP 429 (Store Cooldown)' };
  }

  const allow304 = Boolean(opts?.allowEtag304);
  const cachedEtag = allow304 ? lgsFeedEtagCache.get(url) : undefined;
  const condHeaders: Record<string, string> | undefined = cachedEtag
    ? {
        ...(cachedEtag.etag ? { 'If-None-Match': cachedEtag.etag } : {}),
        ...(cachedEtag.lastModified ? { 'If-Modified-Since': cachedEtag.lastModified } : {})
      }
    : undefined;

  const handleSuccess = (res: { status: number; data: any; etag?: string; lastModified?: string }) => {
    if (res.status === 304) {
      if (res.etag || res.lastModified || cachedEtag) {
        lgsFeedEtagCache.set(url, {
          etag: res.etag || cachedEtag?.etag,
          lastModified: res.lastModified || cachedEtag?.lastModified,
          cachedProducts: cachedEtag?.cachedProducts
        });
      }
      if (opts?.reuseCachedProductsOn304 && cachedEtag?.cachedProducts) {
        return { data: { products: cachedEtag.cachedProducts }, notModified304: true, status: 304 };
      }
      return { data: null, notModified304: true, status: 304 };
    }
    if (res.etag || res.lastModified) {
      lgsFeedEtagCache.set(url, {
        etag: res.etag || cachedEtag?.etag,
        lastModified: res.lastModified || cachedEtag?.lastModified,
        cachedProducts: opts?.reuseCachedProductsOn304 && Array.isArray(res.data?.products)
          ? res.data.products
          : undefined
      });
    }
    return { data: res.data, notModified304: false, status: res.status };
  };

  const primaryLane: ShopifyEgressLane = getPreferredLaneForStore(storeName);
  const altLane: ShopifyEgressLane = primaryLane === 'DIRECT' ? 'PROXY' : 'DIRECT';
  const candidateLanes: ShopifyEgressLane[] = WEBSHARE_PROXY_URL ? [primaryLane, altLane] : ['DIRECT'];

  let lastStatus: number | undefined;
  let lastErrMsg = 'Timeout/Network Error';

  for (const lane of candidateLanes) {
    const acquired = await acquireShopifyEgressSlot(lane, url);
    if (!acquired) continue;

    try {
      const res = await performLaneJsonRequest(url, REQUEST_TIMEOUT_MS, lane, condHeaders);
      return handleSuccess(res);
    } catch (err: any) {
      const st = err?.httpStatus || err?.response?.status;
      lastStatus = st || lastStatus;
      if (st === 401) {
        lastErrMsg = 'HTTP 401 (Storefront Password Locked)';
        break;
      }
      lastErrMsg = st ? `HTTP ${st}` : (err?.code || err?.message || 'Timeout/Network Error');

      if (st === 429) {
        if (lane === 'DIRECT') flagStoreDirectRateLimited(storeName);
        continue;
      }
      if (st === 403 && lane === 'DIRECT') {
        flagStoreDirectRateLimited(storeName);
        continue;
      }
      if (st && st >= 400 && st < 500) {
        break;
      }
    }
  }

  if (lastStatus === 429 && storeName) {
    store429CooldownUntilMap.set(storeName, Date.now() + 60000);
  }
  return {
    data: null,
    status: lastStatus,
    error: lastErrMsg
  };
}

function scorePokemonCollectionCandidate(col: any): number {
  const handle = String(col.handle || '').toLowerCase();
  const title = String(col.title || '').toLowerCase();
  const hay = `${handle} ${title}`;
  if (INVALID_COLLECTION_SUBPATH_REGEX.test(hay)) return -100;
  if (SEALED_PRIORITY_COLLECTION_HANDLE_REGEX.test(handle) || /pokemon-sealed-in-stock|pokemon-sealed/i.test(handle)) return 120;
  if (BROAD_PARENT_COLLECTION_HANDLE_REGEX.test(handle)) return 100;
  if (NARROW_SUBCOLLECTION_HANDLE_REGEX.test(handle)) return 10;
  if (/sealed|pokemon-tcg|all-pokemon|^pokemon/i.test(handle)) return 75;
  if (/pokemon|pkmn/i.test(handle)) return 45;
  return 20;
}

// Automatically finds the best Pokemon collection feed on each Shopify store and caches resolvedPath to disk
async function resolveBestPokemonFeed(
  store: MonitoredStore,
  health: StoreHealthRecord
): Promise<{ feedPath: string; initialProducts?: any[]; error?: string }> {
  if (store.resolvedPath && INVALID_COLLECTION_SUBPATH_REGEX.test(store.resolvedPath)) {
    store.resolvedPath = undefined;
  }
  if (health.resolvedPath && (INVALID_COLLECTION_SUBPATH_REGEX.test(health.resolvedPath) || (!store.resolvedPath && NARROW_SUBCOLLECTION_HANDLE_REGEX.test(health.resolvedPath)))) {
    health.resolvedPath = undefined;
  }
  if (store.resolvedPath) {
    health.resolvedPath = store.resolvedPath;
    return { feedPath: store.resolvedPath };
  }
  if (health.resolvedPath) {
    store.resolvedPath = health.resolvedPath;
    return { feedPath: health.resolvedPath };
  }

  // Check store's /collections.json first to see their exact Pokemon collection handle
  const { data: colData } = await smartGetJson(`${store.baseUrl}/collections.json?limit=250`, { storeName: store.name });
  if (colData?.collections && Array.isArray(colData.collections)) {
    const pkmnCols = colData.collections.filter((c: any) => {
      const hay = `${c.handle || ''} ${c.title || ''}`;
      return (
        (/pokemon|pkmn/i.test(c.handle || '') || /pokemon/i.test(c.title || '')) &&
        !INVALID_COLLECTION_SUBPATH_REGEX.test(hay)
      );
    });
    pkmnCols.sort((a: any, b: any) => {
      const scoreDiff = scorePokemonCollectionCandidate(b) - scorePokemonCollectionCandidate(a);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(b.products_count || 0) - Number(a.products_count || 0);
    });

    for (const col of pkmnCols.slice(0, 3)) {
      const testPath = `/collections/${col.handle}/products.json?limit=250`;
      const { data: prodData } = await smartGetJson(`${store.baseUrl}${testPath}`, { storeName: store.name });
      if (prodData?.products && Array.isArray(prodData.products) && prodData.products.length >= 5) {
        store.resolvedPath = testPath;
        health.resolvedPath = testPath;
        if (NARROW_SUBCOLLECTION_HANDLE_REGEX.test(col.handle) && !store.additionalPaths) {
          const companionPaths = pkmnCols
            .filter((c: any) => c.handle !== col.handle && /booster-box|elite-trainer|etb|sealed|bundle/i.test(c.handle))
            .slice(0, 2)
            .map((c: any) => `/collections/${c.handle}/products.json?limit=250`);
          if (companionPaths.length > 0) {
            store.additionalPaths = companionPaths;
            health.additionalPaths = companionPaths;
          }
        }
        return { feedPath: testPath, initialProducts: prodData.products };
      }
    }
  }

  const fallbackPath = '/products.json?limit=250';
  const { data: fallbackData, error } = await smartGetJson(`${store.baseUrl}${fallbackPath}`, { storeName: store.name });
  if (fallbackData?.products && Array.isArray(fallbackData.products)) {
    store.resolvedPath = fallbackPath;
    health.resolvedPath = fallbackPath;
    return { feedPath: fallbackPath, initialProducts: fallbackData.products };
  }

  return { feedPath: fallbackPath, error };
}

async function pollSingleStore(store: MonitoredStore): Promise<{
  hit: boolean;
  notModified304: boolean;
  rateLimited429: boolean;
  productsScanned: number;
  skippedByCircuit: boolean;
}> {
  const now = Date.now();
  const health: StoreHealthRecord = storeHealthMap.get(store.name) || {
    name: store.name,
    baseUrl: store.baseUrl,
    status: 'HEALTHY',
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastSuccessAt: 0,
    lastProductsCount: 0
  };

  if (health.cooldownUntil > now) {
    health.status = 'CIRCUIT_OPEN';
    storeHealthMap.set(store.name, health);
    return { hit: false, notModified304: false, rateLimited429: false, productsScanned: 0, skippedByCircuit: true };
  }

  try {
    const resolved = await resolveBestPokemonFeed(store, health);
    let products = resolved.initialProducts;
    let error = resolved.error;
    const hasAdditionalPaths = Array.isArray(store.additionalPaths) && store.additionalPaths.length > 0;
    const existingDeep = deepPaginationCache.get(store.name);
    const needsDeepRefreshSoon = (health.lastProductsCount || 0) >= 250 && (!existingDeep || (now - existingDeep.lastDeepFetchAt >= DEEP_PAGE_CACHE_TTL_MS));
    const canShortCircuit304 = seededOosStores.has(store.name) && !hasAdditionalPaths && !needsDeepRefreshSoon;

    if (!products) {
      const feedWithLimit = resolved.feedPath.includes('limit=')
        ? resolved.feedPath
        : `${resolved.feedPath}${resolved.feedPath.includes('?') ? '&' : '?'}limit=250`;
      const page1Url = feedWithLimit.includes('page=')
        ? `${store.baseUrl}${feedWithLimit}`
        : `${store.baseUrl}${feedWithLimit}${feedWithLimit.includes('?') ? '&' : '?'}page=1`;
      const fetched = await smartGetJson(page1Url, {
        storeName: store.name,
        allowEtag304: canShortCircuit304
      });

      if (fetched.notModified304) {
        health.consecutiveFailures = 0;
        health.cooldownUntil = 0;
        health.status = 'HEALTHY';
        health.lastSuccessAt = Date.now();
        health.lastError = undefined;
        health.lastLatencyMs = Math.max(25, Date.now() - now);
        health.resolvedPath = store.resolvedPath;
        storeHealthMap.set(store.name, health);
        return {
          hit: true,
          notModified304: true,
          rateLimited429: false,
          productsScanned: health.lastProductsCount || 0,
          skippedByCircuit: false
        };
      }

      products = fetched.data?.products;
      error = fetched.error;
    }

    if (!Array.isArray(products)) {
      const is429 = Boolean(error && /429/.test(error));
      health.lastError = error || 'Invalid JSON feed';
      if (!is429) {
        health.consecutiveFailures += 1;
      }
      if (!is429 && health.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        health.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
        health.status = 'CIRCUIT_OPEN';
        console.warn(`[CIRCUIT BREAKER] ${store.name} failed ${health.consecutiveFailures} consecutive polls (${health.lastError}). Cooling down for 15m.`);
      } else {
        health.status = 'DEGRADED';
      }
      storeHealthMap.set(store.name, health);
      return { hit: false, notModified304: false, rateLimited429: is429, productsScanned: 0, skippedByCircuit: false };
    }

    // Multi-Endpoint Sub-Collection Polling (for stores whose ETBs and Booster Boxes span multiple collections):
    if (hasAdditionalPaths) {
      const seenIds = new Set<any>(products.map((p: any) => p.id));
      const canUseExtra304 = seededOosStores.has(store.name);
      for (const extraPath of store.additionalPaths || []) {
        if (!extraPath || extraPath === resolved.feedPath) continue;
        const extraWithLimit = extraPath.includes('limit=') ? extraPath : `${extraPath}${extraPath.includes('?') ? '&' : '?'}limit=250`;
        const extraRes = await smartGetJson(`${store.baseUrl}${extraWithLimit}`, {
          storeName: store.name,
          allowEtag304: canUseExtra304,
          reuseCachedProductsOn304: true
        });
        const extraItems = extraRes.data?.products;
        if (Array.isArray(extraItems)) {
          for (const ep of extraItems) {
            if (ep && ep.id && !seenIds.has(ep.id)) {
              seenIds.add(ep.id);
              products.push(ep);
            }
          }
        }
      }
    }

    // Tier 2 (Staggered 10-Minute Deep Shelf Sweep — Pages 2 to 3, deferred until Sweep #2+):
    if (products.length >= 250) {
      let deepEntry = deepPaginationCache.get(store.name);
      const needsDeepRefresh = !deepEntry || (now - deepEntry.lastDeepFetchAt >= DEEP_PAGE_CACHE_TTL_MS);

      if (lgsSweepNumber >= 2 && needsDeepRefresh && deepFetchesThisSweep < MAX_DEEP_FETCHES_PER_SWEEP) {
        deepFetchesThisSweep += 1;
        const extraFetched: any[] = [];
        const baseFeed = resolved.feedPath.replace(/[?&]page=\d+/g, '');
        const sep = baseFeed.includes('?') ? '&' : '?';

        for (let pageNum = 2; pageNum <= 3; pageNum++) {
          const deepRes = await smartGetJson(`${store.baseUrl}${baseFeed}${sep}page=${pageNum}`, { storeName: store.name });
          const pageItems = deepRes.data?.products;
          if (!Array.isArray(pageItems) || pageItems.length === 0) break;
          extraFetched.push(...pageItems);
          if (pageItems.length < 250) break;
        }

        deepEntry = {
          lastDeepFetchAt: Date.now(),
          extraProducts: extraFetched
        };
        deepPaginationCache.set(store.name, deepEntry);
      }

      if (deepEntry && Array.isArray(deepEntry.extraProducts) && deepEntry.extraProducts.length > 0) {
        const seenIds = new Set<any>(products.map((p: any) => p.id));
        for (const dp of deepEntry.extraProducts) {
          if (dp && dp.id && !seenIds.has(dp.id)) {
            seenIds.add(dp.id);
            products.push(dp);
          }
        }
      }
    }

    // Success: reset circuit breaker and persist resolvedPath
    const pagesScanned = products.length > 0 ? Math.max(1, Math.ceil(products.length / 250)) : 1;
    health.consecutiveFailures = 0;
    health.cooldownUntil = 0;
    health.status = 'HEALTHY';
    health.lastSuccessAt = Date.now();
    health.lastError = undefined;
    health.lastProductsCount = products.length;
    health.lastPagesScanned = pagesScanned;
    health.lastLatencyMs = Math.max(45, Date.now() - now);
    health.resolvedPath = store.resolvedPath;
    storeHealthMap.set(store.name, health);

    const checkNow = Date.now();
    const fxMultiplier = resolveShopifyFxMultiplier(store);
    const activeVariantIds = new Set<string>();

    for (const prod of products) {
      if (
        /kanzen\s*games/i.test(store.name) &&
        prod.product_type &&
        String(prod.product_type).trim().toLowerCase() !== 'pokemon sealed'
      ) {
        continue;
      }
      const isShopifyMetaSingleOrNonSealed = isSingleOrNonSealedShopifyProduct(prod);

      for (const variant of prod.variants || []) {
        const rawPrice = parseFloat(variant.price);
        const priceNum = fxMultiplier !== 1.0 ? Math.round(rawPrice * fxMultiplier * 100) / 100 : rawPrice;
        if (!priceNum || priceNum < 15) continue;

        if (variant.available) {
          const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
          const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
          const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;

          // Layer 1 & Layer 2: If single card or non-sealed, route collectibles >= $15 quietly to singlesCache.json and never into sealed cache
          if (isShopifyMetaSingleOrNonSealed || isSingleCardOrNonSealed(fullTitle, prod.product_type, `${prod.handle || ''} ${tagsStr}`)) {
            if (priceNum >= 15 && isCollectibleSingleCardOrSlab(fullTitle, prod.product_type, tagsStr)) {
              const rawCompare = parseFloat(variant.compare_at_price || '0');
              const compareAtPrice = rawCompare > 0 ? (fxMultiplier !== 1.0 ? Math.round(rawCompare * fxMultiplier * 100) / 100 : rawCompare) : undefined;
              ingestSingleCardOffer({
                title: fullTitle,
                storeName: store.name,
                price: priceNum,
                compareAtPrice,
                url: productUrl,
                itemId: String(variant.id),
                productType: prod.product_type,
                tags: prod.tags,
                stock: typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0 ? variant.inventory_quantity : undefined,
                image: prod.images?.[0]?.src
              });
            }
            continue;
          }
          if (priceNum < 18) continue;
          if (!hasMandatorySealedContainerKeyword(fullTitle)) continue;
          if (!isValidSkuForFormFactor(fullTitle, undefined, priceNum, { handle: `${prod.handle || ''} ${tagsStr}` })) continue;
          activeVariantIds.add(String(variant.id));

          const prev = variantStateMap.get(variant.id);
          const minsSinceCheck = prev ? (checkNow - prev.lastCheckedAt) / (1000 * 60) : 999;

          if (!prev || priceNum !== prev.price || minsSinceCheck >= 3) {
            variantStateMap.set(variant.id, { price: priceNum, lastCheckedAt: checkNow, oosStrikes: 0 });

            const realQty = typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0
              ? variant.inventory_quantity
              : undefined;
            const cart1xUrl = `${store.baseUrl}/cart/${variant.id}:1?payment=shop_pay`;
            const cart2xUrl = (realQty === undefined || realQty >= 2) ? `${store.baseUrl}/cart/${variant.id}:2?payment=shop_pay` : undefined;
            const cart3xUrl = (realQty === undefined || realQty >= 3) ? `${store.baseUrl}/cart/${variant.id}:3?payment=shop_pay` : undefined;
            const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;
            const isPreOrder = /pre-?order|pre-?sale/i.test(`${fullTitle} ${tagsStr} ${prod.handle || ''}`);

            await processIncomingDrop({
              title: fullTitle,
              retailer: store.name,
              url: cart1xUrl,
              productUrl,
              cart1xUrl,
              cart2xUrl,
              cart3xUrl,
              isPreOrder,
              price: priceNum,
              stock: realQty,
              itemId: String(variant.id),
            });
          } else {
            prev.oosStrikes = 0;
          }
        } else {
          const prev = variantStateMap.get(variant.id);
          if (prev) {
            prev.oosStrikes += 1;
            if (prev.oosStrikes >= 2) {
              variantStateMap.delete(variant.id);
              await markAlertSoldOut(String(variant.id));
            }
          } else {
            await markAlertSoldOut(String(variant.id));
          }

          // Zero-Stock Pre-Drop Staging Detector:
          // Detect brand-new matching target uploads or OOS price slashes to <= MSRP before inventory flips live!
          const prevOos = oosVariantStagingMap.get(variant.id);
          oosVariantStagingMap.set(variant.id, { price: priceNum, seenAt: checkNow });
          const isStoreBaselineSeeded = seededOosStores.has(store.name);
          const isNewStagingUpload = !prevOos && isStoreBaselineSeeded;
          const isOosPriceSlashed = Boolean(prevOos && priceNum <= prevOos.price - 2 && prevOos.price > priceNum);

          if (isNewStagingUpload || isOosPriceSlashed) {
            const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
            const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
            if (isSingleCardOrNonSealed(fullTitle, prod.product_type, `${prod.handle || ''} ${tagsStr}`) || !hasMandatorySealedContainerKeyword(fullTitle)) {
              continue;
            }
            const matchedRule = matchTargetRuleForStaging(fullTitle, priceNum, store.name, `${prod.handle || ''} ${tagsStr}`);
            if (matchedRule && matchedRule.msrpCeiling > 0 && priceNum <= Math.round(matchedRule.msrpCeiling * 1.02 * 100) / 100) {
              const stagingKey = `${store.name}__${matchedRule.id}`;
              const lastStagedAt = stagingAlertCooldownMap.get(stagingKey) || 0;
              if (checkNow - lastStagedAt > 4 * 60 * 60 * 1000) {
                stagingAlertCooldownMap.set(stagingKey, checkNow);
                const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;
                const stagingReason = isOosPriceSlashed
                  ? `📡 PRE-DROP STAGING RADAR: OOS Price Slashed ($${prevOos!.price.toFixed(2)} -> $${priceNum.toFixed(2)}) — Watch for Inventory Flip!`
                  : `📡 PRE-DROP STAGING RADAR: New Target SKU Staged at $${priceNum.toFixed(2)} (OOS) — Watch for Inventory Flip!`;
                console.log(`📡 [PRE-DROP STAGING RADAR] ${store.name} staged "${fullTitle}" at $${priceNum.toFixed(2)} (MSRP $${matchedRule.msrpCeiling.toFixed(2)}) -> ${stagingReason}`);
                recordPreDropStagingEvent({
                  ruleId: matchedRule.id,
                  ruleName: matchedRule.name,
                  formFactor: matchedRule.formFactor || 'Sealed',
                  rawTitle: fullTitle,
                  retailer: store.name,
                  price: priceNum,
                  msrp: matchedRule.msrpCeiling,
                  marketValue: matchedRule.estimatedMarketValue || matchedRule.msrpCeiling,
                  url: productUrl,
                  stagingReason
                });
              }
            }
          }
        }
      }
    }

    if (products.length > 0) {
      pruneStoreMissingOffers(store.name, activeVariantIds);
    }
    seededOosStores.add(store.name);
    return { hit: products.length > 0, notModified304: false, rateLimited429: false, productsScanned: products.length, skippedByCircuit: false };
  } catch (err: any) {
    health.consecutiveFailures += 1;
    health.lastError = err?.message || 'Unexpected poll exception';
    if (health.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      health.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      health.status = 'CIRCUIT_OPEN';
    } else {
      health.status = 'DEGRADED';
    }
    storeHealthMap.set(store.name, health);
    return { hit: false, notModified304: false, rateLimited429: false, productsScanned: 0, skippedByCircuit: false };
  }
}

export async function pollShopifyStores(): Promise<void> {
  if (isPolling) {
    if (Date.now() - lastSweepStartedAt > SWEEP_WATCHDOG_MS + 10000) {
      console.warn('[LGS Poller] Watchdog detected stale isPolling lock (>100s) — force-resetting lock.');
      isPolling = false;
    } else {
      console.warn('[LGS Poller] Previous sweep still active — skipping overlapping cycle.');
      return;
    }
  }
  isPolling = true;
  lastSweepStartedAt = Date.now();
  deepFetchesThisSweep = 0;
  lgsSweepNumber += 1;

  // Eliminate Tier-1 Double-Polling: fastTier1Poller owns 15s single-page sweeps on TIER1_FAST stores;
  // lgsPoller reconciles TIER1_FAST deep pagination & missing-offer pruning on Sweep #1 + every 5th cycle (~5 min).
  const includeTier1Reconciliation = lgsSweepNumber === 1 || lgsSweepNumber % 5 === 0;
  const storesScheduled = includeTier1Reconciliation
    ? [...MONITORED_STORES]
    : MONITORED_STORES.filter((s) => s.tier !== 'TIER1_FAST');

  let activeStoresHit = 0;
  let sweep304Count = 0;
  let sweep429Count = 0;
  let totalProductsScanned = 0;
  let circuitOpenCount = 0;

  try {
    const queue = [...storesScheduled];
    const workerCount = Math.min(MAX_CONCURRENT_STORES, queue.length);
    await withWatchdog(
      Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (queue.length > 0) {
            const store = queue.shift();
            if (!store) break;
            try {
              const res = await withWatchdog(
                pollSingleStore(store),
                STORE_POLL_WATCHDOG_MS,
                `Store poll for ${store.name}`
              );
              if (res.hit) activeStoresHit++;
              if (res.notModified304) sweep304Count++;
              if (res.rateLimited429) sweep429Count++;
              totalProductsScanned += res.productsScanned;
              if (res.skippedByCircuit) circuitOpenCount++;
            } catch (storeErr: any) {
              console.warn(`[LGS Poller] Watchdog aborted hung store ${store.name}: ${storeErr?.message || storeErr}`);
            }
          }
        })
      ),
      SWEEP_WATCHDOG_MS,
      'LGS Sweep Cycle'
    );
    flushStoreHealthToDisk();

    let healthyFleetCount = 0;
    for (const st of MONITORED_STORES) {
      const h = storeHealthMap.get(st.name);
      if (h && h.status === 'HEALTHY') healthyFleetCount += 1;
    }
    const durSec = ((Date.now() - lastSweepStartedAt) / 1000).toFixed(1);
    const modeTag = includeTier1Reconciliation ? 'FULL+T1-RECON' : 'T2-STANDARD';

    console.log(
      `[${new Date().toLocaleTimeString()}] LGS Sweep #${lgsSweepNumber} [${modeTag}] (${durSec}s): ${activeStoresHit}/${storesScheduled.length} responded (${sweep304Count} HTTP 304, ${sweep429Count} HTTP 429, ${circuitOpenCount} cooldown) • ${totalProductsScanned} listings • ${healthyFleetCount}/${MONITORED_STORES.length} fleet healthy.`
    );
  } catch (sweepErr: any) {
    console.error(`[LGS Poller] Sweep error or watchdog timeout recovered: ${sweepErr?.message || sweepErr}`);
    try { flushStoreHealthToDisk(); } catch (e) {}
  } finally {
    initialLgsSweepDone = true;
    isPolling = false;
    const elapsedMs = Date.now() - lastSweepStartedAt;
    const restTime = Math.max(18000, 65000 - elapsedMs) + getRandomJitter(0, 3000);
    setTimeout(pollShopifyStores, restTime);
  }
}
