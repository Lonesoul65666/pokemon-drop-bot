const fs = require('fs');
const path = require('path');

const OUTPUT_PATH = path.resolve(__dirname, 'policies.json');

const ERAS = {
  MEGA: 'Mega Evolution (2025-2026)',
  SV: 'Scarlet & Violet (2023-2025)',
  SWSH: 'Sword & Shield Vault (2021-2023)'
};

// Master database of sets and configs
const SETS = [
  // --- Mega Evolution (2025-2026) ---
  { id: 'me-discovery', name: 'Mega Evolution: Mega Discovery', era: ERAS.MEGA, isSpecial: false, boxMarket: 210, boxBuy: 180, etbs: [{ id: 'me-discovery-etb', name: 'Mega Discovery ETB (Mega Lucario)', market: 85, buy: 70, matchers: ['(mega discovery|discovery).*etb', 'etb.*(mega discovery|discovery)', 'lucario.*mega.*etb'] }] },
  { id: 'me-pitch-black', name: 'Mega Evolution: Pitch Black', era: ERAS.MEGA, isSpecial: false, boxMarket: 220, boxBuy: 190, etbs: [{ id: 'me-pitch-black-etb', name: 'Mega Evolution: Pitch Black ETB', market: 80, buy: 70, matchers: ['pitch black.*etb', 'etb.*pitch black'] }] },
  { id: 'me-phantasmal-flames', name: 'Mega Evolution: Phantasmal Flames', era: ERAS.MEGA, isSpecial: false, boxMarket: 390, boxBuy: 260, etbs: [{ id: 'me-phantasmal-flames-etb', name: 'Mega Evolution: Phantasmal Flames ETB', market: 145, buy: 95, matchers: ['phantasmal flames.*etb', 'etb.*phantasmal flames'] }] },
  { id: 'me-perfect-order', name: 'Mega Evolution: Perfect Order', era: ERAS.MEGA, isSpecial: false, boxMarket: 190, boxBuy: 175, etbs: [{ id: 'me-perfect-order-etb', name: 'Mega Evolution: Perfect Order ETB', market: 65, buy: 58, matchers: ['perfect order.*etb', 'etb.*perfect order'] }] },
  { id: 'me-chaos-rising', name: 'Mega Evolution: Chaos Rising', era: ERAS.MEGA, isSpecial: false, boxMarket: 190, boxBuy: 175, etbs: [{ id: 'me-chaos-rising-etb', name: 'Mega Evolution: Chaos Rising ETB', market: 65, buy: 58, matchers: ['chaos rising.*etb', 'etb.*chaos rising'] }] },
  { id: 'me-delta-reign', name: 'Mega Evolution: Delta Reign', era: ERAS.MEGA, isSpecial: false, boxMarket: 180, boxBuy: 165, etbs: [{ id: 'me-delta-reign-etb', name: 'Mega Evolution: Delta Reign ETB', market: 60, buy: 55, matchers: ['delta reign.*etb', 'etb.*delta reign'] }] },
  { id: 'me-ascended-heroes', name: 'Mega Evolution: Ascended Heroes', era: ERAS.MEGA, isSpecial: true, bundleMarket: 45, bundleBuy: 35, etbs: [{ id: 'me-ascended-heroes-etb', name: 'Mega Evolution: Ascended Heroes ETB', market: 90, buy: 75, matchers: ['ascended heroes.*etb', 'etb.*ascended heroes'] }] },
  { id: 'me-30th-celebration', name: '30th Celebration', era: ERAS.MEGA, isSpecial: true, bundleMarket: 45, bundleBuy: 35, etbs: [{ id: 'me-30th-celebration-etb', name: '30th Celebration ETB', market: 55, buy: 52, matchers: ['30th.*(celebration|anniversary).*etb', 'etb.*30th'] }] },

  // --- Scarlet & Violet (2023-2025) ---
  { id: 'sv-base', name: 'Scarlet & Violet Base', era: ERAS.SV, isSpecial: false, boxMarket: 145, boxBuy: 135, etbs: [
    { id: 'sv-base-koraidon-etb', name: 'Scarlet & Violet Base ETB (Koraidon)', market: 55, buy: 48, matchers: ['scarlet.*violet.*(base)?.*koraidon.*etb', 'koraidon.*etb'] },
    { id: 'sv-base-miraidon-etb', name: 'Scarlet & Violet Base ETB (Miraidon)', market: 55, buy: 48, matchers: ['scarlet.*violet.*(base)?.*miraidon.*etb', 'miraidon.*etb'] }
  ]},
  { id: 'sv-paldea-evolved', name: 'Paldea Evolved', era: ERAS.SV, isSpecial: false, boxMarket: 210, boxBuy: 185, etbs: [{ id: 'sv-paldea-evolved-etb', name: 'Paldea Evolved ETB', market: 65, buy: 58, matchers: ['paldea evolved.*etb', 'etb.*paldea evolved'] }] },
  { id: 'sv-obsidian-flames', name: 'Obsidian Flames', era: ERAS.SV, isSpecial: false, boxMarket: 150, boxBuy: 140, etbs: [{ id: 'sv-obsidian-flames-etb', name: 'Obsidian Flames ETB', market: 55, buy: 50, matchers: ['obsidian flames.*etb', 'etb.*obsidian flames'] }] },
  { id: 'sv-151', name: 'Scarlet & Violet: 151', era: ERAS.SV, isSpecial: true, bundleMarket: 162, bundleBuy: 90, etbs: [{ id: 'sv-151-etb', name: 'Scarlet & Violet: 151 ETB', market: 110, buy: 85, matchers: ['(151).*etb', 'etb.*(151)'] }] },
  { id: 'sv-paradox-rift', name: 'Paradox Rift', era: ERAS.SV, isSpecial: false, boxMarket: 160, boxBuy: 145, etbs: [
    { id: 'sv-paradox-rift-roaring-etb', name: 'Paradox Rift ETB (Roaring Moon)', market: 55, buy: 50, matchers: ['paradox rift.*roaring.*etb', 'roaring moon.*etb'] },
    { id: 'sv-paradox-rift-valiant-etb', name: 'Paradox Rift ETB (Iron Valiant)', market: 55, buy: 50, matchers: ['paradox rift.*valiant.*etb', 'iron valiant.*etb'] }
  ]},
  { id: 'sv-paldean-fates', name: 'Paldean Fates', era: ERAS.SV, isSpecial: true, bundleMarket: 42, bundleBuy: 32, etbs: [{ id: 'sv-paldean-fates-etb', name: 'Paldean Fates ETB', market: 65, buy: 55, matchers: ['paldean fates.*etb', 'etb.*paldean fates'] }] },
  { id: 'sv-temporal-forces', name: 'Temporal Forces', era: ERAS.SV, isSpecial: false, boxMarket: 165, boxBuy: 150, etbs: [
    { id: 'sv-temporal-forces-wake-etb', name: 'Temporal Forces ETB (Walking Wake)', market: 55, buy: 50, matchers: ['temporal forces.*wake.*etb', 'walking wake.*etb'] },
    { id: 'sv-temporal-forces-leaves-etb', name: 'Temporal Forces ETB (Iron Leaves)', market: 55, buy: 50, matchers: ['temporal forces.*leaves.*etb', 'iron leaves.*etb'] }
  ]},
  { id: 'sv-twilight-masquerade', name: 'Twilight Masquerade', era: ERAS.SV, isSpecial: false, boxMarket: 185, boxBuy: 165, etbs: [{ id: 'sv-twilight-masquerade-etb', name: 'Twilight Masquerade ETB', market: 60, buy: 55, matchers: ['twilight masquerade.*etb', 'etb.*twilight masquerade'] }] },
  { id: 'sv-shrouded-fable', name: 'Shrouded Fable', era: ERAS.SV, isSpecial: true, bundleMarket: 35, bundleBuy: 28, etbs: [{ id: 'sv-shrouded-fable-etb', name: 'Shrouded Fable ETB', market: 55, buy: 48, matchers: ['shrouded fable.*etb', 'etb.*shrouded fable'] }] },
  { id: 'sv-stellar-crown', name: 'Stellar Crown', era: ERAS.SV, isSpecial: false, boxMarket: 160, boxBuy: 145, etbs: [{ id: 'sv-stellar-crown-etb', name: 'Stellar Crown ETB', market: 55, buy: 50, matchers: ['stellar crown.*etb', 'etb.*stellar crown'] }] },
  { id: 'sv-surging-sparks', name: 'Surging Sparks', era: ERAS.SV, isSpecial: false, boxMarket: 255, boxBuy: 210, etbs: [{ id: 'sv-surging-sparks-etb', name: 'Surging Sparks ETB', market: 75, buy: 62, matchers: ['surging sparks.*etb', 'etb.*surging sparks'] }] },
  { id: 'sv-prismatic-evolutions', name: 'Prismatic Evolutions', era: ERAS.SV, isSpecial: true, bundleMarket: 120, bundleBuy: 75, etbs: [{ id: 'sv-prismatic-evolutions-etb', name: 'Prismatic Evolutions ETB', market: 105, buy: 85, matchers: ['prismatic evolutions.*etb', 'etb.*prismatic evolutions'] }] },
  { id: 'sv-journey-together', name: 'Journey Together', era: ERAS.SV, isSpecial: false, boxMarket: 200, boxBuy: 175, etbs: [{ id: 'sv-journey-together-etb', name: 'Journey Together ETB', market: 65, buy: 58, matchers: ['journey together.*etb', 'etb.*journey together'] }] },
  { id: 'sv-destined-rivals', name: 'Destined Rivals', era: ERAS.SV, isSpecial: false, boxMarket: 410, boxBuy: 275, etbs: [{ id: 'sv-destined-rivals-etb', name: 'Destined Rivals ETB', market: 115, buy: 75, matchers: ['destined rivals.*etb', 'etb.*destined rivals'] }] },

  // --- Sword & Shield Vault (2021-2023) ---
  { id: 'swsh-battle-styles', name: 'Battle Styles', era: ERAS.SWSH, isSpecial: false, boxMarket: 160, boxBuy: 140, etbs: [
    { id: 'swsh-battle-styles-single-etb', name: 'Battle Styles ETB (Single Strike Red)', market: 55, buy: 48, matchers: ['battle styles.*single.*etb', 'single strike.*etb'] },
    { id: 'swsh-battle-styles-rapid-etb', name: 'Battle Styles ETB (Rapid Strike Blue)', market: 55, buy: 48, matchers: ['battle styles.*rapid.*etb', 'rapid strike.*etb'] }
  ]},
  { id: 'swsh-chilling-reign', name: 'Chilling Reign', era: ERAS.SWSH, isSpecial: false, boxMarket: 260, boxBuy: 210, etbs: [
    { id: 'swsh-chilling-reign-shadow-etb', name: 'Chilling Reign ETB (Shadow Rider)', market: 75, buy: 60, matchers: ['chilling reign.*shadow.*etb', 'shadow rider.*etb'] },
    { id: 'swsh-chilling-reign-ice-etb', name: 'Chilling Reign ETB (Ice Rider)', market: 75, buy: 60, matchers: ['chilling reign.*ice.*etb', 'ice rider.*etb'] }
  ]},
  { id: 'swsh-evolving-skies', name: 'Evolving Skies', era: ERAS.SWSH, isSpecial: false, boxMarket: 920, boxBuy: 650, etbs: [{ id: 'swsh-evolving-skies-etb', name: 'Evolving Skies ETB', market: 180, buy: 120, matchers: ['evolving skies.*etb', 'etb.*evolving skies'] }] },
  { id: 'swsh-celebrations', name: 'Celebrations 25th Anniversary', era: ERAS.SWSH, isSpecial: true, etbs: [{ id: 'swsh-celebrations-etb', name: 'Celebrations 25th Anniversary ETB', market: 95, buy: 80, matchers: ['celebrations.*25th.*etb', 'celebrations.*etb'] }] },
  { id: 'swsh-fusion-strike', name: 'Fusion Strike', era: ERAS.SWSH, isSpecial: false, boxMarket: 280, boxBuy: 220, etbs: [{ id: 'swsh-fusion-strike-etb', name: 'Fusion Strike ETB', market: 75, buy: 60, matchers: ['fusion strike.*etb', 'etb.*fusion strike'] }] },
  { id: 'swsh-brilliant-stars', name: 'Brilliant Stars', era: ERAS.SWSH, isSpecial: false, boxMarket: 230, boxBuy: 190, etbs: [{ id: 'swsh-brilliant-stars-etb', name: 'Brilliant Stars ETB', market: 65, buy: 55, matchers: ['brilliant stars.*etb', 'etb.*brilliant stars'] }] },
  { id: 'swsh-astral-radiance', name: 'Astral Radiance', era: ERAS.SWSH, isSpecial: false, boxMarket: 190, boxBuy: 170, etbs: [{ id: 'swsh-astral-radiance-etb', name: 'Astral Radiance ETB', market: 60, buy: 52, matchers: ['astral radiance.*etb', 'etb.*astral radiance'] }] },
  { id: 'swsh-pokemon-go', name: 'Pokémon GO', era: ERAS.SWSH, isSpecial: true, etbs: [{ id: 'swsh-pokemon-go-etb', name: 'Pokémon GO ETB', market: 65, buy: 55, matchers: ['(pokemon|pokémon) go.*etb', 'etb.*(pokemon|pokémon) go'] }] },
  { id: 'swsh-lost-origin', name: 'Lost Origin', era: ERAS.SWSH, isSpecial: false, boxMarket: 240, boxBuy: 190, etbs: [{ id: 'swsh-lost-origin-etb', name: 'Lost Origin ETB', market: 70, buy: 55, matchers: ['lost origin.*etb', 'etb.*lost origin'] }] },
  { id: 'swsh-silver-tempest', name: 'Silver Tempest', era: ERAS.SWSH, isSpecial: false, boxMarket: 195, boxBuy: 175, etbs: [{ id: 'swsh-silver-tempest-etb', name: 'Silver Tempest ETB', market: 60, buy: 52, matchers: ['silver tempest.*etb', 'etb.*silver tempest'] }] },
  { id: 'swsh-crown-zenith', name: 'Crown Zenith', era: ERAS.SWSH, isSpecial: true, bundleMarket: 50, bundleBuy: 38, etbs: [{ id: 'swsh-crown-zenith-etb', name: 'Crown Zenith ETB (Lucario)', market: 95, buy: 75, matchers: ['crown zenith.*etb', 'etb.*crown zenith', 'lucario.*crown zenith.*etb'] }] }
];

