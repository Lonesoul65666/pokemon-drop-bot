import fs from 'fs';
import path from 'path';

export type TrendSignal = 'BEATS_MARKET_FLOOR' | 'ELASTIC_DIP' | 'UPTREND_LAG_DEAL' | 'STABLE_ACCUMULATE' | 'FALLING_KNIFE_WAIT';

export interface RollingMarketMetrics {
  skuId: string; currentMarket: number; avg14d: number; avg30d: number; avg60d: number; avg90d: number;
  low30d: number; low60d: number; low90d: number; delta14dPct: number; change30dPct: number; change60dPct: number; change90dPct: number;
  sampleDaysCount: number; insufficientHistory: boolean;
}

export interface AutoPilotTargetResult {
  autoPilotEnabled: boolean; autoPilotCeiling: number; effectiveTargetCeiling: number; ripHuntCeiling: number;
  isRipHuntMode: boolean; isBleedingDown: boolean; isSupplyTightening: boolean; autoPilotModeLabel: string; autoPilotBadge?: string;
}

export interface TrendEvalParams {
  skuId: string; formFactor?: string; dropPrice: number; landedPrice: number; estimatedShipping?: number;
  policyMaxBuy: number; msrpCeiling: number; marketBaseline: number; releaseDate?: string;
  owned?: boolean; wallOwned?: boolean; dadRipOwned?: boolean; loganRipOwned?: boolean;
  completionCount?: number; fullyConquered?: boolean; autoPilotEnabled?: boolean;
  activeStoreCount?: number; lowestShelfPrice?: number; isCloseCall?: boolean; isMarketplace3P?: boolean; nowTs?: number;
}

export interface TrendEvaluation {
  trendSignal: TrendSignal; trendVerdictLabel: string; isElasticDip: boolean; qualifiesForElasticDipAlert: boolean;
  isRunawayUptrendDeal: boolean; isBleedingDown: boolean; isSupplyTightening: boolean; autoPilotCeiling: number;
  effectiveTargetCeiling: number; ripHuntCeiling: number; isRipHuntMode: boolean; isPreRelease: boolean;
  daysUntilRelease: number | null; preReleaseStatusTag?: string; undercutMarketPct: number; rolling: RollingMarketMetrics;
}

const DAILY_SNAPSHOTS_PATH = path.resolve(process.cwd(), 'dailySnapshots.json');
const WEEKLY_CHECKPOINTS_PATH = path.resolve(process.cwd(), 'weeklyCheckpoints.json');
const MARKET_CACHE_PATH = path.resolve(process.cwd(), 'marketCache.json');
const SALES_HISTORY_PATH = path.resolve(process.cwd(), 'salesHistory.json');
const STORE_OFFERS_CACHE_PATH = path.resolve(process.cwd(), 'storeOffersCache.json');

const CACHE_TTL_MS = 30 * 1000;
let lastDiskLoadTs = 0;
let cachedDaily: Record<string, Array<{ date?: string; timestamp?: number; marketPrice?: number; lowestDrop?: number }>> = {};
let cachedWeekly: Record<string, Array<{ weekEnding?: string; timestamp?: number; marketPrice?: number; lowestDrop?: number; avgClearPrice?: number }>> = {};
let cachedMarket: Record<string, { rollingAverage?: number; lowestPrice?: number; estimatedMarketValue?: number; samples?: number[] }> = {};
let cachedSales: Array<{ targetId?: string; price?: number; landedPrice?: number; marketPrice?: number; restockedAt?: number; lastSeenAt?: number }> = [];
let cachedStoreOffers: Record<string, Record<string, { price?: number; dropPrice?: number; landedPrice?: number }>> = {};

const fileMtimes: Record<string, number> = {};
function loadJsonIfChanged<T>(filePath: string, currentVal: T): T {
  try {
    if (!fs.existsSync(filePath)) return currentVal;
    const mtime = fs.statSync(filePath).mtimeMs;
    if (mtime === fileMtimes[filePath]) return currentVal;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    fileMtimes[filePath] = mtime;
    return (parsed ?? currentVal) as T;
  } catch {
    return currentVal;
  }
}

