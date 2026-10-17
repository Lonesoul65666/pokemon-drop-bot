import axios from 'axios';
import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { getNextProxy } from './lgsPoller';
import {
  BOOSTER_BOX_EXCLUSION_TERMS,
  PC_EXCLUSIVE_EXCLUSION_TERMS,
  getMinPlausiblePriceFloor,
  getMaxPlausiblePriceCeiling,
  isValidSkuForFormFactor
} from './policies';

export interface CompQuote {
  price: number;
  shipping: number;
  shippingLabel: string;
  total: number;
  lowestPrice?: number;
  averagePrice?: number;
  url: string;
  title?: string;
  isLiveVerified: boolean;
}

export interface DualMarketComps {
  tcgplayer?: CompQuote;
  ebay?: CompQuote;
}

export const GLOBAL_JUNK_BLOCKLIST = [
  'empty',
  'no packs',
  'box only',
  'case only',
  'acrylic',
  'protector',
  'code',
  'sleeves',
  'dice',
  'opened',
  'damaged',
  'weighed',
  'pack only',
  'single pack',
  'art set',
  '3-pack',
  '3 pack',
  'blister',
  'checklane',
  'sleeved',
  'build & battle',
  'build and battle',
  'korean',
  'japanese',
  'jp ',
  'chinese',
  's-chinese',
  't-chinese',
  'spanish',
  'french',
  'german'
];

export const PC_EXCLUSIVE_BLOCKLIST = PC_EXCLUSIVE_EXCLUSION_TERMS;

export const SINGLE_BULK_BLOCKLIST = [
  'case',
  'cases',
  'x10',
  '10x',
  'x6',
  '6x',
  'x4',
  '4x',
  'lot',
  'display case',
  'master case',
  'sealed case',
  'box of 10',
  'set of'
];

export const CASE_REQUIRED_IDENTIFIERS = [
  'case',
  'x6',
  '6x',
  'x10',
  '10x'
];

export const MULTI_CASE_BLOCKLIST = [
  '2 cases',
  'multiple cases',
  'pallet'
];

export function inferFormFactor(ruleId?: string, ruleName?: string): string {
  const id = (ruleId || '').toLowerCase();
  const name = (ruleName || '').toLowerCase();
  if (id.endsWith('-etb-case') || ((name.includes('etb') || name.includes('elite trainer')) && name.includes('case'))) {
    return 'ETB Case';
  }
  if (id.endsWith('-booster-case') || id.endsWith('-case') || name.includes('master case') || (name.includes('booster') && name.includes('case'))) {
    return 'Master Case';
  }
  if (id.endsWith('-etb') || name.includes('etb') || name.includes('elite trainer')) {
    return 'ETB';
  }
  if (id.endsWith('-bundle') || name.includes('bundle')) {
    return 'Booster Bundle';
  }
  return 'Booster Box';
}

export function isValidCompTitle(title: string, targetName: string, formFactor: string, price?: number, ruleId?: string): boolean {
  const lower = ` ${title.toLowerCase()} `;
  const targetLower = targetName.toLowerCase();

  // 0. Shared SKU, PC Firewall & Price Floor/Ceiling Validation
  if (!isValidSkuForFormFactor(title, formFactor, price, { ruleId, targetName })) {
    return false;
  }

  // 1. Global Junk Blocklist (reject on ALL targets)
  if (GLOBAL_JUNK_BLOCKLIST.some(term => lower.includes(term))) {
    return false;
  }

  // 1b. Strict 36-Pack Booster Box & Master Case Half-Box / Bundle / Foreign Exclusions
  if (formFactor === 'Booster Box' || formFactor === 'Master Case') {
    if (BOOSTER_BOX_EXCLUSION_TERMS.some(term => lower.includes(term))) {
      return false;
    }
  }

  // 2. Standard ETB & ETB Case Rule: reject PC exclusives unless target explicitly requests it
  if (formFactor === 'ETB' || formFactor === 'ETB Case') {
    const isTargetPcExclusive = PC_EXCLUSIVE_BLOCKLIST.some(term => targetLower.includes(term));
    if (!isTargetPcExclusive && PC_EXCLUSIVE_BLOCKLIST.some(term => lower.includes(term))) {
      return false;
    }
  }

  // 3. Single Item Isolation (ETB, Booster Box, Booster Bundle)
  if (formFactor === 'ETB' || formFactor === 'Booster Box' || formFactor === 'Booster Bundle') {
    if (SINGLE_BULK_BLOCKLIST.some(term => lower.includes(term))) {
      return false;
    }
  }

  // 4. Case Isolation (Master Case, ETB Case)
  if (formFactor === 'Master Case' || formFactor === 'ETB Case') {
    if (!CASE_REQUIRED_IDENTIFIERS.some(term => lower.includes(term))) {
      return false;
    }
    if (MULTI_CASE_BLOCKLIST.some(term => lower.includes(term))) {
      return false;
    }
  }

  return true;
}