const catalog = [];

SETS.forEach(set => {
  const cleanTerm = set.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

  // 1. 36-Pack Booster Boxes & 6-Box Sealed Cases (Mainline sets only)
  if (!set.isSpecial && set.boxMarket) {
    catalog.push({
      id: `${set.id}-booster-box`,
      name: `${set.name} Booster Box (36-Pack)`,
      era: set.era,
      formFactor: 'Booster Box',
      image: '',
      matchers: [`${cleanTerm}.*booster box`, `booster box.*${cleanTerm}`],
      minStock: 1,
      msrpCeiling: set.era === ERAS.SWSH ? 143.64 : 161.64,
      maxMarketBuyPrice: set.boxBuy,
      estimatedMarketValue: set.boxMarket,
      priority: set.boxMarket > 220 ? 'GRAIL' : 'STANDARD',
      cooldownMins: 30,
      active: true
    });

    catalog.push({
      id: `${set.id}-booster-case`,
      name: `${set.name} Sealed Booster Case (6 Boxes / 216 Packs)`,
      era: set.era,
      formFactor: 'Master Case',
      image: '',
      matchers: [`case.*${cleanTerm}.*booster`, `${cleanTerm}.*booster.*case`],
      minStock: 1,
      msrpCeiling: set.era === ERAS.SWSH ? 860.00 : 970.00,
      maxMarketBuyPrice: Math.round(set.boxBuy * 5.8),
      estimatedMarketValue: Math.round(set.boxMarket * 6.0),
      priority: 'GRAIL',
      cooldownMins: 60,
      active: true
    });
  }

  // 2. All ETB Variants for this set
  set.etbs.forEach(etb => {
    catalog.push({
      id: etb.id,
      name: etb.name,
      era: set.era,
      formFactor: 'ETB',
      image: '',
      matchers: etb.matchers,
      minStock: 1,
      msrpCeiling: set.era === ERAS.SWSH ? 49.99 : 54.99,
      maxMarketBuyPrice: etb.buy,
      estimatedMarketValue: etb.market,
      priority: etb.market > 80 ? 'GRAIL' : 'STANDARD',
      cooldownMins: 30,
      active: true,
      owned: false
    });
  });

  // 3. 6-Pack Booster Bundles (Special sets or sets with bundles)
  if (set.bundleMarket) {
    catalog.push({
      id: `${set.id}-bundle`,
      name: `${set.name} 6-Pack Booster Bundle`,
      era: set.era,
      formFactor: 'Booster Bundle',
      image: '',
      matchers: [`${cleanTerm}.*booster bundle`, `booster bundle.*${cleanTerm}`],
      minStock: 1,
      msrpCeiling: 32.00,
      maxMarketBuyPrice: set.bundleBuy,
      estimatedMarketValue: set.bundleMarket,
      priority: 'GRAIL',
      cooldownMins: 45,
      active: true
    });
  }
});

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2), 'utf-8');
console.log(`Generated unified catalog with ${catalog.length} items across all 4 form factors into policies.json`);