function ensureHistoricalDataLoaded(now = Date.now()): void {
  if (now - lastDiskLoadTs < CACHE_TTL_MS && Object.keys(cachedMarket).length > 0) return;
  lastDiskLoadTs = now;
  cachedDaily = loadJsonIfChanged(DAILY_SNAPSHOTS_PATH, cachedDaily);
  cachedWeekly = loadJsonIfChanged(WEEKLY_CHECKPOINTS_PATH, cachedWeekly);
  cachedMarket = loadJsonIfChanged(MARKET_CACHE_PATH, cachedMarket);
  cachedStoreOffers = loadJsonIfChanged(STORE_OFFERS_CACHE_PATH, cachedStoreOffers);
  const rawSales = loadJsonIfChanged<any>(SALES_HISTORY_PATH, cachedSales);
  if (Array.isArray(rawSales)) cachedSales = rawSales;
}

export function getDaysUntilRelease(releaseDate?: string, nowTs = Date.now()): number | null {
  if (!releaseDate) return null;
  const parsed = Date.parse(`${releaseDate}T00:00:00`);
  return Number.isNaN(parsed) ? null : Math.ceil((parsed - nowTs) / (24 * 60 * 60 * 1000));
}

export function isPreReleaseDate(releaseDate?: string, nowTs = Date.now()): boolean {
  const days = getDaysUntilRelease(releaseDate, nowTs);
  return days !== null && days >= 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;
const meanOf = (vals: number[], fallback: number) => {
  const valid = vals.filter(v => Number.isFinite(v) && v > 0);
  return valid.length === 0 ? round2(fallback) : round2(valid.reduce((a, b) => a + b, 0) / valid.length);
};
const minOf = (vals: number[], fallback: number) => {
  const valid = vals.filter(v => Number.isFinite(v) && v > 0);
  return valid.length === 0 ? round2(fallback) : round2(Math.min(...valid));
};

export function getLiveStoreOfferMedian(skuId: string, minPlausible = 18, nowTs = Date.now(), maxPlausible = 99999): number | null {
  ensureHistoricalDataLoaded(nowTs);
  const offersMap = cachedStoreOffers[skuId] || {};
  let prices = Object.values(offersMap).map(o => Number(o?.price || o?.dropPrice || o?.landedPrice || 0)).filter(p => Number.isFinite(p) && p >= minPlausible && p <= maxPlausible).sort((a, b) => a - b);
  if (prices.length < 2) {
    const recentSales = cachedSales.filter(s => s && s.targetId === skuId).map(s => Number(s.price || s.landedPrice || 0)).filter(p => Number.isFinite(p) && p >= minPlausible && p <= maxPlausible);
    prices = [...prices, ...recentSales].sort((a, b) => a - b);
  }
  if (prices.length < 2) return null;
  const slice = prices.slice(0, Math.min(5, prices.length));
  const mid = Math.floor(slice.length / 2);
  return round2(slice.length % 2 === 1 ? slice[mid] : (slice[mid - 1] + slice[mid]) / 2);
}

export function computeRollingMarketMetrics(skuId: string, fallbackMarket = 60, fallbackMsrp = 54.99, nowTs = Date.now()): RollingMarketMetrics {
  ensureHistoricalDataLoaded(nowTs);
  const minPlausible = Math.max(15, round2(fallbackMsrp * 0.45));
  const maxPlausible = fallbackMarket > 0 ? round2(fallbackMarket * 1.35) : 99999;
  const mktEntry = cachedMarket[skuId] || {};
  const liveMedian = getLiveStoreOfferMedian(skuId, minPlausible, nowTs, maxPlausible);
  const rawMcAvg = Number(mktEntry.rollingAverage && mktEntry.rollingAverage > 0 ? mktEntry.rollingAverage : fallbackMarket);
  const sanitizedFallback = ((rawMcAvg === 115 || rawMcAvg === 1150 || rawMcAvg > maxPlausible) && fallbackMarket !== 115 && fallbackMarket > 0) ? fallbackMarket : rawMcAvg;
  const currentMarket = round2(liveMedian !== null ? liveMedian : (sanitizedFallback || fallbackMsrp));

  const dailyList = Array.isArray(cachedDaily[skuId]) ? cachedDaily[skuId] : [];
  const weeklyList = Array.isArray(cachedWeekly[skuId]) ? cachedWeekly[skuId] : [];
  const skuSales = cachedSales.filter(s => s && s.targetId === skuId);

  const byDate = new Map<string, { marketPrice: number; lowestDrop: number }>();
  for (const sn of dailyList) {
    if (!sn?.date) continue;
    const mp = Number(sn.marketPrice || currentMarket);
    const ld = Number(sn.lowestDrop || mp);
    if (mp >= minPlausible) byDate.set(sn.date, { marketPrice: mp, lowestDrop: ld >= minPlausible ? ld : mp });
  }
  for (const wk of weeklyList) {
    if (!wk?.weekEnding || byDate.has(wk.weekEnding)) continue;
    const mp = Number(wk.marketPrice || currentMarket);
    const ld = Number(wk.lowestDrop || wk.avgClearPrice || mp);
    if (mp >= minPlausible) byDate.set(wk.weekEnding, { marketPrice: mp, lowestDrop: ld >= minPlausible ? ld : mp });
  }
  for (const s of skuSales) {
    const ts = Number(s.restockedAt || s.lastSeenAt || 0);
    const sLow = Number(s.landedPrice || s.price || 0);
    if (!ts || sLow < minPlausible) continue;
    const dStr = new Date(ts).toISOString().slice(0, 10);
    const existing = byDate.get(dStr);
    if (!existing || sLow < existing.lowestDrop) {
      byDate.set(dStr, { marketPrice: existing ? existing.marketPrice : Number(s.marketPrice || currentMarket), lowestDrop: sLow });
    }
  }

  const cachedLow = Number(
    mktEntry.lowestPrice && mktEntry.lowestPrice >= minPlausible && mktEntry.lowestPrice !== 115
      ? mktEntry.lowestPrice
      : currentMarket
  );
  const todayStr = new Date(nowTs).toISOString().slice(0, 10);
  if (!byDate.has(todayStr) && (liveMedian !== null || (mktEntry.lowestPrice && mktEntry.lowestPrice >= minPlausible))) {
    byDate.set(todayStr, { marketPrice: currentMarket, lowestDrop: Math.min(currentMarket, cachedLow) });
  }

  // Zero synthetic curves: compute rolling metrics strictly from real recorded timestamps!
  const dayMs = 24 * 60 * 60 * 1000;
  const realEntries = [...byDate.entries()]
    .map(([date, pt]) => ({ date, ts: Date.parse(`${date}T00:00:00Z`) || 0, ...pt }))
    .filter(pt => pt.ts > 0 && pt.ts <= nowTs + dayMs)
    .sort((a, b) => a.ts - b.ts);

  const inDays = (days: number) => realEntries.filter(p => nowTs - p.ts <= days * dayMs);
  const pts14 = inDays(14);
  const pts30 = inDays(30);
  const pts60 = inDays(60);
  const pts90 = inDays(90);

  const avg14d = meanOf(pts14.map(p => p.marketPrice), currentMarket);
  const avg30d = meanOf(pts30.map(p => p.marketPrice), currentMarket);
  const avg60d = meanOf(pts60.map(p => p.marketPrice), currentMarket);
  const avg90d = meanOf(pts90.map(p => p.marketPrice), currentMarket);
  const low30d = minOf(pts30.map(p => p.lowestDrop), cachedLow);
  const low60d = minOf(pts60.map(p => p.lowestDrop), cachedLow);
  const low90d = minOf(pts90.map(p => p.lowestDrop), cachedLow);

  const pctChangeFrom = (pts: typeof realEntries) =>
    pts.length >= 2 && pts[0].marketPrice > 0
      ? round1(((currentMarket - pts[0].marketPrice) / pts[0].marketPrice) * 100)
      : 0;

  return {
    skuId, currentMarket, avg14d, avg30d, avg60d, avg90d, low30d, low60d, low90d,
    delta14dPct: pctChangeFrom(pts14),
    change30dPct: pctChangeFrom(pts30),
    change60dPct: pctChangeFrom(pts60),
    change90dPct: pctChangeFrom(pts90),
    sampleDaysCount: realEntries.length,
    insufficientHistory: realEntries.length < 14
  };
}

export function computeAutoPilotTarget(params: {
  skuId: string; msrpCeiling: number; policyMaxBuy: number; marketBaseline: number;
  rolling?: RollingMarketMetrics; autoPilotEnabled?: boolean; lowestShelfPrice?: number;
  activeStoreCount?: number; wallOwned?: boolean; dadRipOwned?: boolean; loganRipOwned?: boolean;
  completionCount?: number; fullyConquered?: boolean;
}): AutoPilotTargetResult {
  const {
    skuId, msrpCeiling, policyMaxBuy, marketBaseline,
    autoPilotEnabled = true, lowestShelfPrice = 0, activeStoreCount = 0,
    wallOwned = false, dadRipOwned = false, loganRipOwned = false
  } = params;
  const rolling = params.rolling || computeRollingMarketMetrics(skuId, marketBaseline, msrpCeiling);
  const compCount = params.completionCount !== undefined ? params.completionCount : (wallOwned ? 1 : 0) + (dadRipOwned ? 1 : 0) + (loganRipOwned ? 1 : 0);
  const fullyConquered = params.fullyConquered !== undefined ? params.fullyConquered : compCount >= 3;
  const isRipHuntMode = Boolean((wallOwned || compCount >= 1) && !fullyConquered);

  const hasMinTrendSamples = rolling.sampleDaysCount >= 3;
  const isBleedingDown = Boolean(hasMinTrendSamples && (rolling.delta14dPct <= -5 || (activeStoreCount >= 8 && rolling.delta14dPct <= -2.5)));
  const isSupplyTightening = Boolean(rolling.sampleDaysCount >= 5 && !isBleedingDown && rolling.change60dPct >= 8 && activeStoreCount <= 5);

  const userManualCeiling = policyMaxBuy > 0 ? policyMaxBuy : msrpCeiling;
  let autoPilotCeiling = userManualCeiling;
  let autoPilotModeLabel = rolling.insufficientHistory
    ? `REAL SAMPLES (${rolling.sampleDaysCount}D < 14D)`
    : '60D ELASTIC DIP FLOAT';
  let autoPilotBadge: string | undefined = undefined;

  if (isBleedingDown) {
    // Advisory support target computed strictly from historical market floor — NEVER from incoming dropPrice (kills Zeno's Paradox)
    const floorRef = rolling.low30d > 0 ? rolling.low30d : (rolling.currentMarket || marketBaseline || userManualCeiling);
    autoPilotCeiling = Math.max(round2(msrpCeiling * 0.90), Math.round(floorRef * 0.92));
    const shownDelta = Math.round(rolling.delta14dPct);
    autoPilotModeLabel = 'BLEEDING DOWN // CAUTION ADVISORY';
    autoPilotBadge = `◈ ⟦ BLEEDING DOWN (${shownDelta}% 14D • ${rolling.sampleDaysCount}D REAL) // HOLD OFF ⟧`;
  } else if (isSupplyTightening) {
    const climbTarget = Math.round(Math.max(userManualCeiling, Math.min(rolling.avg60d * 0.96, rolling.currentMarket * 0.94)));
    autoPilotCeiling = Math.max(msrpCeiling, climbTarget);
    autoPilotModeLabel = 'SUPPLY TIGHTENING // ADVISORY';
    autoPilotBadge = `◈ ⟦ SUPPLY TIGHTENING (+${Math.round(rolling.change60dPct)}% 60D) // SLIDER CAPPED ⟧`;
  } else if (!rolling.insufficientHistory) {
    const dipTarget = Math.round(Math.max(rolling.low60d * 1.03, rolling.avg60d * 0.90));
    autoPilotCeiling = Math.max(msrpCeiling, dipTarget);
  }

  // Strict Slider Sovereignty: Always honor Scott's manual policyMaxBuy slider for both 0/3 Wall and 1/3–2/3 Rip-Hunt targets.
  // BLEEDING DOWN remains strictly an honest trendVerdictLabel & Capital Advisor caution signal — never lowering the buy trigger!
  const ripHuntCeiling = userManualCeiling;
  const effectiveTargetCeiling = userManualCeiling;

  return { autoPilotEnabled, autoPilotCeiling, effectiveTargetCeiling, ripHuntCeiling, isRipHuntMode, isBleedingDown, isSupplyTightening, autoPilotModeLabel, autoPilotBadge };
}

export function evaluateSkuTrendAndTiming(params: TrendEvalParams): TrendEvaluation {
  const {
    skuId, formFactor = 'ETB', dropPrice, landedPrice,
    estimatedShipping = Math.max(0, landedPrice - dropPrice),
    policyMaxBuy, msrpCeiling, marketBaseline, releaseDate,
    owned = false, wallOwned = owned, dadRipOwned = false, loganRipOwned = false,
    completionCount, fullyConquered, autoPilotEnabled = true,
    activeStoreCount = 0,
    isCloseCall = false, isMarketplace3P = false, nowTs = Date.now()
  } = params;

  const daysUntilRelease = getDaysUntilRelease(releaseDate, nowTs);
  const isPreRelease = daysUntilRelease !== null && daysUntilRelease >= 0;
  const isPreLaunchWindow = daysUntilRelease !== null && daysUntilRelease >= -7 && daysUntilRelease <= 120;

  const rolling = computeRollingMarketMetrics(skuId, marketBaseline, msrpCeiling, nowTs);
  const ap = computeAutoPilotTarget({
    skuId, msrpCeiling, policyMaxBuy, marketBaseline: rolling.currentMarket, rolling, autoPilotEnabled,
    activeStoreCount, wallOwned, dadRipOwned, loganRipOwned, completionCount, fullyConquered
  });

  const mktFloorRef = Math.abs(rolling.currentMarket - 100) <= 1.5 ? 100 : Math.round(rolling.currentMarket || marketBaseline || policyMaxBuy);
  const ff = String(formFactor || '').toLowerCase();
  const graceBuffer = (ff.includes('box') || ff.includes('case')) ? 10.0 : 5.0;
  const canUseShelfPrice = !isMarketplace3P && estimatedShipping <= 10.0;
  const targetRef = ap.effectiveTargetCeiling;
  const effComparePrice = (canUseShelfPrice && dropPrice <= targetRef + graceBuffer) ? dropPrice : landedPrice;
  const beatsOrCloseCall = dropPrice <= targetRef || landedPrice <= targetRef || isCloseCall || effComparePrice <= targetRef + graceBuffer;

  const landedUndercutPct = mktFloorRef > 0 ? Math.round(((mktFloorRef - landedPrice) / mktFloorRef) * 100) : 0;
  const shelfUndercutPct = mktFloorRef > 0 ? Math.round(((mktFloorRef - dropPrice) / mktFloorRef) * 100) : 0;
  const undercutMarketPct = landedUndercutPct >= 8 ? landedUndercutPct : (canUseShelfPrice && dropPrice <= targetRef ? Math.max(landedUndercutPct, shelfUndercutPct) : landedUndercutPct);

  const makeResult = (trendSignal: TrendSignal, trendVerdictLabel: string, opts?: { isElasticDip?: boolean; qualifiesForElasticDipAlert?: boolean; isRunawayUptrendDeal?: boolean; preReleaseStatusTag?: string }): TrendEvaluation => ({
    trendSignal, trendVerdictLabel, isElasticDip: Boolean(opts?.isElasticDip),
    qualifiesForElasticDipAlert: Boolean(opts?.qualifiesForElasticDipAlert), isRunawayUptrendDeal: Boolean(opts?.isRunawayUptrendDeal),
    isBleedingDown: ap.isBleedingDown, isSupplyTightening: ap.isSupplyTightening, autoPilotCeiling: ap.autoPilotCeiling,
    effectiveTargetCeiling: ap.effectiveTargetCeiling, ripHuntCeiling: ap.ripHuntCeiling, isRipHuntMode: ap.isRipHuntMode,
    isPreRelease, daysUntilRelease, preReleaseStatusTag: opts?.preReleaseStatusTag, undercutMarketPct, rolling
  });

  if (isPreRelease || isPreLaunchWindow) {
    if (beatsOrCloseCall && undercutMarketPct >= 8) {
      const label = `◈ ⟦ BEATS $${mktFloorRef} MARKET FLOOR (-${undercutMarketPct}%) // SOLID PRE-LAUNCH GRAB ⟧`;
      return makeResult('BEATS_MARKET_FLOOR', label, { preReleaseStatusTag: label });
    }
    if (!beatsOrCloseCall || (rolling.delta14dPct <= -8 && undercutMarketPct < 5)) {
      const label = '◈ ⟦ PRE-RELEASE PREMIUM — WAIT FOR POST-LAUNCH DIP ⟧';
      return makeResult('FALLING_KNIFE_WAIT', label, { preReleaseStatusTag: label });
    }
    const label = `◈ ⟦ BEATS $${mktFloorRef} MARKET FLOOR (-${Math.max(1, undercutMarketPct)}%) // SOLID PRE-LAUNCH GRAB ⟧`;
    return makeResult('BEATS_MARKET_FLOOR', label, { preReleaseStatusTag: label });
  }

  if (ap.isBleedingDown && dropPrice > ap.autoPilotCeiling) {
    return makeResult('FALLING_KNIFE_WAIT', ap.autoPilotBadge || '◈ ⟦ BLEEDING DOWN (-6% 14D) // HOLD OFF ⟧');
  }

  const dipPriceRef = canUseShelfPrice ? Math.min(landedPrice, dropPrice + estimatedShipping) : landedPrice;
  const dipVsAvg60dPct = rolling.avg60d > 0 ? Math.round(((rolling.avg60d - dipPriceRef) / rolling.avg60d) * 100) : 0;
  const nearSupportFloor60d = rolling.low60d > 0 && dipPriceRef <= rolling.low60d * 1.04 && rolling.avg60d >= rolling.low60d * 1.06;
  if (!fullyConquered && (dipVsAvg60dPct >= 10 || nearSupportFloor60d)) {
    const shownDipPct = Math.max(4, dipVsAvg60dPct);
    const label = `◈ ⟦ 60D ELASTIC DIP (-${shownDipPct}% VS $${Math.round(rolling.avg60d)} 60D AVG) // HISTORICALLY REBOUNDS ⟧`;
    const qualifiesForElasticDipAlert = Boolean(dipPriceRef <= targetRef * 1.12 || dipPriceRef <= rolling.avg60d * 0.88);
    return makeResult('ELASTIC_DIP', label, { isElasticDip: true, qualifiesForElasticDipAlert });
  }

  if ((ap.isSupplyTightening || rolling.change60dPct >= 8) && dipPriceRef <= rolling.avg60d * 1.02 && undercutMarketPct >= 8) {
    const label = ap.autoPilotBadge || `◈ ⟦ SUPPLY TIGHTENING (+${Math.round(rolling.change60dPct)}% 60D) // PRIORITY GRAB ⟧`;
    return makeResult('UPTREND_LAG_DEAL', label, { isRunawayUptrendDeal: true });
  }

  if (rolling.delta14dPct <= -8 && !beatsOrCloseCall) {
    return makeResult('FALLING_KNIFE_WAIT', `◈ ⟦ BLEEDING DOWN (${Math.round(rolling.delta14dPct)}% 14D) // HOLD OFF ⟧`);
  }
  if (beatsOrCloseCall && undercutMarketPct >= 8) {
    return makeResult('BEATS_MARKET_FLOOR', `◈ ⟦ BEATS $${mktFloorRef} MARKET FLOOR (-${undercutMarketPct}%) // SOLID ACCUMULATE ⟧`);
  }
  const label = undercutMarketPct > 0
    ? `◈ ⟦ STABLE 60D PLATEAU (-${undercutMarketPct}% VS $${mktFloorRef} MKT) ⟧`
    : `◈ ⟦ STABLE 60D PLATEAU ($${Math.round(rolling.avg60d)} 60D AVG) ⟧`;
  return makeResult('STABLE_ACCUMULATE', label);
}

export { buildEarnedWatermarkSummary, fetchTcgPlayerQuarterHistoryNote } from './watermarkHistory';
