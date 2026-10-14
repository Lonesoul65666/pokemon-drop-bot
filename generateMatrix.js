$utf8NoBom = New-Object System.Text.UTF8Encoding $false

$matrixCode = @'
const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, 'policies.json');

// Preserve existing Vaulted ETB checkmarks and custom slider values
let existingMap = {};
if (fs.existsSync(OUTPUT_PATH)) {
  try {
    const existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));
    existing.forEach(p => { existingMap[p.id] = p; });
  } catch (e) {}
}

const ERAS = {
  MEGA: 'Mega Evolution (2025-2026)',
  SV: 'Scarlet & Violet (2023-2025)',
  SWSH: 'Sword & Shield Vault (2021-2023)'
};

const SETS = [
  // --- Mega Evolution (2025-2026) ---
  { id: 'me-discovery', name: 'Mega Evolution: Mega Discovery', shortName: 'mega discovery', era: ERAS.MEGA, isSpecial: false, boxMarket: 210, boxBuy: 180, bundleMarket: 45, bundleBuy: 35, etbs: [{ id: 'me-discovery-etb', name: 'Mega Discovery ETB (Mega Lucario)', market: 85, buy: 70, term: '(mega discovery|mega evolution)' }] },
  { id: 'me-pitch-black', name: 'Mega Evolution: Pitch Black', shortName: 'pitch black', era: ERAS.MEGA, isSpecial: false, boxMarket: 220, boxBuy: 190, bundleMarket: 45, bundleBuy: 35, etbs: [{ id: 'me-pitch-black-etb', name: 'Mega Evolution: Pitch Black ETB', market: 80, buy: 70, term: 'pitch black' }] },
  { id: 'me-phantasmal-flames', name: 'Mega Evolution: Phantasmal Flames', shortName: 'phantasmal flames', era: ERAS.MEGA, isSpecial: false, boxMarket: 390, boxBuy: 260, bundleMarket: 55, bundleBuy: 40, etbs: [{ id: 'me-phantasmal-flames-etb', name: 'Mega Evolution: Phantasmal Flames ETB', market: 145, buy: 95, term: 'phantasmal flames' }] },
  { id: 'me-perfect-order', name: 'Mega Evolution: Perfect Order', shortName: 'perfect order', era: ERAS.MEGA, isSpecial: false, boxMarket: 190, boxBuy: 175, bundleMarket: 42, bundleBuy: 34, etbs: [{ id: 'me-perfect-order-etb', name: 'Mega Evolution: Perfect Order ETB', market: 65, buy: 58, term: 'perfect order' }] },
  { id: 'me-chaos-rising', name: 'Mega Evolution: Chaos Rising', shortName: 'chaos rising', era: ERAS.MEGA, isSpecial: false, boxMarket: 190, boxBuy: 175, bundleMarket: 42, bundleBuy: 34, etbs: [{ id: 'me-chaos-rising-etb', name: 'Mega Evolution: Chaos Rising ETB', market: 65, buy: 58, term: 'chaos rising' }] },
  { id: 'me-delta-reign', name: 'Mega Evolution: Delta Reign', shortName: 'delta reign', era: ERAS.MEGA, isSpecial: false, boxMarket: 240, boxBuy: 175, bundleMarket: 60, bundleBuy: 42, etbs: [{ id: 'me-delta-reign-etb', name: 'Mega Evolution: Delta Reign ETB', market: 120, buy: 75, term: 'delta reign' }] },
  { id: 'me-ascended-heroes', name: 'Mega Evolution: Ascended Heroes', shortName: 'ascended heroes', era: ERAS.MEGA, isSpecial: true, bundleMarket: 70, bundleBuy: 45, etbs: [{ id: 'me-ascended-heroes-etb', name: 'Mega Evolution: Ascended Heroes ETB', market: 160, buy: 95, term: 'ascended heroes' }] },
  { id: 'me-30th-celebration', name: '30th Celebration', shortName: '30th', era: ERAS.MEGA, isSpecial: true, bundleMarket: 45, bundleBuy: 35, etbs: [{ id: 'me-30th-celebration-etb', name: '30th Celebration ETB', market: 55, buy: 52, term: '30th.*(celebration|anniversary)' }] },

  // --- Scarlet & Violet (2023-2025) ---
  { id: 'sv-base', name: 'Scarlet & Violet Base', shortName: 'scarlet.*violet base', era: ERAS.SV, isSpecial: false, boxMarket: 145, boxBuy: 135, bundleMarket: 32, bundleBuy: 26, etbs: [
    { id: 'sv-base-koraidon-etb', name: 'Scarlet & Violet Base ETB (Koraidon)', market: 55, buy: 48, term: 'koraidon' },
    { id: 'sv-base-miraidon-etb', name: 'Scarlet & Violet Base ETB (Miraidon)', market: 55, buy: 48, term: 'miraidon' }
  ]},
  { id: 'sv-paldea-evolved', name: 'Paldea Evolved', shortName: 'paldea evolved', era: ERAS.SV, isSpecial: false, boxMarket: 210, boxBuy: 185, bundleMarket: 38, bundleBuy: 30, etbs: [{ id: 'sv-paldea-evolved-etb', name: 'Paldea Evolved ETB', market: 65, buy: 58, term: 'paldea evolved' }] },
  { id: 'sv-obsidian-flames', name: 'Obsidian Flames', shortName: 'obsidian flames', era: ERAS.SV, isSpecial: false, boxMarket: 150, boxBuy: 140, bundleMarket: 34, bundleBuy: 28, etbs: [{ id: 'sv-obsidian-flames-etb', name: 'Obsidian Flames ETB', market: 55, buy: 50, term: 'obsidian flames' }] },
  { id: 'sv-151', name: 'Scarlet & Violet: 151', shortName: '151', era: ERAS.SV, isSpecial: true, bundleMarket: 162, bundleBuy: 90, etbs: [{ id: 'sv-151-etb', name: 'Scarlet & Violet: 151 ETB', market: 110, buy: 85, term: '151' }] },
  { id: 'sv-paradox-rift', name: 'Paradox Rift', shortName: 'paradox rift', era: ERAS.SV, isSpecial: false, boxMarket: 160, boxBuy: 145, bundleMarket: 34, bundleBuy: 28, etbs: [
    { id: 'sv-paradox-rift-roaring-etb', name: 'Paradox Rift ETB (Roaring Moon)', market: 55, buy: 50, term: '(paradox rift.*roaring|roaring moon)' },
    { id: 'sv-paradox-rift-valiant-etb', name: 'Paradox Rift ETB (Iron Valiant)', market: 55, buy: 50, term: '(paradox rift.*valiant|iron valiant)' }
  ]},
  { id: 'sv-paldean-fates', name: 'Paldean Fates', shortName: 'paldean fates', era: ERAS.SV, isSpecial: true, bundleMarket: 42, bundleBuy: 32, etbs: [{ id: 'sv-paldean-fates-etb', name: 'Paldean Fates ETB', market: 65, buy: 55, term: 'paldean fates' }] },
  { id: 'sv-temporal-forces', name: 'Temporal Forces', shortName: 'temporal forces', era: ERAS.SV, isSpecial: false, boxMarket: 165, boxBuy: 150, bundleMarket: 35, bundleBuy: 28, etbs: [
    { id: 'sv-temporal-forces-wake-etb', name: 'Temporal Forces ETB (Walking Wake)', market: 55, buy: 50, term: '(temporal forces.*wake|walking wake)' },
    { id: 'sv-temporal-forces-leaves-etb', name: 'Temporal Forces ETB (Iron Leaves)', market: 55, buy: 50, term: '(temporal forces.*leaves|iron leaves)' }
  ]},
  { id: 'sv-twilight-masquerade', name: 'Twilight Masquerade', shortName: 'twilight masquerade', era: ERAS.SV, isSpecial: false, boxMarket: 185, boxBuy: 165, bundleMarket: 38, bundleBuy: 30, etbs: [{ id: 'sv-twilight-masquerade-etb', name: 'Twilight Masquerade ETB', market: 60, buy: 55, term: 'twilight masquerade' }] },
  { id: 'sv-shrouded-fable', name: 'Shrouded Fable', shortName: 'shrouded fable', era: ERAS.SV, isSpecial: true, bundleMarket: 35, bundleBuy: 28, etbs: [{ id: 'sv-shrouded-fable-etb', name: 'Shrouded Fable ETB', market: 55, buy: 48, term: 'shrouded fable' }] },
  { id: 'sv-stellar-crown', name: 'Stellar Crown', shortName: 'stellar crown', era: ERAS.SV, isSpecial: false, boxMarket: 160, boxBuy: 145, bundleMarket: 35, bundleBuy: 28, etbs: [{ id: 'sv-stellar-crown-etb', name: 'Stellar Crown ETB', market: 55, buy: 50, term: 'stellar crown' }] },
  { id: 'sv-surging-sparks', name: 'Surging Sparks', shortName: 'surging sparks', era: ERAS.SV, isSpecial: false, boxMarket: 255, boxBuy: 210, bundleMarket: 45, bundleBuy: 35, etbs: [{ id: 'sv-surging-sparks-etb', name: 'Surging Sparks ETB', market: 115, buy: 75, term: 'surging sparks' }] },
  { id: 'sv-prismatic-evolutions', name: 'Prismatic Evolutions', shortName: 'prismatic evolutions', era: ERAS.SV, isSpecial: true, bundleMarket: 120, bundleBuy: 75, etbs: [{ id: 'sv-prismatic-evolutions-etb', name: 'Prismatic Evolutions ETB', market: 105, buy: 85, term: 'prismatic evolutions' }] },
  { id: 'sv-journey-together', name: 'Journey Together', shortName: 'journey together', era: ERAS.SV, isSpecial: false, boxMarket: 200, boxBuy: 175, bundleMarket: 40, bundleBuy: 34, etbs: [{ id: 'sv-journey-together-etb', name: 'Journey Together ETB', market: 65, buy: 58, term: 'journey together' }] },
  { id: 'sv-destined-rivals', name: 'Destined Rivals', shortName: 'destined rivals', era: ERAS.SV, isSpecial: false, boxMarket: 410, boxBuy: 275, bundleMarket: 55, bundleBuy: 40, etbs: [{ id: 'sv-destined-rivals-etb', name: 'Destined Rivals ETB', market: 115, buy: 75, term: 'destined rivals' }] },

  // --- Sword & Shield Vault (2021-2023) ---
  { id: 'swsh-battle-styles', name: 'Battle Styles', shortName: 'battle styles', era: ERAS.SWSH, isSpecial: false, boxMarket: 160, boxBuy: 140, etbs: [
    { id: 'swsh-battle-styles-single-etb', name: 'Battle Styles ETB (Single Strike Red)', market: 55, buy: 48, term: '(battle styles.*single|single strike)' },
    { id: 'swsh-battle-styles-rapid-etb', name: 'Battle Styles ETB (Rapid Strike Blue)', market: 55, buy: 48, term: '(battle styles.*rapid|rapid strike)' }
  ]},
  { id: 'swsh-chilling-reign', name: 'Chilling Reign', shortName: 'chilling reign', era: ERAS.SWSH, isSpecial: false, boxMarket: 260, boxBuy: 210, etbs: [
    { id: 'swsh-chilling-reign-shadow-etb', name: 'Chilling Reign ETB (Shadow Rider)', market: 75, buy: 60, term: '(chilling reign.*shadow|shadow rider)' },
    { id: 'swsh-chilling-reign-ice-etb', name: 'Chilling Reign ETB (Ice Rider)', market: 75, buy: 60, term: '(chilling reign.*ice|ice rider)' }
  ]},
  { id: 'swsh-evolving-skies', name: 'Evolving Skies', shortName: 'evolving skies', era: ERAS.SWSH, isSpecial: false, boxMarket: 920, boxBuy: 650, etbs: [{ id: 'swsh-evolving-skies-etb', name: 'Evolving Skies ETB', market: 180, buy: 120, term: 'evolving skies' }] },
  { id: 'swsh-celebrations', name: 'Celebrations 25th Anniversary', shortName: 'celebrations', era: ERAS.SWSH, isSpecial: true, etbs: [{ id: 'swsh-celebrations-etb', name: 'Celebrations 25th Anniversary ETB', market: 95, buy: 80, term: 'celebrations' }] },
  { id: 'swsh-fusion-strike', name: 'Fusion Strike', shortName: 'fusion strike', era: ERAS.SWSH, isSpecial: false, boxMarket: 280, boxBuy: 220, etbs: [{ id: 'swsh-fusion-strike-etb', name: 'Fusion Strike ETB', market: 75, buy: 60, term: 'fusion strike' }] },
  { id: 'swsh-brilliant-stars', name: 'Brilliant Stars', shortName: 'brilliant stars', era: ERAS.SWSH, isSpecial: false, boxMarket: 230, boxBuy: 190, etbs: [{ id: 'swsh-brilliant-stars-etb', name: 'Brilliant Stars ETB', market: 65, buy: 55, term: 'brilliant stars' }] },
  { id: 'swsh-astral-radiance', name: 'Astral Radiance', shortName: 'astral radiance', era: ERAS.SWSH, isSpecial: false, boxMarket: 190, boxBuy: 170, etbs: [{ id: 'swsh-astral-radiance-etb', name: 'Astral Radiance ETB', market: 60, buy: 52, term: 'astral radiance' }] },
  { id: 'swsh-pokemon-go', name: 'Pokemon GO', shortName: 'pok(e|é)mon go', era: ERAS.SWSH, isSpecial: true, etbs: [{ id: 'swsh-pokemon-go-etb', name: 'Pokemon GO ETB', market: 65, buy: 55, term: 'pok(e|é)mon go' }] },
  { id: 'swsh-lost-origin', name: 'Lost Origin', shortName: 'lost origin', era: ERAS.SWSH, isSpecial: false, boxMarket: 240, boxBuy: 190, etbs: [{ id: 'swsh-lost-origin-etb', name: 'Lost Origin ETB', market: 70, buy: 55, term: 'lost origin' }] },
  { id: 'swsh-silver-tempest', name: 'Silver Tempest', shortName: 'silver tempest', era: ERAS.SWSH, isSpecial: false, boxMarket: 195, boxBuy: 175, etbs: [{ id: 'swsh-silver-tempest-etb', name: 'Silver Tempest ETB', market: 60, buy: 52, term: 'silver tempest' }] },
  { id: 'swsh-crown-zenith', name: 'Crown Zenith', shortName: 'crown zenith', era: ERAS.SWSH, isSpecial: true, bundleMarket: 50, bundleBuy: 38, etbs: [{ id: 'swsh-crown-zenith-etb', name: 'Crown Zenith ETB (Lucario)', market: 95, buy: 75, term: 'crown zenith' }] }
];

