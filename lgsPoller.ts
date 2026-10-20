import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dns from 'dns';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { processIncomingDrop } from './listener';
import { markAlertSoldOut, recordPreDropStagingEvent } from './notifier';
import { isValidSkuForFormFactor, atomicWriteJson } from './policies';
import { matchTargetRuleForStaging } from './evaluator';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dns.setDefaultResultOrder('ipv4first');

const WEBSHARE_PROXY_URL = process.env.WEBSHARE_PROXY_URL || '';
const STORE_HEALTH_PATH = path.resolve(process.cwd(), 'storeHealth.json');
const MAX_CONCURRENT_STORES = 10;
const REQUEST_TIMEOUT_MS = 8000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

export function getNextProxy(): HttpsProxyAgent<string> {
  return new HttpsProxyAgent(WEBSHARE_PROXY_URL);
}

export interface MonitoredStore {
  name: string;
  baseUrl: string;
  freeShipThreshold: number;
  flatShipping: number;
  currency?: 'USD' | 'CAD';
  resolvedPath?: string;
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
}

const storeHealthMap = new Map<string, StoreHealthRecord>();
let isPolling = false;

try {
  if (fs.existsSync(STORE_HEALTH_PATH)) {
    const raw = JSON.parse(fs.readFileSync(STORE_HEALTH_PATH, 'utf-8'));
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        storeHealthMap.set(k, v as StoreHealthRecord);
      }
    }
  }
} catch (e) {}

function flushStoreHealthToDisk() {
  const activeNames = new Set(MONITORED_STORES.map(s => s.name));
  const out: Record<string, StoreHealthRecord> = {};
  for (const [k, v] of storeHealthMap.entries()) {
    if (activeNames.has(k)) {
      out[k] = v;
    }
  }
  atomicWriteJson(STORE_HEALTH_PATH, out);
}

