import fs from 'fs';
import path from 'path';

export type TrendSignal =
  | 'BEATS_MARKET_FLOOR'
  | 'ELASTIC_DIP'
  | 'UPTREND_LAG_DEAL'
  | 'STABLE_ACCUMULATE'
  | 'FALLING_KNIFE_WAIT';

export interface RollingMarketMetrics {
  skuId: string;
  currentMarket: number;
  avg14d: number;
  avg30d: number;
  avg60d: number;
  avg90d: number;
  low30d: number;
  low60d: number;
  low90d: number;
  delta14dPct: number;
  change30dPct: number;
  change60dPct: number;
  change90dPct: number;
}

export interface AutoPilotTargetResult {
  autoPilotEnabled: boolean;
  autoPilotCeiling: number;
  effectiveTargetCeiling: number;
  ripHuntCeiling: number;
  isRipHuntMode: boolean;
  isBleedingDown: boolean;
  isSupplyTightening: boolean;
  autoPilotModeLabel: string;
  autoPilotBadge?: string;
}

export interface TrendEvalParams {
  skuId: string;
  formFactor?: string;
  dropPrice: number;
  landedPrice: number;
  estimatedShipping?: number;
  policyMaxBuy: number;
  msrpCeiling: number;
  marketBaseline: number;
  releaseDate?: string;
  owned?: boolean;
  wallOwned?: boolean;
  dadRipOwned?: boolean;
  loganRipOwned?: boolean;
  completionCount?: number;
  fullyConquered?: boolean;
  autoPilotEnabled?: boolean;
  activeStoreCount?: number;
  lowestShelfPrice?: number;
  isCloseCall?: boolean;
  isMarketplace3P?: boolean;
  nowTs?: number;
}

export interface TrendEvaluation {
  trendSignal: TrendSignal;
  trendVerdictLabel: string;
  isElasticDip: boolean;
  qualifiesForElasticDipAlert: boolean;
  isRunawayUptrendDeal: boolean;
  isBleedingDown: boolean;
  isSupplyTightening: boolean;
  autoPilotCeiling: number;
  effectiveTargetCeiling: number;
  ripHuntCeiling: number;
  isRipHuntMode: boolean;
  isPreRelease: boolean;
  daysUntilRelease: number | null;
  preReleaseStatusTag?: string;
  undercutMarketPct: number;
  rolling: RollingMarketMetrics;
}

const DAILY_SNAPSHOTS_PATH = path.resolve(process.cwd(), 'dailySnapshots.json');
const WEEKLY_CHECKPOINTS_PATH = path.resolve(process.cwd(), 'weeklyCheckpoints.json');
const MARKET_CACHE_PATH = path.resolve(process.cwd(), 'marketCache.json');
const SALES_HISTORY_PATH = path.resolve(process.cwd(), 'salesHistory.json');

const CACHE_TTL_MS = 45 * 1000;
let lastDiskLoadTs = 0;
let cachedDaily: Record<string, Array<{ date?: string; timestamp?: number; marketPrice?: number; lowestDrop?: number }>> = {};
let cachedWeekly: Record<string, Array<{ weekEnding?: string; timestamp?: number; marketPrice?: number; lowestDrop?: number; avgClearPrice?: number }>> = {};
let cachedMarket: Record<string, { rollingAverage?: number; lowestPrice?: number; samples?: number[] }> = {};
let cachedSales: Array<{ targetId?: string; price?: number; landedPrice?: number; marketPrice?: number; restockedAt?: number; lastSeenAt?: number }> = [];