export function computeTrimmedCompStats(rawPrices: number[], minFloor = 0, maxCeiling = 99999): { lowestPrice: number; averagePrice: number; trimmedSlice: number[] } | null {
  const valid = rawPrices.filter(p => Number.isFinite(p) && p > 0 && p >= minFloor && p <= maxCeiling).sort((a, b) => a - b);
  if (valid.length === 0) return null;

  let trimmed = valid;
  if (valid.length >= 5) {
    const startIdx = Math.floor(valid.length * 0.15);
    const endIdx = Math.max(startIdx + 1, Math.ceil(valid.length * 0.50));
    trimmed = valid.slice(startIdx, endIdx);
  }

  const mid = Math.floor(trimmed.length / 2);
  const median = trimmed.length % 2 === 1
    ? trimmed[mid]
    : (trimmed[mid - 1] + trimmed[mid]) / 2;

  const averagePrice = Math.round(median * 100) / 100;
  const lowestPrice = Math.round(Math.min(...trimmed, averagePrice) * 100) / 100;

  return { lowestPrice, averagePrice, trimmedSlice: trimmed };
}

export function applySyncSanityGuard(
  price: number,
  formFactor: string,
  singleUnitBaseline?: number,
  options?: { sampleCount?: number; ruleId?: string; targetName?: string; policyBaseline?: number }
): number {
  const minFloor = getMinPlausiblePriceFloor(formFactor);
  const maxCeiling = getMaxPlausiblePriceCeiling(formFactor, options?.ruleId, options?.targetName);
  let clamped = Math.max(minFloor, Math.min(maxCeiling, Math.round(price * 100) / 100));

  if ((formFactor === 'ETB Case' || formFactor === 'Master Case') && singleUnitBaseline && singleUnitBaseline > 0) {
    const multCap = formFactor === 'Master Case' ? 6.5 : 10.5;
    clamped = Math.min(clamped, Math.round(singleUnitBaseline * multCap * 100) / 100);
  }

  const ruleIdLower = (options?.ruleId || '').toLowerCase();
  const isMeEra = ruleIdLower.startsWith('me-');
  const isLowSample = options?.sampleCount !== undefined && options.sampleCount < 5;
  const isMeEtbOrBundle = isMeEra && (formFactor === 'ETB' || formFactor === 'Booster Bundle');

  if ((isLowSample || isMeEtbOrBundle) && options?.policyBaseline && options.policyBaseline > 0) {
    const maxAllowed = Math.max(minFloor, Math.min(maxCeiling, Math.round(options.policyBaseline * 1.35 * 100) / 100));
    clamped = Math.min(clamped, maxAllowed);
  }

  return Math.min(clamped, maxCeiling);
}

function cleanQuery(name: string): string {
  return name
    .replace(/\(36-Pack\)/gi, '')
    .replace(/\(6 Boxes \/ 216 Packs\)/gi, '')
    .replace(/\(10 ETBs\)/gi, '')
    .replace(/6-Pack /gi, '')
    .replace(/Sealed /gi, '')
    .replace(/Mega Evolution:/gi, '')
    .replace(/Scarlet & Violet:/gi, '')
    .replace(/ETB/gi, 'Elite Trainer Box')
    .trim();
}

async function smartPost(url: string, body: any, headers: Record<string, string>, timeout = 5500) {
  try {
    return await axios.post(url, body, { timeout, headers });
  } catch (e) {
    return await axios.post(url, body, { timeout, httpsAgent: getNextProxy(), headers });
  }
}

async function smartGet(url: string, headers: Record<string, string>, timeout = 5500) {
  try {
    return await axios.get(url, { timeout, headers });
  } catch (e) {
    return await axios.get(url, { timeout, httpsAgent: getNextProxy(), headers });
  }
}

