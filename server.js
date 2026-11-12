const express = require('express');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] [drop-bot-dashboard] UNCAUGHT EXCEPTION (Recovered):`, err && (err.stack || err.message || err));
});

process.on('unhandledRejection', (reason) => {
  console.error(`[${new Date().toISOString()}] [drop-bot-dashboard] UNHANDLED REJECTION (Recovered):`, reason && (reason.stack || reason.message || reason));
});

const app = express();
const PORT = 3000;
const POLICIES_PATH = path.resolve(__dirname, 'policies.json');
const TELEMETRY_PATH = path.resolve(__dirname, 'marketCache.json');
const DROPS_PATH = path.resolve(__dirname, 'dropsHistory.json');
const LIVE_STOCK_PATH = path.resolve(__dirname, 'liveStock.json');
const ALERT_STATE_PATH = path.resolve(__dirname, 'alertState.json');
const SETTINGS_PATH = path.resolve(__dirname, 'botSettings.json');
const STORE_HEALTH_PATH = path.resolve(__dirname, 'storeHealth.json');
const SALES_HISTORY_PATH = path.resolve(__dirname, 'salesHistory.json');
const MSRP_TROPHIES_PATH = path.resolve(__dirname, 'data', 'msrpTrophies.json');
const CONQUERED_VAULT_PATH = path.resolve(__dirname, 'conqueredVault.json');
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PUBLIC_INDEX_PATH = path.resolve(PUBLIC_DIR, 'index.html');
const ART_DIR = path.resolve(__dirname, 'art');

const {
  loadMergedPoliciesRaw,
  saveUserPoliciesFromUi,
  updateSkuFamilySlotsFromUi,
  markSkuOwnedFromUi,
  loadGlobalSettings,
  saveGlobalSettingsFromUi,
  loadActiveLgsStores
} = require('./src/config/configManager');
const {
  evaluateSkuTrendAndTiming,
  computeRollingMarketMetrics,
  computeAutoPilotTarget,
  isPreReleaseDate
} = require('./src/engine/trendAdvisor');
const {
  isSingleCardOrNonSealed,
  hasMandatorySealedContainerKeyword,
  reloadWatchPolicies,
  getPackCountForSku: tsGetPackCount
} = require('./policies');
const {
  buildShopifyDirectCartLinks
} = require('./evaluator');
const {
  querySinglesCache,
  updateSinglesWatchlist
} = require('./src/engine/singlesSniper');

const USER_PREFS_PATH = path.resolve(__dirname, 'config', 'userPreferences.json');
const CATALOG_PATH = path.resolve(__dirname, 'config', 'catalog.json');
const STORES_CFG_PATH = path.resolve(__dirname, 'config', 'stores.json');
const _jsonFileCache = new Map();

function readJsonCached(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const stat = fs.statSync(filePath);
    const hit = _jsonFileCache.get(filePath);
    if (hit && hit.mtimeMs === stat.mtimeMs) {
      return hit.data;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const val = parsed !== null && parsed !== undefined ? parsed : fallback;
    _jsonFileCache.set(filePath, { mtimeMs: stat.mtimeMs, data: val });
    return val;
  } catch (e) {
    return fallback;
  }
}

let _apiCacheGeneration = 0;
let _cachedPoliciesMem = null;
let _cachedPoliciesSig = '';
let _cachedMergedOffersMem = null;
let _cachedMergedOffersSig = '';
let _cachedMergedOffersTs = 0;
let _cachedStatusJson = null;
let _cachedStatusSig = '';
let _cachedStatusTs = 0;
let _cachedEngineRoomJson = null;
let _cachedEngineRoomSig = '';
let _cachedEngineRoomTs = 0;

function invalidateDashboardApiCaches() {
  _apiCacheGeneration += 1;
  _cachedPoliciesMem = null;
  _cachedMergedOffersMem = null;
  _cachedStatusJson = null;
  _cachedEngineRoomJson = null;
}

function getFileMtimeFast(p) {
  try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; }
}

function getDashboardStateSignature() {
  return [
    _apiCacheGeneration,
    getFileMtimeFast(USER_PREFS_PATH),
    getFileMtimeFast(CATALOG_PATH),
    getFileMtimeFast(STORES_CFG_PATH),
    getFileMtimeFast(POLICIES_PATH),
    getFileMtimeFast( path.resolve(__dirname, 'storeOffersCache.json') ),
    getFileMtimeFast(LIVE_STOCK_PATH),
    getFileMtimeFast(TELEMETRY_PATH),
    getFileMtimeFast(STORE_HEALTH_PATH),
    getFileMtimeFast(DROPS_PATH),
    getFileMtimeFast(SALES_HISTORY_PATH),
    getFileMtimeFast(CONQUERED_VAULT_PATH),
    getFileMtimeFast(MSRP_TROPHIES_PATH),
    getFileMtimeFast(SETTINGS_PATH)
  ].join(':');
}

function getRuntimePolicies() {
  const sig = `${_apiCacheGeneration}:${getFileMtimeFast(USER_PREFS_PATH)}:${getFileMtimeFast(CATALOG_PATH)}:${getFileMtimeFast(POLICIES_PATH)}`;
  if (_cachedPoliciesMem && _cachedPoliciesSig === sig) {
    return _cachedPoliciesMem;
  }
  try {
    const merged = loadMergedPoliciesRaw();
    if (Array.isArray(merged) && merged.length > 0) {
      _cachedPoliciesMem = merged;
      _cachedPoliciesSig = sig;
      return merged;
    }
  } catch (e) {}
  const fallback = readJsonCached(POLICIES_PATH, []);
  _cachedPoliciesMem = Array.isArray(fallback) ? fallback : [];
  _cachedPoliciesSig = sig;
  return _cachedPoliciesMem;
}

function atomicWriteJson(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    const fallbackTmp = `${filePath}.tmp`;
    fs.writeFileSync(fallbackTmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(fallbackTmp, filePath);
  } finally {
    invalidateDashboardApiCaches();
  }
}

function getPackCountForSku(skuId, formFactor, name) {
  try {
    if (typeof tsGetPackCount === 'function') {
      return tsGetPackCount(skuId, formFactor, name);
    }
  } catch (e) {}
  const idLower = (skuId || '').toLowerCase();
  const ffLower = (formFactor || '').toLowerCase();
  const nameLower = (name || '').toLowerCase();
  const combined = `${idLower} ${ffLower} ${nameLower}`;
  if (ffLower === 'master case' || ffLower === 'booster-case' || idLower.endsWith('-booster-case') || /\b216\s*packs\b|\b6\s*boxes\b/i.test(combined)) return 216;
  if (ffLower === 'etb case' || ffLower === 'etb-case' || idLower.endsWith('-etb-case') || /\b10\s*etbs\b|\bcase\s*of\s*10\b/i.test(combined)) return 90;
  if (ffLower === 'booster box' || ffLower === 'booster-box' || idLower.endsWith('-booster-box') || /\b36[- ]?pack\b|booster\s*box/i.test(combined)) return 36;
  if (ffLower === 'booster bundle' || ffLower === 'bundle' || idLower.endsWith('-bundle') || /\b6[- ]?pack\b|booster\s*bundle|\bbundle\b/i.test(combined)) return 6;
  if (ffLower === 'etb' || idLower.endsWith('-etb') || /\b(etb|elite\s*trainer\s*box)\b/i.test(combined)) {
    return /pokemon\s*center|pokémon\s*center|pkmn\s*center|pc\s*exclusive|pc\s*etb/i.test(combined) ? 11 : 9;
  }
  return 36;
}

function computeRipMetrics(landedPrice, skuId, formFactor, name, explicitPackCount) {
  const packCount = (explicitPackCount && explicitPackCount > 0)
    ? explicitPackCount
    : getPackCountForSku(skuId, formFactor, name);
  const safePrice = Number.isFinite(Number(landedPrice)) && Number(landedPrice) > 0 ? Number(landedPrice) : 0;
  const pricePerPack = packCount > 0 && safePrice > 0
    ? Number((safePrice / packCount).toFixed(2))
    : 0;
  const isRipValueLeader = pricePerPack > 0 && pricePerPack <= 4.25;
  return { packCount, pricePerPack, isRipValueLeader };
}

const DEFAULT_MSRP_CATCH = {
  productName: 'Mega Evolution: Chaos Rising Elite Trainer Box',
  ruleId: 'me-chaos-rising-etb',
  store: 'Cooperstown Cards (TCGPlayer Verified Seller)',
  price: 51.00,
  landedPrice: 51.00,
  landedPriceNote: '$51.00 MSRP Drop ($67.11 after tax/ship)',
  msrp: 54.99,
  marketValue: 60.00,
  discountPct: 15,
  orderRef: 'B108C090-96CCFE-CA0AF',
  url: 'https://www.tcgplayer.com/product/684450?Language=English',
  timestamp: 1792295593850,
  timeStr: '2026-10-18T03:53:00.000Z'
};

function loadMsrpTrophies() {
  try {
    if (fs.existsSync(MSRP_TROPHIES_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(MSRP_TROPHIES_PATH, 'utf-8'));
      if (parsed && typeof parsed.totalMsrpHits === 'number' && Array.isArray(parsed.catches)) {
        if (parsed.totalMsrpHits < 1 || parsed.catches.length === 0) {
          parsed.totalMsrpHits = Math.max(1, parsed.totalMsrpHits);
          parsed.catches = [DEFAULT_MSRP_CATCH];
          try { atomicWriteJson(MSRP_TROPHIES_PATH, parsed); } catch (e) {}
        }
        return parsed;
      }
    }
  } catch (e) {}
  const initial = { totalMsrpHits: 1, catches: [DEFAULT_MSRP_CATCH] };
  try {
    atomicWriteJson(MSRP_TROPHIES_PATH, initial);
  } catch (e) {}
  return initial;
}

const DEFAULT_SEED_TROPHIES = [
  {
    id: 'trophy-30th-celebration-etb-case-001',
    skuId: 'me-30th-celebration-etb-case',
    productName: 'Pokémon 30th Celebration ETB Sealed Case (10 ETBs)',
    formFactor: 'etb-case',
    store: 'Player One Services (Verified WPN)',
    conqueredAt: '2026-10-17T16:45:00.000Z',
    deliveryWindow: 'Oct 27 – Oct 30, 2026',
    orderRef: '8E2261C4-EEED7D-7D4DB',
    landedPrice: 1529.45,
    marketValueAtCapture: 1650.00,
    discountPct: 11,
    packCount: 90,
    pricePerPack: 16.99,
    isRipValueLeader: false,
    discordAlertSnapshot: {
      headline: '🎯 FLOOR SNIPE: 30th Celebration 10-ETB Sealed Case',
      triggerReason: 'Verified WPN Institutional Seller • Opened-Case Trap Avoided',
      badgeText: '11% UNDER MKT • 90-DAY FLOOR',
      capturedFrom: 'DropBot Commander Live Radar'
    },
    ruleOf3Status: {
      ripped: false,
      onWall: true,
      subsidized: false,
      sealedCase: true
    },
    memoryNote: 'First major case conquered with Logan sitting in the room!'
  },
  {
    id: 'trophy-2-chaos-rising-etb-msrp',
    skuId: 'me-chaos-rising-etb',
    productName: 'Mega Evolution: Chaos Rising Elite Trainer Box',
    formFactor: 'etb',
    store: 'Cooperstown Cards (TCGPlayer Verified Seller)',
    conqueredAt: '2026-10-18T03:53:00.000Z',
    deliveryWindow: 'Oct 27 – Oct 30, 2026',
    orderRef: 'B108C090-96CCFE-CA0AF',
    landedPrice: 51.00,
    landedPriceNote: '$51.00 MSRP Drop ($67.11 after tax/ship)',
    marketValueAtCapture: 60.00,
    discountPct: 15,
    packCount: 9,
    pricePerPack: 5.67,
    isRipValueLeader: false,
    discordAlertSnapshot: {
      headline: '🚨💎 UNICORN RETAIL MSRP HIT — Mega Evolution: Chaos Rising ETB at $51.00!',
      triggerReason: 'DEFCON-1 OVERRIDE (In Vault — MSRP Rip Alert! Slashed from $60.00)',
      badgeText: '7% BELOW $54.99 RETAIL MSRP',
      capturedFrom: 'Discord @everyone Defcon-1 Flare • 10:53 PM'
    },
    ruleOf3Status: {
      ripped: true,
      onWall: true,
      subsidized: false,
      sealedCase: false
    },
    memoryNote: 'First live V4 Defcon-1 MSRP Override catch! Sniped at 10:53 PM from Cooperstown Cards to rip with Logan!'
  }
];

function computeCollectorRank(ownedEtbCount, trophyCount) {
  const score = (ownedEtbCount * 10) + (trophyCount * 25);
  if (score >= 450) return { level: 5, title: '🏛️ Vault Sovereign', score, nextThreshold: 600 };
  if (score >= 300) return { level: 4, title: '💎 Institutional Whale', score, nextThreshold: 450 };
  if (score >= 175) return { level: 3, title: '🔥 Case Commander', score, nextThreshold: 300 };
  if (score >= 75) return { level: 2, title: '⚡ Floor Sniper', score, nextThreshold: 175 };
  return { level: 1, title: '🎯 Vault Initiate', score, nextThreshold: 75 };
}

function loadConqueredVault() {
  let plaques = [];
  try {
    if (fs.existsSync(CONQUERED_VAULT_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONQUERED_VAULT_PATH, 'utf-8'));
      if (Array.isArray(raw)) {
        plaques = raw;
      } else if (raw && Array.isArray(raw.trophies)) {
        plaques = raw.trophies;
      } else if (raw && Array.isArray(raw.plaques)) {
        plaques = raw.plaques;
      }
    }
  } catch (e) {
    plaques = [];
  }

  let mutated = false;
  if (plaques.length === 0) {
    plaques = [...DEFAULT_SEED_TROPHIES];
    mutated = true;
  } else {
    for (const seed of DEFAULT_SEED_TROPHIES) {
      if (!plaques.some(p => p.id === seed.id)) {
        plaques.push(seed);
        mutated = true;
      }
    }
  }
  if (mutated) {
    try {
      atomicWriteJson(CONQUERED_VAULT_PATH, { trophies: plaques, updatedAt: new Date().toISOString() });
    } catch (e) {}
  }

  const policies = getRuntimePolicies();

  const etbPolicies = policies.filter(p => p.formFactor === 'ETB');
  const ownedEtbs = etbPolicies.filter(p => Boolean(p.owned || p.inVault));
  const ownedCases = policies.filter(p => (p.formFactor === 'ETB Case' || p.formFactor === 'Master Case') && Boolean(p.owned || p.inVault));

  const enrichedPlaques = plaques.map(t => {
    const rip = computeRipMetrics(t.landedPrice, t.skuId, t.formFactor, t.productName, t.packCount);
    return {
      ...t,
      packCount: t.packCount ?? rip.packCount,
      pricePerPack: t.pricePerPack ?? rip.pricePerPack,
      isRipValueLeader: t.isRipValueLeader ?? rip.isRipValueLeader
    };
  });

  const ruleOf3Progress = {
    rippedCount: enrichedPlaques.filter(t => t.ruleOf3Status?.ripped).length,
    onWallCount: enrichedPlaques.filter(t => t.ruleOf3Status?.onWall).length + ownedEtbs.length,
    subsidizedCount: enrichedPlaques.filter(t => t.ruleOf3Status?.subsidized).length,
    sealedCaseCount: enrichedPlaques.filter(t => t.ruleOf3Status?.sealedCase).length,
    totalEtbTargets: etbPolicies.length,
    ownedEtbTargets: ownedEtbs.length,
    ownedCaseTargets: ownedCases.length
  };

  const collectorRank = computeCollectorRank(ownedEtbs.length, enrichedPlaques.length);

  return {
    totalConquered: enrichedPlaques.length,
    collectorRank,
    ruleOf3Progress,
    trophies: enrichedPlaques,
    plaques: enrichedPlaques
  };
}

function saveConqueredPlaques(plaques) {
  atomicWriteJson(CONQUERED_VAULT_PATH, {
    trophies: plaques,
    updatedAt: new Date().toISOString()
  });
  return loadConqueredVault();
}

if (!fs.existsSync(ART_DIR)) {
  fs.mkdirSync(ART_DIR, { recursive: true });
}
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
loadMsrpTrophies();
loadConqueredVault();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get(['/', '/index.html', '/dashboard.html'], (req, res) => {
  res.sendFile(PUBLIC_INDEX_PATH);
});

app.get('/api/conquered-vault', (req, res) => {
  try {
    res.json(loadConqueredVault());
  } catch (e) {
    res.status(500).json({ error: e.message, totalConquered: 0, trophies: [], plaques: [] });
  }
});

app.post('/api/conquered-vault/claim', (req, res) => {
  try {
    const body = req.body || {};
    const vaultState = loadConqueredVault();
    const plaques = [...vaultState.trophies];

    const policies = getRuntimePolicies();
    const matchedPol = policies.find(p => p.id === body.skuId || p.id === body.ruleId);

    const skuId = body.skuId || body.ruleId || (matchedPol ? matchedPol.id : 'custom-sku');
    const productName = body.productName || body.title || (matchedPol ? matchedPol.name : 'Conquered Sealed Target');
    const formFactor = body.formFactor || (matchedPol ? matchedPol.formFactor : 'Sealed');
    const store = body.store || body.retailer || 'Verified Store';
    const landedPrice = Number(body.landedPrice ?? body.price ?? (matchedPol ? matchedPol.maxMarketBuyPrice : 0));
    const marketValueAtCapture = Number(body.marketValueAtCapture ?? body.marketValue ?? (matchedPol ? matchedPol.estimatedMarketValue : landedPrice));
    const discountPct = body.discountPct !== undefined
      ? Number(body.discountPct)
      : (marketValueAtCapture > 0 ? Math.max(0, Math.round(((marketValueAtCapture - landedPrice) / marketValueAtCapture) * 100)) : 0);

    const rip = computeRipMetrics(landedPrice, skuId, formFactor, productName, body.packCount);
    const isCaseForm = /case/i.test(`${formFactor} ${skuId} ${productName}`);

    const newTrophy = {
      id: body.id || `trophy-${skuId}-${Date.now()}`,
      skuId,
      productName,
      formFactor,
      store,
      conqueredAt: body.conqueredAt || new Date().toISOString(),
      deliveryWindow: body.deliveryWindow || 'In Transit / Pending Delivery',
      orderRef: body.orderRef || '',
      landedPrice,
      landedPriceNote: body.landedPriceNote || undefined,
      marketValueAtCapture,
      discountPct,
      packCount: rip.packCount,
      pricePerPack: rip.pricePerPack,
      isRipValueLeader: rip.isRipValueLeader,
      discordAlertSnapshot: body.discordAlertSnapshot || {
        headline: `🎯 SNIPED: ${productName}`,
        triggerReason: body.triggerReason || `Captured @ $${landedPrice.toFixed(2)} from ${store}`,
        badgeText: `${discountPct}% UNDER MKT • $${rip.pricePerPack.toFixed(2)}/PK`,
        capturedFrom: 'DropBot Commander Live Radar'
      },
      ruleOf3Status: {
        ripped: Boolean(body.ruleOf3Status?.ripped),
        onWall: body.ruleOf3Status?.onWall !== undefined ? Boolean(body.ruleOf3Status.onWall) : true,
        subsidized: Boolean(body.ruleOf3Status?.subsidized),
        sealedCase: body.ruleOf3Status?.sealedCase !== undefined ? Boolean(body.ruleOf3Status.sealedCase) : isCaseForm
      },
      memoryNote: body.memoryNote || 'Claimed via DropBot Commander One-Click Trophy Snapshot!'
    };

    plaques.unshift(newTrophy);

    if (matchedPol) {
      matchedPol.owned = true;
      try { markSkuOwnedFromUi(matchedPol.id, true); } catch (e) {}
    }

    const updated = saveConqueredPlaques(plaques);
    res.json({ ok: true, trophy: newTrophy, vault: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/conquered-vault/:id', (req, res) => {
  try {
    const targetId = req.params.id;
    const body = req.body || {};
    const vaultState = loadConqueredVault();
    const plaques = [...vaultState.trophies];
    const idx = plaques.findIndex(t => t.id === targetId || t.skuId === targetId);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: `Trophy ${targetId} not found.` });
    }

    const existing = plaques[idx];
    plaques[idx] = {
      ...existing,
      deliveryWindow: body.deliveryWindow !== undefined ? body.deliveryWindow : existing.deliveryWindow,
      orderRef: body.orderRef !== undefined ? body.orderRef : existing.orderRef,
      landedPriceNote: body.landedPriceNote !== undefined ? body.landedPriceNote : existing.landedPriceNote,
      memoryNote: body.memoryNote !== undefined ? body.memoryNote : existing.memoryNote,
      ruleOf3Status: {
        ...(existing.ruleOf3Status || { ripped: false, onWall: true, subsidized: false, sealedCase: false }),
        ...(body.ruleOf3Status || {})
      }
    };

    const updated = saveConqueredPlaques(plaques);
    res.json({ ok: true, trophy: plaques[idx], vault: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

async function handleBountyRecon(req, res) {
  try {
    const skuId = (req.query?.skuId || req.body?.skuId || '').trim();
    const rawQuery = (req.query?.query || req.query?.q || req.body?.query || req.body?.q || '').trim();
    const formatFilter = (req.query?.format || req.body?.format || '').trim().toUpperCase();
    const storeFilter = (req.query?.store || req.body?.store || '').trim();
    const fetchLive = Boolean(req.query?.live === 'true' || req.body?.live === true);

    const policies = getRuntimePolicies();
    let liveMap = {};
    if (fs.existsSync(LIVE_STOCK_PATH)) {
      try { liveMap = JSON.parse(fs.readFileSync(LIVE_STOCK_PATH, 'utf-8')); } catch (e) {}
    }
    let drops = [];
    if (fs.existsSync(DROPS_PATH)) {
      try { drops = JSON.parse(fs.readFileSync(DROPS_PATH, 'utf-8')); } catch (e) {}
    }
    let cache = {};
    if (fs.existsSync(TELEMETRY_PATH)) {
      try { cache = JSON.parse(fs.readFileSync(TELEMETRY_PATH, 'utf-8')); } catch (e) {}
    }
    let salesHistory = [];
    if (fs.existsSync(SALES_HISTORY_PATH)) {
      try { salesHistory = JSON.parse(fs.readFileSync(SALES_HISTORY_PATH, 'utf-8')); } catch (e) {}
    }

    let lgsStores = loadActiveLgsStores();
    if (!lgsStores.length) {
      try {
        const lgsMod = require('./lgsPoller');
        lgsStores = lgsMod.LGS_STORES || lgsMod.MONITORED_STORES || [];
      } catch (e) {}
    }

    const findStoreMeta = (storeName) => {
      const clean = String(storeName || '').toLowerCase().trim();
      return lgsStores.find(s => s.name.toLowerCase() === clean || clean.includes(s.name.toLowerCase())) || null;
    };

    const matchesFormatTab = (pol, fmt) => {
      if (!fmt || fmt === 'ALL') return true;
      const ff = String(pol.formFactor || '').toLowerCase();
      if (fmt === 'ETB') return ff === 'etb';
      if (fmt === 'BOOSTER_BOX') return ff === 'booster box';
      if (fmt === 'CASES') return ff.includes('case');
      if (fmt === 'BUNDLE') return ff.includes('bundle');
      return true;
    };

    let matchedPolicies = policies;
    let exactPrimaryPolicy = null;
    if (skuId) {
      const exact = policies.find(p => p.id.toLowerCase() === skuId.toLowerCase());
      if (exact) {
        exactPrimaryPolicy = exact;
        matchedPolicies = [exact];
      } else {
        matchedPolicies = policies.filter(p => p.id.toLowerCase().includes(skuId.toLowerCase()) || p.name.toLowerCase().includes(skuId.toLowerCase()));
        if (matchedPolicies.length === 1) exactPrimaryPolicy = matchedPolicies[0];
      }
    } else if (rawQuery) {
      const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
      matchedPolicies = policies.filter(p => {
        const hay = `${p.id} ${p.name} ${p.era || ''} ${p.formFactor || ''}`.toLowerCase();
        return terms.every(t => hay.includes(t));
      });
      if (formatFilter && formatFilter !== 'ALL') {
        const fmtFiltered = matchedPolicies.filter(p => matchesFormatTab(p, formatFilter));
        if (fmtFiltered.length > 0) matchedPolicies = fmtFiltered;
      }
      if (matchedPolicies.length === 1) exactPrimaryPolicy = matchedPolicies[0];
    } else if (storeFilter) {
      matchedPolicies = policies.filter(p => matchesFormatTab(p, formatFilter));
    } else if (formatFilter && formatFilter !== 'ALL') {
      matchedPolicies = policies.filter(p => matchesFormatTab(p, formatFilter));
    }

    if (matchedPolicies.length === 0) {
      matchedPolicies = policies.filter(p => matchesFormatTab(p, formatFilter)).slice(0, 20);
      if (matchedPolicies.length === 0) matchedPolicies = policies.slice(0, 12);
    }

    const candidates = [];
    const seenKeys = new Set();

    const computeTriggerPrice = (pol, marketVal) => {
      if (!pol) return 0;
      const msrp = Number(pol.msrpCeiling || 0);
      const maxBuy = Number(pol.maxMarketBuyPrice || 0);
      if (maxBuy > 0) return Math.max(msrp, maxBuy);
      const disc = Number(pol.minDiscountPercent || 15);
      const mktTrigger = marketVal > 0 ? Math.round(marketVal * (1 - disc / 100) * 100) / 100 : msrp;
      return Math.max(msrp, mktTrigger);
    };

    const muteVaultedSetting = Boolean(loadGlobalSettings()?.muteVaulted);

    const pushCandidate = (cand, polRef) => {
      if (!cand || !cand.landedPrice || cand.landedPrice <= 0) return;
      if (storeFilter) {
        const sf = storeFilter.toLowerCase();
        const st = String(cand.store || '').toLowerCase();
        if (!st.includes(sf) && !sf.includes(st)) return;
      }
      const dedupKey = `${cand.skuId}__${String(cand.store || '').toLowerCase()}__${cand.landedPrice.toFixed(2)}`;
      if (seenKeys.has(dedupKey)) return;
      seenKeys.add(dedupKey);
      const rip = computeRipMetrics(cand.landedPrice, cand.skuId, cand.formFactor, cand.productName, cand.packCount);
      const spreadDollars = Math.round((cand.marketValue - cand.landedPrice) * 100) / 100;
      const discountPct = cand.marketValue > 0 ? Math.round(((cand.marketValue - cand.landedPrice) / cand.marketValue) * 100) : 0;
      const storeMeta = findStoreMeta(cand.store);
      const shipDiff = Math.max(0, Math.round((cand.landedPrice - (cand.price || cand.landedPrice)) * 100) / 100);
      const shippingNote = cand.shippingNote || (shipDiff > 0.05 ? `+ $${shipDiff.toFixed(2)} Ship` : '+ FREE Ship');
      const triggerPrice = computeTriggerPrice(polRef, cand.marketValue);
      const shelfStatus = computeShelfStatusForOffer({
        dropPrice: Number(cand.price || cand.landedPrice),
        landedPrice: Number(cand.landedPrice),
        estimatedShipping: shipDiff,
        triggerPrice,
        msrpCeiling: Number((polRef && polRef.msrpCeiling) || cand.msrp || 0),
        marketValue: Number(cand.marketValue || 0),
        formFactor: cand.formFactor || (polRef && polRef.formFactor),
        owned: Boolean(polRef && (polRef.owned || polRef.inVault)),
        muteVaulted: muteVaultedSetting,
        storeName: cand.store
      });
      const trendEval = evaluateSkuTrendAndTiming({
        skuId: cand.skuId,
        formFactor: cand.formFactor || (polRef && polRef.formFactor),
        dropPrice: Number(cand.price || cand.landedPrice),
        landedPrice: Number(cand.landedPrice),
        estimatedShipping: shipDiff,
        policyMaxBuy: triggerPrice,
        msrpCeiling: Number((polRef && polRef.msrpCeiling) || cand.msrp || 0),
        marketBaseline: Number(cand.marketValue || 0),
        releaseDate: polRef && polRef.releaseDate,
        owned: Boolean(polRef && (polRef.owned || polRef.inVault)),
        isCloseCall: shelfStatus.isCloseCall,
        isMarketplace3P: /tcgplayer|ebay|3p|marketplace/i.test(String(cand.store || ''))
      });
      candidates.push({
        ...cand,
        era: cand.era || (polRef && polRef.era) || 'Modern Era',
        triggerPrice,
        shippingNote,
        storeBaseUrl: (storeMeta && storeMeta.baseUrl) || null,
        packCount: rip.packCount,
        pricePerPack: rip.pricePerPack,
        isRipValueLeader: rip.isRipValueLeader,
        spreadDollars,
        discountPct,
        statusTier: shelfStatus.statusTier,
        statusTag: shelfStatus.statusTag,
        isCloseCall: shelfStatus.isCloseCall,
        closeCallDelta: shelfStatus.closeCallDelta,
        trendSignal: trendEval.trendSignal,
        trendVerdictLabel: trendEval.trendVerdictLabel,
        isElasticDip: trendEval.isElasticDip,
        isPreRelease: trendEval.isPreRelease,
        preReleaseStatusTag: trendEval.preReleaseStatusTag
      });
    };

    for (const pol of matchedPolicies) {
      const tel = cache[pol.id];
      const marketVal = (tel && tel.rollingAverage > 0) ? tel.rollingAverage : (pol.estimatedMarketValue || pol.msrpCeiling || 0);

      // 1. Live Stock Hit
      const live = liveMap[pol.id];
      if (live && live.inStock && live.price > 0) {
        pushCandidate({
          sourceType: 'LIVE_SHELF',
          skuId: pol.id,
          productName: pol.name,
          formFactor: pol.formFactor || 'Sealed',
          store: live.retailer || 'Verified Store',
          price: Number(live.price),
          landedPrice: Number(live.landedPrice || live.price),
          marketValue: marketVal,
          msrp: pol.msrpCeiling,
          url: live.productUrl || live.url,
          cart1xUrl: live.cart1xUrl,
          cart2xUrl: live.cart2xUrl,
          cart3xUrl: live.cart3xUrl,
          inStock: true,
          observedAt: live.updatedAt || Date.now()
        }, pol);
      }

      // 2. Recent Discord Alert Hits (include up to 8 stores when comparing a specific SKU or store)
      const matchingDrops = drops.filter(d => d.ruleId === pol.id);
      for (const d of matchingDrops.slice(0, (exactPrimaryPolicy || storeFilter) ? 10 : 3)) {
        const p = Number(d.price || 0);
        if (p > 0) {
          pushCandidate({
            sourceType: d.soldOut ? 'RECENT_FLOOR' : 'RECENT_ALERT',
            skuId: pol.id,
            productName: pol.name,
            formFactor: pol.formFactor || d.formFactor || 'Sealed',
            store: d.retailer || 'Recent Alert Store',
            price: p,
            landedPrice: Number(d.landedPrice || p),
            marketValue: marketVal,
            msrp: pol.msrpCeiling,
            url: d.productUrl || d.url,
            cart1xUrl: d.cart1xUrl,
            cart2xUrl: d.cart2xUrl,
            cart3xUrl: d.cart3xUrl,
            inStock: !d.soldOut,
            observedAt: d.timestamp || Date.now()
          }, pol);
        }
      }

      // 3. Sales Tape Events (Active + Recent Store Offers when comparing a specific SKU or store)
      const tapeEvs = salesHistory.filter(ev => ev.targetId === pol.id && (ev.status === 'ACTIVE' || exactPrimaryPolicy || storeFilter));
      for (const ev of tapeEvs.slice(0, (exactPrimaryPolicy || storeFilter) ? 10 : 3)) {
        pushCandidate({
          sourceType: ev.status === 'ACTIVE' ? 'MARKET_TAPE_ACTIVE' : 'RECENT_STORE_COMP',
          skuId: pol.id,
          productName: pol.name,
          formFactor: pol.formFactor || 'Sealed',
          store: ev.store || 'Market Tape Store',
          price: Number(ev.price),
          landedPrice: Number(ev.landedPrice || ev.price),
          marketValue: marketVal,
          msrp: pol.msrpCeiling,
          url: ev.url || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}`,
          inStock: ev.status === 'ACTIVE',
          observedAt: ev.lastSeenAt || ev.restockedAt || Date.now()
        }, pol);
      }

      // 4. Telemetry Cached Lowest / TCGPlayer Baseline
      if (tel && tel.lowestPrice > 0) {
        pushCandidate({
          sourceType: tel.inStock ? 'LIVE_CACHE_LOW' : 'TCGPLAYER_BASELINE',
          skuId: pol.id,
          productName: pol.name,
          formFactor: pol.formFactor || 'Sealed',
          store: tel.lowestStore || 'TCGPlayer Verified Low',
          price: Number(tel.lowestPrice),
          landedPrice: Number(tel.lowestPrice),
          marketValue: marketVal,
          msrp: pol.msrpCeiling,
          url: tel.lowestUrl || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}`,
          inStock: Boolean(tel.inStock),
          observedAt: tel.lastSeen || Date.now()
        }, pol);
      }
      if (!storeFilter && pol.estimatedMarketValue > 0 && (exactPrimaryPolicy || !tel || !tel.lowestPrice)) {
        pushCandidate({
          sourceType: 'POLICY_BASELINE',
          skuId: pol.id,
          productName: pol.name,
          formFactor: pol.formFactor || 'Sealed',
          store: 'TCGPlayer Market Index',
          price: Number(pol.estimatedMarketValue),
          landedPrice: Number(pol.estimatedMarketValue),
          marketValue: marketVal,
          msrp: pol.msrpCeiling,
          url: `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}`,
          inStock: true,
          observedAt: Date.now()
        }, pol);
      }
      if (!storeFilter && exactPrimaryPolicy) {
        // Also provide direct eBay Buy-It-Now & Retail MSRP reference lines when comparing a single product head-to-head
        const ebayEst = Math.round((marketVal * 0.98) * 100) / 100;
        pushCandidate({
          sourceType: 'EBAY_MARKET_INDEX',
          skuId: pol.id,
          productName: pol.name,
          formFactor: pol.formFactor || 'Sealed',
          store: 'eBay Buy-It-Now (Free Ship Index)',
          price: ebayEst,
          landedPrice: ebayEst,
          marketValue: marketVal,
          msrp: pol.msrpCeiling,
          url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(pol.name + ' sealed')}&LH_BIN=1&_sop=15`,
          inStock: true,
          observedAt: Date.now()
        }, pol);
      }
    }

    // If filtering by a specific Shopify store and local cache has < 6 items, live-probe that store's Shopify feed!
    const matchedStoreMeta = storeFilter ? findStoreMeta(storeFilter) : null;
    if (storeFilter && matchedStoreMeta && candidates.length < 6) {
      try {
        const axios = require('axios');
        const feedUrl = `${matchedStoreMeta.baseUrl}${matchedStoreMeta.resolvedPath || '/products.json?limit=150'}`;
        const feedRes = await axios.get(feedUrl, {
          timeout: 3800,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'application/json' }
        });
        const prods = feedRes.data?.products || [];
        const fxMult = matchedStoreMeta.currency === 'CAD' ? 0.73 : 1.0;
        const { matchTargetRuleForStaging } = require('./evaluator');
        for (const prod of prods) {
          for (const variant of (prod.variants || [])) {
            if (!variant.available) continue;
            const rawPrice = parseFloat(variant.price);
            const priceNum = fxMult !== 1.0 ? Math.round(rawPrice * fxMult * 100) / 100 : rawPrice;
            if (!priceNum || priceNum < 18) continue;
            const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
            const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
            const matchedPol = matchTargetRuleForStaging(fullTitle, priceNum, matchedStoreMeta.name, `${prod.handle || ''} ${tagsStr}`);
            if (matchedPol && matchesFormatTab(matchedPol, formatFilter)) {
              const shipAdd = priceNum >= (matchedStoreMeta.freeShipThreshold || 150) ? 0 : (matchedStoreMeta.flatShipping || 6.99);
              const landed = Math.round((priceNum + shipAdd) * 100) / 100;
              const tel = cache[matchedPol.id];
              const marketVal = (tel && tel.rollingAverage > 0) ? tel.rollingAverage : (matchedPol.estimatedMarketValue || matchedPol.msrpCeiling || 0);
              pushCandidate({
                sourceType: 'LIVE_SHELF',
                skuId: matchedPol.id,
                productName: matchedPol.name,
                formFactor: matchedPol.formFactor || 'Sealed',
                store: matchedStoreMeta.name,
                price: priceNum,
                landedPrice: landed,
                shippingNote: shipAdd > 0 ? `+ $${shipAdd.toFixed(2)} Ship` : '+ FREE Ship',
                marketValue: marketVal,
                msrp: matchedPol.msrpCeiling,
                url: prod.handle ? `${matchedStoreMeta.baseUrl}/products/${prod.handle}` : matchedStoreMeta.baseUrl,
                cart1xUrl: `${matchedStoreMeta.baseUrl}/cart/${variant.id}:1`,
                cart2xUrl: `${matchedStoreMeta.baseUrl}/cart/${variant.id}:2`,
                cart3xUrl: `${matchedStoreMeta.baseUrl}/cart/${variant.id}:3`,
                inStock: true,
                observedAt: Date.now()
              }, matchedPol);
            }
          }
        }
      } catch (e) {}
    }

    // Optional live TCGPlayer + eBay comp probe for the primary target when requested or when <= 2 candidates found
    if (!storeFilter && (fetchLive || candidates.length <= 2) && matchedPolicies.length > 0) {
      try {
        const primary = exactPrimaryPolicy || matchedPolicies[0];
        const { getDualMarketComps } = require('./marketComps');
        const comps = await getDualMarketComps(primary.id, primary.name, primary.estimatedMarketValue || 50);
        if (comps?.tcgplayer?.price > 0) {
          pushCandidate({
            sourceType: 'LIVE_TCGPLAYER_COMP',
            skuId: primary.id,
            productName: primary.name,
            formFactor: primary.formFactor || 'Sealed',
            store: `TCGPlayer Live (${comps.tcgplayer.shippingLabel})`,
            price: comps.tcgplayer.price,
            landedPrice: comps.tcgplayer.total || comps.tcgplayer.price,
            shippingNote: comps.tcgplayer.shippingLabel || '+ Marketplace Ship',
            marketValue: comps.tcgplayer.averagePrice || primary.estimatedMarketValue,
            msrp: primary.msrpCeiling,
            url: comps.tcgplayer.url,
            inStock: true,
            observedAt: Date.now()
          }, primary);
        }
        if (comps?.ebay?.price > 0) {
          pushCandidate({
            sourceType: 'LIVE_EBAY_BIN_COMP',
            skuId: primary.id,
            productName: primary.name,
            formFactor: primary.formFactor || 'Sealed',
            store: `eBay BIN (${comps.ebay.shippingLabel})`,
            price: comps.ebay.price,
            landedPrice: comps.ebay.total || comps.ebay.price,
            shippingNote: comps.ebay.shippingLabel || '+ FREE Ship',
            marketValue: comps.ebay.averagePrice || primary.estimatedMarketValue,
            msrp: primary.msrpCeiling,
            url: comps.ebay.url,
            inStock: true,
            observedAt: Date.now()
          }, primary);
        }
      } catch (e) {}
    }

    // Sort strictly by lowest landedPrice so offers rank lowest-to-highest
    candidates.sort((a, b) => a.landedPrice - b.landedPrice);

    const maxSlice = (exactPrimaryPolicy || skuId || rawQuery || storeFilter) ? 18 : 12;
    const rankedOptions = candidates.slice(0, maxSlice).map((opt, idx) => ({
      rank: idx + 1,
      ...opt
    }));

    // Calculate #1 Best Sealed Hold (highest discountPct below market, tie-broken by spreadDollars)
    const holdSorted = [...candidates].sort((a, b) => {
      if (b.discountPct !== a.discountPct) return b.discountPct - a.discountPct;
      return b.spreadDollars - a.spreadDollars;
    });
    const bestSealedHold = holdSorted[0]
      ? {
          verdict: '#1 Best Sealed Hold',
          reason: `${holdSorted[0].discountPct}% under market ($${holdSorted[0].spreadDollars.toFixed(2)} instant equity spread) @ ${holdSorted[0].store}`,
          option: holdSorted[0]
        }
      : null;

    // Calculate #1 Cheapest Pack Rip (lowest pricePerPack $/Pack)
    const ripSorted = [...candidates].filter(c => c.pricePerPack > 0).sort((a, b) => a.pricePerPack - b.pricePerPack);
    const cheapestPackRip = ripSorted[0]
      ? {
          verdict: '#1 Cheapest Pack Rip',
          reason: `$${ripSorted[0].pricePerPack.toFixed(2)}/pack across ${ripSorted[0].packCount} booster packs (${ripSorted[0].isRipValueLeader ? 'RIP VALUE LEADER <= $4.25/pk' : 'Lowest $/Pack Available'}) @ ${ripSorted[0].store}`,
          option: ripSorted[0]
        }
      : null;

    res.json({
      ok: true,
      query: { skuId: skuId || null, query: rawQuery || null, format: formatFilter || 'ALL', store: storeFilter || null },
      storeFilter: storeFilter || null,
      storeExternalUrl: (matchedStoreMeta && matchedStoreMeta.baseUrl) || (rankedOptions[0] && rankedOptions[0].storeBaseUrl) || null,
      isSingleTargetComparison: Boolean(exactPrimaryPolicy || skuId || (rawQuery && matchedPolicies.length <= 2)),
      targetProductName: exactPrimaryPolicy ? exactPrimaryPolicy.name : (matchedPolicies.length === 1 ? matchedPolicies[0].name : (rawQuery || null)),
      matchedTargetsCount: matchedPolicies.length,
      totalCandidatesEvaluated: candidates.length,
      top5LowestLanded: rankedOptions,
      allOffers: rankedOptions,
      bestSealedHold,
      cheapestPackRip,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, top5LowestLanded: [] });
  }
}