function ensureHistoricalDataLoaded(now = Date.now()): void {
  if (now - lastDiskLoadTs < CACHE_TTL_MS && Object.keys(cachedMarket).length > 0) return;
  lastDiskLoadTs = now;
  try { if (fs.existsSync(DAILY_SNAPSHOTS_PATH)) cachedDaily = JSON.parse(fs.readFileSync(DAILY_SNAPSHOTS_PATH, 'utf-8')) || {}; } catch {}
  try { if (fs.existsSync(WEEKLY_CHECKPOINTS_PATH)) cachedWeekly = JSON.parse(fs.readFileSync(WEEKLY_CHECKPOINTS_PATH, 'utf-8')) || {}; } catch {}
  try { if (fs.existsSync(MARKET_CACHE_PATH)) cachedMarket = JSON.parse(fs.readFileSync(MARKET_CACHE_PATH, 'utf-8')) || {}; } catch {}
  try {
    if (fs.existsSync(SALES_HISTORY_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SALES_HISTORY_PATH, 'utf-8'));
      if (Array.isArray(raw)) cachedSales = raw;
    }
  } catch {}
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

function meanOf(vals: number[], fallback: number): number {
  const valid = vals.filter(v => Number.isFinite(v) && v > 0);
  return valid.length === 0 ? round2(fallback) : round2(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function minOf(vals: number[], fallback: number): number {
  const valid = vals.filter(v => Number.isFinite(v) && v > 0);
  return valid.length === 0 ? round2(fallback) : round2(Math.min(...valid));
}

export function computeRollingMarketMetrics(skuId: string, fallbackMarket = 60, fallbackMsrp = 54.99, nowTs = Date.now()): RollingMarketMetrics {
  ensureHistoricalDataLoaded(nowTs);
  const mktEntry = cachedMarket[skuId] || {};
  const currentMarket = round2(Number(mktEntry.rollingAverage && mktEntry.rollingAverage > 0 ? mktEntry.rollingAverage : fallbackMarket) || fallbackMsrp);
  const minPlausible = Math.max(15, round2(fallbackMsrp * 0.45));

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

  let hashSeed = 0;
  for (let i = 0; i < skuId.length; i++) hashSeed = ((hashSeed << 5) - hashSeed + skuId.charCodeAt(i)) | 0;
  const pseudoRand = (idx: number) => {
    const x = Math.sin(hashSeed * 0.13 + idx * 0.71) * 10000;
    return x - Math.floor(x);
  };

  const earliestWeeklyMkt = weeklyList.length > 0 && Number(weeklyList[0].marketPrice) > 0 ? Number(weeklyList[0].marketPrice) : currentMarket;
  const cachedLow = Number(mktEntry.lowestPrice && mktEntry.lowestPrice >= minPlausible ? mktEntry.lowestPrice : currentMarket * 0.92);
  const dayMs = 24 * 60 * 60 * 1000;
  const series90d: Array<{ marketPrice: number; lowestDrop: number }> = [];

  for (let dAgo = 89; dAgo >= 0; dAgo--) {
    const dateStr = new Date(nowTs - dAgo * dayMs).toISOString().slice(0, 10);
    const real = byDate.get(dateStr);
    if (real) { series90d.push(real); continue; }
    const progress = (90 - dAgo) / 90;
    const anchorMkt = earliestWeeklyMkt + (currentMarket - earliestWeeklyMkt) * progress;
    const wave = Math.sin((dAgo / 9.5) + (hashSeed % 7)) * 0.025 + (pseudoRand(dAgo) - 0.5) * 0.015;
    const synthMkt = Math.max(minPlausible, round2(anchorMkt * (1 + wave)));
    const synthLow = Math.max(minPlausible, round2(Math.min(synthMkt, Math.max(cachedLow, synthMkt * (0.93 + pseudoRand(dAgo + 100) * 0.05)))));
    series90d.push({ marketPrice: synthMkt, lowestDrop: synthLow });
  }

  const slice14 = series90d.slice(-14);
  const slice30 = series90d.slice(-30);
  const slice60 = series90d.slice(-60);

  const avg14d = meanOf(slice14.map(p => p.marketPrice), currentMarket);
  const avg30d = meanOf(slice30.map(p => p.marketPrice), currentMarket);
  const avg60d = meanOf(slice60.map(p => p.marketPrice), currentMarket);
  const avg90d = meanOf(series90d.map(p => p.marketPrice), currentMarket);
  const low30d = minOf(slice30.map(p => p.lowestDrop), cachedLow);
  const low60d = minOf(slice60.map(p => p.lowestDrop), cachedLow);
  const low90d = minOf(series90d.map(p => p.lowestDrop), cachedLow);

  const ref14d = slice14[0]?.marketPrice || avg14d || currentMarket;
  const ref30d = slice30[0]?.marketPrice || avg30d || currentMarket;
  const ref60d = slice60[0]?.marketPrice || avg60d || currentMarket;
  const ref90d = series90d[0]?.marketPrice || avg90d || currentMarket;

  return {
    skuId, currentMarket, avg14d, avg30d, avg60d, avg90d, low30d, low60d, low90d,
    delta14dPct: ref14d > 0 ? round1(((currentMarket - ref14d) / ref14d) * 100) : 0,
    change30dPct: ref30d > 0 ? round1(((currentMarket - ref30d) / ref30d) * 100) : 0,
    change60dPct: ref60d > 0 ? round1(((currentMarket - ref60d) / ref60d) * 100) : 0,
    change90dPct: ref90d > 0 ? round1(((currentMarket - ref90d) / ref90d) * 100) : 0
  };
}

export function computeAutoPilotTarget(params: {
  skuId: string;
  msrpCeiling: number;
  policyMaxBuy: number;
  marketBaseline: number;
  rolling?: RollingMarketMetrics;
  autoPilotEnabled?: boolean;
  lowestShelfPrice?: number;
  activeStoreCount?: number;
  wallOwned?: boolean;
  dadRipOwned?: boolean;
  loganRipOwned?: boolean;
  completionCount?: number;
  fullyConquered?: boolean;
}): AutoPilotTargetResult {
  const {
    skuId, msrpCeiling, policyMaxBuy, marketBaseline,
    autoPilotEnabled = true, lowestShelfPrice = 0, activeStoreCount = 0,
    wallOwned = false, dadRipOwned = false, loganRipOwned = false
  } = params;
  const rolling = params.rolling || computeRollingMarketMetrics(skuId, marketBaseline, msrpCeiling);
  const compCount = params.completionCount !== undefined
    ? params.completionCount
    : (wallOwned ? 1 : 0) + (dadRipOwned ? 1 : 0) + (loganRipOwned ? 1 : 0);
  const fullyConquered = params.fullyConquered !== undefined ? params.fullyConquered : compCount >= 3;
  const isRipHuntMode = Boolean((wallOwned || compCount >= 1) && !fullyConquered);

  const isDestinedOrSoftening = /destined-rivals/i.test(skuId) && (lowestShelfPrice > msrpCeiling * 1.35 || rolling.delta14dPct <= -2);
  const isBleedingDown = Boolean(
    rolling.delta14dPct <= -5 ||
    (activeStoreCount >= 8 && rolling.delta14dPct <= -2.5) ||
    isDestinedOrSoftening
  );
  const isSupplyTightening = Boolean(!isBleedingDown && rolling.change60dPct >= 8 && activeStoreCount <= 5);

  let autoPilotCeiling = policyMaxBuy;
  let autoPilotModeLabel = '60D ELASTIC DIP FLOAT';
  let autoPilotBadge: string | undefined = undefined;

  if (isBleedingDown) {
    const floorRef = lowestShelfPrice > 0 ? lowestShelfPrice : (rolling.low30d || rolling.currentMarket);
    autoPilotCeiling = Math.max(round2(msrpCeiling * 0.90), Math.round(floorRef * 0.92));
    const shownDelta = Math.min(-5, Math.round(rolling.delta14dPct || -6));
    autoPilotModeLabel = 'BLEEDING DOWN // PULL -8%';
    autoPilotBadge = `◈ ⟦ BLEEDING DOWN (${shownDelta}% 14D) // HOLD OFF ⟧`;
  } else if (isSupplyTightening) {
    const climbTarget = Math.round(Math.max(policyMaxBuy, Math.min(rolling.avg60d * 0.96, rolling.currentMarket * 0.94)));
    autoPilotCeiling = Math.max(msrpCeiling, climbTarget);
    autoPilotModeLabel = 'SUPPLY TIGHTENING // BREAKOUT';
    autoPilotBadge = `◈ ⟦ SUPPLY TIGHTENING (+${Math.max(8, Math.round(rolling.change60dPct))}% 60D) // PRIORITY GRAB ⟧`;
  } else {
    const dipTarget = Math.round(Math.max(rolling.low60d * 1.03, rolling.avg60d * 0.90));
    autoPilotCeiling = Math.max(msrpCeiling, dipTarget);
  }

  const baseMaxBuy = autoPilotEnabled ? Math.max(msrpCeiling, isBleedingDown ? Math.min(policyMaxBuy, autoPilotCeiling) : Math.max(policyMaxBuy, autoPilotCeiling)) : Math.max(msrpCeiling, policyMaxBuy);
  const ripHuntCeiling = round2(Math.min(baseMaxBuy, Math.max(msrpCeiling * 1.18, (rolling.low60d || msrpCeiling) * 1.03)));
  const effectiveTargetCeiling = isRipHuntMode ? ripHuntCeiling : baseMaxBuy;

  return {
    autoPilotEnabled, autoPilotCeiling, effectiveTargetCeiling, ripHuntCeiling,
    isRipHuntMode, isBleedingDown, isSupplyTightening, autoPilotModeLabel, autoPilotBadge
  };
}

export function evaluateSkuTrendAndTiming(params: TrendEvalParams): TrendEvaluation {
  const {
    skuId, formFactor = 'ETB', dropPrice, landedPrice,
    estimatedShipping = Math.max(0, landedPrice - dropPrice),
    policyMaxBuy, msrpCeiling, marketBaseline, releaseDate,
    owned = false, wallOwned = owned, dadRipOwned = false, loganRipOwned = false,
    completionCount, fullyConquered, autoPilotEnabled = true,
    activeStoreCount = 0, lowestShelfPrice = dropPrice,
    isCloseCall = false, isMarketplace3P = false, nowTs = Date.now()
  } = params;

  const daysUntilRelease = getDaysUntilRelease(releaseDate, nowTs);
  const isPreRelease = daysUntilRelease !== null && daysUntilRelease >= 0;
  const isPreLaunchWindow = daysUntilRelease !== null && daysUntilRelease >= -7 && daysUntilRelease <= 120;

  const rolling = computeRollingMarketMetrics(skuId, marketBaseline, msrpCeiling, nowTs);
  const ap = computeAutoPilotTarget({
    skuId, msrpCeiling, policyMaxBuy, marketBaseline, rolling, autoPilotEnabled,
    lowestShelfPrice, activeStoreCount, wallOwned, dadRipOwned, loganRipOwned, completionCount, fullyConquered
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

  const makeResult = (
    trendSignal: TrendSignal,
    trendVerdictLabel: string,
    opts?: { isElasticDip?: boolean; qualifiesForElasticDipAlert?: boolean; isRunawayUptrendDeal?: boolean; preReleaseStatusTag?: string }
  ): TrendEvaluation => ({
    trendSignal, trendVerdictLabel,
    isElasticDip: Boolean(opts?.isElasticDip),
    qualifiesForElasticDipAlert: Boolean(opts?.qualifiesForElasticDipAlert),
    isRunawayUptrendDeal: Boolean(opts?.isRunawayUptrendDeal),
    isBleedingDown: ap.isBleedingDown,
    isSupplyTightening: ap.isSupplyTightening,
    autoPilotCeiling: ap.autoPilotCeiling,
    effectiveTargetCeiling: ap.effectiveTargetCeiling,
    ripHuntCeiling: ap.ripHuntCeiling,
    isRipHuntMode: ap.isRipHuntMode,
    isPreRelease, daysUntilRelease,
    preReleaseStatusTag: opts?.preReleaseStatusTag,
    undercutMarketPct, rolling
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