async function fetchExactTcgSellerListings(prodId: number, minFloor: number, maxCeiling: number): Promise<Array<{ itemPrice: number; shipping: number; total: number }>> {
  try {
    const url = `https://mp-search-api.tcgplayer.com/v1/product/${prodId}/listings`;
    const body = {
      filters: {
        term: { sellerStatus: "Live", channelId: 0, language: ["English"] },
        range: { quantity: { gte: 1 } },
        exclude: { channelExclusion: 0 }
      },
      from: 0,
      size: 15,
      sort: { field: "price+shipping", order: "asc" },
      context: { shippingCountry: "US", cart: {} }
    };
    const res = await smartPost(url, body, { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, 4500);
    const listings = res.data?.results?.[0]?.results || [];
    const quotes: Array<{ itemPrice: number; shipping: number; total: number }> = [];
    for (const l of listings) {
      const p = parseFloat(l.price || 0);
      const s = parseFloat(l.shippingPrice || 0);
      const total = Math.round((p + s) * 100) / 100;
      if (p > 0 && total >= minFloor && total <= maxCeiling) {
        quotes.push({ itemPrice: p, shipping: s, total });
      }
    }
    return quotes;
  } catch (e) {}
  return [];
}

async function fetchTcgPlayerComp(ruleId: string | undefined, ruleName: string, singleUnitBaseline?: number, policyBaseline?: number): Promise<CompQuote | undefined> {
  const query = cleanQuery(ruleName);
  const formFactor = inferFormFactor(ruleId, ruleName);
  const minFloor = getMinPlausiblePriceFloor(formFactor);
  const maxCeiling = getMaxPlausiblePriceCeiling(formFactor, ruleId, ruleName);

  try {
    const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(query)}&isList=false`;
    const body = {
      algorithm: "sales_synonym_v2",
      from: 0,
      size: 12,
      filters: { term: { productLineName: ["pokemon"] }, range: {}, match: {} },
      listingSearch: {
        context: { cart: {} },
        filters: {
          term: { sellerStatus: "Live", channelId: 0 },
          range: { quantity: { gte: 1 } },
          exclude: { channelExclusion: 0 }
        }
      },
      context: { cart: {}, shippingCountry: "US" },
      settings: { useFuzzySearch: true, didYouMean: {} },
      sort: {}
    };

    const res = await smartPost(url, body, { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, 5500);

    const results = res.data?.results?.[0]?.results || [];
    for (const item of results) {
      if (item.customAttributes?.number) continue;
      const productName = `${item.productName || ''} ${item.setName || ''}`.trim();
      const t = productName.toLowerCase();

      if (!isValidCompTitle(productName, ruleName, formFactor, undefined, ruleId)) continue;

      const qLower = query.toLowerCase();
      if (qLower.includes('elite trainer') && !t.includes('elite trainer') && !t.includes('etb')) continue;
      if (qLower.includes('booster box') && !t.includes('booster box')) continue;
      if (qLower.includes('bundle') && !t.includes('bundle')) continue;

      const prodId = Math.floor(Number(item.productId));
      const directUrl = `https://www.tcgplayer.com/product/${prodId}`;

      const exactListings = await fetchExactTcgSellerListings(prodId, minFloor, maxCeiling);
      const listingTotals = exactListings.map(l => l.total);
      const fallbackPrice = parseFloat(item.lowestPrice || item.marketPrice || 0);
      const validFallback = (fallbackPrice >= minFloor && fallbackPrice <= maxCeiling) ? [fallbackPrice] : [];
      const rawSamples = listingTotals.length > 0 ? listingTotals : validFallback;
      const stats = computeTrimmedCompStats(rawSamples, minFloor, maxCeiling);
      if (!stats || stats.lowestPrice < minFloor) continue;

      const guardOpts = { sampleCount: rawSamples.length, ruleId, targetName: ruleName, policyBaseline };
      const clampedAvg = applySyncSanityGuard(stats.averagePrice, formFactor, singleUnitBaseline, guardOpts);
      const clampedLow = Math.max(minFloor, Math.min(applySyncSanityGuard(stats.lowestPrice, formFactor, singleUnitBaseline, guardOpts), clampedAvg));
      const shipAmt = exactListings.length > 0 ? exactListings[0].shipping : 0;

      let shipLabel = '(Free shipping)';
      if (shipAmt > 0) {
        shipLabel = `(+$${shipAmt.toFixed(2)} shipping)`;
      } else if (clampedAvg > 0) {
        shipLabel = `(Free ship • Mkt: $${clampedAvg.toFixed(2)})`;
      }

      return {
        price: clampedLow,
        shipping: Math.round(shipAmt * 100) / 100,
        shippingLabel: shipLabel,
        total: clampedLow,
        lowestPrice: clampedLow,
        averagePrice: clampedAvg,
        url: directUrl,
        title: item.productName,
        isLiveVerified: true
      };
    }
  } catch (e) {}

  return undefined;
}