app.get('/api/bounty-recon', handleBountyRecon);
app.post('/api/bounty-recon', handleBountyRecon);

app.get('/api/trophies', (req, res) => {
  try {
    res.json(loadMsrpTrophies());
  } catch (e) {
    res.json({ totalMsrpHits: 0, catches: [] });
  }
});

function getDynamicStoreTelemetry() {
  let lgsStores = loadActiveLgsStores();
  let bigBoxStores = [];
  if (!lgsStores.length) {
    try {
      const lgsMod = require('./lgsPoller');
      lgsStores = lgsMod.LGS_STORES || lgsMod.MONITORED_STORES || [];
    } catch (e) {}
  }
  try {
    const vpMod = require('./vampirePoller');
    bigBoxStores = vpMod.BIG_BOX_STORES || [];
  } catch (e) {}

  let storeHealth = {};
  let fastTier1Poller = {
    status: 'ACTIVE_15S_DELTA',
    intervalMs: 15000,
    tier1StoreCount: 25,
    storesPolledLastCycle: 25,
    notModified304Count: 0,
    variantsCheckedLastCycle: 0,
    newOrRestockedHits: 0,
    totalCyclesRun: 0,
    lastSweepAt: Date.now()
  };
  let bigBoxHealth = {
    targetRedskyStatus: '200_OK_0_IN_STOCK',
    pokemonCenterStatus: 'WAF_CHALLENGE_IMPERVA',
    walmartStatus: 'WAF_CHALLENGE_PX',
    bestBuyStatus: '200_OK_0_IN_STOCK',
    costcoStatus: '200_OK_0_IN_STOCK',
    samsClubStatus: '200_OK_0_IN_STOCK',
    gamestopStatus: '200_OK_0_IN_STOCK',
    redditRssStatus: 'HEALTHY',
    lastCheckAt: Date.now(),
    itemsScanned: 0,
    activeBigBoxCount: 9,
    northStar5: {
      pokemonCenter: { name: 'Pokémon Center', status: 'WAF_CHALLENGE_IMPERVA', lastStatus: 'WAF_CHALLENGE_IMPERVA', itemsParsed: 0, mode: 'Direct $59.99 Exclusive + Queue Radar', lastChecked: Date.now() },
      target: { name: 'Target (RedSky)', status: '200 OK // 0 IN STOCK', lastStatus: '200 OK // 0 IN STOCK', itemsParsed: 0, mode: 'RedSky Fulfillment API (Zip 76177)', lastChecked: Date.now() },
      walmart: { name: 'Walmart (1P MSRP)', status: 'WAF_CHALLENGE_PX', lastStatus: 'WAF_CHALLENGE_PX', itemsParsed: 0, mode: '1P Retail MSRP Filter + Restock Radar', lastChecked: Date.now() },
      bestBuy: { name: 'Best Buy', status: '200 OK // 0 IN STOCK', lastStatus: '200 OK // 0 IN STOCK', itemsParsed: 0, mode: 'Open SKU JSON + Restock Radar', lastChecked: Date.now() },
      costco: { name: 'Costco Wholesale', status: '200 OK // 0 IN STOCK', lastStatus: '200 OK // 0 IN STOCK', itemsParsed: 0, mode: '$39.99–$64.99 Pallet Bundle Watcher', lastChecked: Date.now() },
      samsClub: { name: "Sam's Club", status: '200 OK // 0 IN STOCK', lastStatus: '200 OK // 0 IN STOCK', itemsParsed: 0, mode: 'Member Exclusive Sealed Multi-Packs', lastChecked: Date.now() },
      gamestop: { name: 'GameStop', status: '200 OK // 0 IN STOCK', lastStatus: '200 OK // 0 IN STOCK', itemsParsed: 0, mode: '1P Retail MSRP Sealed Boxes & ETBs', lastChecked: Date.now() }
    }
  };
  const rawHealth = readJsonCached(STORE_HEALTH_PATH, null);
  if (rawHealth && typeof rawHealth === 'object') {
    if (rawHealth.__bigBoxHealth) {
      bigBoxHealth = { ...bigBoxHealth, ...rawHealth.__bigBoxHealth };
    }
    if (rawHealth.__fastTier1Telemetry) {
      fastTier1Poller = { ...fastTier1Poller, ...rawHealth.__fastTier1Telemetry };
    }
    for (const [k, v] of Object.entries(rawHealth)) {
      if (!k.startsWith('__')) storeHealth[k] = v;
    }
  }

  const lgsCount = lgsStores.length || Object.keys(storeHealth).length || 91;
  const bigBoxCount = bigBoxStores.length || 9;
  const now = Date.now();
  const circuitOpenCount = Object.values(storeHealth).filter(
    s => s && s.status === 'CIRCUIT_OPEN' && Number(s.cooldownUntil || 0) > now
  ).length;
  const healthyLgsCount = Math.max(0, lgsCount - circuitOpenCount);
  const marketplaceCount = 3; // TCGPlayer, eBay, r/PKMNTCGDeals
  const totalMonitoredSources = lgsCount + bigBoxCount + marketplaceCount;
  const rawProductsSum = Object.values(storeHealth).reduce((acc, s) => acc + (Number(s && s.lastProductsCount) || 0), 0);
  const totalListingsMonitored = rawProductsSum > 1500 ? rawProductsSum : lgsCount * 145;

  return {
    lgsCount,
    healthyLgsCount,
    circuitOpenCount,
    bigBoxCount,
    bigBoxHealth,
    marketplaceCount,
    totalMonitoredSources,
    totalListingsMonitored,
    fastTier1Poller,
    lgsStores,
    bigBoxStores,
    storeHealth
  };
}

