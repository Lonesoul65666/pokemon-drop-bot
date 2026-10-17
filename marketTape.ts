import fs from 'fs';
import path from 'path';
import {
  atomicWriteJson,
  WATCH_POLICIES,
  getMinPlausiblePriceFloor,
  getMaxPlausiblePriceCeiling,
  getPackCountForSku,
  computeRipMetrics
} from './policies';

export const SALES_HISTORY_PATH = path.resolve(process.cwd(), 'salesHistory.json');
export const DAILY_SNAPSHOTS_PATH = path.resolve(process.cwd(), 'dailySnapshots.json');
export const WEEKLY_CHECKPOINTS_PATH = path.resolve(process.cwd(), 'weeklyCheckpoints.json');
const MARKET_CACHE_PATH = path.resolve(process.cwd(), 'marketCache.json');
const DROPS_HISTORY_PATH = path.resolve(process.cwd(), 'dropsHistory.json');
const LIVE_STOCK_PATH = path.resolve(process.cwd(), 'liveStock.json');

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

export type VelocityTier = '⚡ FLASH' | '🔥 FAST' | '🐢 SLOW' | 'ACTIVE';

export interface SalesHistoryEvent {
  id: string;
  itemId: string;
  targetId: string;
  targetName: string;
  store: string;
  price: number;
  landedPrice: number;
  marketPrice: number;
  discountPct: number;
  packCount?: number;
  pricePerPack?: number;
  isRipValueLeader?: boolean;
  url: string;
  restockedAt: number;
  lastSeenAt: number;
  clearedAt?: number;
  durationMins?: number;
  status: 'ACTIVE' | 'CLEARED';
  velocity: VelocityTier;
  bigBoxTier?: string;
  bigBoxBadge?: string;
}

export interface DailyTargetSnapshot {
  date: string; // YYYY-MM-DD
  timestamp: number;
  marketPrice: number;
  lowestDrop: number;
  lowestStore: string;
  observations: number;
}

export interface WeeklyDeltaCheckpoint {
  weekEnding: string; // YYYY-MM-DD (Sunday)
  timestamp: number;
  marketPrice: number;
  avgClearPrice: number;
  lowestDrop: number;
  clearedCount: number;
  topStore: string;
  wowDeltaPct: number;
}

export interface TargetTapeMetrics {
  targetId: string;
  targetName: string;
  formFactor: string;
  era: string;
  msrp: number;
  marketPrice: number;
  maxBuy: number;
  packCount: number;
  pricePerPack: number;
  isRipValueLeader: boolean;
  releaseDate?: string;
  isPreRelease?: boolean;
  preReleaseStatusTag?: string;
  nrt7dDeltaPct: number;
  absorptionRatio: number;
  clearedCount14d: number;
  activeCount14d: number;
  totalEvents14d: number;
  lastClearPrice: number | null;
  lastClearStore: string | null;
  lastClearMins: number | null;
  lastClearVelocity: VelocityTier | null;
  staleFloorPrice: number | null;
  staleFloorStore: string | null;
  topStore: string;
  topStoreRestocks: number;
  topStoreAvgDiscountPct: number;
  isDistributorWave: boolean;
  waveStores48h: string[];
  verdictBadge: string;
  verdictTone: 'emerald' | 'cyan' | 'amber' | 'purple' | 'slate';
  latestWeekly: WeeklyDeltaCheckpoint | null;
}

let salesHistory: SalesHistoryEvent[] = [];
let dailySnapshots: Record<string, DailyTargetSnapshot[]> = {};
let weeklyCheckpoints: Record<string, WeeklyDeltaCheckpoint[]> = {};
let flushTimer: any = null;

function getDateKey(ts = Date.now()): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getMostRecentSundayKey(ts = Date.now()): string {
  const d = new Date(ts);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  return getDateKey(d.getTime());
}

function pruneOldRecords() {
  const cutoffTs = Date.now() - FOURTEEN_DAYS_MS;
  salesHistory = salesHistory.filter(ev => (ev.clearedAt || ev.lastSeenAt || ev.restockedAt) >= cutoffTs);

  for (const targetId of Object.keys(dailySnapshots)) {
    const arr = dailySnapshots[targetId] || [];
    dailySnapshots[targetId] = arr.filter(s => s.timestamp >= cutoffTs).slice(-14);
    if (dailySnapshots[targetId].length === 0) {
      delete dailySnapshots[targetId];
    }
  }
}

