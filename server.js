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
const HTML_PATH = path.resolve(__dirname, 'dashboard.html');
const ART_DIR = path.resolve(__dirname, 'art');

const PRE_RELEASE_BLEED_TAG = '⏳ PRE-RELEASE BLEED (Wait for Launch Week)';

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
  }
}

function getPackCountForSku(skuId, formFactor, name) {
  try {
    const { getPackCountForSku: tsGetPackCount } = require('./policies');
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

  let policies = [];
  try {
    if (fs.existsSync(POLICIES_PATH)) {
      policies = JSON.parse(fs.readFileSync(POLICIES_PATH, 'utf-8'));
    }
  } catch (e) {}

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

function isPreReleaseDate(releaseDate, nowTs = Date.now()) {
  if (!releaseDate) return false;
  const parsed = Date.parse(`${releaseDate}T00:00:00`);
  if (Number.isNaN(parsed)) return false;
  return nowTs < parsed;
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

app.get('/', (req, res) => {
  if (fs.existsSync(PUBLIC_INDEX_PATH)) {
    return res.sendFile(PUBLIC_INDEX_PATH);
  }
  res.sendFile(HTML_PATH);
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

    let policies = [];
    if (fs.existsSync(POLICIES_PATH)) {
      try { policies = JSON.parse(fs.readFileSync(POLICIES_PATH, 'utf-8')); } catch (e) {}
    }
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
      try { atomicWriteJson(POLICIES_PATH, policies); } catch (e) {}
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

    let policies = [];
    if (fs.existsSync(POLICIES_PATH)) {
      try { policies = JSON.parse(fs.readFileSync(POLICIES_PATH, 'utf-8')); } catch (e) {}
    }
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

    let lgsStores = [];
    try {
      const lgsMod = require('./lgsPoller');
      lgsStores = lgsMod.LGS_STORES || lgsMod.MONITORED_STORES || [];
    } catch (e) {}

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
      const disc = Number(pol.minDiscountPercent || 15);
      const mktTrigger = marketVal > 0 ? Math.round(marketVal * (1 - disc / 100) * 100) / 100 : msrp;
      return Math.max(msrp, mktTrigger);
    };

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
        discountPct
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
  let lgsStores = [];
  let bigBoxStores = [];
  try {
    const lgsMod = require('./lgsPoller');
    lgsStores = lgsMod.LGS_STORES || lgsMod.MONITORED_STORES || [];
  } catch (e) {}
  try {
    const vpMod = require('./vampirePoller');
    bigBoxStores = vpMod.BIG_BOX_STORES || [];
  } catch (e) {}

  let storeHealth = {};
  if (fs.existsSync(STORE_HEALTH_PATH)) {
    try { storeHealth = JSON.parse(fs.readFileSync(STORE_HEALTH_PATH, 'utf-8')); } catch (e) {}
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
    marketplaceCount,
    totalMonitoredSources,
    totalListingsMonitored,
    lgsStores,
    bigBoxStores,
    storeHealth
  };
}

app.get('/api/status', (req, res) => {
  try {
    const trophies = loadMsrpTrophies();
    const conqueredVault = loadConqueredVault();
    const storeTel = getDynamicStoreTelemetry();
    res.json({
      ok: true,
      timestamp: Date.now(),
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
        marketplaceCount: storeTel.marketplaceCount,
        totalMonitoredSources: storeTel.totalMonitoredSources,
        totalListingsMonitored: storeTel.totalListingsMonitored
      },
      storeHealth: storeTel.storeHealth
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
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

    let policies = [];
    if (fs.existsSync(POLICIES_PATH)) {
      try {
        policies = JSON.parse(fs.readFileSync(POLICIES_PATH, 'utf-8'));
      } catch (e) {
        policies = [];
      }
    }
    const policyMap = new Map(policies.map(p => [p.id, p]));

    // Prune any item whose price exceeds current policy maxBuy (or pre-order ceiling) or is older than 6 hours
    const now = Date.now();
    const activeStock = {};
    for (const [ruleId, entry] of Object.entries(liveMap)) {
      if (ruleId === '__recentOos' || !entry || !entry.inStock) continue;
      const pol = policyMap.get(ruleId);
      if (!pol || pol.active === false) continue;
      const rawMaxBuy = Math.max(pol.msrpCeiling || 0, pol.maxMarketBuyPrice || 0);
      const effectiveMaxBuy = entry.isPreOrder
        ? Math.min(rawMaxBuy, Math.round((pol.msrpCeiling || 0) * 1.05))
        : rawMaxBuy;
      const landed = entry.landedPrice || entry.price;
      const eligible = entry.price <= effectiveMaxBuy && (landed <= effectiveMaxBuy || Boolean(entry.freeShipNote));
      if (eligible && (now - (entry.updatedAt || 0)) < 6 * 60 * 60 * 1000) {
        const isPreRelease = isPreReleaseDate(pol.releaseDate, now);
        const rip = computeRipMetrics(landed, ruleId, pol.formFactor, pol.name, pol.packCount);
        activeStock[ruleId] = {
          ...entry,
          packCount: entry.packCount ?? rip.packCount,
          pricePerPack: entry.pricePerPack ?? rip.pricePerPack,
          isRipValueLeader: entry.isRipValueLeader ?? rip.isRipValueLeader,
          releaseDate: pol.releaseDate,
          isPreRelease,
          preReleaseStatusTag: isPreRelease ? PRE_RELEASE_BLEED_TAG : undefined
        };
      }
    }

    res.json(activeStock);
  } catch (e) {
    res.json({});
  }
});

app.post('/api/send-digest', async (req, res) => {
  try {
    const { sendStockDigestCard } = require('./notifier');
    const result = await sendStockDigestCard({ force: true });
    res.json(result);
  } catch (e) {
    res.status(500).json({ sent: false, error: e.message });
  }
});

app.get('/api/settings', (req, res) => {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      return res.type('json').send(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    }
    res.json({ muteVaulted: false });
  } catch (e) {
    res.json({ muteVaulted: false });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    let existing = { muteVaulted: true, liveDigestEnabled: false };
    if (fs.existsSync(SETTINGS_PATH)) {
      try { existing = { ...existing, ...(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) || {}) }; } catch (e) {}
    }
    const merged = { ...existing, ...(req.body || {}) };
    atomicWriteJson(SETTINGS_PATH, merged);
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
    const raw = fs.readFileSync(POLICIES_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
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
      const pre = isPreReleaseDate(p.releaseDate, now);
      const liveEntry = liveMap[p.id];
      const tel = cache[p.id];
      const refLanded = (liveEntry && liveEntry.inStock && (liveEntry.landedPrice || liveEntry.price))
        ? Number(liveEntry.landedPrice || liveEntry.price)
        : ((tel && tel.lowestPrice > 0) ? Number(tel.lowestPrice) : Number(p.maxMarketBuyPrice || p.estimatedMarketValue || p.msrpCeiling || 0));
      const rip = computeRipMetrics(refLanded, p.id, p.formFactor, p.name, p.packCount);
      return {
        ...p,
        packCount: rip.packCount,
        pricePerPack: rip.pricePerPack,
        isRipValueLeader: rip.isRipValueLeader,
        isPreRelease: pre,
        preReleaseStatusTag: pre ? PRE_RELEASE_BLEED_TAG : undefined
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
    atomicWriteJson(POLICIES_PATH, req.body);
    res.json({ status: 'Saved and hot-synced.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
