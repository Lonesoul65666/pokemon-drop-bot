"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EARNED_MILESTONES = void 0;
exports.buildEarnedWatermarkSummary = buildEarnedWatermarkSummary;
exports.fetchTcgPlayerQuarterHistoryNote = fetchTcgPlayerQuarterHistoryNote;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const policies_1 = require("../../policies");
const DAILY_SNAPSHOTS_PATH = path_1.default.resolve(process.cwd(), 'dailySnapshots.json');
const SALES_HISTORY_PATH = path_1.default.resolve(process.cwd(), 'salesHistory.json');
const ROOT_PRICE_HISTORY_PATH = path_1.default.resolve(process.cwd(), 'priceHistory.json');
const DATA_PRICE_HISTORY_PATH = path_1.default.resolve(process.cwd(), 'data', 'priceHistory.json');
const DAY_MS = 24 * 60 * 60 * 1000;
exports.EARNED_MILESTONES = [7, 15, 30, 60, 90];
let cachedDailyMtime = 0;
let cachedDailyData = {};
let cachedSalesMtime = 0;
let cachedSalesData = [];
const tcgQuarterCache = new Map();
function loadCachedJson(filePath, prevMtime, prevVal) {
    try {
        if (!fs_1.default.existsSync(filePath))
            return { mtime: 0, val: prevVal };
        const st = fs_1.default.statSync(filePath);
        if (st.mtimeMs > prevMtime)
            return { mtime: st.mtimeMs, val: JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8')) };
        return { mtime: prevMtime, val: prevVal };
    }
    catch {
        return { mtime: prevMtime, val: prevVal };
    }
}
function is1PStoreLabel(store) {
    return /pok[eé]mon\s*center|\btarget\b|\bwalmart\b|best\s*buy|\bamazon\b|\bcostco\b|sam'?s\s*club|\bgamestop\b|barnes\s*(&|and)\s*noble/i.test(String(store || ''));
}
function formatWholeOrCents(price) {
    if (!Number.isFinite(price) || price <= 0)
        return '$0';
    if (price >= 45 || Math.abs(price - Math.round(price)) < 0.05)
        return `$${Math.round(price).toLocaleString('en-US')}`;
    return `$${price.toFixed(2)}`;
}
function collectRealShelfObservations(skuId, nowTs = Date.now(), currentLandedPrice) {
    const rule = policies_1.WATCH_POLICIES.find((p) => p.id === skuId);
    const baseMinFloor = (0, policies_1.getMinPlausiblePriceFloor)(rule?.formFactor);
    const msrp = Number(rule?.msrpCeiling || 0);
    const minFloor = Math.max(baseMinFloor, msrp > 0 ? Math.round(msrp * 0.60 * 100) / 100 : baseMinFloor);
    const maxCeiling = (0, policies_1.getMaxPlausiblePriceCeiling)(rule?.formFactor, skuId, rule?.name, rule);
    const dLoad = loadCachedJson(DAILY_SNAPSHOTS_PATH, cachedDailyMtime, cachedDailyData);
    cachedDailyMtime = dLoad.mtime;
    cachedDailyData = dLoad.val && typeof dLoad.val === 'object' ? dLoad.val : {};
    const sLoad = loadCachedJson(SALES_HISTORY_PATH, cachedSalesMtime, cachedSalesData);
    cachedSalesMtime = sLoad.mtime;
    cachedSalesData = Array.isArray(sLoad.val) ? sLoad.val : [];
    const points = [];
    for (const snap of Array.isArray(cachedDailyData[skuId]) ? cachedDailyData[skuId] : []) {
        if (!snap)
            continue;
        const store = String(snap.lowestStore || '');
        if (/Baseline|TCGPlayer Market/i.test(store) && Number(snap.observations ?? 0) <= 1)
            continue;
        const p = Number(snap.lowestDrop || 0);
        const mkt = Number(snap.marketPrice || 0);
        if (!Number.isFinite(p) || p < minFloor || p > maxCeiling)
            continue;
        if (!is1PStoreLabel(store) && msrp > 0 && mkt >= msrp * 1.75 && p <= msrp * 0.92)
            continue;
        const parsedDateTs = snap.date ? Date.parse(`${snap.date}T12:00:00Z`) : 0;
        const ts = Number.isFinite(parsedDateTs) && parsedDateTs > 0 ? parsedDateTs : Number(snap.timestamp || 0);
        if (ts > 0 && ts <= nowTs + DAY_MS)
            points.push({ ts, price: p });
    }
    for (const ev of cachedSalesData) {
        if (!ev || ev.targetId !== skuId)
            continue;
        const p = Number(ev.landedPrice || ev.price || 0);
        if (!Number.isFinite(p) || p < minFloor || p > maxCeiling)
            continue;
        if (!is1PStoreLabel(ev.store) && msrp > 0 && Number(ev.marketPrice || 0) >= msrp * 1.75 && p <= msrp * 0.92)
            continue;
        const startTs = Number(ev.restockedAt || ev.lastSeenAt || 0);
        const endTs = Number(ev.clearedAt || ev.lastSeenAt || startTs);
        if (startTs > 0 && startTs <= nowTs + DAY_MS)
            points.push({ ts: startTs, price: p });
        if (endTs > startTs && endTs <= nowTs + DAY_MS)
            points.push({ ts: endTs, price: p });
    }
    for (const extraPath of [DATA_PRICE_HISTORY_PATH, ROOT_PRICE_HISTORY_PATH]) {
        try {
            if (!fs_1.default.existsSync(extraPath))
                continue;
            const raw = JSON.parse(fs_1.default.readFileSync(extraPath, 'utf-8'));
            for (const row of Array.isArray(raw?.[skuId]) ? raw[skuId] : []) {
                const p = Number(row?.landedPrice ?? row?.lowestDrop ?? row?.price ?? 0);
                const ts = Number(row?.timestamp ?? (row?.date ? Date.parse(`${row.date}T12:00:00Z`) : 0));
                if (ts > 0 && p >= minFloor && p <= maxCeiling)
                    points.push({ ts, price: p });
            }
        }
        catch { }
    }
    if (currentLandedPrice !== undefined && currentLandedPrice >= minFloor && currentLandedPrice <= maxCeiling) {
        points.push({ ts: nowTs, price: currentLandedPrice });
    }
    return points;
}
function buildEarnedWatermarkSummary(skuId, currentLandedPrice, nowTs = Date.now()) {
    if (!skuId) {
        return {
            skuId: '', realDaysTracked: 0, earnedMilestones: [], nextUnlockDays: 7, daysUntilNextUnlock: 7,
            observedAllTimeLow: currentLandedPrice && currentLandedPrice > 0 ? currentLandedPrice : null,
            watermarkStrip: 'Shelf Floor — Tracking live (7d unlocks in 7d)'
        };
    }
    const points = collectRealShelfObservations(skuId, nowTs, currentLandedPrice);
    if (points.length === 0) {
        return {
            skuId, realDaysTracked: 0, earnedMilestones: [], nextUnlockDays: 7, daysUntilNextUnlock: 7,
            observedAllTimeLow: null, watermarkStrip: 'Shelf Floor — Tracking started (7d unlocks in 7d)'
        };
    }
    const earliestTs = Math.min(...points.map((pt) => pt.ts));
    const realDaysTracked = Math.max(1, Math.floor(nowTs / DAY_MS) - Math.floor(earliestTs / DAY_MS) + 1);
    const observedAllTimeLow = Math.min(...points.map((pt) => pt.price));
    const earnedMilestones = [];
    let prevMilestoneDays = 0;
    for (const milestone of exports.EARNED_MILESTONES) {
        if (realDaysTracked < milestone)
            break;
        const bandMaxAgeMs = milestone * DAY_MS + 14 * 3600 * 1000;
        const bandMinAgeMs = prevMilestoneDays > 0 ? prevMilestoneDays * DAY_MS - 10 * 3600 * 1000 : -DAY_MS;
        const bandPoints = points.filter((pt) => (nowTs - pt.ts) >= bandMinAgeMs && (nowTs - pt.ts) <= bandMaxAgeMs);
        const chosen = bandPoints.length > 0 ? bandPoints : points.filter((pt) => (nowTs - pt.ts) <= bandMaxAgeMs);
        if (chosen.length > 0) {
            earnedMilestones.push({ days: milestone, lowPrice: Math.round(Math.min(...chosen.map((pt) => pt.price)) * 100) / 100 });
        }
        prevMilestoneDays = milestone;
    }
    const nextUnlockDays = exports.EARNED_MILESTONES.find((m) => realDaysTracked < m) ?? null;
    const daysUntilNextUnlock = nextUnlockDays !== null ? Math.max(1, nextUnlockDays - realDaysTracked) : null;
    const unlockSuffix = nextUnlockDays !== null
        ? `(${realDaysTracked}d tracked — ${nextUnlockDays}d unlocks in ${daysUntilNextUnlock}d)`
        : `(${realDaysTracked}d tracked)`;
    const body = earnedMilestones.length > 0
        ? earnedMilestones.map((m) => `${m.days}d: ${formatWholeOrCents(m.lowPrice)}`).join(' • ')
        : `Observed: ${formatWholeOrCents(observedAllTimeLow)}`;
    return {
        skuId, realDaysTracked, earnedMilestones, nextUnlockDays, daysUntilNextUnlock,
        observedAllTimeLow, watermarkStrip: `Shelf Floor — ${body} ${unlockSuffix}`
    };
}
async function fetchTcgPlayerQuarterHistoryNote(tcgProductId, options) {
    const prodId = Number(tcgProductId || 0);
    if (!Number.isFinite(prodId) || prodId <= 0)
        return '';
    const nowTs = options?.nowTs ?? Date.now();
    const cached = tcgQuarterCache.get(prodId);
    if (cached && cached.expiresAt > nowTs)
        return cached.note;
    const minFloor = (0, policies_1.getMinPlausiblePriceFloor)(options?.formFactor);
    const maxCeiling = (0, policies_1.getMaxPlausiblePriceCeiling)(options?.formFactor, options?.skuId, options?.productName);
    try {
        const res = await fetch(`https://infinite-api.tcgplayer.com/price/history/${Math.floor(prodId)}/detailed?range=quarter`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                Origin: 'https://www.tcgplayer.com',
                Referer: 'https://www.tcgplayer.com/',
                Accept: 'application/json'
            },
            signal: AbortSignal.timeout(4500)
        });
        if (!res.ok)
            return '';
        const text = await res.text();
        if (!text || text.trim().startsWith('<'))
            return '';
        const variants = Array.isArray(JSON.parse(text)?.result) ? JSON.parse(text).result : [];
        const targetVar = variants.find((v) => /unopened/i.test(String(v?.condition || '')) && /english/i.test(String(v?.language || ''))) || variants[0];
        const dated = [];
        for (const b of Array.isArray(targetVar?.buckets) ? targetVar.buckets : []) {
            if (Number(b?.quantitySold || b?.transactionCount || 0) <= 0 || !b?.bucketStartDate)
                continue;
            const ts = Date.parse(`${b.bucketStartDate}T12:00:00Z`);
            const mkt = parseFloat(String(b?.marketPrice || '0'));
            const lowShipped = parseFloat(String(b?.lowSalePriceWithShipping || '0'));
            const p = lowShipped >= minFloor && lowShipped <= maxCeiling ? lowShipped : mkt;
            if (Number.isFinite(ts) && ts > 0 && Number.isFinite(p) && p >= minFloor && p <= maxCeiling)
                dated.push({ ts, price: p });
        }
        if (dated.length === 0)
            return '';
        const oldestAgeDays = Math.floor((nowTs - Math.min(...dated.map((d) => d.ts))) / DAY_MS);
        if (oldestAgeDays < 25) {
            tcgQuarterCache.set(prodId, { note: '', expiresAt: nowTs + 30 * 60 * 1000 });
            return '';
        }
        const slice30 = dated.filter((d) => (nowTs - d.ts) / DAY_MS >= 16 && (nowTs - d.ts) / DAY_MS <= 38);
        const slice60 = dated.filter((d) => (nowTs - d.ts) / DAY_MS >= 42 && (nowTs - d.ts) / DAY_MS <= 75);
        const p30 = slice30.length > 0 ? Math.min(...slice30.map((d) => d.price)) : null;
        const p60 = oldestAgeDays >= 50 && slice60.length > 0 ? Math.min(...slice60.map((d) => d.price)) : null;
        const note = p30 !== null && p60 !== null
            ? `(TCG 30d/60d: ${formatWholeOrCents(p30)}/${formatWholeOrCents(p60)})`
            : (p30 !== null ? `(TCG 30d: ${formatWholeOrCents(p30)})` : '');
        tcgQuarterCache.set(prodId, { note, expiresAt: nowTs + 30 * 60 * 1000 });
        return note;
    }
    catch {
        return '';
    }
}