export const LGS_STORES: MonitoredStore[] = [
  // Existing Core Verified USD Shopify Stores (14)
  { name: 'Smoke & Mirrors', baseUrl: 'https://smokeandmirrorshobby.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Safari Zone', baseUrl: 'https://safari-zone.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Zulus Games', baseUrl: 'https://zulusgames.com', freeShipThreshold: 100, flatShipping: 5.99, currency: 'USD' },
  { name: 'Gamers Guild AZ', baseUrl: 'https://gamersguildaz.com', freeShipThreshold: 99, flatShipping: 6.99, currency: 'USD' },
  { name: 'MinMaxGames', baseUrl: 'https://minmaxgames.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Card Shop Live', baseUrl: 'https://cardshoplive.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Joshs Cards', baseUrl: 'https://joshscards.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Flipside Gaming', baseUrl: 'https://www.flipsidegaming.com', freeShipThreshold: 100, flatShipping: 5.99, currency: 'USD' },
  { name: 'Over The Brick', baseUrl: 'https://overthebrick.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Knight & Day Games', baseUrl: 'https://knightanddaygames.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'TCG Stadium', baseUrl: 'https://tcg-stadium.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Rip N Ship Arena', baseUrl: 'https://www.ripnshiparena.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Collector Store', baseUrl: 'https://collectorstore.com', freeShipThreshold: 100, flatShipping: 6.99, currency: 'USD' },
  { name: 'Prodigy Games', baseUrl: 'https://prodigygames.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  // Wave 1 Verified USD Shopify Stores (17)
  { name: 'Double Infinity Gaming', baseUrl: 'https://doubleinfinitygaming.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Paladin Cards', baseUrl: 'https://paladincards20.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'PKMN Colosseum', baseUrl: 'https://pkmncolosseum.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Mystic TCG', baseUrl: 'https://mystictcg.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Top Cut Central', baseUrl: 'https://topcutcentral.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Poke-Collect', baseUrl: 'https://poke-collect.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'AllPokeTCG', baseUrl: 'https://allpoketcg.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'The Pokecave', baseUrl: 'https://thepokecave.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Game Grid Lehi', baseUrl: 'https://store.gglehi.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Card Cavern', baseUrl: 'https://cardcaverntradingcards.com', freeShipThreshold: 100, flatShipping: 5.99, currency: 'USD' },
  { name: 'Galactic Toys', baseUrl: 'https://galactictoys.com', freeShipThreshold: 125, flatShipping: 6.99, currency: 'USD' },
  { name: '1st Edition Collectibles', baseUrl: 'https://1steditioncollectibles.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Trading Card Market', baseUrl: 'https://tradingcardmarket.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'The Gaming Goat', baseUrl: 'https://tgg-games.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Stomping Grounds', baseUrl: 'https://www.stompinggroundstcg.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Red Raccoon Games', baseUrl: 'https://redraccoongames.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Tabletop Village', baseUrl: 'https://tabletopvillage.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  // Wave 2 Phase A Newly Onboarded Verified Shopify Stores (5)
  { name: 'Card N All Gaming', baseUrl: 'https://cardnallgaming.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'The Poke Court', baseUrl: 'https://thepokecourt.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Awesome CCG', baseUrl: 'https://awesomeccg.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Tanuki Games', baseUrl: 'https://tanukigamesatx.com', freeShipThreshold: 100, flatShipping: 6.99, currency: 'USD' },
  { name: 'Hobbiesville', baseUrl: 'https://hobbiesville.com', freeShipThreshold: 175, flatShipping: 9.99, currency: 'CAD' },
  // Wave 2 Overnight Discovery Newly Onboarded Verified Shopify Stores (4)
  { name: 'PokeBox USA', baseUrl: 'https://pokeboxusa.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: '401 Games', baseUrl: 'https://store.401games.ca', freeShipThreshold: 175, flatShipping: 9.99, currency: 'CAD' },
  { name: 'Kanzen Games', baseUrl: 'https://kanzengames.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'The Card Vault', baseUrl: 'https://thecardvault.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  // Wave 3 V4 Autopilot Regional & Mom-and-Pop Verified Shopify Stores (11)
  { name: 'Level One Game Shop', baseUrl: 'https://levelonegameshop.com', freeShipThreshold: 125, flatShipping: 6.99, currency: 'USD' },
  { name: 'Mox Boarding House', baseUrl: 'https://moxboardinghouse.com', freeShipThreshold: 100, flatShipping: 6.99, currency: 'USD' },
  { name: 'Taps Games', baseUrl: 'https://tapsgames.com', freeShipThreshold: 175, flatShipping: 9.99, currency: 'CAD' },
  { name: 'Sports Card Junction', baseUrl: 'https://sportscardjunction.com', freeShipThreshold: 150, flatShipping: 6.99, currency: 'USD' },
  { name: 'Gnome Games', baseUrl: 'https://gnomegames.com', freeShipThreshold: 125, flatShipping: 6.99, currency: 'USD' },
  { name: 'Silver Goblin', baseUrl: 'https://silvergoblin.cards', freeShipThreshold: 175, flatShipping: 9.99, currency: 'CAD' },
  { name: 'Face to Face Games', baseUrl: 'https://facetofacegames.com', freeShipThreshold: 175, flatShipping: 9.99, currency: 'CAD' },
  { name: 'Miraj Trading', baseUrl: 'https://mirajtrading.com', freeShipThreshold: 175, flatShipping: 9.99, currency: 'CAD' },
  { name: 'Untouchables', baseUrl: 'https://untouchables.ca', freeShipThreshold: 175, flatShipping: 9.99, currency: 'CAD' },
  { name: 'A&C Games', baseUrl: 'https://acgamesonline.com', freeShipThreshold: 175, flatShipping: 9.99, currency: 'CAD' },
  { name: 'Tistaminis', baseUrl: 'https://tistaminis.com', freeShipThreshold: 175, flatShipping: 9.99, currency: 'CAD' }
];

export const MONITORED_STORES: MonitoredStore[] = LGS_STORES;

const variantStateMap = new Map<number, { price: number; lastCheckedAt: number; oosStrikes: number }>();
const oosVariantStagingMap = new Map<number, { price: number; seenAt: number }>();
const seededOosStores = new Set<string>();
const stagingAlertCooldownMap = new Map<string, number>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomJitter(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

const STORE_POLL_WATCHDOG_MS = 22000;
const SWEEP_WATCHDOG_MS = 105000;
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

async function axiosGetWithAbort(url: string, timeoutMs: number, httpsAgent?: any) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await axios.get(url, {
      timeout: timeoutMs,
      signal: controller.signal,
      httpsAgent,
      headers: HEADERS
    });
  } finally {
    clearTimeout(timer);
  }
}

async function smartGetJson(url: string): Promise<{ data: any; error?: string }> {
  try {
    const res = await axiosGetWithAbort(url, REQUEST_TIMEOUT_MS);
    return { data: res.data };
  } catch (e: any) {
    try {
      const proxy = getNextProxy();
      const res = await axiosGetWithAbort(url, REQUEST_TIMEOUT_MS, proxy);
      return { data: res.data };
    } catch (e2: any) {
      const status = e2?.response?.status || e?.response?.status;
      return { data: null, error: status ? `HTTP ${status}` : (e2?.code || e2?.message || 'Timeout/Network Error') };
    }
  }
}

// Automatically finds the best Pokemon collection feed on each Shopify store so we get 250 pure Pokemon items!
async function resolveBestPokemonFeed(store: MonitoredStore): Promise<string> {
  if (store.resolvedPath) return store.resolvedPath;

  const candidateHandles = [
    '/collections/pokemon-sealed/products.json?limit=250',
    '/collections/pokemon-sealed-products/products.json?limit=250',
    '/collections/pokemon-sealed-product/products.json?limit=250',
    '/collections/english-pokemon-tcg/products.json?limit=250',
    '/collections/pokemon-cards/products.json?limit=250',
    '/collections/all-pokemon-pre-orders/products.json?limit=250',
    '/collections/pokemon/products.json?limit=250',
    '/collections/pokemon-tcg/products.json?limit=250'
  ];

  // Check store's /collections.json first to see their exact Pokemon collection handle
  const { data: colData } = await smartGetJson(`${store.baseUrl}/collections.json?limit=250`);
  if (colData?.collections && Array.isArray(colData.collections)) {
    const pkmnCols = colData.collections.filter((c: any) => {
      const hay = `${c.handle || ''} ${c.title || ''}`;
      return (
        (/pokemon|pkmn/i.test(c.handle || '') || /pokemon/i.test(c.title || '')) &&
        !/single|singles|graded|slab|slabs|psa|cgc|bgs|japanese|chinese|korean|event|local|lorcana|digimon|one-piece|magic|mtg/i.test(hay)
      );
    });
    // Prefer "sealed", "booster-boxes", "pokemon-tcg", or main "pokemon" collection
    pkmnCols.sort((a: any, b: any) => {
      const aSealed = /sealed|booster|box|tcg|in-stock|^pokemon$/i.test(a.handle) ? 1 : 0;
      const bSealed = /sealed|booster|box|tcg|in-stock|^pokemon$/i.test(b.handle) ? 1 : 0;
      return bSealed - aSealed;
    });

    for (const col of pkmnCols.slice(0, 4)) {
      const testPath = `/collections/${col.handle}/products.json?limit=250`;
      const { data: prodData } = await smartGetJson(`${store.baseUrl}${testPath}`);
      if (prodData?.products && prodData.products.length >= 5) {
        store.resolvedPath = testPath;
        return testPath;
      }
    }
  }

  // Fallback to testing common candidate handles
  for (const cand of candidateHandles) {
    const { data: prodData } = await smartGetJson(`${store.baseUrl}${cand}`);
    if (prodData?.products && prodData.products.length >= 5) {
      store.resolvedPath = cand;
      return cand;
    }
  }

  store.resolvedPath = '/products.json?limit=250';
  return store.resolvedPath;
}

async function pollSingleStore(store: MonitoredStore): Promise<{ hit: boolean; productsScanned: number; skippedByCircuit: boolean }> {
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
    return { hit: false, productsScanned: 0, skippedByCircuit: true };
  }

  try {
    const feedPath = await resolveBestPokemonFeed(store);
    const { data, error } = await smartGetJson(`${store.baseUrl}${feedPath}`);
    const products = data?.products;

    if (!Array.isArray(products)) {
      health.consecutiveFailures += 1;
      health.lastError = error || 'Invalid JSON feed';
      if (health.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        health.cooldownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
        health.status = 'CIRCUIT_OPEN';
        console.warn(`[CIRCUIT BREAKER] ${store.name} failed ${health.consecutiveFailures} consecutive polls (${health.lastError}). Cooling down for 15m.`);
      } else {
        health.status = 'DEGRADED';
      }
      storeHealthMap.set(store.name, health);
      return { hit: false, productsScanned: 0, skippedByCircuit: false };
    }

    // Success: reset circuit breaker
    health.consecutiveFailures = 0;
    health.cooldownUntil = 0;
    health.status = 'HEALTHY';
    health.lastSuccessAt = Date.now();
    health.lastError = undefined;
    health.lastProductsCount = products.length;
    storeHealthMap.set(store.name, health);

    const checkNow = Date.now();
    const fxMultiplier = store.currency === 'CAD' ? 0.73 : 1.0;

    for (const prod of products) {
      for (const variant of prod.variants || []) {
        const rawPrice = parseFloat(variant.price);
        const priceNum = fxMultiplier !== 1.0 ? Math.round(rawPrice * fxMultiplier * 100) / 100 : rawPrice;
        if (!priceNum || priceNum < 18) continue;

        if (variant.available) {
          const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
          const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
          if (!isValidSkuForFormFactor(fullTitle, undefined, priceNum, { handle: `${prod.handle || ''} ${tagsStr}` })) continue;

          const prev = variantStateMap.get(variant.id);
          const minsSinceCheck = prev ? (checkNow - prev.lastCheckedAt) / (1000 * 60) : 999;

          if (!prev || priceNum !== prev.price || minsSinceCheck >= 3) {
            variantStateMap.set(variant.id, { price: priceNum, lastCheckedAt: checkNow, oosStrikes: 0 });

            const realQty = typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0
              ? variant.inventory_quantity
              : undefined;
            const cart1xUrl = `${store.baseUrl}/cart/${variant.id}:1`;
            const cart2xUrl = (realQty === undefined || realQty >= 2) ? `${store.baseUrl}/cart/${variant.id}:2` : undefined;
            const cart3xUrl = (realQty === undefined || realQty >= 3) ? `${store.baseUrl}/cart/${variant.id}:3` : undefined;
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

    seededOosStores.add(store.name);
    return { hit: products.length > 0, productsScanned: products.length, skippedByCircuit: false };
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
    return { hit: false, productsScanned: 0, skippedByCircuit: false };
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

  let activeStoresHit = 0;
  let totalProductsScanned = 0;
  let circuitOpenCount = 0;

  try {
    const queue = [...MONITORED_STORES];
    const workerCount = Math.min(MAX_CONCURRENT_STORES, queue.length);

    const workers = Array.from({ length: workerCount }, async () => {
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
          totalProductsScanned += res.productsScanned;
          if (res.skippedByCircuit) circuitOpenCount++;
        } catch (storeErr: any) {
          console.warn(`[LGS Poller] Watchdog aborted hung store ${store.name}: ${storeErr?.message || storeErr}`);
        }
        await sleep(getRandomJitter(120, 300));
      }
    });

    await withWatchdog(Promise.all(workers), SWEEP_WATCHDOG_MS, '40-Store LGS Sweep Cycle');
    flushStoreHealthToDisk();

    console.log(
      `[${new Date().toLocaleTimeString()}] LGS Sweep Complete (Pool=${MAX_CONCURRENT_STORES}): ${activeStoresHit}/${MONITORED_STORES.length} stores responded (${totalProductsScanned} Pokemon listings checked${circuitOpenCount > 0 ? `, ${circuitOpenCount} in circuit cooldown` : ''}).`
    );
  } catch (sweepErr: any) {
    console.error(`[LGS Poller] Sweep error or watchdog timeout recovered: ${sweepErr?.message || sweepErr}`);
    try { flushStoreHealthToDisk(); } catch (e) {}
  } finally {
    isPolling = false;
    const restTime = getRandomJitter(15000, 22000);
    setTimeout(pollShopifyStores, restTime);
  }
}
