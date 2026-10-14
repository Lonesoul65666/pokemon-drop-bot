const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const POLICIES_PATH = path.resolve(__dirname, 'policies.json');
const TELEMETRY_PATH = path.resolve(__dirname, 'marketCache.json');
const ART_DIR = path.resolve(__dirname, 'art');

if (!fs.existsSync(ART_DIR)) {
  fs.mkdirSync(ART_DIR, { recursive: true });
}

app.use(express.json());

const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DropBot Commander</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0b0f19; color: #f1f5f9; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .card-glass { background: #131b2e; border: 1px solid #1e293b; transition: border-color 0.2s, box-shadow 0.2s; }
    .card-glass:hover { border-color: #3b82f6; box-shadow: 0 8px 24px -4px rgba(59, 130, 246, 0.15); }
    input[type=range] { accent-color: #3b82f6; }
  </style>
</head>
<body class="p-6 max-w-7xl mx-auto">
  <header class="flex flex-col md:flex-row justify-between items-start md:items-center pb-6 border-b border-slate-800 gap-4">
    <div>
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-black tracking-tight text-white flex items-center gap-2">
          <span class="text-yellow-400">⚡</span> DROPBOT COMMANDER
        </h1>
        <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
          ● Live Restock Feeds Active
        </span>
        <span class="text-xs px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium" id="vaultCounter">
          Vaulted ETBs: 0 / 0
        </span>
      </div>
      <p class="text-xs text-slate-400 mt-1">Direct-to-cart sealed portfolio monitoring & live market telemetry</p>
    </div>

    <div id="syncToast" class="opacity-0 transition-opacity duration-300 text-xs px-3 py-1.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium">
      Auto-synced to bot
    </div>
  </header>

  <div class="flex flex-wrap items-center justify-between gap-4 my-6">
    <div class="flex flex-wrap items-center gap-2" id="filterPills">
      <button onclick="setFilter('ALL')" class="pill-btn active px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white" data-filter="ALL">All Products</button>
      <button onclick="setFilter('Master Case')" class="pill-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700" data-filter="Master Case">📦 Master Cases</button>
      <button onclick="setFilter('Booster Box')" class="pill-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700" data-filter="Booster Box">🎴 36-Pack Boxes</button>
      <button onclick="setFilter('ETB')" class="pill-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700" data-filter="ETB">🎁 ETBs</button>
      <button onclick="setFilter('Booster Bundle')" class="pill-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700" data-filter="Booster Bundle">🗃️ 6-Pack Bundles</button>
    </div>

    <input type="text" id="searchInput" placeholder="Search sets or products..." oninput="render()"
      class="bg-slate-900 border border-slate-700 text-xs text-white px-3 py-1.5 rounded-lg focus:outline-none focus:border-blue-500 w-56" />
  </div>

  <main id="catalogContainer" class="space-y-10"></main>

  <script>
    let policies = [];
    let telemetry = {};
    let activeFilter = 'ALL';
    let saveTimeout = null;

    async function init() {
      const [polRes, telRes] = await Promise.all([
        fetch('/api/policies'),
        fetch('/api/telemetry')
      ]);
      policies = await polRes.json();
      telemetry = await telRes.json();
      updateVaultCounter();
      render();

      setInterval(async () => {
        try {
          const tRes = await fetch('/api/telemetry');
          telemetry = await tRes.json();
          updateTelemetryUI();
        } catch (e) {}
      }, 10000);
    }

    function updateVaultCounter() {
      const etbs = policies.filter(p => p.formFactor === 'ETB');
      const ownedCount = etbs.filter(p => p.owned === true).length;
      const counter = document.getElementById('vaultCounter');
      if (counter) {
        counter.innerText = 'Vaulted ETBs: ' + ownedCount + ' / ' + etbs.length;
      }
    }

    function setFilter(type) {
      activeFilter = type;
      document.querySelectorAll('.pill-btn').forEach(b => {
        if (b.dataset.filter === type) {
          b.className = 'pill-btn active px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white';
        } else {
          b.className = 'pill-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700';
        }
      });
      render();
    }

    function updateTelemetryUI() {
      policies.forEach((p, index) => {
        const tel = telemetry[p.id];
        if (tel) {
          const telBanner = document.getElementById('tel_banner_' + index);
          if (telBanner) {
            telBanner.innerHTML = \`
              <div>
                <div class="text-[10px] text-blue-300 font-semibold uppercase">Best Online Spot</div>
                <div class="text-xs text-white font-bold">$\${tel.lowestPrice.toFixed(2)} <span class="text-slate-400 font-normal">at \${tel.lowestStore}</span></div>
              </div>
              <a href="\${tel.lowestUrl}" target="_blank" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[11px] font-bold tracking-tight inline-flex items-center gap-1">
                Cart ↗
              </a>
            \`;
            telBanner.className = "mb-3 px-3 py-2 bg-blue-950/40 border border-blue-800/40 rounded-lg flex items-center justify-between";
          }
        }
      });
    }

    function render() {
      const query = document.getElementById('searchInput').value.toLowerCase();
      const container = document.getElementById('catalogContainer');
      container.innerHTML = '';

      const filtered = policies.filter(p => {
        const matchesType = activeFilter === 'ALL' || p.formFactor === activeFilter;
        const matchesQuery = p.name.toLowerCase().includes(query) || (p.era && p.era.toLowerCase().includes(query));
        return matchesType && matchesQuery;
      });

      const eras = [...new Set(filtered.map(p => p.era || 'General Releases'))];

      eras.forEach(era => {
        const itemsInEra = filtered.filter(p => (p.era || 'General Releases') === era);
        if (itemsInEra.length === 0) return;

        const section = document.createElement('section');
        section.innerHTML = \`
          <div class="flex items-center gap-2 mb-4">
            <h2 class="text-sm font-bold uppercase tracking-wider text-slate-400">\${era}</h2>
            <div class="h-px bg-slate-800 flex-1"></div>
            <span class="text-xs text-slate-500">\${itemsInEra.length} Tracked</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            \${itemsInEra.map(p => renderCard(p)).join('')}
          </div>
        \`;
        container.appendChild(section);
      });
      updateTelemetryUI();
    }

    function renderCard(p) {
      const index = policies.findIndex(x => x.id === p.id);
      const tel = telemetry[p.id];
      const marketVal = (tel && tel.rollingAverage > 0) ? tel.rollingAverage : p.estimatedMarketValue;
      const discount = Math.round(((marketVal - (p.maxMarketBuyPrice || 0)) / marketVal) * 100);
      const imgPath = \`/art/\${p.id}.jpg?t=\${Date.now()}\`;

      return \`
        <div class="card-glass rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div class="flex justify-between items-center mb-3 gap-2">
              <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-blue-400 border border-slate-700">
                \${p.formFactor}
              </span>

              <div class="flex items-center gap-3">
                \${p.formFactor === 'ETB' ? \`
                  <label class="flex items-center gap-1.5 text-[11px] font-semibold \${p.owned ? 'text-purple-400' : 'text-slate-400'} cursor-pointer">
                    <input type="checkbox" \${p.owned ? 'checked' : ''} onchange="toggleOwned(\${index}, this.checked)" class="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0">
                    <span>Vaulted</span>
                  </label>
                \` : ''}

                <label class="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" \${p.active !== false ? 'checked' : ''} onchange="toggleActive(\${index}, this.checked)" class="sr-only peer">
                  <div class="w-8 h-4 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-500"></div>
                </label>
              </div>
            </div>

            <div class="flex items-center gap-3 mb-4">
              <div class="w-14 h-14 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-center p-1 overflow-hidden shrink-0">
                <img src="\${imgPath}" class="max-h-full max-w-full object-contain rounded-md" alt="" />
              </div>
              <div>
                <h3 class="text-sm font-bold text-white leading-snug">\${p.name}</h3>
                <span class="text-[11px] text-slate-400">Retail MSRP: $\${p.msrpCeiling ? p.msrpCeiling.toFixed(2) : '0.00'}</span>
              </div>
            </div>

            <div id="tel_banner_\${index}" class="mb-3 px-3 py-2 bg-slate-900/40 border border-slate-800/60 rounded-lg text-[11px] text-slate-500 italic">
               Scanning feeds for live stock...
            </div>

            <div class="bg-slate-900/60 border border-slate-800 rounded-lg p-3 grid grid-cols-2 gap-2 mb-4">
              <div>
                <div class="text-[10px] uppercase font-bold text-slate-500">
                  Estimated Market
                </div>
                <div class="text-sm font-extrabold text-yellow-400">$\${marketVal.toFixed(2)}</div>
              </div>
              <div>
                <div class="text-[10px] uppercase font-bold text-slate-500">Max Buy Target</div>
                <div class="text-sm font-extrabold text-emerald-400" id="priceDisplay_\${index}">$\${(p.maxMarketBuyPrice || 0).toFixed(2)}</div>
              </div>
            </div>

            <div class="mb-2">
              <div class="flex justify-between text-xs mb-1">
                <span class="text-slate-400 font-medium">Buy Ceiling</span>
                <span class="font-bold \${discount >= 20 ? 'text-emerald-400' : 'text-blue-400'}" id="spreadDisplay_\${index}">
                  \${discount}% Under Market
                </span>
              </div>
              <input type="range" 
                min="\${Math.floor(p.msrpCeiling || 0)}" 
                max="\${Math.ceil(marketVal * 1.2 || 100)}" 
                step="0.5" 
                value="\${p.maxMarketBuyPrice || 0}"
                oninput="onSliderMove(\${index}, this.value, \${marketVal})"
                class="w-full h-1.5 bg-slate-800 rounded-lg cursor-pointer" />
            </div>
          </div>

          <div class="flex gap-1.5 pt-3 border-t border-slate-800/80">
            <button onclick="setPreset(\${index}, \${p.msrpCeiling})" class="flex-1 py-1 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white">At MSRP</button>
            <button onclick="setPreset(\${index}, \${marketVal * 0.85})" class="flex-1 py-1 rounded text-[10px] font-semibold bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white">-15%</button>
            <button onclick="setPreset(\${index}, \${marketVal * 0.70})" class="flex-1 py-1 rounded text-[10px] font-semibold bg-slate-800 text-emerald-400 hover:bg-emerald-950/40">-30% Alpha</button>
          </div>
        </div>
      \`;
    }

    function onSliderMove(index, val, marketVal) {
      policies[index].maxMarketBuyPrice = parseFloat(val);
      const discount = Math.round(((marketVal - policies[index].maxMarketBuyPrice) / marketVal) * 100);
      document.getElementById(\`priceDisplay_\${index}\`).innerText = '$' + parseFloat(val).toFixed(2);
      document.getElementById(\`spreadDisplay_\${index}\`).innerText = discount + '% Under Market';
      debouncedSave();
    }

    function setPreset(index, targetVal) {
      policies[index].maxMarketBuyPrice = Math.round(targetVal * 100) / 100;
      render();
      saveInstant();
    }

    function toggleActive(index, state) {
      policies[index].active = state;
      saveInstant();
    }

    function toggleOwned(index, state) {
      policies[index].owned = state;
      updateVaultCounter();
      render();
      saveInstant();
    }

    async function sendPoliciesToDisk() {
      await fetch('/api/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policies)
      });
      const toast = document.getElementById('syncToast');
      toast.style.opacity = '1';
      setTimeout(() => { toast.style.opacity = '0'; }, 1500);
    }

    function saveInstant() {
      clearTimeout(saveTimeout);
      sendPoliciesToDisk();
    }

    function debouncedSave() {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(sendPoliciesToDisk, 400);
    }

    init();
  </script>
</body>
</html>
`;

app.get('/', (req, res) => res.send(HTML_CONTENT));

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
  const cleanUrl = req.params.filename.split('?')[0];
  const filePath = path.join(ART_DIR, path.basename(cleanUrl));
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  res.type('image/svg+xml');
  res.send('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" rx="8" fill="#1e293b"/><text x="50%" y="50%" fill="#64748b" font-family="sans-serif" font-size="12" font-weight="bold" text-anchor="middle" dominant-baseline="middle">NO ART</text></svg>');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('DropBot Commander running at http://localhost:' + PORT);
});