export function flushMarketTapeToDisk(immediate = false) {
  const doFlush = () => {
    pruneOldRecords();
    atomicWriteJson(SALES_HISTORY_PATH, salesHistory);
    atomicWriteJson(DAILY_SNAPSHOTS_PATH, dailySnapshots);
    atomicWriteJson(WEEKLY_CHECKPOINTS_PATH, weeklyCheckpoints);
  };

  if (immediate) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    doFlush();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      doFlush();
    }, 2500);
  }
}

function loadAndSeedMarketTape() {
  try {
    if (fs.existsSync(SALES_HISTORY_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SALES_HISTORY_PATH, 'utf-8'));
      if (Array.isArray(raw)) salesHistory = raw;
    }
  } catch (e) {
    salesHistory = [];
  }

  try {
    if (fs.existsSync(DAILY_SNAPSHOTS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(DAILY_SNAPSHOTS_PATH, 'utf-8'));
      if (raw && typeof raw === 'object') dailySnapshots = raw;
    }
  } catch (e) {
    dailySnapshots = {};
  }

  try {
    if (fs.existsSync(WEEKLY_CHECKPOINTS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(WEEKLY_CHECKPOINTS_PATH, 'utf-8'));
      if (raw && typeof raw === 'object') weeklyCheckpoints = raw;
    }
  } catch (e) {
    weeklyCheckpoints = {};
  }

  let cache: Record<string, any> = {};
  try {
    if (fs.existsSync(MARKET_CACHE_PATH)) {
      cache = JSON.parse(fs.readFileSync(MARKET_CACHE_PATH, 'utf-8'));
    }
  } catch (e) {}

  let modified = false;
  const now = Date.now();
  const todayKey = getDateKey(now);

  // Seed Day 0 dailySnapshots for all policies if missing (0.0% initial delta)
  for (const pol of WATCH_POLICIES) {
    const c = cache[pol.id];
    const mkt = (c && c.rollingAverage > 0) ? c.rollingAverage : pol.estimatedMarketValue;
    const low = (c && c.lowestPrice > 0) ? c.lowestPrice : mkt;
    const store = (c && c.lowestStore) ? c.lowestStore : 'TCGPlayer Market';

    if (!dailySnapshots[pol.id] || dailySnapshots[pol.id].length === 0) {
      dailySnapshots[pol.id] = [
        {
          date: todayKey,
          timestamp: now,
          marketPrice: mkt,
          lowestDrop: low,
          lowestStore: store,
          observations: (c?.observationsCount || 1)
        }
      ];
      modified = true;
    }
  }

  // Seed weeklyCheckpoints immediately on first boot if empty (Week 0 at 0.0% delta)
  if (Object.keys(weeklyCheckpoints).length === 0) {
    recordSundayWeeklyCheckpoints(true);
    modified = true;
  }

  if (modified) {
    flushMarketTapeToDisk(true);
  }
}

export function recordDailySnapshot(
  targetId: string,
  price: number,
  store: string,
  marketPrice?: number
) {
  if (!targetId || price <= 0) return;

  const pol = WATCH_POLICIES.find(p => p.id === targetId);
  if (pol) {
    const minFloor = getMinPlausiblePriceFloor(pol.formFactor);
    const maxCeiling = getMaxPlausiblePriceCeiling(pol.formFactor, pol.id, pol.name);
    if (price < minFloor || price > maxCeiling) return;
    if (marketPrice && (marketPrice < minFloor || marketPrice > maxCeiling)) {
      marketPrice = pol.estimatedMarketValue;
    }
  }

  const now = Date.now();
  const todayKey = getDateKey(now);
  const list = dailySnapshots[targetId] || [];
  let todaySnap = list.find(s => s.date === todayKey);

  const effMarket = marketPrice && marketPrice > 0 ? marketPrice : price;
  if (!todaySnap) {
    todaySnap = {
      date: todayKey,
      timestamp: now,
      marketPrice: effMarket,
      lowestDrop: price,
      lowestStore: store,
      observations: 1
    };
    list.push(todaySnap);
  } else {
    todaySnap.timestamp = now;
    todaySnap.observations += 1;
    if (marketPrice && marketPrice > 0) {
      todaySnap.marketPrice = marketPrice;
    }
    if (price <= todaySnap.lowestDrop || todaySnap.lowestDrop <= 0) {
      todaySnap.lowestDrop = price;
      todaySnap.lowestStore = store;
    }
  }

  dailySnapshots[targetId] = list.slice(-14);
  flushMarketTapeToDisk(false);
}