function computeNearMissesAndBestOffers() {
  const liveMap = readJsonCached(LIVE_STOCK_PATH, {});
  const policies = getRuntimePolicies();
  const cache = readJsonCached(TELEMETRY_PATH, {});
  const muteVaultedGlobal = Boolean(loadGlobalSettings()?.muteVaulted);

  const rawBestOffers = (liveMap && liveMap.__bestOffers && typeof liveMap.__bestOffers === 'object')
    ? liveMap.__bestOffers
    : {};
  const mergedBySku = loadMergedStoreOffersBySku();
  const bestCurrentOffers = {};
  const nearMisses = [];
  const now = Date.now();

  for (const pol of policies) {
    if (!pol || pol.active === false) continue;
    const ruleId = pol.id;
    const triggerPrice = Math.max(Number(pol.msrpCeiling || 0), Number(pol.maxMarketBuyPrice || 0));
    if (triggerPrice <= 0) continue;

    const tel = cache[ruleId];
    const marketValue = Number(pol.estimatedMarketValue || (tel && tel.rollingAverage > 0 ? tel.rollingAverage : triggerPrice));

    let cand = rawBestOffers[ruleId];
    const skuMergedList = Object.values(mergedBySku[ruleId] || {}).filter(o => o && o.landedPrice > 0);
    if (skuMergedList.length > 0) {
      skuMergedList.sort((a, b) => a.landedPrice - b.landedPrice);
      const lowestMerged = skuMergedList[0];
      if (!cand || lowestMerged.landedPrice < Number(cand.landedPrice || 999999)) {
        cand = {
          ruleId,
          ruleName: pol.name,
          formFactor: pol.formFactor || 'Sealed',
          era: pol.era,
          title: lowestMerged.listingTitle || pol.name,
          retailer: lowestMerged.store,
          price: lowestMerged.price,
          shippingPrice: lowestMerged.shipping,
          landedPrice: lowestMerged.landedPrice,
          freeShipNote: lowestMerged.shippingNote,
          url: lowestMerged.url,
          productUrl: lowestMerged.url,
          cart1xUrl: lowestMerged.cart1xUrl,
          cart2xUrl: lowestMerged.cart2xUrl,
          cart3xUrl: lowestMerged.cart3xUrl,
          updatedAt: lowestMerged.updatedAt || now,
          timeStr: 'Live Radar'
        };
      }
    }
    if (!cand && tel && tel.lowestPrice > 0 && tel.lowestStore && !/baseline/i.test(tel.lowestStore) && !isSingleCardOrNonSealed(pol.name, undefined, tel.lowestUrl)) {
      const price = Number(tel.lowestPrice);
      const isTcg = /tcgplayer/i.test(tel.lowestStore);
      const estShip = (!isTcg && price < 150) ? 6.99 : 0;
      const landedPrice = Math.round((price + estShip) * 100) / 100;
      cand = {
        ruleId,
        ruleName: pol.name,
        formFactor: pol.formFactor || 'Sealed',
        era: pol.era,
        title: pol.name,
        retailer: tel.lowestStore,
        price,
        shippingPrice: estShip,
        landedPrice,
        freeShipNote: estShip > 0 ? `$${price.toFixed(2)} + $${estShip.toFixed(2)} Est. Ship ($${landedPrice.toFixed(2)} Landed)` : '+FREE Shipping',
        url: tel.lowestUrl || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}`,
        productUrl: tel.lowestUrl,
        updatedAt: Number(tel.lastSeen) || now,
        timeStr: 'Live Telemetry'
      };
    }

    if (!cand || !cand.price || cand.price <= 0) continue;

    const price = Number(cand.price);
    const landedPrice = Number(cand.landedPrice || cand.price);
    const gapDollars = Math.round((landedPrice - triggerPrice) * 100) / 100;
    const gapPct = Math.round(((landedPrice - triggerPrice) / triggerPrice) * 1000) / 10;
    const rawGapDollars = Math.round((price - triggerPrice) * 100) / 100;
    const rawGapPct = Math.round(((price - triggerPrice) / triggerPrice) * 1000) / 10;
    const rip = computeRipMetrics(landedPrice, ruleId, pol.formFactor, pol.name, pol.packCount);
    const shelfStatus = computeShelfStatusForOffer({
      dropPrice: price,
      landedPrice,
      estimatedShipping: Math.max(0, landedPrice - price),
      triggerPrice,
      msrpCeiling: Number(pol.msrpCeiling || 0),
      marketValue,
      formFactor: pol.formFactor,
      owned: Boolean(pol.owned || pol.inVault),
      muteVaulted: muteVaultedGlobal,
      storeName: cand.retailer
    });
    const trendEval = evaluateSkuTrendAndTiming({
      skuId: ruleId,
      formFactor: pol.formFactor,
      dropPrice: price,
      landedPrice,
      estimatedShipping: Math.max(0, landedPrice - price),
      policyMaxBuy: triggerPrice,
      msrpCeiling: Number(pol.msrpCeiling || 0),
      marketBaseline: marketValue,
      releaseDate: pol.releaseDate,
      owned: Boolean(pol.owned || pol.inVault),
      isCloseCall: shelfStatus.isCloseCall,
      isMarketplace3P: /tcgplayer|ebay|3p|marketplace/i.test(String(cand.retailer || '')),
      nowTs: now
    });

    const enrichedOffer = {
      ...cand,
      ruleId,
      ruleName: pol.name,
      formFactor: pol.formFactor || 'Sealed',
      era: pol.era,
      price,
      landedPrice,
      triggerPrice,
      msrp: Number(pol.msrpCeiling || 0),
      marketValue,
      gapDollars,
      gapPct,
      rawGapDollars,
      rawGapPct,
      packCount: rip.packCount,
      pricePerPack: rip.pricePerPack,
      isRipValueLeader: rip.isRipValueLeader,
      owned: Boolean(pol.owned || pol.inVault),
      isPreRelease: trendEval.isPreRelease,
      preReleaseStatusTag: trendEval.preReleaseStatusTag,
      trendSignal: trendEval.trendSignal,
      trendVerdictLabel: trendEval.trendVerdictLabel,
      isElasticDip: trendEval.isElasticDip,
      ...shelfStatus
    };

    bestCurrentOffers[ruleId] = enrichedOffer;

    // Check if this item is a Near Miss (+0.5% to +12.5% over trigger on landed or raw price, and not already in Under-Trigger activeStock)
    const inUnderTriggerStock = Boolean(
      liveMap[ruleId] &&
      liveMap[ruleId].inStock &&
      Number(liveMap[ruleId].price) <= triggerPrice &&
      (Number(liveMap[ruleId].landedPrice || liveMap[ruleId].price) <= triggerPrice || Boolean(liveMap[ruleId].freeShipNote))
    );

    const qualifiesByLanded = gapPct > 0 && gapPct <= 12.5;
    const qualifiesByRaw = rawGapPct > 0 && rawGapPct <= 12.0 && gapPct <= 16.5;

    if (!inUnderTriggerStock && (qualifiesByLanded || qualifiesByRaw)) {
      const effectiveGapPct = qualifiesByLanded ? gapPct : rawGapPct;
      const effectiveGapDollars = qualifiesByLanded ? gapDollars : rawGapDollars;
      nearMisses.push({
        ...enrichedOffer,
        effectiveGapPct,
        effectiveGapDollars,
        recommendedTriggerBump: Math.ceil(landedPrice)
      });
    }
  }

  nearMisses.sort((a, b) => a.effectiveGapPct - b.effectiveGapPct || a.effectiveGapDollars - b.effectiveGapDollars);
  return { bestCurrentOffers, nearMisses };
}

function getCloseCallGraceBuffer(formFactor) {
  const ff = String(formFactor || '').toLowerCase();
  if (ff === 'booster box' || ff === 'etb case' || ff === 'master case' || ff.includes('box') || ff.includes('case')) {
    return 10.00;
  }
  return 5.00;
}

function computeShelfStatusForOffer(params) {
  const dropPrice = Number(params.dropPrice || params.landedPrice || 0);
  const landedPrice = Number(params.landedPrice || dropPrice || 0);
  const estimatedShipping = Number(params.estimatedShipping ?? Math.max(0, landedPrice - dropPrice));
  const triggerPrice = Number(params.triggerPrice || params.msrpCeiling || 54.99);
  const msrpCeiling = Number(params.msrpCeiling || 54.99);
  const marketValue = Number(params.marketValue || triggerPrice || msrpCeiling);
  const formFactor = params.formFactor || 'ETB';
  const owned = Boolean(params.owned);
  const muteVaulted = Boolean(params.muteVaulted);
  const isMarketplace3P = Boolean(params.isMarketplace3P || /tcgplayer|ebay|3p|marketplace/i.test(String(params.storeName || '')));
  const isMsrpUnicorn = Boolean(msrpCeiling > 0 && dropPrice <= Math.round(msrpCeiling * 1.08 * 100) / 100 && estimatedShipping <= 10.00);

  const graceBuffer = getCloseCallGraceBuffer(formFactor);
  const canUseShelfPrice = !isMarketplace3P && estimatedShipping <= 10.00;
  const comparePrice = (canUseShelfPrice && dropPrice <= triggerPrice + graceBuffer) ? dropPrice : landedPrice;

  const isUnderOrAtTarget = comparePrice <= triggerPrice || landedPrice <= triggerPrice || isMsrpUnicorn;
  const rawOver = Math.round((comparePrice - triggerPrice) * 100) / 100;
  const withinGraceBuffer = rawOver > 0 && rawOver <= graceBuffer;
  const withinMarketOrMsrpGuard =
    (marketValue > 0 && comparePrice <= marketValue * 0.93) ||
    (msrpCeiling > 0 && comparePrice <= msrpCeiling * 1.10);
  const isCloseCall = !isUnderOrAtTarget && withinGraceBuffer && withinMarketOrMsrpGuard;
  const closeCallDelta = isCloseCall ? rawOver : 0;

  if (owned && muteVaulted && !isMsrpUnicorn) {
    return {
      statusTier: 'MUTED_OWNED',
      statusTag: '⟦ MUTED: OWNED ON WALL ⟧',
      isCloseCall,
      closeCallDelta,
      comparePrice
    };
  }

  if (isUnderOrAtTarget) {
    const refPrice = landedPrice <= triggerPrice ? landedPrice : dropPrice;
    const underDollars = Math.max(0, Math.round((triggerPrice - refPrice) * 100) / 100);
    return {
      statusTier: 'UNDER_TARGET',
      statusTag: `⟦ UNDER TARGET (-$${underDollars.toFixed(2)}) ⟧`,
      isCloseCall: false,
      closeCallDelta: 0,
      comparePrice: refPrice
    };
  }

  if (isCloseCall) {
    return {
      statusTier: 'CLOSE_CALL',
      statusTag: `⟦ CLOSE CALL (+$${closeCallDelta.toFixed(2)} OVER TARGET — IN CUSHION) ⟧`,
      isCloseCall: true,
      closeCallDelta,
      comparePrice
    };
  }

  const overDollars = Math.max(0.01, Math.round((landedPrice - triggerPrice) * 100) / 100);
  return {
    statusTier: 'NEAR_MISS',
    statusTag: `⟦ NEAR MISS (+$${overDollars.toFixed(2)} OVER TARGET) ⟧`,
    isCloseCall: false,
    closeCallDelta: 0,
    comparePrice: landedPrice
  };
}

const DAILY_SNAPSHOTS_PATH = path.resolve(__dirname, 'dailySnapshots.json');
const WEEKLY_CHECKPOINTS_PATH = path.resolve(__dirname, 'weeklyCheckpoints.json');
const STORE_OFFERS_CACHE_PATH = path.resolve(__dirname, 'storeOffersCache.json');

function computeShelfSpreadDistribution() {
  const mergedBySku = loadMergedStoreOffersBySku();
  const allOffers = [];
  for (const skuMap of Object.values(mergedBySku)) {
    for (const offer of Object.values(skuMap || {})) {
      if (!offer || !offer.landedPrice || offer.landedPrice <= 0) continue;
      const trig = Number(offer.triggerPrice || offer.msrp || 54.99);
      const msrpVal = Number(offer.msrp || 54.99);
      const mktVal = Number(offer.marketValue || trig || msrpVal);
      const landed = Number(offer.landedPrice);
      const gapDollars = Math.round((landed - trig) * 100) / 100;
      const gapPct = trig > 0 ? Math.round(((landed - trig) / trig) * 1000) / 10 : 0;
      const discPct = mktVal > landed ? Math.round(((mktVal - landed) / mktVal) * 100) : 0;
      const isUnderTrigger = landed <= trig + 0.01;
      const isNearMiss = !isUnderTrigger && gapPct > 0 && gapPct <= 10.5;
      const isUnderMarket = discPct >= 5;
      const isAtRetailMsrp = landed <= msrpVal * 1.05;
      allOffers.push({
        ...offer,
        gapDollars,
        gapPct,
        discountPct: discPct,
        isUnderTrigger,
        isNearMiss,
        isUnderMarket,
        isAtRetailMsrp
      });
    }
  }
  allOffers.sort((a, b) => (b.discountPct - a.discountPct) || (a.landedPrice - b.landedPrice));
  return {
    totalInStockOffers: allOffers.length,
    underTriggerCount: allOffers.filter(o => o.isUnderTrigger).length,
    nearMissesCount: allOffers.filter(o => o.isNearMiss).length,
    underMarketCount: allOffers.filter(o => o.isUnderMarket).length,
    atRetailMsrpCount: allOffers.filter(o => o.isAtRetailMsrp).length,
    offers: allOffers
  };
}

app.get('/api/shelf-spread', (req, res) => {
  try {
    res.json(computeShelfSpreadDistribution());
  } catch (e) {
    res.status(500).json({ error: e.message, offers: [] });
  }
});

function buildNextBestBuyAdvisorPayload(requestedBudget) {
  const budgetCap = Number(requestedBudget || 200);
  const policies = getRuntimePolicies();
  const mergedBySku = loadMergedStoreOffersBySku();
  const telemetry = readJsonCached(TELEMETRY_PATH, {});

  const etbPolicies = policies.filter(p => String(p.formFactor || '').toUpperCase() === 'ETB');
  const wallEtbsConquered = etbPolicies.filter(p => Boolean(p.wallOwned ?? p.owned)).length;
  const totalWallOwned = policies.filter(p => Boolean(p.wallOwned ?? p.owned)).length;
  const totalDadRipOwned = policies.filter(p => Boolean(p.dadRipOwned)).length;
  const totalLoganRipOwned = policies.filter(p => Boolean(p.loganRipOwned)).length;
  const total3of3Complete = policies.filter(p => Boolean(p.fullyConquered)).length;
  const totalRipHuntActive = policies.filter(p => Number(p.completionCount || (p.owned ? 1 : 0)) >= 1 && !p.fullyConquered).length;

  const candidates = [];
  const cautionWaitList = [];

  for (const pol of policies) {
    if (!pol || pol.active === false) continue;
    const skuId = pol.id;
    const wallOwned = Boolean(pol.wallOwned ?? pol.owned ?? pol.inVault);
    const dadRipOwned = Boolean(pol.dadRipOwned);
    const loganRipOwned = Boolean(pol.loganRipOwned);
    const completionCount = (wallOwned ? 1 : 0) + (dadRipOwned ? 1 : 0) + (loganRipOwned ? 1 : 0);
    const fullyConquered = Boolean(wallOwned && dadRipOwned && loganRipOwned);

    const skuOffersMap = mergedBySku[skuId] || {};
    const offersList = Object.values(skuOffersMap).filter(o => o && o.landedPrice > 0);
    offersList.sort((a, b) => a.landedPrice - b.landedPrice);
    const bestOffer = offersList[0] || null;

    const msrp = Number(pol.msrpCeiling || 54.99);
    const mkt = Number(pol.estimatedMarketValue || (telemetry[skuId]?.rollingAverage > 0 ? telemetry[skuId].rollingAverage : msrp));
    const policyMaxBuy = Math.max(msrp, Number(pol.maxMarketBuyPrice || msrp));
    const rolling = computeRollingMarketMetrics(skuId, mkt, msrp);
    const lowestPrice = bestOffer ? Number(bestOffer.price || bestOffer.landedPrice) : Number(telemetry[skuId]?.lowestPrice || mkt);
    const landedPrice = bestOffer ? Number(bestOffer.landedPrice || lowestPrice) : lowestPrice;

    const ap = computeAutoPilotTarget({
      skuId,
      msrpCeiling: msrp,
      policyMaxBuy,
      marketBaseline: mkt,
      rolling,
      autoPilotEnabled: pol.autoPilotEnabled !== false,
      lowestShelfPrice: lowestPrice,
      activeStoreCount: offersList.length,
      wallOwned,
      dadRipOwned,
      loganRipOwned,
      completionCount,
      fullyConquered
    });

    if (ap.isBleedingDown) {
      if (cautionWaitList.length < 6 && bestOffer) {
        const shownDelta = Math.round(rolling.delta14dPct);
        cautionWaitList.push({
          skuId,
          name: pol.name,
          formFactor: pol.formFactor || 'ETB',
          era: pol.era || 'Scarlet & Violet',
          currentPrice: Math.round(lowestPrice * 100) / 100,
          landedPrice: Math.round(landedPrice * 100) / 100,
          marketValue: Math.round(mkt * 100) / 100,
          autoPilotCeiling: ap.autoPilotCeiling,
          delta14dPct: shownDelta,
          activeStoreCount: offersList.length,
          store: bestOffer.store,
          url: bestOffer.url,
          cautionBadge: `◈ ⟦ BLEEDING DOWN (${shownDelta}% 14D • ${rolling.sampleDaysCount}D REAL) // HOLD OFF ⟧`,
          cautionReason: `Floor softening across ${offersList.length} store(s) — Auto-Pilot holding off until $${ap.autoPilotCeiling.toFixed(0)} support.`
        });
      }
      if (landedPrice > ap.autoPilotCeiling) continue;
    }

    if (fullyConquered || !bestOffer) continue;

    const discountVsMktPct = mkt > 0 ? Math.round(((mkt - landedPrice) / mkt) * 100) : 0;
    const dipVs60dPct = rolling.avg60d > 0 ? Math.round(((rolling.avg60d - landedPrice) / rolling.avg60d) * 100) : 0;
    const isUnderOrCushion = landedPrice <= ap.effectiveTargetCeiling + (/box|case/i.test(pol.formFactor || '') ? 10 : 5) || bestOffer.underTrigger || bestOffer.isCloseCall;
    const isGrailSet = /151|prismatic|evolving-skies|paldean-fates|crown-zenith|celebrations|surging-sparks|chaos-rising|delta-reign/i.test(skuId);
    const ripPairReady = Boolean(ap.isRipHuntMode && ((bestOffer.stock === undefined || bestOffer.stock >= 2) || /booster\s*box/i.test(pol.formFactor || '')));

    const score =
      (completionCount === 0 ? 35 : 18) +
      (String(pol.formFactor || '').toUpperCase() === 'ETB' && !wallOwned ? 22 : 0) +
      (isUnderOrCushion ? 28 : 0) +
      (isGrailSet ? 16 : 0) +
      (ap.isSupplyTightening ? 15 : 0) +
      (ripPairReady ? 12 : 0) +
      Math.max(-15, Math.min(35, discountVsMktPct)) +
      Math.max(-10, Math.min(25, dipVs60dPct));

    let advisorBadge = bestOffer.trendVerdictLabel || `◈ ⟦ SMART ACCUMULATE // -${Math.max(1, discountVsMktPct)}% VS MKT ⟧`;
    if (ap.isSupplyTightening && ap.autoPilotBadge) advisorBadge = ap.autoPilotBadge;
    else if (ripPairReady) advisorBadge = '◈ ⟦ RIP PAIR READY (QTY 2+) // RIP HUNT FLOOR ⟧';
    else if (dipVs60dPct >= 8) advisorBadge = `◈ ⟦ 60D ELASTIC DIP (-${dipVs60dPct}% VS $${Math.round(rolling.avg60d)} 60D AVG) ⟧`;

    const slotLabel = completionCount === 0
      ? '0/3 NEED WALL'
      : `${completionCount}/3 WALL LOCKED • NEED RIP`;

    const cartLinks = buildShopifyDirectCartLinks({
      url: bestOffer.url,
      productUrl: bestOffer.url,
      cart1xUrl: bestOffer.cart1xUrl,
      cart2xUrl: bestOffer.cart2xUrl,
      cart3xUrl: bestOffer.cart3xUrl,
      itemId: bestOffer.itemId,
      stock: bestOffer.stock,
      retailer: bestOffer.store
    });

    candidates.push({
      skuId,
      name: pol.name,
      formFactor: pol.formFactor || 'ETB',
      era: pol.era || 'Pokemon TCG',
      store: bestOffer.store,
      price: bestOffer.price,
      shipping: bestOffer.shipping,
      landedPrice: bestOffer.landedPrice,
      marketValue: mkt,
      msrp,
      triggerPrice: ap.effectiveTargetCeiling,
      autoPilotCeiling: ap.autoPilotCeiling,
      autoPilotModeLabel: ap.autoPilotModeLabel,
      discountPct: discountVsMktPct,
      dipVs60dPct,
      packCount: bestOffer.packCount,
      pricePerPack: bestOffer.pricePerPack,
      wallOwned,
      dadRipOwned,
      loganRipOwned,
      completionCount,
      fullyConquered,
      slotLabel,
      ripPairReady,
      advisorBadge,
      statusTag: bestOffer.statusTag,
      url: bestOffer.url,
      cart1xUrl: cartLinks.cart1xUrl,
      cart2xUrl: cartLinks.cart2xUrl,
      cart3xUrl: cartLinks.cart3xUrl,
      score
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.landedPrice - b.landedPrice);

  const pickForBudget = (cap) => {
    const within = candidates.filter(c => c.landedPrice <= cap);
    return (within.length >= 3 ? within : candidates).slice(0, 3);
  };

  const budgets = {
    '100': pickForBudget(105),
    '200': pickForBudget(210),
    '350': pickForBudget(360),
    '500': candidates.slice(0, 3)
  };
  const selectedKey = budgetCap <= 105 ? '100' : (budgetCap <= 210 ? '200' : (budgetCap <= 360 ? '350' : '500'));

  return {
    ok: true,
    selectedBudget: Number(selectedKey),
    topBuys: budgets[selectedKey],
    budgets,
    cautionWaitList,
    familyProgress: {
      wallEtbsConquered,
      totalEtbSets: etbPolicies.length || 38,
      totalWallOwned,
      totalDadRipOwned,
      totalLoganRipOwned,
      total3of3Complete,
      totalRipHuntActive
    }
  };
}

