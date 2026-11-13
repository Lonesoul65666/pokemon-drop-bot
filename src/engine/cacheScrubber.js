"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrubPoisonedRuntimeCaches = scrubPoisonedRuntimeCaches;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const policies_1 = require("../../policies");
const evaluator_1 = require("../../evaluator");
const ROOT_DIR = path.resolve(__dirname, '../..');
const PHASE_3C_EPOCH_MARKER = path.join(ROOT_DIR, 'data', '.phase3c_usd_epoch.json');
function isPreviewOrTestArtifact(skuId, title, retailer, itemId, price) {
    const combined = `${skuId} ${title} ${retailer} ${itemId}`;
    if (/\[FORMAT\s*PREVIEW|preview_30th|test_tick/i.test(combined))
        return true;
    if (skuId === 'me-30th-celebration-etb-case' && (Math.abs(price - 922.99) < 1.5 || Math.abs(price - 999.99) < 0.05)) {
        return true;
    }
    return false;
}
function isBogusV3Placeholder(price, formFactor) {
    const ff = String(formFactor || '').toLowerCase();
    if (ff === 'etb' && Math.abs(price - 115) < 0.05)
        return true;
    if (ff.includes('case') && Math.abs(price - 1150) < 0.05)
        return true;
    return false;
}
function scrubPoisonedRuntimeCaches(forceCurrencyReset = false) {
    const report = {
        storeOffersPurged: 0,
        liveStockPurged: 0,
        dropsHistoryPurged: 0,
        dailySnapshotsPurged: 0,
        salesHistoryPurged: 0,
        marketCacheCleaned: 0,
        msrpTrophiesPurged: 0,
        valid1PMsrpTrophiesRemaining: 0,
        poisoned38To45Purged: 0,
        previewTestTicksPurged: 0,
        phase3cCurrencyFlushExecuted: false
    };
    // Phase 3C One-Time Currency & Variant-Truth Reset:
    // Wipe pre-Phase-3C unverified LGS shelf rows from storeOffersCache.json & liveStock.json once so
    // fresh USD-locked + variant.available=true polls repopulate clean prices (kills Kanzen $151 & Zulu $65.98 ghosts!).
    const needsPhase3cFlush = forceCurrencyReset || !fs.existsSync(PHASE_3C_EPOCH_MARKER);
    if (needsPhase3cFlush) {
        try {
            const offersPath = path.join(ROOT_DIR, 'storeOffersCache.json');
            if (fs.existsSync(offersPath)) {
                const rawOffers = JSON.parse(fs.readFileSync(offersPath, 'utf-8')) || {};
                let purged = 0;
                for (const skuOffers of Object.values(rawOffers)) {
                    if (skuOffers && typeof skuOffers === 'object') {
                        purged += Object.keys(skuOffers).length;
                    }
                }
                (0, policies_1.atomicWriteJson)(offersPath, {});
                report.storeOffersPurged += purged;
            }
            const livePath = path.join(ROOT_DIR, 'liveStock.json');
            if (fs.existsSync(livePath)) {
                (0, policies_1.atomicWriteJson)(livePath, { __bestOffers: {}, __recentOos: [] });
            }
            const dataDir = path.dirname(PHASE_3C_EPOCH_MARKER);
            if (!fs.existsSync(dataDir))
                fs.mkdirSync(dataDir, { recursive: true });
            (0, policies_1.atomicWriteJson)(PHASE_3C_EPOCH_MARKER, {
                epoch: 'v6_phase3c_usd_variant_truth',
                flushedAt: new Date().toISOString()
            });
            report.phase3cCurrencyFlushExecuted = true;
        }
        catch { }
    }
    const policyMap = new Map();
    for (const p of policies_1.WATCH_POLICIES)
        policyMap.set(p.id, p);
    const marketPath = path.join(ROOT_DIR, 'marketCache.json');
    let marketCache = {};
    if (fs.existsSync(marketPath)) {
        try {
            marketCache = JSON.parse(fs.readFileSync(marketPath, 'utf-8'));
        }
        catch {
            marketCache = {};
        }
    }
    const getFloorAndCeil = (skuId, store, url, title) => {
        const pol = policyMap.get(skuId);
        const is1P = (0, evaluator_1.isVerified1PBigBoxOrPc)(store, url, false);
        const tel = marketCache[skuId];
        const verifiedMarket = Math.max(Number(pol?.estimatedMarketValue || 0), Number(tel?.marketPrice || 0) <= (Number(pol?.estimatedMarketValue || 9999) * 1.6) ? Number(tel?.marketPrice || 0) : 0);
        const floor = (0, policies_1.computeSanityPriceFloor)({
            formFactor: pol?.formFactor,
            msrp: pol?.msrpCeiling,
            verifiedMarket,
            is1PBigBox: is1P,
            title: title || pol?.name || skuId
        });
        const ceil = (0, policies_1.getMaxPlausiblePriceCeiling)(pol?.formFactor, skuId, pol?.name || title, pol);
        return { pol, floor, ceil, is1P };
    };
    // 1. Scrub storeOffersCache.json
    const offersPath = path.join(ROOT_DIR, 'storeOffersCache.json');
    if (fs.existsSync(offersPath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(offersPath, 'utf-8'));
            let mutated = false;
            for (const [skuId, skuOffers] of Object.entries(raw || {})) {
                if (!skuOffers || typeof skuOffers !== 'object')
                    continue;
                for (const [stKey, rec] of Object.entries(skuOffers)) {
                    if (!rec)
                        continue;
                    const p = Number(rec.price || rec.landedPrice || 0);
                    const title = String(rec.rawTitle || rec.title || '');
                    const store = String(rec.storeName || stKey || '');
                    const url = String(rec.productUrl || rec.url || '');
                    const { pol, floor, ceil } = getFloorAndCeil(skuId, store, url, title);
                    const isPreview = isPreviewOrTestArtifact(skuId, title, store, String(rec.itemId || ''), p);
                    const isBadTitle = title ? ((0, policies_1.isPoisonedVariantOrAccessory)(undefined, title, p, pol?.formFactor) || (0, policies_1.isSingleCardOrNonSealed)(title, undefined, url)) : false;
                    const isPlaceholder = isBogusV3Placeholder(p, pol?.formFactor) && /tcgplayer|baseline|market/i.test(store);
                    if (!pol || isPreview || isBadTitle || isPlaceholder || p < floor || p > ceil) {
                        if (p >= 35 && p <= 48)
                            report.poisoned38To45Purged += 1;
                        if (isPreview)
                            report.previewTestTicksPurged += 1;
                        delete skuOffers[stKey];
                        report.storeOffersPurged += 1;
                        mutated = true;
                    }
                }
            }
            if (mutated)
                (0, policies_1.atomicWriteJson)(offersPath, raw);
        }
        catch { }
    }
    // 2. Scrub liveStock.json
    const livePath = path.join(ROOT_DIR, 'liveStock.json');
    if (fs.existsSync(livePath)) {
        try {
            const live = JSON.parse(fs.readFileSync(livePath, 'utf-8'));
            let mutated = false;
            for (const key of Object.keys(live || {})) {
                if (key === '__recentOos' || key === '__bestOffers')
                    continue;
                const entry = live[key];
                const p = Number(entry?.price || entry?.landedPrice || 0);
                const title = String(entry?.title || entry?.ruleName || '');
                const store = String(entry?.retailer || '');
                const { pol, floor, ceil } = getFloorAndCeil(key, store, String(entry?.url || ''), title);
                const isPreview = isPreviewOrTestArtifact(key, title, store, String(entry?.itemId || ''), p);
                const isBad = !pol || isPreview || (0, policies_1.isPoisonedVariantOrAccessory)(undefined, title, p, pol?.formFactor) || p < floor || p > ceil;
                if (isBad) {
                    if (p >= 35 && p <= 48)
                        report.poisoned38To45Purged += 1;
                    if (isPreview)
                        report.previewTestTicksPurged += 1;
                    delete live[key];
                    report.liveStockPurged += 1;
                    mutated = true;
                }
            }
            if (live?.__bestOffers && typeof live.__bestOffers === 'object') {
                for (const [bKey, entry] of Object.entries(live.__bestOffers)) {
                    const p = Number(entry?.price || entry?.landedPrice || 0);
                    const title = String(entry?.title || entry?.ruleName || '');
                    const store = String(entry?.retailer || '');
                    const { pol, floor, ceil } = getFloorAndCeil(bKey, store, String(entry?.url || ''), title);
                    const isPreview = isPreviewOrTestArtifact(bKey, title, store, String(entry?.itemId || ''), p);
                    if (!pol || isPreview || (0, policies_1.isPoisonedVariantOrAccessory)(undefined, title, p, pol?.formFactor) || p < floor || p > ceil) {
                        if (p >= 35 && p <= 48)
                            report.poisoned38To45Purged += 1;
                        delete live.__bestOffers[bKey];
                        report.liveStockPurged += 1;
                        mutated = true;
                    }
                }
            }
            if (mutated)
                (0, policies_1.atomicWriteJson)(livePath, live);
        }
        catch { }
    }
    // 3. Scrub dropsHistory.json & alertHistory.json
    for (const histFile of ['dropsHistory.json', 'alertHistory.json']) {
        const histPath = path.join(ROOT_DIR, histFile);
        if (!fs.existsSync(histPath))
            continue;
        try {
            const arr = JSON.parse(fs.readFileSync(histPath, 'utf-8'));
            if (!Array.isArray(arr))
                continue;
            const filtered = arr.filter((d) => {
                const skuId = String(d?.ruleId || '');
                const p = Number(d?.price || d?.landedPrice || 0);
                const title = String(d?.rawTitle || d?.title || '');
                const store = String(d?.retailer || '');
                const { pol, floor, ceil } = getFloorAndCeil(skuId, store, String(d?.url || ''), title);
                const isPreview = isPreviewOrTestArtifact(skuId, title, store, String(d?.itemId || ''), p);
                const isBad = !pol || isPreview || (0, policies_1.isPoisonedVariantOrAccessory)(undefined, title, p, pol?.formFactor) || p < floor || p > ceil;
                if (isBad) {
                    if (p >= 35 && p <= 48)
                        report.poisoned38To45Purged += 1;
                    if (isPreview)
                        report.previewTestTicksPurged += 1;
                    report.dropsHistoryPurged += 1;
                    return false;
                }
                return true;
            });
            if (filtered.length !== arr.length)
                (0, policies_1.atomicWriteJson)(histPath, filtered);
        }
        catch { }
    }
    // 4. Scrub dailySnapshots.json & salesHistory.json
    const snapPath = path.join(ROOT_DIR, 'dailySnapshots.json');
    if (fs.existsSync(snapPath)) {
        try {
            const snaps = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
            let mutated = false;
            for (const [skuId, rows] of Object.entries(snaps || {})) {
                if (!Array.isArray(rows))
                    continue;
                const { floor, ceil } = getFloorAndCeil(skuId, 'LGS', '', '');
                const cleanRows = rows.filter((r) => {
                    const low = Number(r?.lowestDrop ?? r?.low ?? r?.marketPrice ?? 0);
                    const isPreview = isPreviewOrTestArtifact(skuId, '', String(r?.lowestStore || ''), '', low);
                    if (isPreview || (low > 0 && (low < floor || low > ceil))) {
                        if (low >= 35 && low <= 48)
                            report.poisoned38To45Purged += 1;
                        if (isPreview)
                            report.previewTestTicksPurged += 1;
                        report.dailySnapshotsPurged += 1;
                        mutated = true;
                        return false;
                    }
                    return true;
                });
                snaps[skuId] = cleanRows;
            }
            if (mutated)
                (0, policies_1.atomicWriteJson)(snapPath, snaps);
        }
        catch { }
    }
    const salesPath = path.join(ROOT_DIR, 'salesHistory.json');
    if (fs.existsSync(salesPath)) {
        try {
            const sales = JSON.parse(fs.readFileSync(salesPath, 'utf-8'));
            if (Array.isArray(sales)) {
                const cleanSales = sales.filter((r) => {
                    const skuId = String(r?.targetId || r?.skuId || '');
                    const p = Number(r?.landedPrice || r?.price || 0);
                    const store = String(r?.store || '');
                    const { pol, floor, ceil } = getFloorAndCeil(skuId, store, String(r?.url || ''), '');
                    const isPreview = isPreviewOrTestArtifact(skuId, '', store, '', p);
                    if (!pol || isPreview || p < floor || p > ceil) {
                        if (p >= 35 && p <= 48)
                            report.poisoned38To45Purged += 1;
                        if (isPreview)
                            report.previewTestTicksPurged += 1;
                        report.salesHistoryPurged += 1;
                        return false;
                    }
                    return true;
                });
                if (cleanSales.length !== sales.length)
                    (0, policies_1.atomicWriteJson)(salesPath, cleanSales);
            }
        }
        catch { }
    }
    // 5. Scrub marketCache.json bogus $115 / $1150 V3 placeholders & < sanityFloor lows
    if (Object.keys(marketCache).length > 0) {
        let mktMutated = false;
        for (const [skuId, entry] of Object.entries(marketCache)) {
            if (!entry || typeof entry !== 'object')
                continue;
            const pol = policyMap.get(skuId);
            const { floor, ceil } = getFloorAndCeil(skuId, String(entry.lowestStore || ''), String(entry.lowestUrl || ''), String(pol?.name || ''));
            const lowP = Number(entry.lowestPrice || 0);
            const estMkt = Number(pol?.estimatedMarketValue || 0);
            const isV3115 = isBogusV3Placeholder(lowP, pol?.formFactor) || isBogusV3Placeholder(Number(entry.rollingAverage || 0), pol?.formFactor) || isBogusV3Placeholder(Number(entry.estimatedMarketValue || 0), pol?.formFactor);
            const isBogusBaseline = isV3115 ||
                /baseline|placeholder|seed/i.test(String(entry.lowestStore || '')) ||
                (estMkt > 0 && lowP > estMkt * 1.45 && /tcgplayer/i.test(String(entry.lowestStore || '')));
            if (lowP > 0 && (lowP < floor || lowP > ceil || isBogusBaseline)) {
                if (lowP >= 35 && lowP <= 48)
                    report.poisoned38To45Purged += 1;
                entry.lowestPrice = estMkt > 0 ? estMkt : 0;
                entry.lowestStore = '';
                entry.lowestUrl = '';
                entry.inStock = false;
                if (isBogusV3Placeholder(Number(entry.rollingAverage || 0), pol?.formFactor)) {
                    entry.rollingAverage = estMkt > 0 ? estMkt : 0;
                }
                if (isBogusV3Placeholder(Number(entry.estimatedMarketValue || 0), pol?.formFactor)) {
                    entry.estimatedMarketValue = estMkt > 0 ? estMkt : 0;
                }
                if (Array.isArray(entry.samples)) {
                    entry.samples = entry.samples.filter((s) => !isBogusV3Placeholder(Number(s), pol?.formFactor));
                }
                report.marketCacheCleaned += 1;
                mktMutated = true;
            }
        }
        if (mktMutated)
            (0, policies_1.atomicWriteJson)(marketPath, marketCache);
    }
    // 6. Scrub data/msrpTrophies.json — strictly 1st-Party Big-Box Retail <= msrp * 1.08
    const trophiesPath = path.join(ROOT_DIR, 'data', 'msrpTrophies.json');
    if (fs.existsSync(trophiesPath)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(trophiesPath, 'utf-8'));
            const rawCatches = Array.isArray(parsed?.catches) ? parsed.catches : [];
            const valid1P = rawCatches.filter((c) => {
                const store = String(c?.store || '');
                const url = String(c?.url || '');
                const msrp = Number(c?.msrp || policyMap.get(String(c?.ruleId || ''))?.msrpCeiling || 54.99);
                const landed = Number(c?.landedPrice || c?.price || 0);
                return (0, evaluator_1.isVerified1PBigBoxOrPc)(store, url, false) && landed > 0 && landed <= Math.round(msrp * 1.08 * 100) / 100;
            });
            const prevHits = Number(parsed?.totalMsrpHits || 0);
            if (valid1P.length !== rawCatches.length || prevHits !== valid1P.length) {
                report.msrpTrophiesPurged = Math.max(rawCatches.length - valid1P.length, prevHits - valid1P.length);
                report.valid1PMsrpTrophiesRemaining = valid1P.length;
                (0, policies_1.atomicWriteJson)(trophiesPath, { totalMsrpHits: valid1P.length, catches: valid1P });
            }
            else {
                report.valid1PMsrpTrophiesRemaining = valid1P.length;
            }
        }
        catch { }
    }
    return report;
}