const catalog = [];

SETS.forEach(set => {
  const cleanTerm = set.shortName;
  const etbPattern = '(etb|elite trainer( box)?)';

  // 1A. 6-Box Sealed Booster Master Cases (Placed FIRST so "Case" matches before single Booster Box)
  if (!set.isSpecial && set.boxMarket) {
    const caseId = `${set.id}-booster-case`;
    const prevCase = existingMap[caseId] || {};
    catalog.push({
      id: caseId,
      name: `${set.name} Sealed Booster Case (6 Boxes / 216 Packs)`,
      era: set.era,
      formFactor: 'Master Case',
      image: prevCase.image || '',
      matchers: [`case.*${cleanTerm}.*booster`, `${cleanTerm}.*booster.*case`],
      minStock: 1,
      msrpCeiling: set.era === ERAS.SWSH ? 860.00 : 970.00,
      maxMarketBuyPrice: prevCase.maxMarketBuyPrice ?? Math.round(set.boxBuy * 5.8),
      estimatedMarketValue: Math.round(set.boxMarket * 6.0),
      priority: 'GRAIL',
      cooldownMins: 60,
      active: prevCase.active ?? true
    });
  }

  // 1B. 10-ETB Sealed Master Cases (Placed BEFORE single ETBs so "ETB Case" matches the 10-ETB Case rule!)
  set.etbs.forEach(etb => {
    const etbCaseId = `${etb.id}-case`;
    const prevEtbCase = existingMap[etbCaseId] || {};
    catalog.push({
      id: etbCaseId,
      name: `${etb.name} Sealed Case (10 ETBs)`,
      era: set.era,
      formFactor: 'Master Case',
      image: prevEtbCase.image || '',
      matchers: [
        `case.*${etb.term}.*${etbPattern}`,
        `${etb.term}.*${etbPattern}.*case`,
        `${etb.term}.*case.*${etbPattern}`
      ],
      minStock: 1,
      msrpCeiling: set.era === ERAS.SWSH ? 499.90 : 549.90,
      maxMarketBuyPrice: prevEtbCase.maxMarketBuyPrice ?? Math.round(etb.buy * 9.5),
      estimatedMarketValue: Math.round(etb.market * 10.0),
      priority: 'GRAIL',
      cooldownMins: 60,
      active: prevEtbCase.active ?? true
    });
  });

  // 2. 36-Pack Booster Boxes
  if (!set.isSpecial && set.boxMarket) {
    const boxId = `${set.id}-booster-box`;
    const prevBox = existingMap[boxId] || {};
    catalog.push({
      id: boxId,
      name: `${set.name} Booster Box (36-Pack)`,
      era: set.era,
      formFactor: 'Booster Box',
      image: prevBox.image || '',
      matchers: [`${cleanTerm}.*booster box`, `booster box.*${cleanTerm}`],
      minStock: 1,
      msrpCeiling: set.era === ERAS.SWSH ? 143.64 : 161.64,
      maxMarketBuyPrice: prevBox.maxMarketBuyPrice ?? set.boxBuy,
      estimatedMarketValue: set.boxMarket,
      priority: set.boxMarket > 220 ? 'GRAIL' : 'STANDARD',
      cooldownMins: 30,
      active: prevBox.active ?? true
    });
  }

  // 3. Single ETB Variants
  set.etbs.forEach(etb => {
    const prevEtb = existingMap[etb.id] || {};
    catalog.push({
      id: etb.id,
      name: etb.name,
      era: set.era,
      formFactor: 'ETB',
      image: prevEtb.image || '',
      matchers: [`${etb.term}.*${etbPattern}`, `${etbPattern}.*${etb.term}`],
      minStock: 1,
      msrpCeiling: set.era === ERAS.SWSH ? 49.99 : 54.99,
      maxMarketBuyPrice: prevEtb.maxMarketBuyPrice ?? etb.buy,
      estimatedMarketValue: etb.market,
      priority: etb.market > 80 ? 'GRAIL' : 'STANDARD',
      cooldownMins: 30,
      active: prevEtb.active ?? true,
      owned: prevEtb.owned ?? false
    });
  });

  // 4. 6-Pack Booster Bundles
  if (set.bundleMarket) {
    const bundleId = `${set.id}-bundle`;
    const prevBundle = existingMap[bundleId] || {};
    catalog.push({
      id: bundleId,
      name: `${set.name} 6-Pack Booster Bundle`,
      era: set.era,
      formFactor: 'Booster Bundle',
      image: prevBundle.image || '',
      matchers: [`${cleanTerm}.*booster bundle`, `booster bundle.*${cleanTerm}`],
      minStock: 1,
      msrpCeiling: 32.00,
      maxMarketBuyPrice: prevBundle.maxMarketBuyPrice ?? set.bundleBuy,
      estimatedMarketValue: set.bundleMarket,
      priority: 'GRAIL',
      cooldownMins: 45,
      active: prevBundle.active ?? true
    });
  }
});

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2), 'utf-8');
console.log(`Generated unified catalog with ${catalog.length} items (including 10-ETB Cases) into policies.json`);
'@

[System.IO.File]::WriteAllText("C:\pokemon-drop-bot\generateMatrix.js", $matrixCode,$utf8NoBom)
node C:\pokemon-drop-bot\generateMatrix.js