export function recordTapeRestock(params: {
  itemId: string;
  targetId: string;
  targetName: string;
  store: string;
  price: number;
  landedPrice?: number;
  marketPrice: number;
  url: string;
  bigBoxTier?: string;
  bigBoxBadge?: string;
}) {
  const now = Date.now();
  const discountPct = params.marketPrice > 0
    ? Math.round(((params.marketPrice - params.price) / params.marketPrice) * 100)
    : 0;

  recordDailySnapshot(params.targetId, params.price, params.store, params.marketPrice);

  const pol = WATCH_POLICIES.find(p => p.id === params.targetId);
  const effLanded = params.landedPrice ?? params.price;
  const rip = computeRipMetrics(effLanded, params.targetId, pol?.formFactor, params.targetName, pol?.packCount);

  const existing = salesHistory.find(
    ev => ev.status === 'ACTIVE' && (ev.itemId === String(params.itemId) || (ev.targetId === params.targetId && ev.store === params.store))
  );

  if (existing) {
    existing.lastSeenAt = now;
    existing.price = params.price;
    existing.landedPrice = effLanded;
    existing.marketPrice = params.marketPrice;
    existing.discountPct = discountPct;
    existing.packCount = rip.packCount;
    existing.pricePerPack = rip.pricePerPack;
    existing.isRipValueLeader = rip.isRipValueLeader;
    existing.url = params.url || existing.url;
    if (params.bigBoxTier) existing.bigBoxTier = params.bigBoxTier;
    if (params.bigBoxBadge) existing.bigBoxBadge = params.bigBoxBadge;
  } else {
    salesHistory.unshift({
      id: `${params.targetId}__${params.store}__${now}`,
      itemId: String(params.itemId),
      targetId: params.targetId,
      targetName: params.targetName,
      store: params.store,
      price: params.price,
      landedPrice: effLanded,
      marketPrice: params.marketPrice,
      discountPct,
      packCount: rip.packCount,
      pricePerPack: rip.pricePerPack,
      isRipValueLeader: rip.isRipValueLeader,
      url: params.url,
      restockedAt: now,
      lastSeenAt: now,
      status: 'ACTIVE',
      velocity: 'ACTIVE',
      bigBoxTier: params.bigBoxTier,
      bigBoxBadge: params.bigBoxBadge
    });
  }

  if (salesHistory.length > 600) {
    salesHistory = salesHistory.slice(0, 600);
  }
  flushMarketTapeToDisk(false);
}

export function recordTapeSoldOut(itemId: string): SalesHistoryEvent | null {
  const now = Date.now();
  const activeEv = salesHistory.find(ev => ev.status === 'ACTIVE' && ev.itemId === String(itemId));
  if (!activeEv) return null;

  activeEv.status = 'CLEARED';
  activeEv.clearedAt = now;
  const durationMins = Math.max(1, Math.round((now - activeEv.restockedAt) / 60000));
  activeEv.durationMins = durationMins;

  if (durationMins < 5) {
    activeEv.velocity = '⚡ FLASH';
  } else if (durationMins <= 60) {
    activeEv.velocity = '🔥 FAST';
  } else {
    activeEv.velocity = '🐢 SLOW';
  }

  flushMarketTapeToDisk(false);
  return activeEv;
}

export function getFlashClearEscalation(targetId?: string, dropPrice?: number): {
  isHighVelocityRepeat: boolean;
  badgeText?: string;
  lastStore?: string;
  lastMins?: number;
  lastPrice?: number;
} {
  if (!targetId || !dropPrice || dropPrice <= 0) {
    return { isHighVelocityRepeat: false };
  }

  const cutoff7d = Date.now() - SEVEN_DAYS_MS;
  const flashClears = salesHistory.filter(
    ev =>
      ev.targetId === targetId &&
      ev.status === 'CLEARED' &&
      ev.velocity === '⚡ FLASH' &&
      (ev.clearedAt || ev.lastSeenAt) >= cutoff7d &&
      dropPrice <= ev.price * 1.05
  );

  if (flashClears.length === 0) {
    return { isHighVelocityRepeat: false };
  }

  flashClears.sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0));
  const best = flashClears[0];
  const mins = best.durationMins || 3;
  return {
    isHighVelocityRepeat: true,
    badgeText: `🚨 HIGH-VELOCITY REPEAT (Last cleared in ${mins}m @ ${best.store})`,
    lastStore: best.store,
    lastMins: mins,
    lastPrice: best.price
  };
}