app.get('/api/advisor/next-buy', (req, res) => {
  try {
    const budget = Number(req.query.budget || 200);
    res.json(buildNextBestBuyAdvisorPayload(budget));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, topBuys: [], cautionWaitList: [] });
  }
});

app.get('/api/status', (req, res) => {
  try {
    const now = Date.now();
    const stateSig = getDashboardStateSignature();
    if (_cachedStatusJson && _cachedStatusSig === stateSig && (now - _cachedStatusTs) < 15000) {
      return res.type('json').send(_cachedStatusJson);
    }
    const trophies = loadMsrpTrophies();
    const conqueredVault = loadConqueredVault();
    const storeTel = getDynamicStoreTelemetry();
    const { bestCurrentOffers, nearMisses } = computeNearMissesAndBestOffers();
    const shelfSpread = computeShelfSpreadDistribution();
    const nextBuyAdvisor = buildNextBestBuyAdvisorPayload(200);
    const payload = {
      ok: true,
      timestamp: now,
      totalMsrpHits: trophies.totalMsrpHits,
      msrpTrophies: trophies,
      totalConquered: conqueredVault.totalConquered,
      collectorRank: conqueredVault.collectorRank,
      lgsStoreCount: storeTel.lgsCount,
      healthyLgsCount: storeTel.healthyLgsCount,
      bigBoxStoreCount: storeTel.bigBoxCount,
      totalMonitoredSources: storeTel.totalMonitoredSources,
      totalListingsMonitored: storeTel.totalListingsMonitored,
      storeTelemetry: {
        lgsCount: storeTel.lgsCount,
        healthyLgsCount: storeTel.healthyLgsCount,
        circuitOpenCount: storeTel.circuitOpenCount,
        bigBoxCount: storeTel.bigBoxCount,
        bigBoxHealth: storeTel.bigBoxHealth,
        fastTier1Poller: storeTel.fastTier1Poller,
        marketplaceCount: storeTel.marketplaceCount,
        totalMonitoredSources: storeTel.totalMonitoredSources,
        totalListingsMonitored: storeTel.totalListingsMonitored
      },
      fastTier1Poller: storeTel.fastTier1Poller,
      bigBoxHealth: storeTel.bigBoxHealth,
      storeHealth: storeTel.storeHealth,
      bestCurrentOffers,
      nearMisses,
      shelfSpread,
      nextBuyAdvisor,
      familyProgress: nextBuyAdvisor.familyProgress
    };
    _cachedStatusJson = JSON.stringify(payload);
    _cachedStatusSig = stateSig;
    _cachedStatusTs = now;
    return res.type('json').send(_cachedStatusJson);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/near-misses', (req, res) => {
  try {
    res.json(computeNearMissesAndBestOffers());
  } catch (e) {
    res.status(500).json({ nearMisses: [], bestCurrentOffers: {}, error: e.message });
  }
});

function loadMergedStoreOffersBySku() {
  const now = Date.now();
  const stateSig = getDashboardStateSignature();
  if (_cachedMergedOffersMem && _cachedMergedOffersSig === stateSig && (now - _cachedMergedOffersTs) < 15000) {
    return _cachedMergedOffersMem;
  }
  const rawCache = readJsonCached(STORE_OFFERS_CACHE_PATH, {});
  const policies = getRuntimePolicies();
  const liveMap = readJsonCached(LIVE_STOCK_PATH, {});
  const telemetry = readJsonCached(TELEMETRY_PATH, {});
  const salesArr = readJsonCached(SALES_HISTORY_PATH, []);
  const dropsArr = readJsonCached(DROPS_PATH, []);

  const polById = new Map(policies.map(p => [p.id, p]));
  const merged = {};

  const ensureSkuBucket = (skuId) => {
    if (!merged[skuId]) merged[skuId] = {};
    return merged[skuId];
  };

  const muteVaultedSetting = Boolean(loadGlobalSettings()?.muteVaulted);

  // 1. Seed from storeOffersCache.json
  for (const [skuId, storeMap] of Object.entries(rawCache)) {
    if (!storeMap || typeof storeMap !== 'object') continue;
    const pol = polById.get(skuId);
    if (!pol) continue;
    const bucket = ensureSkuBucket(skuId);
    const mkt = Number(pol.estimatedMarketValue || (telemetry[skuId]?.rollingAverage > 0 ? telemetry[skuId].rollingAverage : (pol.msrpCeiling || 54.99)));
    const trig = Math.max(Number(pol.maxMarketBuyPrice || 0), Number(pol.msrpCeiling || 0));
    for (const [storeKey, rec] of Object.entries(storeMap)) {
      if (!rec || !rec.landedPrice || rec.landedPrice <= 0) continue;
      const candTitle = String(rec.listingTitle || rec.rawTitle || pol.name);
      if (isSingleCardOrNonSealed(candTitle, undefined, rec.url) || !hasMandatorySealedContainerKeyword(candTitle, pol.formFactor)) {
        continue;
      }
      const landed = Math.round(Number(rec.landedPrice) * 100) / 100;
      const rawShip = Math.round(Number(rec.shipping || 0) * 100) / 100;
      const rawPrice = (rawShip > 0 && Math.abs(Number(rec.price || landed) - landed) < 0.01 && landed > rawShip)
        ? Math.round((landed - rawShip) * 100) / 100
        : Math.round(Number(rec.price || landed) * 100) / 100;
      if (rawShip > 35 || (/tcgplayer|ebay|3p/i.test(String(rec.storeName || storeKey)) && rawPrice > 0 && rawShip > rawPrice * 0.20)) {
        continue;
      }
      const rip = computeRipMetrics(landed, skuId, pol.formFactor, pol.name, pol.packCount);
      const discPct = mkt > 0 ? Math.round(((mkt - landed) / mkt) * 100) : 0;
      const firstSeen = Number(rec.firstSeenAt || rec.updatedAt || now);
      const pDelta = Number(rec.priceDelta || 0);
      const isFresh = Boolean(rec.isFreshRestock || (now - firstSeen) <= 6 * 3600 * 1000 || pDelta <= -0.50);
      const shelfStatus = computeShelfStatusForOffer({
        dropPrice: rawPrice,
        landedPrice: landed,
        estimatedShipping: rawShip,
        triggerPrice: trig,
        msrpCeiling: Number(pol.msrpCeiling || 54.99),
        marketValue: mkt,
        formFactor: pol.formFactor,
        owned: Boolean(pol.owned || pol.inVault),
        muteVaulted: muteVaultedSetting,
        storeName: rec.storeName || storeKey
      });
      const trendEval = evaluateSkuTrendAndTiming({
        skuId,
        formFactor: pol.formFactor,
        dropPrice: rawPrice,
        landedPrice: landed,
        estimatedShipping: rawShip,
        policyMaxBuy: trig,
        msrpCeiling: Number(pol.msrpCeiling || 54.99),
        marketBaseline: mkt,
        releaseDate: pol.releaseDate,
        owned: Boolean(pol.owned || pol.inVault),
        isCloseCall: shelfStatus.isCloseCall,
        isMarketplace3P: /tcgplayer|ebay|3p|marketplace/i.test(String(rec.storeName || storeKey)),
        nowTs: now
      });
      const underTrig = shelfStatus.statusTier === 'UNDER_TARGET' || landed <= trig + 0.01;
      const gapDollars = Math.round((landed - trig) * 100) / 100;
      const directCart = buildShopifyDirectCartLinks({
        url: rec.productUrl || rec.url,
        productUrl: rec.productUrl || rec.url,
        cart1xUrl: rec.cart1xUrl,
        cart2xUrl: rec.cart2xUrl,
        cart3xUrl: rec.cart3xUrl,
        itemId: rec.itemId,
        stock: rec.stock,
        retailer: rec.storeName || storeKey
      });
      const wallOwned = Boolean(pol.wallOwned ?? pol.owned ?? pol.inVault);
      const dadRipOwned = Boolean(pol.dadRipOwned);
      const loganRipOwned = Boolean(pol.loganRipOwned);
      const completionCount = (wallOwned ? 1 : 0) + (dadRipOwned ? 1 : 0) + (loganRipOwned ? 1 : 0);
      const fullyConquered = Boolean(wallOwned && dadRipOwned && loganRipOwned);
      const ripPairReady = Boolean(completionCount >= 1 && !fullyConquered && ((rec.stock === undefined || rec.stock >= 2) || /booster\s*box/i.test(pol.formFactor || '')));
      bucket[storeKey] = {
        skuId,
        productName: pol.name,
        skuName: pol.name,
        listingTitle: String(rec.listingTitle || rec.rawTitle || pol.name),
        formFactor: pol.formFactor || 'ETB',
        era: pol.era || 'Pokemon TCG',
        owned: wallOwned,
        wallOwned,
        dadRipOwned,
        loganRipOwned,
        completionCount,
        fullyConquered,
        ripPairReady,
        msrp: Number(pol.msrpCeiling || 54.99),
        triggerPrice: trig,
        marketValue: mkt,
        store: String(rec.storeName || storeKey).replace(/^[📡🚨💎🔥⚡🎯]+\s*/, '').trim(),
        price: rawPrice,
        shipping: rawShip,
        landedPrice: landed,
        shippingNote: rec.freeShipNote || (rawShip > 0 ? `+$${rawShip.toFixed(2)} Ship` : '+FREE Shipping'),
        statusTier: shelfStatus.statusTier,
        statusTag: ripPairReady ? `${shelfStatus.statusTag} • ◈ ⟦ RIP PAIR READY (QTY 2+) ⟧` : shelfStatus.statusTag,
        isCloseCall: shelfStatus.isCloseCall,
        closeCallDelta: shelfStatus.closeCallDelta,
        trendSignal: trendEval.trendSignal,
        trendVerdictLabel: trendEval.trendVerdictLabel,
        isElasticDip: trendEval.isElasticDip,
        isPreRelease: trendEval.isPreRelease,
        preReleaseStatusTag: trendEval.preReleaseStatusTag,
        packCount: rip.packCount,
        pricePerPack: rip.pricePerPack,
        isRipValueLeader: rip.isRipValueLeader,
        discountPct: discPct,
        spreadPct: discPct,
        underTrigger: underTrig,
        isUnderTrigger: underTrig,
        gapDollars,
        isFreshRestock: isFresh,
        priceDelta: pDelta,
        firstSeenAt: firstSeen,
        updatedAt: Number(rec.updatedAt || now),
        url: rec.productUrl || rec.url || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}&view=grid`,
        cart1xUrl: directCart.cart1xUrl,
        cart2xUrl: directCart.cart2xUrl,
        cart3xUrl: directCart.cart3xUrl,
        stock: rec.stock,
        itemId: rec.itemId,
        inStock: true
      };
    }
  }

  // 2. Overlay liveStock.json & liveStock.__bestOffers
  const overlayEntry = (skuId, item, isBestOffer) => {
    const pol = polById.get(skuId);
    if (!pol || !item) return;
    const candTitle = String(item.title || pol.name);
    if (isSingleCardOrNonSealed(candTitle, undefined, item.url) || !hasMandatorySealedContainerKeyword(candTitle, pol.formFactor)) {
      return;
    }
    const landed = Math.round(Number(item.landedPrice || item.price || 0) * 100) / 100;
    if (landed <= 0) return;
    const cleanStore = String(item.retailer || 'Verified Store').replace(/^[📡🚨💎🔥⚡🎯]+\s*/, '').trim();
    const storeKey = cleanStore.replace(/\s*\(TCGPlayer.*?\)$/i, ' (TCGPlayer)').trim();
    const bucket = ensureSkuBucket(skuId);
    if (bucket[storeKey] && bucket[storeKey].landedPrice <= landed) return;
    const mkt = Number(pol.estimatedMarketValue || (telemetry[skuId]?.rollingAverage > 0 ? telemetry[skuId].rollingAverage : (pol.msrpCeiling || 54.99)));
    const trig = Math.max(Number(pol.maxMarketBuyPrice || 0), Number(pol.msrpCeiling || 0));
    const rawPrice = Math.round(Number(item.price || landed) * 100) / 100;
    const rawShip = Math.round(Number(item.shippingPrice || Math.max(0, landed - rawPrice)) * 100) / 100;
    if (rawShip > 35 || (/tcgplayer|ebay|3p/i.test(cleanStore) && rawPrice > 0 && rawShip > rawPrice * 0.20)) return;
    const rip = computeRipMetrics(landed, skuId, pol.formFactor, pol.name, pol.packCount);
    const discPct = mkt > 0 ? Math.round(((mkt - landed) / mkt) * 100) : 0;
    const shelfStatus = computeShelfStatusForOffer({
      dropPrice: rawPrice,
      landedPrice: landed,
      estimatedShipping: rawShip,
      triggerPrice: trig,
      msrpCeiling: Number(pol.msrpCeiling || 54.99),
      marketValue: mkt,
      formFactor: pol.formFactor,
      owned: Boolean(pol.owned || pol.inVault),
      muteVaulted: muteVaultedSetting,
      storeName: cleanStore
    });
    const trendEval = evaluateSkuTrendAndTiming({
      skuId,
      formFactor: pol.formFactor,
      dropPrice: rawPrice,
      landedPrice: landed,
      estimatedShipping: rawShip,
      policyMaxBuy: trig,
      msrpCeiling: Number(pol.msrpCeiling || 54.99),
      marketBaseline: mkt,
      releaseDate: pol.releaseDate,
      owned: Boolean(pol.owned || pol.inVault),
      isCloseCall: shelfStatus.isCloseCall,
      isMarketplace3P: /tcgplayer|ebay|3p|marketplace/i.test(cleanStore),
      nowTs: now
    });
    const underTrig = shelfStatus.statusTier === 'UNDER_TARGET' || landed <= trig + 0.01;
    const gapDollars = Math.round((landed - trig) * 100) / 100;
    bucket[storeKey] = {
      skuId,
      productName: pol.name,
      skuName: pol.name,
      listingTitle: String(item.title || pol.name),
      formFactor: pol.formFactor || 'ETB',
      era: pol.era || 'Pokemon TCG',
      owned: Boolean(pol.owned || pol.inVault),
      msrp: Number(pol.msrpCeiling || 54.99),
      triggerPrice: trig,
      marketValue: mkt,
      store: cleanStore,
      price: rawPrice,
      shipping: rawShip,
      landedPrice: landed,
      shippingNote: item.freeShipNote || '+FREE Shipping',
      statusTier: shelfStatus.statusTier,
      statusTag: shelfStatus.statusTag,
      isCloseCall: shelfStatus.isCloseCall,
      closeCallDelta: shelfStatus.closeCallDelta,
      trendSignal: trendEval.trendSignal,
      trendVerdictLabel: trendEval.trendVerdictLabel,
      isElasticDip: trendEval.isElasticDip,
      isPreRelease: trendEval.isPreRelease,
      preReleaseStatusTag: trendEval.preReleaseStatusTag,
      packCount: rip.packCount,
      pricePerPack: rip.pricePerPack,
      isRipValueLeader: rip.isRipValueLeader,
      discountPct: discPct,
      spreadPct: discPct,
      underTrigger: underTrig,
      isUnderTrigger: underTrig,
      gapDollars,
      isFreshRestock: !isBestOffer,
      priceDelta: 0,
      firstSeenAt: Number(item.updatedAt || now),
      updatedAt: Number(item.updatedAt || now),
      url: item.productUrl || item.url || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}&view=grid`,
      cart1xUrl: item.cart1xUrl,
      cart2xUrl: item.cart2xUrl,
      cart3xUrl: item.cart3xUrl,
      inStock: true
    };
  };

  for (const [k, v] of Object.entries(liveMap)) {
    if (k.startsWith('__') || !v || !v.inStock) continue;
    overlayEntry(k, v, false);
  }
  if (liveMap.__bestOffers && typeof liveMap.__bestOffers === 'object') {
    for (const [k, v] of Object.entries(liveMap.__bestOffers)) {
      overlayEntry(k, v, true);
    }
  }

  // 3. Overlay recent ACTIVE salesHistory entries (last 48h)
  if (Array.isArray(salesArr)) {
    for (const s of salesArr) {
      if (!s || !s.targetId || s.status !== 'ACTIVE') continue;
      const seenTs = Number(s.lastSeenAt || s.restockedAt || 0);
      if (now - seenTs > 48 * 3600 * 1000) continue;
      const isCart = s.url && String(s.url).includes('/cart/');
      overlayEntry(s.targetId, {
        retailer: s.store,
        price: s.price,
        landedPrice: s.landedPrice || s.price,
        url: s.url,
        productUrl: isCart ? String(s.url).split('/cart/')[0] : s.url,
        cart1xUrl: isCart ? (String(s.url).includes('payment=shop_pay') ? s.url : `${s.url}${String(s.url).includes('?') ? '&' : '?'}payment=shop_pay`) : undefined,
        cart2xUrl: isCart ? String(s.url).replace(/:\d+(?=\?|$)/, ':2') + (String(s.url).includes('payment=shop_pay') ? '' : `${String(s.url).includes('?') ? '&' : '?'}payment=shop_pay`) : undefined,
        cart3xUrl: isCart ? String(s.url).replace(/:\d+(?=\?|$)/, ':3') + (String(s.url).includes('payment=shop_pay') ? '' : `${String(s.url).includes('?') ? '&' : '?'}payment=shop_pay`) : undefined,
        updatedAt: seenTs
      }, false);
    }
  }

  // 4. Overlay recent in-stock dropsHistory entries (last 48h) & telemetry lowestStore backfill
  if (Array.isArray(dropsArr)) {
    for (const d of dropsArr) {
      if (!d || !d.ruleId || d.soldOut || d.isPreDropStaging) continue;
      const ts = Number(d.timestamp || 0);
      if (ts > 0 && (now - ts) > 48 * 3600 * 1000) continue;
      overlayEntry(d.ruleId, {
        retailer: d.retailer,
        title: d.title,
        price: d.price,
        landedPrice: d.landedPrice || d.price,
        freeShipNote: d.freeShipNote,
        url: d.url,
        productUrl: d.productUrl || d.url,
        cart1xUrl: d.cart1xUrl,
        cart2xUrl: d.cart2xUrl,
        cart3xUrl: d.cart3xUrl,
        updatedAt: ts || now
      }, true);
    }
  }

  for (const [skuId, tel] of Object.entries(telemetry)) {
    if (!tel || !tel.inStock || !tel.lowestStore || !(tel.lowestPrice > 0)) continue;
    if (/market|baseline|catalog/i.test(String(tel.lowestStore))) continue;
    overlayEntry(skuId, {
      retailer: tel.lowestStore,
      price: tel.lowestPrice,
      landedPrice: tel.lowestPrice,
      url: tel.lowestUrl,
      productUrl: tel.lowestUrl,
      updatedAt: Number(tel.lastUpdated || now)
    }, true);
  }

  _cachedMergedOffersMem = merged;
  _cachedMergedOffersSig = stateSig;
  _cachedMergedOffersTs = now;
  return merged;
}

app.get('/api/store-offers', (req, res) => {
  try {
    res.json(loadMergedStoreOffersBySku());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/engine-room', (req, res) => {
  try {
    const reqNow = Date.now();
    const stateSig = getDashboardStateSignature();
    if (_cachedEngineRoomJson && _cachedEngineRoomSig === stateSig && (reqNow - _cachedEngineRoomTs) < 15000) {
      return res.type('json').send(_cachedEngineRoomJson);
    }
    const storeTel = getDynamicStoreTelemetry();
    const mergedOffersBySku = loadMergedStoreOffersBySku();

    // Group offers by canonical store name
    const offersByStoreKey = new Map();
    const normalizeStoreName = (name) => String(name || '')
      .replace(/^[📡🚨💎🔥⚡🎯]+\s*/, '')
      .replace(/\s*\(TCGPlayer.*?\)$/i, '')
      .trim()
      .toLowerCase();

    for (const skuMap of Object.values(mergedOffersBySku)) {
      for (const offer of Object.values(skuMap)) {
        if (!offer || !offer.store) continue;
        const nKey = normalizeStoreName(offer.store);
        if (!offersByStoreKey.has(nKey)) offersByStoreKey.set(nKey, []);
        offersByStoreKey.get(nKey).push(offer);
      }
    }

    const ns5Raw = (storeTel.bigBoxHealth && storeTel.bigBoxHealth.northStar5) || {};
    const northStarOrder = [
      {
        id: 'pokemonCenter',
        name: 'Pokémon Center',
        defaultCadence: '90s Direct + Queue-It Radar',
        defaultMethod: '1P PokemonCenter.com + Queue-It Detector',
        defaultStrictFilter: '$59.99 Exclusive / 1P MSRP Only',
        defaultStatus: 'WAF_CHALLENGE_IMPERVA',
        defaultCount: 0
      },
      {
        id: 'target',
        name: 'Target (RedSky)',
        defaultCadence: '15s RedSky JSON API',
        defaultMethod: 'RedSky 1P Fulfillment API (Zip 76177 • Store 3991)',
        defaultStrictFilter: '1P Retail MSRP (<= $55.99 ETB / <= $30.99 Bundle)',
        defaultStatus: '200 OK // 0 IN STOCK',
        defaultCount: 0
      },
      {
        id: 'walmart',
        name: 'Walmart (1P MSRP)',
        defaultCadence: '45s 1P Facet Sweep',
        defaultMethod: '1P Sold & Shipped by Walmart.com (<= $55 ETB)',
        defaultStrictFilter: 'Sold & Shipped by Walmart.com Only',
        defaultStatus: 'WAF_CHALLENGE_PX',
        defaultCount: 0
      },
      {
        id: 'bestBuy',
        name: 'Best Buy',
        defaultCadence: '60s SKU Availability JSON',
        defaultMethod: 'SKU Search & ButtonState (SoldOut vs AddToCart)',
        defaultStrictFilter: '1P Retail MSRP ($49.99–$54.99 ETB / $26.99 Bundle)',
        defaultStatus: '200 OK // 0 IN STOCK',
        defaultCount: 0
      },
      {
        id: 'costco',
        name: 'Costco Wholesale',
        defaultCadence: '60s CatalogSearch',
        defaultMethod: 'CatalogSearch Online Stock Check (InStock vs SoldOut)',
        defaultStrictFilter: '$39.99–$64.99 Member Pallet Multi-Packs',
        defaultStatus: '200 OK // 0 IN STOCK',
        defaultCount: 0
      },
      {
        id: 'samsClub',
        name: "Sam's Club",
        defaultCadence: '60s Club Pallet Search',
        defaultMethod: 'SamsClub.com Online Inventory Check',
        defaultStrictFilter: 'Member Exclusive Sealed Multi-Packs',
        defaultStatus: '200 OK // 0 IN STOCK',
        defaultCount: 0
      },
      {
        id: 'gamestop',
        name: 'GameStop',
        aliases: ['gamestop'],
        defaultCadence: '160s Playwright WAF Bridge',
        defaultMethod: 'Invisible Playwright + InStock JSON-LD',
        defaultStrictFilter: '1P Retail MSRP Sealed Boxes & ETBs',
        defaultStatus: '200 OK // 0 IN STOCK',
        defaultCount: 0
      },
      {
        id: 'amazon',
        name: 'Amazon (1P MSRP)',
        aliases: ['amazon', 'amazon (1p msrp)'],
        defaultCadence: '45s ATVPDKIKX0DER Sweep',
        defaultMethod: 'smid=ATVPDKIKX0DER + 1-Tap Cart Add',
        defaultStrictFilter: 'Ships & Sold by Amazon.com (<= MSRP*1.08)',
        defaultStatus: '200 OK // 0 IN STOCK',
        defaultCount: 0
      },
      {
        id: 'barnesNoble',
        name: 'Barnes & Noble',
        aliases: ['barnes & noble', 'barnes and noble'],
        defaultCadence: '160s Playwright WAF Bridge',
        defaultMethod: 'Invisible Playwright + InStock JSON-LD',
        defaultStrictFilter: '1P Retail MSRP ETBs & Booster Bundles',
        defaultStatus: '200 OK // 0 IN STOCK',
        defaultCount: 0
      }
    ];

    const northStar5 = northStarOrder.map(cfg => {
      const item = ns5Raw[cfg.id] || {};
      const itemsParsed = Number(item.itemsExtracted ?? item.itemsParsed ?? cfg.defaultCount);
      const totalNodesFound = item.totalNodesFound !== undefined
        ? Number(item.totalNodesFound)
        : Number(item.nodesFound ?? item.productsDetected ?? itemsParsed ?? 0);
      const rawStatus = String(item.lastStatus || item.status || cfg.defaultStatus);
      let humanStatus = rawStatus;
      if (/^ARMED/i.test(rawStatus) || rawStatus === 'HEALTHY' || /Checked|Monitored/i.test(rawStatus)) {
        humanStatus = itemsParsed > 0 ? `200 OK // ${itemsParsed} IN STOCK` : cfg.defaultStatus;
      }
      const matchKeys = [cfg.name.toLowerCase(), cfg.id.toLowerCase(), ...((cfg.aliases || []).map(a => a.toLowerCase()))];
      if (cfg.id === 'pokemonCenter') matchKeys.push('pokemon center', 'pokémon center');
      if (cfg.id === 'target') matchKeys.push('target');
      if (cfg.id === 'walmart') matchKeys.push('walmart');
      if (cfg.id === 'costco') matchKeys.push('costco');
      const seenOfferUrls = new Set();
      const matched = [];
      for (const mk of matchKeys) {
        for (const o of (offersByStoreKey.get(mk) || [])) {
          const ok = `${o.skuId}::${o.url}`;
          if (!seenOfferUrls.has(ok)) { seenOfferUrls.add(ok); matched.push(o); }
        }
      }
      matched.sort((a, b) => a.landedPrice - b.landedPrice);
      const hasUnderTrigger = matched.some(o => o.underTrigger);
      const isWafOrNetBlocked = /WAF|SHIELD|CHALLENGE|403|412|435|ERR_|TIMEOUT|TARPIT|BLOCKED|ROUTER_TLS_FILTER/i.test(humanStatus);
      const isQueueOrDrop = /QUEUE|WAITING ROOM|DROP/i.test(humanStatus);

      let coreTier = 'SLEEPING_CORE';
      if (isWafOrNetBlocked) {
        coreTier = 'SHIELD_BLOCKED';
      } else if (isQueueOrDrop || (totalNodesFound > 0 && hasUnderTrigger)) {
        coreTier = 'MASTER_CORE';
      } else if (totalNodesFound > 0 && !/PARSER_BLIND/i.test(humanStatus)) {
        coreTier = 'ULTRA_CORE';
      } else {
        humanStatus = 'PARSER_BLIND_0_NODES';
        coreTier = 'SLEEPING_CORE';
      }

      const checkedAt = Number(item.lastCheckedAt || item.lastChecked || storeTel.bigBoxHealth?.lastCheckAt || Date.now());
      const engineMethod = item.engineMethod || item.targetRule || item.mode || cfg.defaultMethod;

      return {
        id: cfg.id,
        name: cfg.name,
        coreTier,
        cadence: item.cadence || cfg.defaultCadence,
        engineMethod,
        mode: engineMethod,
        bridgeMode: item.bridgeMode || undefined,
        queueActive: Boolean(item.queueActive),
        queueBanner: item.queueBanner || undefined,
        strictFilter: item.strictFilter || cfg.defaultStrictFilter,
        totalNodesFound,
        itemsParsed,
        productsParsed: itemsParsed,
        lastStatus: humanStatus,
        status: humanStatus,
        statusTruth: humanStatus,
        lastCheckedAt: checkedAt,
        lastChecked: checkedAt,
        matchedOffers: matched
      };
    });

    const now = Date.now();
    let underTriggerStoreCount = 0;
    let holdingNeededWallEtbsStoreCount = 0;
    let holdingTargetsStoreCount = 0;
    let sleepersStoreCount = 0;
    let blockedStoreCount = 0;
    let healthyLgsCount = 0;
    let totalMatchedBoxesInStock = 0;

    const lgsStores = (storeTel.lgsStores || []).map((st, idx) => {
      const health = (storeTel.storeHealth && storeTel.storeHealth[st.name]) || {};
      const nKey = normalizeStoreName(st.name);
      const shelfOffers = (offersByStoreKey.get(nKey) || []).slice().sort((a, b) => a.landedPrice - b.landedPrice);
      const matchedBoxesCount = shelfOffers.length;
      totalMatchedBoxesInStock += matchedBoxesCount;

      const underTriggerCount = shelfOffers.filter(o => o.underTrigger).length;
      const neededWallEtbsCount = shelfOffers.filter(o => String(o.formFactor || '').toLowerCase() === 'etb' && !o.owned).length;
      const freshMoverCount = shelfOffers.filter(o => o.isFreshRestock).length;
      const catalogScanned = Number(health.lastProductsCount || 0);
      const pagesScanned = Number(health.lastPagesScanned || (catalogScanned > 0 ? Math.max(1, Math.ceil(catalogScanned / 250)) : 0));
      const rawHealthStatus = String(health.status || 'HEALTHY');
      const isCircuitOpen = rawHealthStatus === 'CIRCUIT_OPEN' && Number(health.cooldownUntil || 0) > now;
      const isBlocked = isCircuitOpen || (rawHealthStatus === 'DEGRADED' && Number(health.consecutiveFailures || 0) >= 3);

      let coreTier = 'SLEEPING_CORE';
      let tierLabel = 'RESTOCK SLEEPER';

      if (isBlocked) {
        coreTier = 'SHIELD_BLOCKED';
        tierLabel = 'FIREWALL / THROTTLED';
        blockedStoreCount++;
      } else if (underTriggerCount > 0) {
        coreTier = 'MASTER_CORE';
        tierLabel = 'UNDER TRIGGER';
        underTriggerStoreCount++;
        holdingTargetsStoreCount++;
      } else if (matchedBoxesCount > 0) {
        coreTier = 'ULTRA_CORE';
        tierLabel = 'HOLDING TARGETS';
        holdingTargetsStoreCount++;
      } else {
        coreTier = 'SLEEPING_CORE';
        tierLabel = 'RESTOCK SLEEPER';
        sleepersStoreCount++;
      }

      if (!isBlocked && rawHealthStatus === 'HEALTHY') {
        healthyLgsCount++;
      }

      if (neededWallEtbsCount > 0) {
        holdingNeededWallEtbsStoreCount++;
      }

      const cheapestBox = shelfOffers[0] || null;
      const lastPollAt = Number(health.lastSuccessAt || 0);

      return {
        index: idx + 1,
        name: st.name,
        url: st.baseUrl,
        baseUrl: st.baseUrl,
        currency: st.currency || 'USD',
        tier: st.tier || health.tier || 'TIER2_STANDARD',
        resolvedPath: st.resolvedPath || health.resolvedPath || '/products.json?limit=250',
        additionalPaths: st.additionalPaths || health.additionalPaths || [],
        status: rawHealthStatus,
        coreTier,
        tierLabel,
        pagesScanned,
        catalogScanned,
        matchedBoxesCount,
        matchedInStockCount: matchedBoxesCount,
        neededWallEtbsCount,
        neededWallEtbCount: neededWallEtbsCount,
        underTriggerCount,
        freshMoverCount,
        cheapestBox,
        cheapestOffer: cheapestBox,
        shelfOffers,
        matchedOffers: shelfOffers,
        latencyMs: Number(health.lastLatencyMs || health.lastFastLatencyMs || 0),
        lastFastPollAt: health.lastFastPollAt,
        lastFastLatencyMs: health.lastFastLatencyMs,
        lastPollAt,
        lastSuccessAt: lastPollAt,
        lastPollTime: lastPollAt
      };
    });

    const healthyBigBoxCount = northStar5.filter(r => r.coreTier === 'MASTER_CORE' || r.coreTier === 'ULTRA_CORE').length;
    const blockedBigBoxCount = northStar5.filter(r => r.coreTier === 'SHIELD_BLOCKED').length;

    const enginePayload = {
      ok: true,
      timestamp: now,
      fastTier1Poller: storeTel.fastTier1Poller,
      summary: {
        totalSensors: lgsStores.length + northStar5.length,
        healthySensors: healthyLgsCount + healthyBigBoxCount,
        healthyLgsSensors: healthyLgsCount,
        healthyBigBoxSensors: healthyBigBoxCount,
        lgsTotal: lgsStores.length,
        tier1FastCount: lgsStores.filter(s => s.tier === 'TIER1_FAST').length,
        fastTier1Poller: storeTel.fastTier1Poller,
        bigBoxTotal: northStar5.length,
        underTriggerCount: underTriggerStoreCount,
        masterCoreCount: underTriggerStoreCount,
        holdingNeededWallEtbsCount: holdingNeededWallEtbsStoreCount,
        holdingTargetsCount: holdingTargetsStoreCount,
        ultraCoreCount: Math.max(0, holdingTargetsStoreCount - underTriggerStoreCount) + healthyBigBoxCount,
        sleepersCount: sleepersStoreCount,
        sleepingCoreCount: sleepersStoreCount,
        blockedCount: blockedStoreCount + blockedBigBoxCount,
        shieldBlockedCount: blockedStoreCount + blockedBigBoxCount,
        totalCatalogScanned: storeTel.totalListingsMonitored,
        totalMatchedBoxesInStock
      },
      northStar5,
      bigBoxStores: northStar5,
      bigBoxHealth: storeTel.bigBoxHealth,
      wafBridge: storeTel.bigBoxHealth?.wafBridge || null,
      lgsStores
    };
    _cachedEngineRoomJson = JSON.stringify(enginePayload);
    _cachedEngineRoomSig = stateSig;
    _cachedEngineRoomTs = now;
    return res.type('json').send(_cachedEngineRoomJson);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get(['/api/sku-history/:skuId', '/api/price-history/:skuId'], (req, res) => {
  try {
    const rawParam = String(req.params.skuId || '').trim().toLowerCase();
    const policies = getRuntimePolicies();
    const ALIAS_MAP = {
      'sv-base-etb': 'sv-base-koraidon-etb',
      'scarlet-violet-base-etb': 'sv-base-koraidon-etb'
    };
    const resolvedParam = ALIAS_MAP[rawParam] || rawParam;
    let pol = policies.find(p => String(p.id).toLowerCase() === resolvedParam);
    if (!pol) {
      const tokens = resolvedParam.split('-').filter(Boolean);
      pol = policies.find(p => tokens.every(t => String(p.id).toLowerCase().includes(t)));
    }
    if (!pol) {
      return res.status(404).json({ error: `SKU '${req.params.skuId}' not found` });
    }
    const skuId = pol.id;

    let telemetry = {};
    if (fs.existsSync(TELEMETRY_PATH)) {
      try { telemetry = JSON.parse(fs.readFileSync(TELEMETRY_PATH, 'utf-8')); } catch (e) {}
    }
    let dailySnaps = {};
    if (fs.existsSync(DAILY_SNAPSHOTS_PATH)) {
      try { dailySnaps = JSON.parse(fs.readFileSync(DAILY_SNAPSHOTS_PATH, 'utf-8')); } catch (e) {}
    }
    let weeklyChks = {};
    if (fs.existsSync(WEEKLY_CHECKPOINTS_PATH)) {
      try { weeklyChks = JSON.parse(fs.readFileSync(WEEKLY_CHECKPOINTS_PATH, 'utf-8')); } catch (e) {}
    }
    let salesArr = [];
    if (fs.existsSync(SALES_HISTORY_PATH)) {
      try { salesArr = JSON.parse(fs.readFileSync(SALES_HISTORY_PATH, 'utf-8')); } catch (e) {}
    }
    let dropsArr = [];
    if (fs.existsSync(DROPS_PATH)) {
      try { dropsArr = JSON.parse(fs.readFileSync(DROPS_PATH, 'utf-8')); } catch (e) {}
    }
    const conquered = loadConqueredVault();
    const mergedOffersBySku = loadMergedStoreOffersBySku();

    const tel = telemetry[skuId] || {};
    const msrp = Number(pol.msrpCeiling || 54.99);
    const marketPrice = Number(pol.estimatedMarketValue || ((tel.rollingAverage > 0 && tel.rollingAverage !== 115) ? tel.rollingAverage : msrp));
    const maxBuyThreshold = Number(pol.maxMarketBuyPrice || msrp);
    const packCount = getPackCountForSku(skuId, pol.formFactor, pol.name);

    // 1. Collect ALL in-stock store offers for this SKU from storeOffersCache.json + liveStock + telemetry
    const skuOfferBucket = mergedOffersBySku[skuId] || {};
    const offerByStore = new Map();

    for (const offer of Object.values(skuOfferBucket)) {
      if (!offer || !offer.store || !offer.landedPrice) continue;
      offerByStore.set(offer.store.toLowerCase(), offer);
    }

    if (tel.lowestPrice > 0 && tel.lowestStore) {
      const cleanTelStore = String(tel.lowestStore).replace(/^[📡🚨💎🔥⚡🎯]+\s*/, '').trim();
      const lKey = cleanTelStore.toLowerCase();
      if (!offerByStore.has(lKey)) {
        const landed = Math.round(Number(tel.lowestPrice) * 100) / 100;
        const rip = computeRipMetrics(landed, skuId, pol.formFactor, pol.name, packCount);
        const discPct = marketPrice > 0 ? Math.round(((marketPrice - landed) / marketPrice) * 100) : 0;
        offerByStore.set(lKey, {
          store: cleanTelStore,
          price: landed,
          shipping: 0,
          landedPrice: landed,
          shippingNote: '+Verified Comp Floor',
          packCount: rip.packCount,
          pricePerPack: rip.pricePerPack,
          isRipValueLeader: rip.isRipValueLeader,
          discountPct: discPct,
          spreadPct: discPct,
          underTrigger: landed <= Math.max(maxBuyThreshold, msrp) + 0.01,
          isFreshRestock: false,
          priceDelta: 0,
          url: tel.lowestUrl || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}&view=grid`,
          updatedAt: Number(tel.lastUpdated || Date.now()),
          inStock: true
        });
      }
    }

    if (offerByStore.size === 0) {
      const rip = computeRipMetrics(marketPrice, skuId, pol.formFactor, pol.name, packCount);
      offerByStore.set('tcgplayer verified market', {
        store: 'TCGPlayer Verified Market',
        price: marketPrice,
        shipping: 0,
        landedPrice: marketPrice,
        shippingNote: '+Verified Market Baseline',
        packCount: rip.packCount,
        pricePerPack: rip.pricePerPack,
        isRipValueLeader: rip.isRipValueLeader,
        discountPct: 0,
        spreadPct: 0,
        underTrigger: marketPrice <= Math.max(maxBuyThreshold, msrp) + 0.01,
        isFreshRestock: false,
        priceDelta: 0,
        url: `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}&view=grid`,
        updatedAt: Date.now(),
        inStock: true
      });
    }

    const currentOffers = [...offerByStore.values()].sort((a, b) => a.landedPrice - b.landedPrice);
    const currentLowestOffer = currentOffers[0] ? currentOffers[0].landedPrice : marketPrice;
    const skuSales = Array.isArray(salesArr) ? salesArr.filter(s => s && s.targetId === skuId) : [];

    // 2. Compute All-Time Bot Low across snapshots, sales, drops, trophies, storeOffersCache, and telemetry
    let allTimeLow = {
      price: Math.min(marketPrice, currentLowestOffer, Number(tel.lowestPrice || marketPrice)),
      store: currentOffers[0]?.store || tel.lowestStore || 'TCGPlayer Verified',
      date: new Date().toISOString().slice(0, 10)
    };

    const considerLow = (pVal, stName, tsOrDate) => {
      const num = Number(pVal);
      if (!num || num <= 0 || num < msrp * 0.45) return;
      if (num < allTimeLow.price || (num === allTimeLow.price && allTimeLow.store.includes('Baseline') && stName && !stName.includes('Baseline'))) {
        const dStr = typeof tsOrDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(tsOrDate)
          ? tsOrDate.slice(0, 10)
          : (tsOrDate ? new Date(Number(tsOrDate)).toISOString().slice(0, 10) : allTimeLow.date);
        allTimeLow = {
          price: Math.round(num * 100) / 100,
          store: String(stName || 'Verified Store').replace(/^[📡🚨💎🔥⚡🎯]+\s*/, '').trim(),
          date: dStr
        };
      }
    };

    if (tel.lowestPrice > 0) considerLow(tel.lowestPrice, tel.lowestStore, tel.lastUpdated);
    currentOffers.forEach(o => considerLow(o.landedPrice, o.store, o.updatedAt));
    (dailySnaps[skuId] || []).forEach(sn => considerLow(sn.lowestDrop || sn.marketPrice, sn.lowestStore, sn.date || sn.timestamp));
    (weeklyChks[skuId] || []).forEach(wk => considerLow(wk.lowestDrop || wk.avgClearPrice || wk.marketPrice, wk.topStore, wk.weekEnding || wk.timestamp));
    skuSales.forEach(s => considerLow(s.landedPrice || s.price, s.store, s.restockedAt));
    (Array.isArray(dropsArr) ? dropsArr.filter(d => d && d.ruleId === skuId) : []).forEach(d => considerLow(d.landedPrice || d.price, d.retailer, d.timestamp));
    (conquered.trophies || []).filter(t => t.skuId === skuId).forEach(t => considerLow(t.landedPrice, t.store, t.conqueredAt));

    // 3. Build 24H, 7D, 30D, and 90D Price Trajectories (Never Blank!)
    const snapMap = new Map();
    (dailySnaps[skuId] || []).forEach(sn => {
      if (sn && sn.date) {
        snapMap.set(sn.date, {
          marketPrice: Number(sn.marketPrice || marketPrice),
          lowestSeenPrice: Number(sn.lowestDrop || sn.marketPrice || currentLowestOffer),
          lowestStore: sn.lowestStore || 'Verified Store'
        });
      }
    });

    skuSales.forEach(s => {
      const ts = Number(s.restockedAt || s.lastSeenAt || 0);
      if (!ts) return;
      const dKey = new Date(ts).toISOString().slice(0, 10);
      const sPrice = Number(s.landedPrice || s.price || 0);
      if (sPrice <= 0) return;
      const prev = snapMap.get(dKey);
      if (!prev || sPrice < prev.lowestSeenPrice) {
        snapMap.set(dKey, {
          marketPrice: Number(s.marketPrice || prev?.marketPrice || marketPrice),
          lowestSeenPrice: sPrice,
          lowestStore: s.store || prev?.lowestStore || 'Verified Store'
        });
      }
    });

    (weeklyChks[skuId] || []).forEach(wk => {
      if (wk && wk.weekEnding && !snapMap.has(wk.weekEnding)) {
        snapMap.set(wk.weekEnding, {
          marketPrice: Number(wk.marketPrice || marketPrice),
          lowestSeenPrice: Number(wk.lowestDrop || wk.avgClearPrice || wk.marketPrice || currentLowestOffer),
          lowestStore: wk.topStore || 'Weekly Checkpoint'
        });
      }
    });

    (Array.isArray(dropsArr) ? dropsArr.filter(d => d && d.ruleId === skuId) : []).forEach(d => {
      const ts = Number(d.timestamp || 0);
      const dPrice = Number(d.landedPrice || d.price || 0);
      if (!ts || dPrice <= 0) return;
      const dKey = new Date(ts).toISOString().slice(0, 10);
      const prev = snapMap.get(dKey);
      if (!prev || dPrice < prev.lowestSeenPrice) {
        snapMap.set(dKey, {
          marketPrice: Number(d.marketValue || prev?.marketPrice || marketPrice),
          lowestSeenPrice: dPrice,
          lowestStore: d.retailer || prev?.lowestStore || 'Verified Store'
        });
      }
    });

    const makePoint = (dateStr, labelStr, mktVal, lowVal, stName) => {
      const cleanMkt = Math.round(Number(mktVal || marketPrice) * 100) / 100;
      const cleanLow = Math.round(Number(lowVal || currentLowestOffer) * 100) / 100;
      const cleanSt = String(stName || currentOffers[0]?.store || 'Verified Store').replace(/^[📡🚨💎🔥⚡🎯]+\s*/, '').trim();
      return {
        date: dateStr,
        label: labelStr,
        marketAvg: cleanMkt,
        marketPrice: cleanMkt,
        lowestLanded: cleanLow,
        lowestSeenPrice: cleanLow,
        msrp,
        maxBuyThreshold,
        store: cleanSt,
        lowestStore: cleanSt
      };
    };

    // Zero synthetic sine curves: build trajectories ONLY from real recorded timestamps + today's live observation
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const todayStr = new Date(nowMs).toISOString().slice(0, 10);
    snapMap.set(todayStr, {
      marketPrice,
      lowestSeenPrice: currentLowestOffer,
      lowestStore: currentOffers[0]?.store || tel.lowestStore || 'Live Radar'
    });

    const sortedDates = [...snapMap.keys()].sort((a, b) => a.localeCompare(b));
    const filterWithinDays = (days) => sortedDates
      .filter(dStr => {
        const ts = Date.parse(`${dStr}T00:00:00Z`) || 0;
        return ts > 0 && (nowMs - ts) <= days * dayMs;
      })
      .map(dStr => {
        const rec = snapMap.get(dStr);
        const dt = new Date(`${dStr}T12:00:00Z`);
        const label = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return makePoint(dStr, label, rec.marketPrice, rec.lowestSeenPrice, rec.lowestStore);
      });

    const priceHistory90d = filterWithinDays(90);
    const priceHistory30d = filterWithinDays(30);
    const priceHistory7d = filterWithinDays(7);

    // Build 24H trajectory strictly from real timestamped events in the last 24h + live point
    const realEvents24h = [];
    skuSales.forEach(s => {
      const ts = Number(s.lastSeenAt || s.restockedAt || 0);
      const pVal = Number(s.landedPrice || s.price || 0);
      if (ts > 0 && pVal > 0 && (nowMs - ts) <= dayMs) {
        realEvents24h.push({ ts, mkt: Number(s.marketPrice || marketPrice), low: pVal, store: s.store });
      }
    });
    currentOffers.forEach(o => {
      const ts = Number(o.updatedAt || 0);
      if (ts > 0 && o.landedPrice > 0 && (nowMs - ts) <= dayMs) {
        realEvents24h.push({ ts, mkt: marketPrice, low: o.landedPrice, store: o.store });
      }
    });
    realEvents24h.sort((a, b) => a.ts - b.ts);

    const priceHistory24h = realEvents24h.map(ev => {
      const lbl = new Date(ev.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return makePoint(lbl, lbl, ev.mkt, ev.low, ev.store);
    });
    const nowTimeLbl = new Date(nowMs).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    priceHistory24h.push(makePoint(nowTimeLbl, nowTimeLbl, marketPrice, currentLowestOffer, currentOffers[0]?.store || 'Live Radar'));

    // 4. Live TCGPlayer & eBay Marketplace Floor Summary (Honest real comps only — zero fake 0.99x multipliers!)
    const tcgOffer = currentOffers.find(o => /tcgplayer/i.test(o.store));
    const ebayOffer = currentOffers.find(o => /ebay/i.test(o.store));
    const tcgFloorPrice = tcgOffer ? tcgOffer.landedPrice : (tel.lowestPrice > 0 ? Number(tel.lowestPrice) : marketPrice);
    const ebayFloorPrice = ebayOffer ? Math.round(ebayOffer.landedPrice * 100) / 100 : null;
    const tcgSearchUrl = (tcgOffer && tcgOffer.url) || tel.lowestUrl || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}&view=grid`;
    const ebaySearchUrl = (ebayOffer && ebayOffer.url) || `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent('Pokemon ' + pol.name + ' Sealed')}&LH_BIN=1&_sop=15`;
    const liveMarketplaceFloor = {
      tcgPlayerLowestLanded: Math.round(tcgFloorPrice * 100) / 100,
      ebayBuyItNowFloor: ebayFloorPrice,
      tcgSearchUrl,
      ebaySearchUrl,
      tcgplayer: {
        price: Math.round(tcgFloorPrice * 100) / 100,
        store: tcgOffer ? tcgOffer.store : (tel.lowestStore || 'TCGPlayer Verified Seller'),
        shippingLabel: tcgOffer ? tcgOffer.shippingNote : '+Verified Lowest Landed',
        url: tcgSearchUrl
      },
      ebay: {
        price: ebayFloorPrice,
        shippingLabel: ebayOffer ? ebayOffer.shippingNote : 'Direct Live BIN Search ↗',
        url: ebaySearchUrl
      }
    };

    // 5. Recent Sales / Velocity Comps
    const recentSales = skuSales
      .slice(0, 12)
      .map(s => ({
        store: String(s.store || 'Verified Store').replace(/^[📡🚨💎🔥⚡🎯]+\s*/, '').trim(),
        price: Number(s.landedPrice || s.price || 0),
        marketPrice: Number(s.marketPrice || marketPrice),
        discountPct: Number(s.discountPct || 0),
        status: s.status || 'ACTIVE',
        velocity: s.velocity || 'ACTIVE',
        durationMinutes: s.durationMinutes,
        date: s.soldOutAt || s.lastSeenAt || s.restockedAt || Date.now(),
        timestamp: s.soldOutAt || s.lastSeenAt || s.restockedAt || Date.now(),
        type: s.status === 'CLEARED' ? 'CLEARED' : 'RESTOCK',
        url: s.url || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${encodeURIComponent(pol.name)}&view=grid`
      }));

    const ripNow = computeRipMetrics(currentLowestOffer, skuId, pol.formFactor, pol.name, packCount);
    const rollingMetrics = computeRollingMarketMetrics(skuId, marketPrice, msrp);
    const rawOfferPrice = currentOffers[0] ? Number(currentOffers[0].price || currentLowestOffer) : currentLowestOffer;
    const trendEval = evaluateSkuTrendAndTiming({
      skuId: pol.id,
      formFactor: pol.formFactor,
      releaseDate: pol.releaseDate,
      msrpCeiling: msrp,
      policyMaxBuy: maxBuyThreshold,
      marketBaseline: marketPrice,
      landedPrice: currentLowestOffer,
      dropPrice: rawOfferPrice,
      estimatedShipping: Math.max(0, currentLowestOffer - rawOfferPrice),
      owned: Boolean(pol.owned || pol.inVault)
    });

    res.json({
      skuId: pol.id,
      name: pol.name,
      era: pol.era || 'Pokemon TCG',
      formFactor: pol.formFactor || 'ETB',
      owned: Boolean(pol.owned || pol.inVault),
      active: pol.active !== false,
      msrp,
      marketPrice: Math.round(marketPrice * 100) / 100,
      maxBuyThreshold: Math.round(maxBuyThreshold * 100) / 100,
      packCount: ripNow.packCount,
      pricePerPack: ripNow.pricePerPack,
      isRipValueLeader: ripNow.isRipValueLeader,
      allTimeLow,
      liveMarketplaceFloor,
      trendSignal: trendEval.trendSignal,
      trendVerdictLabel: trendEval.trendVerdictLabel,
      isElasticDip: trendEval.isElasticDip,
      rollingMetrics,
      sampleDaysCount: rollingMetrics.sampleDaysCount,
      insufficientHistory: rollingMetrics.insufficientHistory,
      priceHistory: priceHistory30d,
      priceHistory24h,
      priceHistory7d,
      priceHistory30d,
      priceHistory90d,
      currentOffers,
      recentSales
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/trends', (req, res) => {
  try {
    const { computeFullMarketTape } = require('./marketTape');
    const tape = computeFullMarketTape();
    const trophies = loadMsrpTrophies();
    const storeTel = getDynamicStoreTelemetry();
    res.json({
      ...tape,
      totalMsrpHits: trophies.totalMsrpHits,
      msrpTrophies: trophies,
      storeTelemetry: {
        lgsCount: storeTel.lgsCount,
        healthyLgsCount: storeTel.healthyLgsCount,
        bigBoxCount: storeTel.bigBoxCount,
        totalMonitoredSources: storeTel.totalMonitoredSources
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message, msrpTrophies: loadMsrpTrophies() });
  }
});

app.get('/api/drops', (req, res) => {
  try {
    if (fs.existsSync(DROPS_PATH)) {
      const drops = JSON.parse(fs.readFileSync(DROPS_PATH, 'utf-8'));
      const enriched = Array.isArray(drops)
        ? drops.map(d => {
            const effPrice = d.landedPrice || d.price || 0;
            const rip = computeRipMetrics(effPrice, d.ruleId, d.formFactor, d.title, d.packCount);
            return {
              ...d,
              packCount: d.packCount ?? rip.packCount,
              pricePerPack: d.pricePerPack ?? rip.pricePerPack,
              isRipValueLeader: d.isRipValueLeader ?? rip.isRipValueLeader
            };
          })
        : [];
      return res.json(enriched);
    }
    res.json([]);
  } catch (e) {
    res.json([]);
  }
});

app.get('/api/store-health', (req, res) => {
  try {
    if (fs.existsSync(STORE_HEALTH_PATH)) {
      return res.type('json').send(fs.readFileSync(STORE_HEALTH_PATH, 'utf-8'));
    }
    res.json({});
  } catch (e) {
    res.json({});
  }
});

app.get('/api/market-tape', (req, res) => {
  try {
    const { computeFullMarketTape } = require('./marketTape');
    const tape = computeFullMarketTape();
    const trophies = loadMsrpTrophies();
    const storeTel = getDynamicStoreTelemetry();
    res.json({
      ...tape,
      totalMsrpHits: trophies.totalMsrpHits,
      msrpTrophies: trophies,
      storeTelemetry: {
        lgsCount: storeTel.lgsCount,
        healthyLgsCount: storeTel.healthyLgsCount,
        bigBoxCount: storeTel.bigBoxCount,
        totalMonitoredSources: storeTel.totalMonitoredSources
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message, targets: {}, honeyHoleStores: [], recentSalesTape: [], weeklyCheckpoints: {}, msrpTrophies: loadMsrpTrophies() });
  }
});

app.post('/api/market-tape/checkpoint', (req, res) => {
  try {
    const { recordSundayWeeklyCheckpoints, computeFullMarketTape } = require('./marketTape');
    const count = recordSundayWeeklyCheckpoints(false);
    res.json({ ok: true, count, tape: computeFullMarketTape() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/live-stock', (req, res) => {
  try {
    let liveMap = {};
    if (fs.existsSync(LIVE_STOCK_PATH)) {
      try {
        liveMap = JSON.parse(fs.readFileSync(LIVE_STOCK_PATH, 'utf-8'));
      } catch (e) {
        liveMap = {};
      }
    }

    const policies = getRuntimePolicies();
    const policyMap = new Map(policies.map(p => [p.id, p]));

    // Prune any item whose price exceeds current policy maxBuy (or pre-order ceiling) or is older than 6 hours
    const now = Date.now();
    const activeStock = {};
    for (const [ruleId, entry] of Object.entries(liveMap)) {
      if (ruleId.startsWith('__') || !entry || !entry.inStock) continue;
      const pol = policyMap.get(ruleId);
      if (!pol || pol.active === false) continue;
      const rawMaxBuy = Math.max(pol.msrpCeiling || 0, pol.maxMarketBuyPrice || 0);
      const effectiveMaxBuy = rawMaxBuy;
      const landed = entry.landedPrice || entry.price;
      const eligible = entry.price <= effectiveMaxBuy && (landed <= effectiveMaxBuy || Boolean(entry.freeShipNote));
      if (eligible && (now - (entry.updatedAt || 0)) < 6 * 60 * 60 * 1000) {
        const rip = computeRipMetrics(landed, ruleId, pol.formFactor, pol.name, pol.packCount);
        const rawEntryPrice = Number(entry.price || landed);
        const trendEval = evaluateSkuTrendAndTiming({
          skuId: ruleId,
          formFactor: pol.formFactor,
          releaseDate: pol.releaseDate,
          msrpCeiling: pol.msrpCeiling || 0,
          policyMaxBuy: effectiveMaxBuy,
          marketBaseline: pol.estimatedMarketValue || pol.msrpCeiling || 0,
          landedPrice: landed,
          dropPrice: rawEntryPrice,
          estimatedShipping: Math.max(0, landed - rawEntryPrice),
          owned: Boolean(pol.owned || pol.inVault),
          nowTs: now
        });
        activeStock[ruleId] = {
          ...entry,
          packCount: entry.packCount ?? rip.packCount,
          pricePerPack: entry.pricePerPack ?? rip.pricePerPack,
          isRipValueLeader: entry.isRipValueLeader ?? rip.isRipValueLeader,
          releaseDate: pol.releaseDate,
          isPreRelease: trendEval.isPreRelease,
          preReleaseStatusTag: trendEval.preReleaseStatusTag,
          trendSignal: trendEval.trendSignal,
          trendVerdictLabel: trendEval.trendVerdictLabel,
          isElasticDip: trendEval.isElasticDip
        };
      }
    }

    res.json(activeStock);
  } catch (e) {
    res.json({});
  }
});

app.post(['/api/send-digest', '/api/digest/send-now'], async (req, res) => {
  try {
    const { sendStockDigestCard } = require('./notifier');
    const result = await sendStockDigestCard({ force: true, windowLabel: 'MANUAL COMMAND BRIEFING' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, sent: false, error: e.message });
  }
});

app.get('/api/settings', (req, res) => {
  try {
    return res.json(loadGlobalSettings());
  } catch (e) {
    res.json({ muteVaulted: false, wallHunterMode: false, liveDigestEnabled: false });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const merged = saveGlobalSettingsFromUi(req.body || {});
    res.json({ ok: true, settings: merged });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reset-dedup', (req, res) => {
  try {
    let preserved = {};
    if (fs.existsSync(ALERT_STATE_PATH)) {
      try {
        const prev = JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf-8')) || {};
        if (prev.__lastDigestSentAt) preserved.__lastDigestSentAt = prev.__lastDigestSentAt;
        if (prev.__lastDigestHash) preserved.__lastDigestHash = prev.__lastDigestHash;
      } catch (e) {}
    }
    atomicWriteJson(ALERT_STATE_PATH, preserved);
    res.json({ ok: true, status: 'Deduplication lock cleared.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/test-alert', async (req, res) => {
  try {
    const { sendAlert } = require('./notifier');
    await sendAlert({
      title: 'Pokemon Scarlet & Violet Prismatic Evolutions Elite Trainer Box',
      retailer: 'Target',
      url: 'https://www.target.com/p/pokemon-trading-card-game-scarlet-38-violet-prismatic-evolutions-elite-trainer-box/-/A-93954435',
      price: '54.99',
      priceNum: 54.99,
      stock: undefined,
      itemId: 'test_target_prismatic',
      ruleId: 'sv-prismatic-evolutions-etb',
      ruleName: 'Prismatic Evolutions ETB',
      formFactor: 'ETB',
      msrp: 54.99,
      marketValue: 105.00,
      maxBuyTarget: 85.00,
      discountPct: 48,
      savingsDollars: 50.01,
      ownedInVault: false,
      alertType: 'NEW_DROP'
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


app.post('/api/live-comp', async (req, res) => {
  try {
    const { id, name, marketValue, sendToDiscord } = req.body;
    const { getDualMarketComps } = require('./marketComps');
    const comps = await getDualMarketComps(id, name, marketValue || 50);
    if (sendToDiscord) {
      const { sendAlert } = require('./notifier');
      const bestPrice = comps.tcgplayer?.price || comps.ebay?.price || marketValue;
      await sendAlert({
        title: name + ' [ON-DEMAND COMP CHECK]',
        retailer: comps.tcgplayer ? 'TCGPlayer Live Low' : 'Market Check',
        url: comps.tcgplayer?.url || comps.ebay?.url || 'https://www.tcgplayer.com',
        price: String(bestPrice),
        priceNum: bestPrice,
        ruleId: id,
        ruleName: name,
        formFactor: 'Manual Check',
        msrp: 0,
        marketValue: marketValue,
        maxBuyTarget: marketValue,
        alertType: 'NEW_DROP'
      });
    }
    res.json(comps);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/policies', (req, res) => {
  try {
    const parsed = getRuntimePolicies();
    let cache = {};
    if (fs.existsSync(TELEMETRY_PATH)) {
      try { cache = JSON.parse(fs.readFileSync(TELEMETRY_PATH, 'utf-8')); } catch (e) {}
    }
    let liveMap = {};
    if (fs.existsSync(LIVE_STOCK_PATH)) {
      try { liveMap = JSON.parse(fs.readFileSync(LIVE_STOCK_PATH, 'utf-8')); } catch (e) {}
    }
    const now = Date.now();
    const enriched = parsed.map(p => {
      const liveEntry = liveMap[p.id];
      const tel = cache[p.id];
      const refLanded = (liveEntry && liveEntry.inStock && (liveEntry.landedPrice || liveEntry.price))
        ? Number(liveEntry.landedPrice || liveEntry.price)
        : ((tel && tel.lowestPrice > 0) ? Number(tel.lowestPrice) : Number(p.maxMarketBuyPrice || p.estimatedMarketValue || p.msrpCeiling || 0));
      const rip = computeRipMetrics(refLanded, p.id, p.formFactor, p.name, p.packCount);
      const wallOwned = Boolean(p.wallOwned ?? p.owned ?? p.inVault);
      const dadRipOwned = Boolean(p.dadRipOwned);
      const loganRipOwned = Boolean(p.loganRipOwned);
      const completionCount = (wallOwned ? 1 : 0) + (dadRipOwned ? 1 : 0) + (loganRipOwned ? 1 : 0);
      const fullyConquered = Boolean(wallOwned && dadRipOwned && loganRipOwned);
      const trendEval = evaluateSkuTrendAndTiming({
        skuId: p.id,
        formFactor: p.formFactor,
        releaseDate: p.releaseDate,
        msrpCeiling: p.msrpCeiling || 0,
        policyMaxBuy: Math.max(p.msrpCeiling || 0, p.maxMarketBuyPrice || 0),
        marketBaseline: p.estimatedMarketValue || p.msrpCeiling || 0,
        landedPrice: refLanded,
        dropPrice: refLanded,
        estimatedShipping: 0,
        owned: wallOwned,
        wallOwned,
        dadRipOwned,
        loganRipOwned,
        completionCount,
        fullyConquered,
        autoPilotEnabled: p.autoPilotEnabled !== false,
        nowTs: now
      });
      return {
        ...p,
        owned: wallOwned,
        inVault: wallOwned,
        wallOwned,
        dadRipOwned,
        loganRipOwned,
        completionCount,
        fullyConquered,
        autoPilotEnabled: p.autoPilotEnabled !== false,
        autoPilotCeiling: trendEval.autoPilotCeiling,
        effectiveTargetCeiling: trendEval.effectiveTargetCeiling,
        ripHuntCeiling: trendEval.ripHuntCeiling,
        isRipHuntMode: trendEval.isRipHuntMode,
        isBleedingDown: trendEval.isBleedingDown,
        isSupplyTightening: trendEval.isSupplyTightening,
        packCount: rip.packCount,
        pricePerPack: rip.pricePerPack,
        isRipValueLeader: rip.isRipValueLeader,
        isPreRelease: trendEval.isPreRelease,
        preReleaseStatusTag: trendEval.preReleaseStatusTag,
        trendSignal: trendEval.trendSignal,
        trendVerdictLabel: trendEval.trendVerdictLabel,
        isElasticDip: trendEval.isElasticDip
      };
    });
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/telemetry', (req, res) => {
  try {
    if (fs.existsSync(TELEMETRY_PATH)) {
      const data = fs.readFileSync(TELEMETRY_PATH, 'utf-8');
      return res.type('json').send(data);
    }
    res.json({});
  } catch (e) {
    res.json({});
  }
});

app.post('/api/policies', (req, res) => {
  try {
    saveUserPoliciesFromUi(req.body);
    try { reloadWatchPolicies(); invalidateDashboardApiCaches(); } catch (e) {}
    res.json({ status: 'Saved to config/userPreferences.json and hot-synced.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post(['/api/policies/:skuId/family-slots', '/api/policies/:skuId/slots'], (req, res) => {
  try {
    const skuId = String(req.params.skuId || '').trim();
    if (!skuId) return res.status(400).json({ ok: false, error: 'Missing skuId' });
    const updatedSku = updateSkuFamilySlotsFromUi(skuId, req.body || {});
    try { reloadWatchPolicies(); invalidateDashboardApiCaches(); } catch (e) {}
    const advisor = buildNextBestBuyAdvisorPayload(200);
    return res.json({
      ok: true,
      policy: updatedSku,
      sku: updatedSku,
      familyProgress: advisor.familyProgress,
      nextBuyAdvisor: advisor
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
});

app.get('/api/singles', (req, res) => {
  try {
    const q = String(req.query.q || req.query.query || '').trim();
    const favoritesOnly = String(req.query.favoritesOnly || '').toLowerCase() === 'true';
    const limit = Number(req.query.limit || 60);
    return res.json(querySinglesCache({ q, favoritesOnly, limit }));
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, results: [] });
  }
});

app.post('/api/singles/watchlist', (req, res) => {
  try {
    const body = req.body || {};
    const updated = updateSinglesWatchlist(body);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, results: [] });
  }
});

app.get('/art/:filename', (req, res) => {
  const cleanName = req.params.filename.split('?')[0];
  const baseId = path.basename(cleanName, path.extname(cleanName));

  const candidates = [
    path.join(ART_DIR, baseId + '.jpg'),
    path.join(ART_DIR, baseId + '.png'),
    path.join(ART_DIR, baseId + '.webp'),
    path.join(ART_DIR, baseId.replace(/-case$/, '') + '.jpg'),
    path.join(ART_DIR, baseId.replace(/-booster-case$/, '-booster-box') + '.jpg')
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      return res.sendFile(cand);
    }
  }

  res.type('image/svg+xml');
  res.send('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="10" fill="#1e293b"/><text x="50%" y="50%" fill="#64748b" font-family="sans-serif" font-size="11" font-weight="bold" text-anchor="middle" dominant-baseline="middle">NO ART</text></svg>');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('DropBot Commander running at http://localhost:' + PORT);
});