async function fetchEbayComp(ruleId: string | undefined, ruleName: string, priceFloorRef: number, singleUnitBaseline?: number, policyBaseline?: number): Promise<CompQuote | undefined> {
  const query = cleanQuery(ruleName);
  const formFactor = inferFormFactor(ruleId, ruleName);
  const hardMinFloor = getMinPlausiblePriceFloor(formFactor);
  const hardMaxCeiling = getMaxPlausiblePriceCeiling(formFactor, ruleId, ruleName);
  const minValid = Math.max(hardMinFloor, (priceFloorRef || hardMinFloor) * 0.60);
  const maxValid = Math.min(hardMaxCeiling, Math.max(minValid * 1.5, (priceFloorRef || hardMinFloor) * 1.55));

  try {
    const searchQ = `site:ebay.com/itm "Pokemon" ${query} Sealed`;
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(searchQ)}&count=15`;
    const res = await smartGet(bingUrl, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }, 5500);

    const $ = cheerio.load(res.data || '');
    const candidates: CompQuote[] = [];

    $('li.b_algo').each((_, el) => {
      const title = $(el).find('h2').text().trim();
      const link = $(el).find('h2 a').attr('href') || '';
      const snippet = $(el).text();

      if (!link.includes('ebay.com/itm/')) return;
      const combinedText = `${title} ${snippet}`;
      if (!isValidCompTitle(combinedText, ruleName, formFactor, undefined, ruleId)) return;

      const pMatches = [...combinedText.matchAll(/\$([0-9]{2,4}\.[0-9]{2})/g)].map(m => parseFloat(m[1]));
      const validPrices = pMatches.filter(p => p >= minValid && p <= maxValid);
      if (validPrices.length === 0) return;

      const itemPrice = Math.min(...validPrices);
      let shipCost = 0;
      let shipLabel = '(Free shipping)';

      const shipMatch = snippet.match(/\+\s*\$([0-9]{1,2}\.[0-9]{2})\s*shipping/i) || snippet.match(/\$([0-9]{1,2}\.[0-9]{2})\s*shipping/i);
      if (shipMatch) {
        shipCost = parseFloat(shipMatch[1]);
        shipLabel = `(+$${shipCost.toFixed(2)} shipping)`;
      } else if (!/free shipping|free delivery/i.test(snippet)) {
        shipLabel = '(Live BIN)';
      }

      const total = Math.round((itemPrice + shipCost) * 100) / 100;
      if (total < hardMinFloor || total > hardMaxCeiling) return;

      const cleanUrl = link.split('?')[0];
      candidates.push({
        price: itemPrice,
        shipping: shipCost,
        shippingLabel: shipLabel,
        total,
        url: cleanUrl,
        title: title.replace(/\s*\|\s*eBay.*/i, '').trim(),
        isLiveVerified: true
      });
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.total - b.total);
      const rawTotals = candidates.map(c => c.total);
      const stats = computeTrimmedCompStats(rawTotals, hardMinFloor, hardMaxCeiling);
      if (!stats || stats.lowestPrice < hardMinFloor) return undefined;

      const guardOpts = { sampleCount: rawTotals.length, ruleId, targetName: ruleName, policyBaseline };
      const clampedAvg = applySyncSanityGuard(stats.averagePrice, formFactor, singleUnitBaseline, guardOpts);
      const clampedLow = Math.max(hardMinFloor, Math.min(applySyncSanityGuard(stats.lowestPrice, formFactor, singleUnitBaseline, guardOpts), clampedAvg));
      const bestMatch = candidates.find(c => c.total >= stats.lowestPrice) || candidates[0];

      return {
        ...bestMatch,
        price: clampedLow,
        total: clampedLow,
        lowestPrice: clampedLow,
        averagePrice: clampedAvg
      };
    }
  } catch (e) {}

  return undefined;
}

export async function getDualMarketComps(ruleId: string | undefined, ruleName: string, fallbackMarket: number, singleUnitBaseline?: number): Promise<DualMarketComps> {
  const formFactor = inferFormFactor(ruleId, ruleName);
  const minFloor = getMinPlausiblePriceFloor(formFactor);
  const safeFallback = Math.max(minFloor, fallbackMarket || minFloor);
  const tcg = await fetchTcgPlayerComp(ruleId, ruleName, singleUnitBaseline, safeFallback);
  const refPrice = (tcg && tcg.price >= minFloor) ? tcg.total : safeFallback;
  const ebay = await fetchEbayComp(ruleId, ruleName, refPrice, singleUnitBaseline, safeFallback);
  return { tcgplayer: tcg, ebay };
}