export function recordSundayWeeklyCheckpoints(seedMode = false): number {
  let cache: Record<string, any> = {};
  try {
    if (fs.existsSync(MARKET_CACHE_PATH)) {
      cache = JSON.parse(fs.readFileSync(MARKET_CACHE_PATH, 'utf-8'));
    }
  } catch (e) {}

  const now = Date.now();
  const weekEnding = getMostRecentSundayKey(now);
  const cutoff7d = now - SEVEN_DAYS_MS;
  let recorded = 0;

  for (const pol of WATCH_POLICIES) {
    const c = cache[pol.id];
    const currentMarket = (c && c.rollingAverage > 0) ? c.rollingAverage : pol.estimatedMarketValue;
    const snaps = dailySnapshots[pol.id] || [];
    const events7d = salesHistory.filter(ev => ev.targetId === pol.id && ev.restockedAt >= cutoff7d);
    const cleared7d = events7d.filter(ev => ev.status === 'CLEARED');

    const avgClearPrice = cleared7d.length > 0
      ? Math.round((cleared7d.reduce((s, e) => s + e.price, 0) / cleared7d.length) * 100) / 100
      : (c?.lowestPrice && c.lowestPrice <= pol.maxMarketBuyPrice ? c.lowestPrice : pol.maxMarketBuyPrice);

    let lowestDrop = (c && c.lowestPrice > 0) ? c.lowestPrice : currentMarket;
    for (const s of snaps) {
      if (s.lowestDrop > 0 && s.lowestDrop < lowestDrop) lowestDrop = s.lowestDrop;
    }
    for (const e of events7d) {
      if (e.price > 0 && e.price < lowestDrop) lowestDrop = e.price;
    }

    // Honey-hole top store in last 7-14d
    const storeCounts: Record<string, number> = {};
    for (const e of events7d) {
      if (e.store && !/tcgplayer|market|catalog/i.test(e.store)) {
        storeCounts[e.store] = (storeCounts[e.store] || 0) + 1;
      }
    }
    let topStore = (c?.lowestStore && !/tcgplayer|market|catalog/i.test(c.lowestStore))
      ? c.lowestStore
      : 'TCGPlayer / LGS Baseline';
    let bestCount = 0;
    for (const [st, cnt] of Object.entries(storeCounts)) {
      if (cnt > bestCount) {
        bestCount = cnt;
        topStore = st;
      }
    }

    const history = weeklyCheckpoints[pol.id] || [];
    if (seedMode && history.length === 0) {
      // Seed prior Sunday baseline + current Sunday checkpoint at 0.0% delta on clean boot
      const prevSundayKey = getDateKey(new Date(weekEnding).getTime() - SEVEN_DAYS_MS);
      const baseRef = currentMarket;
      history.push({
        weekEnding: prevSundayKey,
        timestamp: now - SEVEN_DAYS_MS,
        marketPrice: Math.round(baseRef * 100) / 100,
        avgClearPrice: pol.maxMarketBuyPrice,
        lowestDrop: Math.round(Math.min(baseRef, lowestDrop) * 100) / 100,
        clearedCount: 0,
        topStore,
        wowDeltaPct: 0
      });
    }

    const prevCheckpoint = history.length > 0 ? history[history.length - 1] : null;
    const prevMarket = (prevCheckpoint && prevCheckpoint.weekEnding !== weekEnding)
      ? prevCheckpoint.marketPrice
      : (history.length > 1 ? history[history.length - 2].marketPrice : (pol.estimatedMarketValue || currentMarket));

    const wowDeltaPct = prevMarket > 0
      ? Math.round(((currentMarket - prevMarket) / prevMarket) * 1000) / 10
      : 0;

    const newEntry: WeeklyDeltaCheckpoint = {
      weekEnding,
      timestamp: now,
      marketPrice: Math.round(currentMarket * 100) / 100,
      avgClearPrice: Math.round(avgClearPrice * 100) / 100,
      lowestDrop: Math.round(lowestDrop * 100) / 100,
      clearedCount: cleared7d.length,
      topStore,
      wowDeltaPct
    };

    const existingIdx = history.findIndex(h => h.weekEnding === weekEnding);
    if (existingIdx >= 0) {
      history[existingIdx] = newEntry;
    } else {
      history.push(newEntry);
    }

    weeklyCheckpoints[pol.id] = history.slice(-52);
    recorded++;
  }

  flushMarketTapeToDisk(true);
  return recorded;
}

