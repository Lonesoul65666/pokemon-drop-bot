const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const POLICIES_PATH = path.resolve(__dirname, 'policies.json');
const TELEMETRY_PATH = path.resolve(__dirname, 'marketCache.json');
const DROPS_PATH = path.resolve(__dirname, 'dropsHistory.json');
const LIVE_STOCK_PATH = path.resolve(__dirname, 'liveStock.json');
const ALERT_STATE_PATH = path.resolve(__dirname, 'alertState.json');
const SETTINGS_PATH = path.resolve(__dirname, 'botSettings.json');
const STORE_HEALTH_PATH = path.resolve(__dirname, 'storeHealth.json');
const HTML_PATH = path.resolve(__dirname, 'dashboard.html');
const ART_DIR = path.resolve(__dirname, 'art');

function atomicWriteJson(filePath, data) {
  try {
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    const fallbackTmp = `${filePath}.tmp`;
    fs.writeFileSync(fallbackTmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(fallbackTmp, filePath);
  }
}

if (!fs.existsSync(ART_DIR)) {
  fs.mkdirSync(ART_DIR, { recursive: true });
}

app.use(express.json({ limit: '10mb' }));

app.get('/', (req, res) => {
  res.sendFile(HTML_PATH);
});

app.get('/api/drops', (req, res) => {
  try {
    if (fs.existsSync(DROPS_PATH)) {
      return res.type('json').send(fs.readFileSync(DROPS_PATH, 'utf-8'));
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
    res.json(computeFullMarketTape());
  } catch (e) {
    res.status(500).json({ error: e.message, targets: {}, honeyHoleStores: [], recentSalesTape: [], weeklyCheckpoints: {} });
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
        activeStock[ruleId] = entry;
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
    atomicWriteJson(SETTINGS_PATH, req.body || { muteVaulted: false });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reset-dedup', (req, res) => {
  try {
    atomicWriteJson(ALERT_STATE_PATH, {});
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
    const data = fs.readFileSync(POLICIES_PATH, 'utf-8');
    res.type('json').send(data);
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
