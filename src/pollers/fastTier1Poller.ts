import axios from 'axios';
import {
  isSingleCardOrNonSealed,
  isPoisonedVariantOrAccessory,
  hasMandatorySealedContainerKeyword,
  isUpcOrSpcFormat
} from '../../policies';
import { matchTargetRuleForStaging, isCaseSkuFormat } from '../../evaluator';
import { markAlertSoldOut } from '../../notifier';
import { processIncomingDrop } from '../../listener';
import { loadActiveLgsStores, StoreRegistryEntry } from '../config/configManager';
import {
  getSharedProxyAgent,
  recordFastTier1Telemetry,
  acquireShopifyEgressSlot
} from '../../lgsPoller';
import {
  SHOPIFY_USD_HEADERS,
  appendShopifyUsCountryParam,
  isVariantStrictlyAvailable,
  resolveVerifiedStoreCurrency,
  computeVerifiedStoreShippingUsd
} from '../engine/currencyGuard';

export interface FastTier1Telemetry {
  status: 'ACTIVE_15S_DELTA' | 'STARTING' | 'STOPPED';
  intervalMs: number;
  tier1StoreCount: number;
  storesPolledLastCycle: number;
  notModified304Count: number;
  variantsCheckedLastCycle: number;
  newOrRestockedHits: number;
  totalCyclesRun: number;
  lastSweepAt: number;
}

interface EtagState {
  etag?: string;
  lastModified?: string;
  last200At: number;
}

interface VariantFastSnapshot {
  available: boolean;
  price: number;
  shippingUsd: number;
  seenAt: number;
}

const etagByUrl = new Map<string, EtagState>();
const fastVariantMemory = new Map<string, VariantFastSnapshot>();

let fastTimer: NodeJS.Timeout | null = null;
let cycleInFlight = false;

export const fastTier1Telemetry: FastTier1Telemetry = {
  status: 'STARTING',
  intervalMs: 15000,
  tier1StoreCount: 0,
  storesPolledLastCycle: 0,
  notModified304Count: 0,
  variantsCheckedLastCycle: 0,
  newOrRestockedHits: 0,
  totalCyclesRun: 0,
  lastSweepAt: 0
};

const FAST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  ...SHOPIFY_USD_HEADERS
};

function getTier1ShopifyStores(): StoreRegistryEntry[] {
  const all = loadActiveLgsStores();
  const explicitTier1 = all.filter(
    (s) => s.enabled !== false && s.storeType === 'SHOPIFY_LGS' && s.tier === 'TIER1_FAST'
  );
  if (explicitTier1.length >= 20) {
    return explicitTier1.slice(0, 25);
  }
  return all.filter((s) => s.enabled !== false && s.storeType === 'SHOPIFY_LGS').slice(0, 25);
}