export function computeFullMarketTape() {
  pruneOldRecords();

  let cache: Record<string, any> = {};
  try {
    if (fs.existsSync(MARKET_CACHE_PATH)) {
      cache = JSON.parse(fs.readFileSync(MARKET_CACHE_PATH, 'utf-8'));
    }
  } catch (e) {}

  let liveMap: Record<string, any> = {};
  try {
    if (fs.existsSync(LIVE_STOCK_PATH)) {
      liveMap = JSON.parse(fs.readFileSync(LIVE_STOCK_PATH, 'utf-8'));
    }
  } catch (e) {}

  const now = Date.now();
  const cutoff48h = now - FORTY_EIGHT_HOURS_MS;
  const cutoff7d = now - SEVEN_DAYS_MS;

  const targets: Record<string, TargetTapeMetrics> = {};
  const globalStoreStats: Record<string, { store: string; restocks: number; cleared: number; totalDiscountPct: number; lowestHits: number }> = {};

  for (const pol of WATCH_POLICIES) {
    const c = cache[pol.id];
    const currentMarket = (c && c.rollingAverage > 0) ? c.rollingAverage : pol.estimatedMarketValue;
    const snaps = dailySnapshots[pol.id] || [];

    // 7-day rolling delta %
    let anchorMarket = pol.estimatedMarketValue || currentMarket;
    const olderSnaps = snaps.filter(s => s.timestamp <= cutoff7d + 24 * 60 * 60 * 1000);
    if (olderSnaps.length > 0) {
      anchorMarket = olderSnaps[0].marketPrice || anchorMarket;
    } else if (snaps.length > 0) {
      anchorMarket = snaps[0].marketPrice || anchorMarket;
    }
    const nrt7dDeltaPct = anchorMarket > 0
      ? Math.round(((currentMarket - anchorMarket) / anchorMarket) * 1000) / 10
      : 0;

    const evs14d = salesHistory.filter(ev => ev.targetId === pol.id);
    const clearedEvs = evs14d.filter(ev => ev.status === 'CLEARED');
    const activeEvs = evs14d.filter(ev => ev.status === 'ACTIVE');
    const absorptionRatio = evs14d.length > 0
      ? Math.round((clearedEvs.length / evs14d.length) * 100)
      : 0;

    // Last Clear vs Stale Floor
    clearedEvs.sort((a, b) => (b.clearedAt || 0) - (a.clearedAt || 0));
    const lastClear = clearedEvs[0] || null;

    const liveEntry = liveMap[pol.id];
    let staleFloorPrice: number | null = null;
    let staleFloorStore: string | null = null;
    if (liveEntry && liveEntry.inStock) {
      staleFloorPrice = Number(liveEntry.price);
      staleFloorStore = liveEntry.retailer;
    } else if (c && c.lowestPrice > 0) {
      staleFloorPrice = Number(c.lowestPrice);
      staleFloorStore = c.lowestStore || 'TCGPlayer';
    }

    // Honey-hole Store DNA for this target
    const storeMap: Record<string, { count: number; sumDisc: number }> = {};
    for (const ev of evs14d) {
      if (!ev.store || /tcgplayer|market|catalog/i.test(ev.store)) continue;
      if (!storeMap[ev.store]) storeMap[ev.store] = { count: 0, sumDisc: 0 };
      storeMap[ev.store].count += 1;
      storeMap[ev.store].sumDisc += ev.discountPct || 0;

      if (!globalStoreStats[ev.store]) {
        globalStoreStats[ev.store] = { store: ev.store, restocks: 0, cleared: 0, totalDiscountPct: 0, lowestHits: 0 };
      }
      globalStoreStats[ev.store].restocks += 1;
      if (ev.status === 'CLEARED') globalStoreStats[ev.store].cleared += 1;
      globalStoreStats[ev.store].totalDiscountPct += ev.discountPct || 0;
    }

    if (c?.lowestStore && !/tcgplayer|market|catalog/i.test(c.lowestStore)) {
      const st = c.lowestStore;
      if (!globalStoreStats[st]) {
        globalStoreStats[st] = { store: st, restocks: 1, cleared: 0, totalDiscountPct: Math.max(0, Math.round(((currentMarket - c.lowestPrice) / currentMarket) * 100)), lowestHits: 0 };
      }
      globalStoreStats[st].lowestHits += 1;
    }

    let topStore = (c?.lowestStore && !/tcgplayer|market|catalog/i.test(c.lowestStore))
      ? c.lowestStore
      : 'None (TCGP Baseline)';
    let topStoreRestocks = 0;
    let topStoreAvgDiscountPct = (c?.lowestPrice && currentMarket > 0)
      ? Math.round(((currentMarket - c.lowestPrice) / currentMarket) * 100)
      : 0;

    for (const [st, info] of Object.entries(storeMap)) {
      if (info.count > topStoreRestocks) {
        topStoreRestocks = info.count;
        topStore = st;
        topStoreAvgDiscountPct = Math.round(info.sumDisc / info.count);
      }
    }

    // Distributor Wave detection (>= 3 distinct stores restocking same targetId within 48h)
    const waveStoresSet = new Set<string>();
    for (const ev of evs14d) {
      if (ev.restockedAt >= cutoff48h && ev.store && !/tcgplayer|market|catalog/i.test(ev.store)) {
        waveStoresSet.add(ev.store);
      }
    }
    const waveStores48h = Array.from(waveStoresSet);
    const isDistributorWave = waveStores48h.length >= 3;

    const releaseDate: string | undefined = (pol as any).releaseDate;
    const isPreRelease = Boolean(releaseDate && !Number.isNaN(Date.parse(`${releaseDate}T00:00:00`)) && now < Date.parse(`${releaseDate}T00:00:00`));
    const preReleaseStatusTag = isPreRelease ? '⏳ PRE-RELEASE BLEED (Wait for Launch Week)' : undefined;

    // Verdict Badge & Tone
    let verdictBadge = '🟡 HOLD / WAIT FOR DIP';
    let verdictTone: TargetTapeMetrics['verdictTone'] = 'slate';

    if (liveEntry && liveEntry.inStock && liveEntry.bigBoxBadge && (liveEntry.bigBoxTier === 'PC_EXCLUSIVE_MSRP' || liveEntry.bigBoxTier === 'MSRP_TIER_A')) {
      verdictBadge = `${liveEntry.bigBoxBadge} @ ${liveEntry.retailer}`;
      verdictTone = 'emerald';
    } else if (isPreRelease && (!liveEntry || !liveEntry.inStock || liveEntry.price > pol.msrpCeiling * 1.08)) {
      verdictBadge = preReleaseStatusTag!;
      verdictTone = 'purple';
    } else if (isDistributorWave) {
      verdictBadge = `🌊 DISTRO WAVE (${waveStores48h.length} Stores) • WAIT FOR UNDERCUT`;
      verdictTone = 'purple';
    } else if (liveEntry && liveEntry.inStock && liveEntry.price <= pol.maxMarketBuyPrice) {
      if (lastClear && liveEntry.price <= lastClear.price * 1.02) {
        verdictBadge = '🟢 BUY NOW • AT/BELOW CLEAR FLOOR';
        verdictTone = 'emerald';
      } else {
        verdictBadge = '🟢 BUY ZONE • IN STOCK UNDER TRIGGER';
        verdictTone = 'emerald';
      }
    } else if (lastClear && lastClear.velocity === '⚡ FLASH') {
      verdictBadge = `⚡ FLASH-CLEAR TARGET (${lastClear.durationMins}m @ $${lastClear.price.toFixed(0)})`;
      verdictTone = 'cyan';
    } else if (nrt7dDeltaPct <= -5) {
      verdictBadge = `📉 SOFTENING (${nrt7dDeltaPct}% 7d) • WAIT FOR FLOOR`;
      verdictTone = 'amber';
    } else if (nrt7dDeltaPct >= 5) {
      verdictBadge = `📈 RISING (+${nrt7dDeltaPct}% 7d) • SNIPE AT TRIGGER`;
      verdictTone = 'emerald';
    }

    const wkList = weeklyCheckpoints[pol.id] || [];
    const latestWeekly = wkList.length > 0 ? wkList[wkList.length - 1] : null;

    const refPriceForRip = (liveEntry && liveEntry.inStock && (liveEntry.landedPrice || liveEntry.price))
      ? Number(liveEntry.landedPrice || liveEntry.price)
      : (staleFloorPrice && staleFloorPrice > 0 ? staleFloorPrice : Math.round(currentMarket * 100) / 100);
    const ripMetrics = computeRipMetrics(refPriceForRip, pol.id, pol.formFactor, pol.name, pol.packCount);

    targets[pol.id] = {
      targetId: pol.id,
      targetName: pol.name,
      formFactor: pol.formFactor || 'Sealed',
      era: (pol as any).era || 'General Releases',
      msrp: pol.msrpCeiling,
      marketPrice: Math.round(currentMarket * 100) / 100,
      maxBuy: pol.maxMarketBuyPrice,
      packCount: ripMetrics.packCount,
      pricePerPack: ripMetrics.pricePerPack,
      isRipValueLeader: ripMetrics.isRipValueLeader,
      releaseDate,
      isPreRelease,
      preReleaseStatusTag,
      nrt7dDeltaPct,
      absorptionRatio,
      clearedCount14d: clearedEvs.length,
      activeCount14d: activeEvs.length,
      totalEvents14d: evs14d.length,
      lastClearPrice: lastClear ? lastClear.price : null,
      lastClearStore: lastClear ? lastClear.store : null,
      lastClearMins: lastClear ? (lastClear.durationMins || null) : null,
      lastClearVelocity: lastClear ? lastClear.velocity : null,
      staleFloorPrice,
      staleFloorStore,
      topStore,
      topStoreRestocks,
      topStoreAvgDiscountPct,
      isDistributorWave,
      waveStores48h,
      verdictBadge,
      verdictTone,
      latestWeekly
    };
  }

  const honeyHoleStores = Object.values(globalStoreStats)
    .map(s => ({
      store: s.store,
      restocks: s.restocks,
      cleared: s.cleared,
      lowestHits: s.lowestHits,
      avgDiscountPct: s.restocks > 0 ? Math.round(s.totalDiscountPct / s.restocks) : 0
    }))
    .sort((a, b) => (b.restocks + b.lowestHits) - (a.restocks + a.lowestHits))
    .slice(0, 12);

  let msrpTrophies = { totalMsrpHits: 0, catches: [] };
  try {
    const trophiesPath = path.resolve(process.cwd(), 'data', 'msrpTrophies.json');
    if (fs.existsSync(trophiesPath)) {
      msrpTrophies = JSON.parse(fs.readFileSync(trophiesPath, 'utf-8'));
    }
  } catch (e) {}

  const enrichedSalesTape = salesHistory.slice(0, 30).map(ev => {
    const pol = WATCH_POLICIES.find(p => p.id === ev.targetId);
    const rip = computeRipMetrics(ev.landedPrice || ev.price, ev.targetId, pol?.formFactor, ev.targetName, pol?.packCount);
    return {
      ...ev,
      packCount: ev.packCount ?? rip.packCount,
      pricePerPack: ev.pricePerPack ?? rip.pricePerPack,
      isRipValueLeader: ev.isRipValueLeader ?? rip.isRipValueLeader
    };
  });

  return {
    generatedAt: now,
    windowDays: 14,
    targets,
    honeyHoleStores,
    recentSalesTape: enrichedSalesTape,
    weeklyCheckpoints,
    msrpTrophies
  };
}

export function startMarketTapeScheduler() {
  loadAndSeedMarketTape();

  // Check hourly if it's Sunday night (8:00 PM - 11:59 PM local time) to record Sunday-to-Sunday weekly checkpoints
  setInterval(() => {
    const now = new Date();
    if (now.getDay() === 0 && now.getHours() >= 20) {
      recordSundayWeeklyCheckpoints(false);
    }
  }, 60 * 60 * 1000);
}

// Auto-initialize when module is loaded
loadAndSeedMarketTape();
