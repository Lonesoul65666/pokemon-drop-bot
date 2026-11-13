import * as fs from 'fs';
import * as path from 'path';
import {
  WATCH_POLICIES,
  atomicWriteJson,
  computeSanityPriceFloor,
  getMaxPlausiblePriceCeiling,
  isPoisonedVariantOrAccessory,
  isSingleCardOrNonSealed
} from '../../policies';
import { isVerified1PBigBoxOrPc } from '../../evaluator';

const ROOT_DIR = path.resolve(__dirname, '../..');

export interface CacheScrubReport {
  storeOffersPurged: number;
  liveStockPurged: number;
  dropsHistoryPurged: number;
  dailySnapshotsPurged: number;
  salesHistoryPurged: number;
  marketCacheCleaned: number;
  msrpTrophiesPurged: number;
  valid1PMsrpTrophiesRemaining: number;
  poisoned38To45Purged: number;
  previewTestTicksPurged: number;
}

function isPreviewOrTestArtifact(skuId: string, title: string, retailer: string, itemId: string, price: number): boolean {
  const combined = `${skuId} ${title} ${retailer} ${itemId}`;
  if (/\[FORMAT\s*PREVIEW|preview_30th|test_tick/i.test(combined)) return true;
  if (skuId === 'me-30th-celebration-etb-case' && (Math.abs(price - 922.99) < 1.5 || Math.abs(price - 999.99) < 0.05)) {
    return true;
  }
  return false;
}

export function scrubPoisonedRuntimeCaches(): CacheScrubReport {
  const report: CacheScrubReport = {
    storeOffersPurged: 0,
    liveStockPurged: 0,
    dropsHistoryPurged: 0,
    dailySnapshotsPurged: 0,
    salesHistoryPurged: 0,
    marketCacheCleaned: 0,
    msrpTrophiesPurged: 0,
    valid1PMsrpTrophiesRemaining: 0,
    poisoned38To45Purged: 0,
    previewTestTicksPurged: 0
  };

  const policyMap = new Map<string, any>();
  for (const p of WATCH_POLICIES) policyMap.set(p.id, p);

  const marketPath = path.join(ROOT_DIR, 'marketCache.json');
  let marketCache: Record<string, any> = {};
  if (fs.existsSync(marketPath)) {
    try { marketCache = JSON.parse(fs.readFileSync(marketPath, 'utf-8')); } catch (e) { marketCache = {}; }
  }

  const getFloorAndCeil = (skuId: string, store: string, url: string, title: string) => {
    const pol = policyMap.get(skuId);
    const is1P = isVerified1PBigBoxOrPc(store, url, false);
    const tel = marketCache[skuId];
    const verifiedMarket = Math.max(
      Number(pol?.estimatedMarketValue || 0),
      Number(tel?.marketPrice || 0) <= (Number(pol?.estimatedMarketValue || 9999) * 1.6) ? Number(tel?.marketPrice || 0) : 0
    );
    const floor = computeSanityPriceFloor({
      formFactor: pol?.formFactor,
      msrp: pol?.msrpCeiling,
      verifiedMarket,
      is1PBigBox: is1P,
      title: title || pol?.name || skuId
    });
    const ceil = getMaxPlausiblePriceCeiling(pol?.formFactor, skuId, pol?.name || title, pol);
    return { pol, floor, ceil, is1P };
  };

  // 1. Scrub storeOffersCache.json
  const offersPath = path.join(ROOT_DIR, 'storeOffersCache.json');
  if (fs.existsSync(offersPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(offersPath, 'utf-8'));
      let mutated = false;
      for (const [skuId, skuOffers] of Object.entries(raw || {})) {
        if (!skuOffers || typeof skuOffers !== 'object') continue;
        for (const [stKey, rec] of Object.entries(skuOffers as Record<string, any>)) {
          if (!rec) continue;
          const p = Number(rec.price || rec.landedPrice || 0);
          const title = String(rec.rawTitle || rec.title || '');
          const store = String(rec.storeName || stKey || '');
          const url = String(rec.productUrl || rec.url || '');
          const { pol, floor, ceil } = getFloorAndCeil(skuId, store, url, title);
          const isPreview = isPreviewOrTestArtifact(skuId, title, store, String(rec.itemId || ''), p);
          const isBadTitle = title ? (isPoisonedVariantOrAccessory(undefined, title, p, pol?.formFactor) || isSingleCardOrNonSealed(title, undefined, url)) : false;
          if (!pol || isPreview || isBadTitle || p < floor || p > ceil) {
            if (p >= 35 && p <= 48) report.poisoned38To45Purged += 1;
            if (isPreview) report.previewTestTicksPurged += 1;
            delete (skuOffers as Record<string, any>)[stKey];
            report.storeOffersPurged += 1;
            mutated = true;
          }
        }
      }
      if (mutated) atomicWriteJson(offersPath, raw);
    } catch (e) {}
  }

  // 2. Scrub liveStock.json
  const livePath = path.join(ROOT_DIR, 'liveStock.json');
  if (fs.existsSync(livePath)) {
    try {
      const live = JSON.parse(fs.readFileSync(livePath, 'utf-8'));
      let mutated = false;
      for (const key of Object.keys(live || {})) {
        if (key === '__recentOos' || key === '__bestOffers') continue;
        const entry = live[key];
        const p = Number(entry?.price || entry?.landedPrice || 0);
        const title = String(entry?.title || entry?.ruleName || '');
        const store = String(entry?.retailer || '');
        const { pol, floor, ceil } = getFloorAndCeil(key, store, String(entry?.url || ''), title);
        const isPreview = isPreviewOrTestArtifact(key, title, store, String(entry?.itemId || ''), p);
        const isBad = !pol || isPreview || isPoisonedVariantOrAccessory(undefined, title, p, pol?.formFactor) || p < floor || p > ceil;
        if (isBad) {
          if (p >= 35 && p <= 48) report.poisoned38To45Purged += 1;
          if (isPreview) report.previewTestTicksPurged += 1;
          delete live[key];
          report.liveStockPurged += 1;
          mutated = true;
        }
      }
      if (live?.__bestOffers && typeof live.__bestOffers === 'object') {
        for (const [bKey, entry] of Object.entries(live.__bestOffers as Record<string, any>)) {
          const p = Number(entry?.price || entry?.landedPrice || 0);
          const title = String(entry?.title || entry?.ruleName || '');
          const store = String(entry?.retailer || '');
          const { pol, floor, ceil } = getFloorAndCeil(bKey, store, String(entry?.url || ''), title);
          const isPreview = isPreviewOrTestArtifact(bKey, title, store, String(entry?.itemId || ''), p);
          if (!pol || isPreview || isPoisonedVariantOrAccessory(undefined, title, p, pol?.formFactor) || p < floor || p > ceil) {
            if (p >= 35 && p <= 48) report.poisoned38To45Purged += 1;
            delete live.__bestOffers[bKey];
            report.liveStockPurged += 1;
            mutated = true;
          }
        }
      }
      if (mutated) atomicWriteJson(livePath, live);
    } catch (e) {}
  }

  // 3. Scrub dropsHistory.json & alertHistory.json
  for (const histFile of ['dropsHistory.json', 'alertHistory.json']) {
    const histPath = path.join(ROOT_DIR, histFile);
    if (!fs.existsSync(histPath)) continue;
    try {
      const arr = JSON.parse(fs.readFileSync(histPath, 'utf-8'));
      if (!Array.isArray(arr)) continue;
      const filtered = arr.filter((d: any) => {
        const skuId = String(d?.ruleId || '');
        const p = Number(d?.price || d?.landedPrice || 0);
        const title = String(d?.rawTitle || d?.title || '');
        const store = String(d?.retailer || '');
        const { pol, floor, ceil } = getFloorAndCeil(skuId, store, String(d?.url || ''), title);
        const isPreview = isPreviewOrTestArtifact(skuId, title, store, String(d?.itemId || ''), p);
        const isBad = !pol || isPreview || isPoisonedVariantOrAccessory(undefined, title, p, pol?.formFactor) || p < floor || p > ceil;
        if (isBad) {
          if (p >= 35 && p <= 48) report.poisoned38To45Purged += 1;
          if (isPreview) report.previewTestTicksPurged += 1;
          report.dropsHistoryPurged += 1;
          return false;
        }
        return true;
      });
      if (filtered.length !== arr.length) atomicWriteJson(histPath, filtered);
    } catch (e) {}
  }

  // 4. Scrub dailySnapshots.json & salesHistory.json
  const snapPath = path.join(ROOT_DIR, 'dailySnapshots.json');
  if (fs.existsSync(snapPath)) {
    try {
      const snaps = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
      let mutated = false;
      for (const [skuId, rows] of Object.entries(snaps || {})) {
        if (!Array.isArray(rows)) continue;
        const { floor, ceil } = getFloorAndCeil(skuId, 'LGS', '', '');
        const cleanRows = rows.filter((r: any) => {
          const low = Number(r?.lowestDrop ?? r?.low ?? r?.marketPrice ?? 0);
          const isPreview = isPreviewOrTestArtifact(skuId, '', String(r?.lowestStore || ''), '', low);
          if (isPreview || (low > 0 && (low < floor || low > ceil))) {
            if (low >= 35 && low <= 48) report.poisoned38To45Purged += 1;
            if (isPreview) report.previewTestTicksPurged += 1;
            report.dailySnapshotsPurged += 1;
            mutated = true;
            return false;
          }
          return true;
        });
        (snaps as Record<string, any>)[skuId] = cleanRows;
      }
      if (mutated) atomicWriteJson(snapPath, snaps);
    } catch (e) {}
  }

  const salesPath = path.join(ROOT_DIR, 'salesHistory.json');
  if (fs.existsSync(salesPath)) {
    try {
      const sales = JSON.parse(fs.readFileSync(salesPath, 'utf-8'));
      if (Array.isArray(sales)) {
        const cleanSales = sales.filter((r: any) => {
          const skuId = String(r?.targetId || r?.skuId || '');
          const p = Number(r?.landedPrice || r?.price || 0);
          const store = String(r?.store || '');
          const { pol, floor, ceil } = getFloorAndCeil(skuId, store, String(r?.url || ''), '');
          const isPreview = isPreviewOrTestArtifact(skuId, '', store, '', p);
          if (!pol || isPreview || p < floor || p > ceil) {
            if (p >= 35 && p <= 48) report.poisoned38To45Purged += 1;
            if (isPreview) report.previewTestTicksPurged += 1;
            report.salesHistoryPurged += 1;
            return false;
          }
          return true;
        });
        if (cleanSales.length !== sales.length) atomicWriteJson(salesPath, cleanSales);
      } else if (sales && typeof sales === 'object') {
        let mutated = false;
        for (const [skuId, rows] of Object.entries(sales)) {
          if (!Array.isArray(rows)) continue;
          const { floor, ceil } = getFloorAndCeil(skuId, 'LGS', '', '');
          const cleanRows = rows.filter((r: any) => {
            const p = Number(r?.price || 0);
            const isPreview = isPreviewOrTestArtifact(skuId, '', String(r?.store || ''), '', p);
            if (isPreview || p < floor || p > ceil) {
              if (p >= 35 && p <= 48) report.poisoned38To45Purged += 1;
              if (isPreview) report.previewTestTicksPurged += 1;
              report.salesHistoryPurged += 1;
              mutated = true;
              return false;
            }
            return true;
          });
          (sales as Record<string, any>)[skuId] = cleanRows;
        }
        if (mutated) atomicWriteJson(salesPath, sales);
      }
    } catch (e) {}
  }

  // 5. Scrub marketCache.json bogus $115 baselines & < sanityFloor lows
  if (Object.keys(marketCache).length > 0) {
    let mktMutated = false;
    for (const [skuId, entry] of Object.entries(marketCache)) {
      if (!entry || typeof entry !== 'object') continue;
      const { pol, floor, ceil } = getFloorAndCeil(skuId, String(entry.lowestStore || ''), String(entry.lowestUrl || ''), polName(policyMap.get(skuId)));
      const lowP = Number(entry.lowestPrice || 0);
      const estMkt = Number(pol?.estimatedMarketValue || 0);
      const isBogusBaseline = /baseline|placeholder|seed/i.test(String(entry.lowestStore || '')) ||
        (estMkt > 0 && lowP > estMkt * 1.45 && /tcgplayer/i.test(String(entry.lowestStore || '')));
      if (lowP > 0 && (lowP < floor || lowP > ceil || isBogusBaseline)) {
        if (lowP >= 35 && lowP <= 48) report.poisoned38To45Purged += 1;
        entry.lowestPrice = estMkt > 0 ? estMkt : 0;
        entry.lowestStore = '';
        entry.lowestUrl = '';
        report.marketCacheCleaned += 1;
        mktMutated = true;
      }
    }
    if (mktMutated) atomicWriteJson(marketPath, marketCache);
  }

  // 6. Scrub data/msrpTrophies.json — strictly 1st-Party Big-Box Retail <= msrp * 1.08
  const trophiesPath = path.join(ROOT_DIR, 'data', 'msrpTrophies.json');
  if (fs.existsSync(trophiesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(trophiesPath, 'utf-8'));
      const rawCatches: any[] = Array.isArray(parsed?.catches) ? parsed.catches : [];
      const valid1P = rawCatches.filter((c: any) => {
        const store = String(c?.store || '');
        const url = String(c?.url || '');
        const msrp = Number(c?.msrp || policyMap.get(String(c?.ruleId || ''))?.msrpCeiling || 54.99);
        const landed = Number(c?.landedPrice || c?.price || 0);
        return isVerified1PBigBoxOrPc(store, url, false) && landed > 0 && landed <= Math.round(msrp * 1.08 * 100) / 100;
      });
      const prevHits = Number(parsed?.totalMsrpHits || 0);
      if (valid1P.length !== rawCatches.length || prevHits !== valid1P.length) {
        report.msrpTrophiesPurged = Math.max(rawCatches.length - valid1P.length, prevHits - valid1P.length);
        report.valid1PMsrpTrophiesRemaining = valid1P.length;
        atomicWriteJson(trophiesPath, {
          totalMsrpHits: valid1P.length,
          catches: valid1P
        });
      } else {
        report.valid1PMsrpTrophiesRemaining = valid1P.length;
      }
    } catch (e) {}
  }

  return report;
}

function polName(p: any): string {
  return String(p?.name || '');
}