async function fetchStoreDeltaJson(
  url: string,
  useProxy: boolean
): Promise<{ status: number; notModified: boolean; products: any[] }> {
  const localizedUrl = appendShopifyUsCountryParam(url);
  await acquireShopifyEgressSlot(useProxy ? 'PROXY' : 'DIRECT', localizedUrl);
  const cached = etagByUrl.get(localizedUrl);
  const headers: Record<string, string> = { ...FAST_HEADERS };
  const canSendEtag = cached && Date.now() - cached.last200At < 10 * 60 * 1000;
  if (canSendEtag && cached?.etag) headers['If-None-Match'] = cached.etag;
  if (canSendEtag && cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

  const agent = useProxy ? getSharedProxyAgent() : undefined;
  const res = await axios.get(localizedUrl, {
    timeout: 7000,
    headers,
    ...(agent ? { httpsAgent: agent, proxy: false as const } : {}),
    validateStatus: (s) => (s >= 200 && s < 300) || s === 304
  });

  if (res.status === 304) {
    return { status: 304, notModified: true, products: [] };
  }

  const nextEtag = typeof res.headers?.etag === 'string' ? res.headers.etag : undefined;
  const nextLastMod = typeof res.headers?.['last-modified'] === 'string' ? res.headers['last-modified'] : undefined;
  if (nextEtag || nextLastMod) {
    etagByUrl.set(localizedUrl, { etag: nextEtag, lastModified: nextLastMod, last200At: Date.now() });
  }

  const products = Array.isArray(res.data?.products) ? res.data.products : [];
  return { status: res.status, notModified: false, products };
}

async function probeStoreJson(url: string, useProxy: boolean): Promise<{ status: number; data: any }> {
  await acquireShopifyEgressSlot(useProxy ? 'PROXY' : 'DIRECT', url);
  const agent = useProxy ? getSharedProxyAgent() : undefined;
  const res = await axios.get(url, {
    timeout: 4500,
    headers: { ...FAST_HEADERS },
    ...(agent ? { httpsAgent: agent, proxy: false as const } : {}),
    validateStatus: () => true
  });
  return { status: res.status, data: res.data };
}

async function pollSingleTier1StoreDelta(
  store: StoreRegistryEntry,
  useProxy: boolean
): Promise<{ status: number; notModified: boolean; checkedVariants: number; hits: number; latencyMs: number; productsCount: number }> {
  const started = Date.now();
  const resolvedPath = store.resolvedPath || '/products.json?limit=250';
  const fastPath = resolvedPath.replace(/limit=\d+/i, 'limit=100');
  const url = `${store.baseUrl}${fastPath.startsWith('/') ? '' : '/'}${fastPath}`;

  let activeProxy = useProxy;
  let currRes = await resolveVerifiedStoreCurrency(store, activeProxy ? 'PROXY' : 'DIRECT', (u) => probeStoreJson(u, activeProxy));
  if (currRes.quarantineNonUsd && activeProxy) {
    activeProxy = false;
    currRes = await resolveVerifiedStoreCurrency(store, 'DIRECT', (u) => probeStoreJson(u, false));
  }
  if (currRes.quarantineNonUsd) {
    return { status: 422, notModified: false, checkedVariants: 0, hits: 0, latencyMs: Date.now() - started, productsCount: 0 };
  }

  const delta = await fetchStoreDeltaJson(url, activeProxy);
  if (delta.notModified) {
    return { status: 304, notModified: true, checkedVariants: 0, hits: 0, latencyMs: Date.now() - started, productsCount: 0 };
  }

  const fxMult = currRes.fxMultiplier;
  let checkedVariants = 0;
  let hits = 0;
  const now = Date.now();

  for (const prod of delta.products) {
    if (!prod || !prod.title) continue;
    const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
    const productUrl = prod.handle ? `${store.baseUrl}/products/${prod.handle}` : store.baseUrl;

    if (
      isPoisonedVariantOrAccessory(undefined, prod.title) ||
      isSingleCardOrNonSealed(prod.title, `${prod.handle || ''} ${tagsStr}`, productUrl)
    ) {
      continue;
    }

    const variants = Array.isArray(prod.variants) ? prod.variants : [];
    for (const variant of variants) {
      if (!variant || !variant.id) continue;
      checkedVariants++;

      const varIdStr = String(variant.id);
      const isAvail = isVariantStrictlyAvailable(variant);
      const rawPrice = parseFloat(String(variant.price || '0'));
      if (!Number.isFinite(rawPrice) || rawPrice <= 0) continue;
      const shelfUsd = fxMult !== 1.0 ? Math.round(rawPrice * fxMult * 100) / 100 : rawPrice;

      if (isPoisonedVariantOrAccessory(variant.title, prod.title, shelfUsd)) {
        if (fastVariantMemory.get(varIdStr)?.available) await markAlertSoldOut(varIdStr);
        fastVariantMemory.set(varIdStr, { available: false, price: shelfUsd, shippingUsd: 0, seenAt: now });
        continue;
      }

      const shipCalc = computeVerifiedStoreShippingUsd(store, shelfUsd, currRes);
      const prevFast = fastVariantMemory.get(varIdStr);

      if (!isAvail) {
        if (prevFast?.available) {
          await markAlertSoldOut(varIdStr);
        }
        fastVariantMemory.set(varIdStr, { available: false, price: shelfUsd, shippingUsd: shipCalc.shippingUsd, seenAt: now });
        continue;
      }

      fastVariantMemory.set(varIdStr, { available: true, price: shelfUsd, shippingUsd: shipCalc.shippingUsd, seenAt: now });

      const vTitle =
        variant.title && variant.title !== 'Default Title' ? `${prod.title} - ${variant.title}` : prod.title;
      if (!hasMandatorySealedContainerKeyword(vTitle)) continue;

      const isBrandNewOrRestocked = !prevFast || !prevFast.available;
      const isPriceDropOrSync = Boolean(
        prevFast &&
        (shelfUsd !== prevFast.price || shipCalc.shippingUsd !== prevFast.shippingUsd)
      );
      if (!isBrandNewOrRestocked && !isPriceDropOrSync) continue;

      const matchedRule = matchTargetRuleForStaging(
        vTitle,
        shelfUsd,
        store.name,
        `${prod.handle || ''} ${tagsStr} ${productUrl}`
      );
      if (!matchedRule) continue;

      const checkoutUrl = `${store.baseUrl}/cart/${variant.id}:1?payment=shop_pay`;
      const stockQty =
        typeof variant.inventory_quantity === 'number' && variant.inventory_quantity > 0
          ? variant.inventory_quantity
          : undefined;

      const isSingleQty = isCaseSkuFormat(matchedRule.formFactor, matchedRule.id, vTitle)
        || isUpcOrSpcFormat(matchedRule.formFactor, matchedRule.id, vTitle);
      hits++;
      await processIncomingDrop({
        title: vTitle,
        price: shelfUsd,
        itemPrice: shelfUsd,
        shippingPrice: shipCalc.shippingUsd,
        freeShipping: shipCalc.shippingUsd === 0,
        shippingNoteOverride: shipCalc.shippingNote,
        retailer: store.name,
        url: checkoutUrl,
        productUrl,
        cart1xUrl: checkoutUrl,
        cart2xUrl: isSingleQty ? undefined : `${store.baseUrl}/cart/${variant.id}:2?payment=shop_pay`,
        cart3xUrl: isSingleQty ? undefined : `${store.baseUrl}/cart/${variant.id}:3?payment=shop_pay`,
        stock: stockQty,
        itemId: varIdStr,
        sellerVerified: true
      });
    }
  }

  return {
    status: delta.status,
    notModified: false,
    checkedVariants,
    hits,
    latencyMs: Math.max(25, Date.now() - started),
    productsCount: delta.products.length
  };
}

export async function runFastTier1DeltaCycle(): Promise<FastTier1Telemetry> {
  if (cycleInFlight) return fastTier1Telemetry;
  cycleInFlight = true;

  try {
    const tier1Stores = getTier1ShopifyStores();
    fastTier1Telemetry.tier1StoreCount = tier1Stores.length;
    const hasProxy = Boolean(getSharedProxyAgent());

    let notModCount = 0;
    let totalVariants = 0;
    let totalHits = 0;
    let polledOk = 0;
    const perStorePatch = new Map<string, { lastFastPollAt: number; lastFastLatencyMs: number; productsCount?: number }>();

    const CHUNK = 9;
    for (let i = 0; i < tier1Stores.length; i += CHUNK) {
      const batch = tier1Stores.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(
        batch.map((store, idx) => pollSingleTier1StoreDelta(store, hasProxy && idx % 3 === 1))
      );
      settled.forEach((s, idx) => {
        if (s.status === 'fulfilled') {
          polledOk++;
          if (s.value.notModified) notModCount++;
          totalVariants += s.value.checkedVariants;
          totalHits += s.value.hits;
          perStorePatch.set(batch[idx].name, {
            lastFastPollAt: Date.now(),
            lastFastLatencyMs: s.value.latencyMs,
            productsCount: s.value.productsCount
          });
        }
      });
    }

    fastTier1Telemetry.status = 'ACTIVE_15S_DELTA';
    fastTier1Telemetry.storesPolledLastCycle = polledOk;
    fastTier1Telemetry.notModified304Count = notModCount;
    fastTier1Telemetry.variantsCheckedLastCycle = totalVariants;
    fastTier1Telemetry.newOrRestockedHits = totalHits;
    fastTier1Telemetry.totalCyclesRun += 1;
    fastTier1Telemetry.lastSweepAt = Date.now();

    recordFastTier1Telemetry({ ...fastTier1Telemetry }, perStorePatch);
  } finally {
    cycleInFlight = false;
  }

  return fastTier1Telemetry;
}

export function startFastTier1Poller(intervalMs = 15000): void {
  if (fastTimer) return;
  etagByUrl.clear();
  fastVariantMemory.clear();
  fastTier1Telemetry.intervalMs = intervalMs;
  fastTier1Telemetry.status = 'ACTIVE_15S_DELTA';
  setTimeout(() => {
    runFastTier1DeltaCycle().catch(() => {});
  }, 4000).unref();
  fastTimer = setInterval(() => {
    runFastTier1DeltaCycle().catch(() => {});
  }, intervalMs);
  fastTimer.unref();
}
