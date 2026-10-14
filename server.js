const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const POLICIES_PATH = path.resolve(__dirname, 'policies.json');
const TELEMETRY_PATH = path.resolve(__dirname, 'marketCache.json');
const DROPS_PATH = path.resolve(__dirname, 'dropsHistory.json');
const HTML_PATH = path.resolve(__dirname, 'dashboard.html');
const ART_DIR = path.resolve(__dirname, 'art');

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

app.post('/api/test-alert', async (req, res) => {
  try {
    const { sendAlert } = require('./notifier');
    await sendAlert({
      title: 'Pokemon SV10: Destined Rivals Booster Box (36-Pack) [TEST DROP]',
      retailer: 'Forge & Fire',
      url: 'https://forgeandfiregaming.com',
      price: '245.00',
      priceNum: 245,
      stock: 4,
      ruleId: 'sv-destined-rivals-booster-box',
      ruleName: 'Destined Rivals Booster Box (36-Pack)',
      formFactor: 'Booster Box',
      msrp: 161.64,
      marketValue: 395,
      maxBuyTarget: 275,
      discountPct: 38,
      savingsDollars: 150,
      ownedInVault: false
    });
    res.json({ ok: true });
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
    const tempPath = POLICIES_PATH + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(req.body, null, 2), 'utf-8');
    fs.renameSync(tempPath, POLICIES_PATH);
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
