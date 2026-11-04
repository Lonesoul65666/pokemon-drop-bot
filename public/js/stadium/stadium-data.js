/* =========================================================================
 * LOGAN'S BATTLE STADIUM — DATA & POKÉDEX ENGINE (stadium-data.js)
 * 18-Type Effectiveness Matrix, Signature Moves, 3v3 Preset Decks,
 * Champion Gauntlet Boss Roster & 1,025 Pokédex/Evolution Lookup Helpers.
 * Hard-Frozen in V5 Slice 2.
 * ========================================================================= */
/* =========================================================================
 * === MODULE: POKEDEX BATTLE STADIUM ENGINE (STANDALONE-READY) ===
 * Cleanly encapsulated 18-Type Matchup Matrix, 1,025-Species Pokédex Loader,
 * Dual Partner Evolution Engine, Interactive Turn-Based Battle Stadium, and
 * WebAudio Cry Synthesizer. Ready for standalone extraction or repo sync.
 * ========================================================================= */
const ELEMENTAL_SPECTRUM = {
  water:    { hex: '#00F0FF', rgb: '0, 240, 255',   secondary: '#3B82F6', label: 'WATER',    badgeCls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  fire:     { hex: '#F97316', rgb: '249, 115, 22',  secondary: '#FACC15', label: 'FIRE',     badgeCls: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  dark:     { hex: '#F43F5E', rgb: '244, 63, 94',   secondary: '#CBD5E1', label: 'DARK',     badgeCls: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  electric: { hex: '#FACC15', rgb: '250, 204, 21',  secondary: '#A855F7', label: 'ELECTRIC', badgeCls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  poison:   { hex: '#C084FC', rgb: '192, 132, 252', secondary: '#4ADE80', label: 'POISON',   badgeCls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  psychic:  { hex: '#E879F9', rgb: '232, 121, 249', secondary: '#8B5CF6', label: 'PSYCHIC',  badgeCls: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' },
  dragon:   { hex: '#6366F1', rgb: '99, 102, 241',  secondary: '#FACC15', label: 'DRAGON',   badgeCls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  grass:    { hex: '#10B981', rgb: '16, 185, 129',  secondary: '#34D399', label: 'GRASS',    badgeCls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  normal:   { hex: '#E2E8F0', rgb: '226, 232, 240', secondary: '#F59E0B', label: 'NORMAL',   badgeCls: 'bg-slate-500/20 text-slate-200 border-slate-400/30' },
  fairy:    { hex: '#F472B6', rgb: '244, 114, 182', secondary: '#38BDF8', label: 'FAIRY',    badgeCls: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
  flying:   { hex: '#38BDF8', rgb: '56, 189, 248',  secondary: '#FBBF24', label: 'FLYING',   badgeCls: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  fighting: { hex: '#FB7185', rgb: '251, 113, 133', secondary: '#F97316', label: 'FIGHTING', badgeCls: 'bg-rose-500/20 text-rose-300 border-rose-500/30' },
  rock:     { hex: '#D97706', rgb: '217, 119, 6',   secondary: '#FBBF24', label: 'ROCK',     badgeCls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  ground:   { hex: '#EA580C', rgb: '234, 88, 12',   secondary: '#FDE047', label: 'GROUND',   badgeCls: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  steel:    { hex: '#94A3B8', rgb: '148, 163, 184', secondary: '#38BDF8', label: 'STEEL',    badgeCls: 'bg-slate-500/20 text-slate-200 border-slate-400/30' },
  ice:      { hex: '#67E8F9', rgb: '103, 232, 249', secondary: '#38BDF8', label: 'ICE',      badgeCls: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/30' },
  ghost:    { hex: '#A855F7', rgb: '168, 85, 247',  secondary: '#EC4899', label: 'GHOST',    badgeCls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  bug:      { hex: '#84CC16', rgb: '132, 204, 22',  secondary: '#10B981', label: 'BUG',      badgeCls: 'bg-lime-500/20 text-lime-300 border-lime-500/30' }
};

const TYPE_CHART_18 = {
  normal:   { rock: 0.5, ghost: 0, steel: 0.5 },
  fire:     { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water:    { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass:    { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice:      { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison:   { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground:   { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying:   { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic:  { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug:      { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock:     { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost:    { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon:   { dragon: 2, steel: 0.5, fairy: 0 },
  dark:     { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel:    { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy:    { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
};

function calcBestOffensiveMultiplier(attackerTypes, defenderTypes) {
  const atkArr = Array.isArray(attackerTypes) && attackerTypes.length ? attackerTypes : ['normal'];
  const defArr = Array.isArray(defenderTypes) && defenderTypes.length ? defenderTypes : ['normal'];
  let best = 0;
  atkArr.forEach(atk => {
    const row = TYPE_CHART_18[String(atk).toLowerCase()] || {};
    let mult = 1;
    defArr.forEach(def => {
      const d = String(def).toLowerCase();
      if (row[d] !== undefined) mult *= row[d];
    });
    if (mult > best) best = mult;
  });
  return best;
}

function getTypeMatchup(slot1Types, slot2Types) {
  const s1Mult = calcBestOffensiveMultiplier(slot1Types, slot2Types);
  const s2Mult = calcBestOffensiveMultiplier(slot2Types, slot1Types);

  // Case A: Slot 1 Has Type Advantage (> 1x and >= Slot 2) -> Flush Seam (X1=68% top, X2=46% bottom)
  if (s1Mult > 1 && s1Mult >= s2Mult) {
    return {
      winner: 1,
      slot1Mult: s1Mult,
      slot2Mult: s2Mult,
      overlayClass: 'matchup-slot1-high',
      clashAngle: '125deg',
      seamX1: '68%',
      seamX2: '46%',
      bannerText: 'HIGH GROUND ADVANTAGE • ' + s1Mult + 'x SUPER EFFECTIVE',
      leftSub: 'HIGH GROUND ADVANTAGE • ' + s1Mult + 'x SUPER EFFECTIVE',
      rightSub: 'LOW GROUND DEFENSE • ' + (s2Mult < 1 ? (s2Mult + 'x RESISTED') : (s2Mult + 'x NEUTRAL')),
      callsignSuffix: s1Mult + 'x High Ground (Slot 1)',
      verdictShort: s1Mult + 'x SLOT 1'
    };
  }

  // Case B: Slot 2 Has Type Advantage (> 1x over Slot 1) -> Flush Seam (X1=54% top, X2=32% bottom)
  if (s2Mult > 1 && s2Mult > s1Mult) {
    return {
      winner: 2,
      slot1Mult: s1Mult,
      slot2Mult: s2Mult,
      overlayClass: 'matchup-slot2-high',
      clashAngle: '55deg',
      seamX1: '54%',
      seamX2: '32%',
      bannerText: 'HIGH GROUND ADVANTAGE • ' + s2Mult + 'x SUPER EFFECTIVE',
      leftSub: 'LOW GROUND DEFENSE • ' + (s1Mult < 1 ? (s1Mult + 'x RESISTED') : (s1Mult + 'x NEUTRAL')),
      rightSub: 'HIGH GROUND ADVANTAGE • ' + s2Mult + 'x SUPER EFFECTIVE',
      callsignSuffix: s2Mult + 'x High Ground (Slot 2)',
      verdictShort: s2Mult + 'x SLOT 2'
    };
  }

  // Case C: Neutral Matchup (1x) -> Balanced Flush Seam (X1=56% top, X2=44% bottom)
  return {
    winner: 0,
    slot1Mult: s1Mult,
    slot2Mult: s2Mult,
    overlayClass: 'matchup-neutral',
    clashAngle: '115deg',
    seamX1: '56%',
    seamX2: '44%',
    bannerText: 'BALANCED ELEMENTAL CLASH • 1x NEUTRAL MATCHUP',
    leftSub: 'SLOT 1 VANGUARD • ' + s1Mult + 'x EVEN CLASH',
    rightSub: 'SLOT 2 STRIKER • ' + s2Mult + 'x EVEN CLASH',
    callsignSuffix: 'Balanced 50/50 Arena',
    verdictShort: '1x EVEN'
  };
}

const HALL_OF_FAME_DEX = {
  129: { id: 129, name: 'Magikarp',   type: 'water',    types: ['water'],           nextId: 130,  baseId: 129, chain: [129, 130], stats: { hp: 20, atk: 10, def: 55, spa: 15, spd: 20, spe: 80, bst: 200 }, abilities: ['Swift Swim', 'Rattled'] },
  130: { id: 130, name: 'Gyarados',   type: 'water',    types: ['water', 'flying'], nextId: null, baseId: 129, chain: [129, 130], stats: { hp: 95, atk: 125, def: 79, spa: 60, spd: 100, spe: 81, bst: 540 }, abilities: ['Intimidate', 'Moxie'] },
  58:  { id: 58,  name: 'Growlithe',  type: 'fire',     types: ['fire'],            nextId: 59,   baseId: 58,  chain: [58, 59],   stats: { hp: 55, atk: 70, def: 45, spa: 70, spd: 50, spe: 60, bst: 350 }, abilities: ['Intimidate', 'Flash Fire'] },
  59:  { id: 59,  name: 'Arcanine',   type: 'fire',     types: ['fire'],            nextId: null, baseId: 58,  chain: [58, 59],   stats: { hp: 90, atk: 110, def: 80, spa: 100, spd: 80, spe: 95, bst: 555 }, abilities: ['Intimidate', 'Flash Fire'] },
  7:   { id: 7,   name: 'Squirtle',   type: 'water',    types: ['water'],           nextId: 8,    baseId: 7,   chain: [7, 8, 9],  stats: { hp: 44, atk: 48, def: 65, spa: 50, spd: 64, spe: 43, bst: 314 }, abilities: ['Torrent', 'Rain Dish'] },
  8:   { id: 8,   name: 'Wartortle',  type: 'water',    types: ['water'],           nextId: 9,    baseId: 7,   chain: [7, 8, 9],  stats: { hp: 59, atk: 63, def: 80, spa: 65, spd: 80, spe: 58, bst: 405 }, abilities: ['Torrent', 'Rain Dish'] },
  9:   { id: 9,   name: 'Blastoise',  type: 'water',    types: ['water'],           nextId: null, baseId: 7,   chain: [7, 8, 9],  stats: { hp: 79, atk: 83, def: 100, spa: 85, spd: 105, spe: 78, bst: 530 }, abilities: ['Torrent', 'Rain Dish'] },
  4:   { id: 4,   name: 'Charmander', type: 'fire',     types: ['fire'],            nextId: 5,    baseId: 4,   chain: [4, 5, 6],  stats: { hp: 39, atk: 52, def: 43, spa: 60, spd: 50, spe: 65, bst: 309 }, abilities: ['Blaze', 'Solar Power'] },
  5:   { id: 5,   name: 'Charmeleon', type: 'fire',     types: ['fire'],            nextId: 6,    baseId: 4,   chain: [4, 5, 6],  stats: { hp: 58, atk: 64, def: 58, spa: 80, spd: 65, spe: 80, bst: 405 }, abilities: ['Blaze', 'Solar Power'] },
  6:   { id: 6,   name: 'Charizard',  type: 'fire',     types: ['fire', 'flying'],  nextId: null, baseId: 4,   chain: [4, 5, 6],  stats: { hp: 78, atk: 84, def: 78, spa: 109, spd: 85, spe: 100, bst: 534 }, abilities: ['Blaze', 'Solar Power'] },
  1:   { id: 1,   name: 'Bulbasaur',  type: 'grass',    types: ['grass', 'poison'], nextId: 2,    baseId: 1,   chain: [1, 2, 3],  stats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45, bst: 318 }, abilities: ['Overgrow', 'Chlorophyll'] },
  2:   { id: 2,   name: 'Ivysaur',    type: 'grass',    types: ['grass', 'poison'], nextId: 3,    baseId: 1,   chain: [1, 2, 3],  stats: { hp: 60, atk: 62, def: 63, spa: 80, spd: 80, spe: 60, bst: 405 }, abilities: ['Overgrow', 'Chlorophyll'] },
  3:   { id: 3,   name: 'Venusaur',   type: 'grass',    types: ['grass', 'poison'], nextId: null, baseId: 1,   chain: [1, 2, 3],  stats: { hp: 80, atk: 82, def: 83, spa: 100, spd: 100, spe: 80, bst: 525 }, abilities: ['Overgrow', 'Chlorophyll'] },
  506: { id: 506, name: 'Lillipup',   type: 'normal',   types: ['normal'],          nextId: 507,  baseId: 506, chain: [506, 507, 508], stats: { hp: 45, atk: 60, def: 45, spa: 25, spd: 45, spe: 55, bst: 275 }, abilities: ['Vital Spirit', 'Pickup'] },
  507: { id: 507, name: 'Herdier',    type: 'normal',   types: ['normal'],          nextId: 508,  baseId: 506, chain: [506, 507, 508], stats: { hp: 65, atk: 80, def: 65, spa: 35, spd: 65, spe: 60, bst: 370 }, abilities: ['Intimidate', 'Sand Rush'] },
  508: { id: 508, name: 'Stoutland',  type: 'normal',   types: ['normal'],          nextId: null, baseId: 506, chain: [506, 507, 508], stats: { hp: 85, atk: 110, def: 90, spa: 45, spd: 90, spe: 80, bst: 500 }, abilities: ['Intimidate', 'Sand Rush'] },
  133: { id: 133, name: 'Eevee',      type: 'normal',   types: ['normal'],          nextId: 134,  baseId: 133, chain: [133, 134, 135, 136, 196, 197, 470, 471, 700], stats: { hp: 55, atk: 55, def: 50, spa: 45, spd: 65, spe: 55, bst: 325 }, abilities: ['Adaptability', 'Anticipation'] },
  134: { id: 134, name: 'Vaporeon',   type: 'water',    types: ['water'],           nextId: 135,  baseId: 133, chain: [133, 134, 135, 136, 196, 197, 470, 471, 700], stats: { hp: 130, atk: 65, def: 60, spa: 110, spd: 95, spe: 65, bst: 525 }, abilities: ['Water Absorb', 'Hydration'] },
  135: { id: 135, name: 'Jolteon',    type: 'electric', types: ['electric'],        nextId: 136,  baseId: 133, chain: [133, 134, 135, 136, 196, 197, 470, 471, 700], stats: { hp: 65, atk: 65, def: 60, spa: 110, spd: 95, spe: 130, bst: 525 }, abilities: ['Volt Absorb', 'Quick Feet'] },
  136: { id: 136, name: 'Flareon',    type: 'fire',     types: ['fire'],            nextId: 196,  baseId: 133, chain: [133, 134, 135, 136, 196, 197, 470, 471, 700], stats: { hp: 65, atk: 130, def: 60, spa: 95, spd: 110, spe: 65, bst: 525 }, abilities: ['Flash Fire', 'Guts'] },
  196: { id: 196, name: 'Espeon',     type: 'psychic',  types: ['psychic'],         nextId: 197,  baseId: 133, chain: [133, 134, 135, 136, 196, 197, 470, 471, 700], stats: { hp: 65, atk: 65, def: 60, spa: 130, spd: 95, spe: 110, bst: 525 }, abilities: ['Synchronize', 'Magic Bounce'] },
  197: { id: 197, name: 'Umbreon',    type: 'dark',     types: ['dark'],            nextId: 470,  baseId: 133, chain: [133, 134, 135, 136, 196, 197, 470, 471, 700], stats: { hp: 95, atk: 65, def: 110, spa: 60, spd: 130, spe: 65, bst: 525 }, abilities: ['Synchronize', 'Inner Focus'] },
  470: { id: 470, name: 'Leafeon',    type: 'grass',    types: ['grass'],           nextId: 471,  baseId: 133, chain: [133, 134, 135, 136, 196, 197, 470, 471, 700], stats: { hp: 65, atk: 110, def: 130, spa: 60, spd: 65, spe: 95, bst: 525 }, abilities: ['Leaf Guard', 'Chlorophyll'] },
  471: { id: 471, name: 'Glaceon',    type: 'ice',      types: ['ice'],             nextId: 700,  baseId: 133, chain: [133, 134, 135, 136, 196, 197, 470, 471, 700], stats: { hp: 65, atk: 60, def: 110, spa: 130, spd: 95, spe: 65, bst: 525 }, abilities: ['Snow Cloak', 'Ice Body'] },
  700: { id: 700, name: 'Sylveon',    type: 'fairy',    types: ['fairy'],           nextId: null, baseId: 133, chain: [133, 134, 135, 136, 196, 197, 470, 471, 700], stats: { hp: 95, atk: 65, def: 65, spa: 110, spd: 130, spe: 60, bst: 525 }, abilities: ['Cute Charm', 'Pixilate'] },
  349: { id: 349, name: 'Feebas',     type: 'water',    types: ['water'],           nextId: 350,  baseId: 349, chain: [349, 350], stats: { hp: 20, atk: 15, def: 20, spa: 10, spd: 55, spe: 80, bst: 200 }, abilities: ['Swift Swim', 'Oblivious'] },
  350: { id: 350, name: 'Milotic',    type: 'water',    types: ['water'],           nextId: null, baseId: 349, chain: [349, 350], stats: { hp: 95, atk: 60, def: 79, spa: 100, spd: 125, spe: 81, bst: 540 }, abilities: ['Marvel Scale', 'Competitive'] },
  179: { id: 179, name: 'Mareep',     type: 'electric', types: ['electric'],        nextId: 180,  baseId: 179, chain: [179, 180, 181], stats: { hp: 55, atk: 40, def: 40, spa: 65, spd: 45, spe: 35, bst: 280 }, abilities: ['Static', 'Plus'] },
  180: { id: 180, name: 'Flaaffy',    type: 'electric', types: ['electric'],        nextId: 181,  baseId: 179, chain: [179, 180, 181], stats: { hp: 70, atk: 55, def: 55, spa: 80, spd: 60, spe: 45, bst: 365 }, abilities: ['Static', 'Plus'] },
  181: { id: 181, name: 'Ampharos',   type: 'electric', types: ['electric'],        nextId: null, baseId: 179, chain: [179, 180, 181], stats: { hp: 90, atk: 75, def: 85, spa: 115, spd: 90, spe: 55, bst: 510 }, abilities: ['Static', 'Plus'] },
  88:  { id: 88,  name: 'Grimer',     type: 'poison',   types: ['poison'],          nextId: 89,   baseId: 88,  chain: [88, 89],   stats: { hp: 80, atk: 80, def: 50, spa: 40, spd: 50, spe: 25, bst: 325 }, abilities: ['Stench', 'Sticky Hold'] },
  89:  { id: 89,  name: 'Alolan Muk', type: 'poison',   types: ['poison', 'dark'],  nextId: null, baseId: 88,  chain: [88, 89],   stats: { hp: 105, atk: 105, def: 75, spa: 65, spd: 100, spe: 50, bst: 500 }, abilities: ['Poison Touch', 'Gluttony'] },
  16:  { id: 16,  name: 'Pidgey',     type: 'normal',   types: ['normal', 'flying'], nextId: 17,  baseId: 16,  chain: [16, 17, 18], stats: { hp: 40, atk: 45, def: 40, spa: 35, spd: 35, spe: 56, bst: 251 }, abilities: ['Keen Eye', 'Tangled Feet'] },
  17:  { id: 17,  name: 'Pidgeotto',  type: 'normal',   types: ['normal', 'flying'], nextId: 18,  baseId: 16,  chain: [16, 17, 18], stats: { hp: 63, atk: 60, def: 55, spa: 50, spd: 50, spe: 71, bst: 349 }, abilities: ['Keen Eye', 'Tangled Feet'] },
  18:  { id: 18,  name: 'Pidgeot',    type: 'normal',   types: ['normal', 'flying'], nextId: null, baseId: 16, chain: [16, 17, 18], stats: { hp: 83, atk: 80, def: 75, spa: 70, spd: 70, spe: 101, bst: 479 }, abilities: ['Keen Eye', 'Big Pecks'] },
  147: { id: 147, name: 'Dratini',    type: 'dragon',   types: ['dragon'],          nextId: 148,  baseId: 147, chain: [147, 148, 149], stats: { hp: 41, atk: 64, def: 45, spa: 50, spd: 50, spe: 50, bst: 300 }, abilities: ['Shed Skin', 'Marvel Scale'] },
  148: { id: 148, name: 'Dragonair',  type: 'dragon',   types: ['dragon'],          nextId: 149,  baseId: 147, chain: [147, 148, 149], stats: { hp: 61, atk: 84, def: 65, spa: 70, spd: 70, spe: 70, bst: 420 }, abilities: ['Shed Skin', 'Marvel Scale'] },
  149: { id: 149, name: 'Dragonite',  type: 'dragon',   types: ['dragon', 'flying'], nextId: null, baseId: 147, chain: [147, 148, 149], stats: { hp: 91, atk: 134, def: 95, spa: 100, spd: 100, spe: 80, bst: 600 }, abilities: ['Inner Focus', 'Multiscale'] },
  172: { id: 172, name: 'Pichu',      type: 'electric', types: ['electric'],        nextId: 25,   baseId: 172, chain: [172, 25, 26], stats: { hp: 20, atk: 40, def: 15, spa: 35, spd: 35, spe: 60, bst: 205 }, abilities: ['Static', 'Lightning Rod'] },
  25:  { id: 25,  name: 'Pikachu',    type: 'electric', types: ['electric'],        nextId: 26,   baseId: 172, chain: [172, 25, 26], stats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90, bst: 320 }, abilities: ['Static', 'Lightning Rod'] },
  26:  { id: 26,  name: 'Raichu',     type: 'electric', types: ['electric'],        nextId: null, baseId: 172, chain: [172, 25, 26], stats: { hp: 60, atk: 90, def: 55, spa: 90, spd: 80, spe: 110, bst: 485 }, abilities: ['Static', 'Lightning Rod'] },
  63:  { id: 63,  name: 'Abra',       type: 'psychic',  types: ['psychic'],         nextId: 64,   baseId: 63,  chain: [63, 64, 65], stats: { hp: 25, atk: 20, def: 15, spa: 105, spd: 55, spe: 90, bst: 310 }, abilities: ['Synchronize', 'Magic Guard'] },
  64:  { id: 64,  name: 'Kadabra',    type: 'psychic',  types: ['psychic'],         nextId: 65,   baseId: 63,  chain: [63, 64, 65], stats: { hp: 40, atk: 35, def: 30, spa: 120, spd: 70, spe: 105, bst: 400 }, abilities: ['Synchronize', 'Magic Guard'] },
  65:  { id: 65,  name: 'Alakazam',   type: 'psychic',  types: ['psychic'],         nextId: null, baseId: 63,  chain: [63, 64, 65], stats: { hp: 55, atk: 50, def: 45, spa: 135, spd: 95, spe: 120, bst: 500 }, abilities: ['Synchronize', 'Magic Guard'] },
  359: { id: 359, name: 'Absol',      type: 'dark',     types: ['dark'],            nextId: null, baseId: 359, chain: [359], stats: { hp: 65, atk: 130, def: 60, spa: 75, spd: 60, spe: 75, bst: 465 }, abilities: ['Pressure', 'Super Luck'] },
  143: { id: 143, name: 'Snorlax',    type: 'normal',   types: ['normal'],          nextId: null, baseId: 143, chain: [143], stats: { hp: 160, atk: 110, def: 65, spa: 65, spd: 110, spe: 30, bst: 540 }, abilities: ['Immunity', 'Thick Fat'] },
  150: { id: 150, name: 'Mewtwo',     type: 'psychic',  types: ['psychic'],         nextId: null, baseId: 150, chain: [150], stats: { hp: 106, atk: 110, def: 90, spa: 154, spd: 90, spe: 130, bst: 680 }, abilities: ['Pressure', 'Unnerve'] },
  92:  { id: 92,  name: 'Gastly',     type: 'ghost',    types: ['ghost', 'poison'], nextId: 93,   baseId: 92,  chain: [92, 93, 94], stats: { hp: 30, atk: 35, def: 30, spa: 100, spd: 35, spe: 80, bst: 310 }, abilities: ['Levitate'] },
  93:  { id: 93,  name: 'Haunter',    type: 'ghost',    types: ['ghost', 'poison'], nextId: 94,   baseId: 92,  chain: [92, 93, 94], stats: { hp: 45, atk: 50, def: 45, spa: 115, spd: 55, spe: 95, bst: 405 }, abilities: ['Levitate'] },
  94:  { id: 94,  name: 'Gengar',     type: 'ghost',    types: ['ghost', 'poison'], nextId: null, baseId: 92,  chain: [92, 93, 94], stats: { hp: 60, atk: 65, def: 60, spa: 130, spd: 75, spe: 110, bst: 500 }, abilities: ['Cursed Body', 'Shadow Tag'] },
  248: { id: 248, name: 'Tyranitar',  type: 'rock',     types: ['rock', 'dark'],    nextId: null, baseId: 246, chain: [246, 247, 248], stats: { hp: 100, atk: 134, def: 110, spa: 95, spd: 100, spe: 61, bst: 600 }, abilities: ['Sand Stream', 'Unnerve'] },
  249: { id: 249, name: 'Lugia',      type: 'psychic',  types: ['psychic', 'flying'], nextId: null, baseId: 249, chain: [249], stats: { hp: 106, atk: 90, def: 130, spa: 90, spd: 154, spe: 110, bst: 680 }, abilities: ['Pressure', 'Multiscale'] },
  376: { id: 376, name: 'Metagross',  type: 'steel',    types: ['steel', 'psychic'], nextId: null, baseId: 374, chain: [374, 375, 376], stats: { hp: 80, atk: 135, def: 130, spa: 95, spd: 90, spe: 70, bst: 600 }, abilities: ['Clear Body', 'Tough Claws'] },
  384: { id: 384, name: 'Rayquaza',   type: 'dragon',   types: ['dragon', 'flying'], nextId: null, baseId: 384, chain: [384], stats: { hp: 105, atk: 150, def: 90, spa: 150, spd: 90, spe: 95, bst: 680 }, abilities: ['Air Lock', 'Delta Stream'] },
  443: { id: 443, name: 'Gible',      type: 'dragon',   types: ['dragon', 'ground'], nextId: 444, baseId: 443, chain: [443, 444, 445], stats: { hp: 58, atk: 70, def: 45, spa: 40, spd: 45, spe: 42, bst: 300 }, abilities: ['Sand Veil', 'Rough Skin'] },
  444: { id: 444, name: 'Gabite',     type: 'dragon',   types: ['dragon', 'ground'], nextId: 445, baseId: 443, chain: [443, 444, 445], stats: { hp: 68, atk: 90, def: 65, spa: 50, spd: 55, spe: 82, bst: 410 }, abilities: ['Sand Veil', 'Rough Skin'] },
  445: { id: 445, name: 'Garchomp',   type: 'dragon',   types: ['dragon', 'ground'], nextId: null, baseId: 443, chain: [443, 444, 445], stats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102, bst: 600 }, abilities: ['Rough Skin', 'Sand Veil'] },
  447: { id: 447, name: 'Riolu',      type: 'fighting', types: ['fighting'],         nextId: 448, baseId: 447, chain: [447, 448], stats: { hp: 40, atk: 70, def: 40, spa: 35, spd: 40, spe: 60, bst: 285 }, abilities: ['Inner Focus', 'Prankster'] },
  448: { id: 448, name: 'Lucario',    type: 'fighting', types: ['fighting', 'steel'], nextId: null, baseId: 447, chain: [447, 448], stats: { hp: 70, atk: 110, def: 70, spa: 115, spd: 70, spe: 90, bst: 525 }, abilities: ['Adaptability', 'Justified'] },
  487: { id: 487, name: 'Giratina',   type: 'ghost',    types: ['ghost', 'dragon'],  nextId: null, baseId: 487, chain: [487], stats: { hp: 150, atk: 100, def: 120, spa: 100, spd: 120, spe: 90, bst: 680 }, abilities: ['Pressure', 'Levitate'] },
  493: { id: 493, name: 'Arceus',     type: 'normal',   types: ['normal'],           nextId: null, baseId: 493, chain: [493], stats: { hp: 120, atk: 120, def: 120, spa: 120, spd: 120, spe: 120, bst: 720 }, abilities: ['Multitype'] },
  656: { id: 656, name: 'Froakie',    type: 'water',    types: ['water'],            nextId: 657, baseId: 656, chain: [656, 657, 658], stats: { hp: 41, atk: 56, def: 40, spa: 62, spd: 44, spe: 71, bst: 314 }, abilities: ['Torrent', 'Protean'] },
  657: { id: 657, name: 'Frogadier',  type: 'water',    types: ['water'],            nextId: 658, baseId: 656, chain: [656, 657, 658], stats: { hp: 54, atk: 63, def: 52, spa: 83, spd: 56, spe: 97, bst: 405 }, abilities: ['Torrent', 'Protean'] },
  658: { id: 658, name: 'Greninja',   type: 'water',    types: ['water', 'dark'],    nextId: null, baseId: 656, chain: [656, 657, 658], stats: { hp: 72, atk: 95, def: 67, spa: 103, spd: 71, spe: 122, bst: 530 }, abilities: ['Battle Bond', 'Protean'] },
  888: { id: 888, name: 'Zacian',     type: 'fairy',    types: ['fairy', 'steel'],   nextId: null, baseId: 888, chain: [888], stats: { hp: 92, atk: 150, def: 115, spa: 80, spd: 115, spe: 138, bst: 690 }, abilities: ['Intrepid Sword'] },
  95:  { id: 95,  name: 'Onix',       type: 'rock',     types: ['rock', 'ground'],   nextId: 208,  baseId: 95,  chain: [95, 208], stats: { hp: 75, atk: 85, def: 160, spa: 60, spd: 75, spe: 70, bst: 525 }, abilities: ['Rock Head', 'Sturdy'] },
  76:  { id: 76,  name: 'Golem',      type: 'rock',     types: ['rock', 'ground'],   nextId: null, baseId: 74,  chain: [74, 75, 76], stats: { hp: 80, atk: 120, def: 130, spa: 55, spd: 65, spe: 45, bst: 495 }, abilities: ['Rock Head', 'Sturdy'] },
  121: { id: 121, name: 'Starmie',    type: 'water',    types: ['water', 'psychic'], nextId: null, baseId: 120, chain: [120, 121], stats: { hp: 60, atk: 75, def: 85, spa: 100, spd: 85, spe: 115, bst: 520 }, abilities: ['Natural Cure', 'Analytic'] }
};

const HOF_ROSTER_BUTTONS = [
  { id: 384, label: 'Rayquaza' },
  { id: 445, label: 'Garchomp' },
  { id: 150, label: 'Mewtwo' },
  { id: 6,   label: 'Charizard' },
  { id: 448, label: 'Lucario' },
  { id: 94,  label: 'Gengar' },
  { id: 658, label: 'Greninja' },
  { id: 197, label: 'Umbreon' },
  { id: 493, label: 'Arceus' },
  { id: 487, label: 'Giratina' },
  { id: 249, label: 'Lugia' },
  { id: 130, label: 'Gyarados' },
  { id: 59,  label: 'Arcanine' },
  { id: 149, label: 'Dragonite' },
  { id: 9,   label: 'Blastoise' },
  { id: 3,   label: 'Venusaur' },
  { id: 25,  label: 'Pikachu' },
  { id: 248, label: 'Tyranitar' },
  { id: 376, label: 'Metagross' },
  { id: 350, label: 'Milotic' },
  { id: 143, label: 'Snorlax' },
  { id: 65,  label: 'Alakazam' }
];

const BATTLE_DECK_PRESETS = {
  DRAGON_LORDS:     { label: 'DRAGON LORDS',     ids: [384, 445, 149] },
  MEGA_LEGENDS:     { label: 'MEGA LEGENDS',     ids: [150, 6, 448] },
  SHADOW_DARK:      { label: 'SHADOW & DARK',    ids: [94, 658, 197] },
  GOD_TIER_MYTHICS: { label: 'GOD TIER MYTHICS', ids: [493, 487, 249] }
};

const POWERHOUSE_POOL_IDS = [384, 445, 149, 150, 6, 448, 94, 658, 197, 493, 487, 249, 130, 59, 9, 3, 248, 376, 350, 143, 65, 888, 25, 700, 135, 181];

const CHAMPION_GAUNTLET_STAGES = [
  { stage: 1, title: 'STAGE 1 • GYM LEADER BROCK',      badge: 'BOULDERBADGE', ids: [95, 76, 248],   shinyBoss: false },
  { stage: 2, title: 'STAGE 2 • WATER MASTER MISTY',    badge: 'CASCADEBADGE', ids: [121, 130, 350], shinyBoss: false },
  { stage: 3, title: 'STAGE 3 • DRAGON MASTER LANCE',   badge: 'DRAGONBADGE',  ids: [149, 130, 6],   shinyBoss: false },
  { stage: 4, title: 'STAGE 4 • CHAMPION CYNTHIA',      badge: 'SINNOHCREST',  ids: [445, 448, 350], shinyBoss: true  },
  { stage: 5, title: 'STAGE 5 • LEGEND MASTER RED',     badge: 'REDLEGEND',    ids: [25, 6, 150],    shinyBoss: true  }
];

const SIGNATURE_MOVES_BY_ID = {
  6: [
    { name: 'Flamethrower', type: 'fire',   power: 90,  cat: 'spec', maxPp: 15, status: { code: 'BRN', chance: 0.25 } },
    { name: 'Air Slash',    type: 'flying', power: 85,  cat: 'spec', maxPp: 15 },
    { name: 'Dragon Claw',  type: 'dragon', power: 85,  cat: 'phys', maxPp: 15 },
    { name: 'Blast Burn',   type: 'fire',   power: 150, cat: 'spec', maxPp: 5,  ultimate: true, status: { code: 'BRN', chance: 0.35 } }
  ],
  25: [
    { name: 'Thunderbolt',  type: 'electric', power: 90,  cat: 'spec', maxPp: 15, status: { code: 'PAR', chance: 0.30 } },
    { name: 'Iron Tail',    type: 'steel',    power: 100, cat: 'phys', maxPp: 15 },
    { name: 'Quick Attack', type: 'normal',   power: 75,  cat: 'phys', maxPp: 20 },
    { name: 'Volt Tackle',  type: 'electric', power: 140, cat: 'phys', maxPp: 5,  ultimate: true, status: { code: 'PAR', chance: 0.35 } }
  ],
  94: [
    { name: 'Shadow Ball',  type: 'ghost',   power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Sludge Bomb',  type: 'poison',  power: 90,  cat: 'spec', maxPp: 15, status: { code: 'PSN', chance: 0.35 } },
    { name: 'Hypnosis Hex', type: 'psychic', power: 75,  cat: 'spec', maxPp: 10, status: { code: 'SLP', chance: 0.55 } },
    { name: 'Dream Eater',  type: 'ghost',   power: 140, cat: 'spec', maxPp: 5,  ultimate: true, drain: 0.35 }
  ],
  150: [
    { name: 'Psystrike',    type: 'psychic',  power: 105, cat: 'spec', maxPp: 10 },
    { name: 'Aura Sphere',  type: 'fighting', power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Shadow Ball',  type: 'ghost',    power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Astral Nova',  type: 'psychic',  power: 150, cat: 'spec', maxPp: 5,  ultimate: true }
  ],
  384: [
    { name: 'Dragon Pulse',  type: 'dragon', power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Extreme Speed', type: 'normal', power: 85,  cat: 'phys', maxPp: 15 },
    { name: 'Outrage',       type: 'dragon', power: 120, cat: 'phys', maxPp: 10 },
    { name: 'Dragon Ascent', type: 'flying', power: 150, cat: 'phys', maxPp: 5,  ultimate: true }
  ],
  445: [
    { name: 'Earthquake',   type: 'ground', power: 100, cat: 'phys', maxPp: 10 },
    { name: 'Dragon Claw',  type: 'dragon', power: 85,  cat: 'phys', maxPp: 15 },
    { name: 'Stone Edge',   type: 'rock',   power: 100, cat: 'phys', maxPp: 10 },
    { name: 'Draco Meteor', type: 'dragon', power: 145, cat: 'spec', maxPp: 5,  ultimate: true }
  ],
  149: [
    { name: 'Outrage',       type: 'dragon',   power: 120, cat: 'phys', maxPp: 10 },
    { name: 'Hurricane',     type: 'flying',   power: 110, cat: 'spec', maxPp: 10 },
    { name: 'Thunder Punch', type: 'electric', power: 85,  cat: 'phys', maxPp: 15, status: { code: 'PAR', chance: 0.30 } },
    { name: 'Draco Impact',  type: 'dragon',   power: 145, cat: 'phys', maxPp: 5,  ultimate: true }
  ],
  448: [
    { name: 'Aura Sphere',   type: 'fighting', power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Meteor Mash',   type: 'steel',    power: 95,  cat: 'phys', maxPp: 10 },
    { name: 'Extreme Speed', type: 'normal',   power: 85,  cat: 'phys', maxPp: 15 },
    { name: 'Close Combat',  type: 'fighting', power: 140, cat: 'phys', maxPp: 5,  ultimate: true }
  ],
  658: [
    { name: 'Water Shuriken', type: 'water', power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Dark Pulse',     type: 'dark',  power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Ice Beam',       type: 'ice',   power: 90,  cat: 'spec', maxPp: 15, status: { code: 'FRZ', chance: 0.25 } },
    { name: 'Hydro Cannon',   type: 'water', power: 150, cat: 'spec', maxPp: 5,  ultimate: true }
  ],
  197: [
    { name: 'Foul Play',       type: 'dark',   power: 95,  cat: 'phys', maxPp: 15 },
    { name: 'Dark Pulse',      type: 'dark',   power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Toxic Fang',      type: 'poison', power: 75,  cat: 'phys', maxPp: 10, status: { code: 'PSN', chance: 0.55 } },
    { name: 'Moonlight Drain', type: 'dark',   power: 130, cat: 'spec', maxPp: 5,  ultimate: true, drain: 0.40 }
  ],
  493: [
    { name: 'Extreme Speed', type: 'normal',  power: 90,  cat: 'phys', maxPp: 15 },
    { name: 'Earth Power',   type: 'ground',  power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Cosmic Recover', type: 'psychic', power: 85, cat: 'spec', maxPp: 10, drain: 0.35 },
    { name: 'Judgment',      type: 'normal',  power: 155, cat: 'spec', maxPp: 5,  ultimate: true }
  ],
  487: [
    { name: 'Dragon Claw',  type: 'dragon',   power: 85,  cat: 'phys', maxPp: 15 },
    { name: 'Aura Sphere',  type: 'fighting', power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Will-O-Wisp',  type: 'fire',     power: 75,  cat: 'spec', maxPp: 10, status: { code: 'BRN', chance: 0.55 } },
    { name: 'Shadow Force', type: 'ghost',    power: 150, cat: 'phys', maxPp: 5,  ultimate: true }
  ],
  249: [
    { name: 'Psychic',    type: 'psychic', power: 90,  cat: 'spec', maxPp: 15 },
    { name: 'Hydro Pump', type: 'water',   power: 110, cat: 'spec', maxPp: 10 },
    { name: 'Sky Roost',  type: 'flying',  power: 85,  cat: 'spec', maxPp: 10, drain: 0.35 },
    { name: 'Aeroblast',  type: 'flying',  power: 145, cat: 'spec', maxPp: 5,  ultimate: true }
  ],
  130: [
    { name: 'Waterfall',  type: 'water',  power: 90,  cat: 'phys', maxPp: 15 },
    { name: 'Crunch',     type: 'dark',   power: 85,  cat: 'phys', maxPp: 15 },
    { name: 'Ice Fang',   type: 'ice',    power: 80,  cat: 'phys', maxPp: 15, status: { code: 'FRZ', chance: 0.25 } },
    { name: 'Hyper Geyser', type: 'water', power: 145, cat: 'phys', maxPp: 5, ultimate: true }
  ],
  59: [
    { name: 'Flamethrower',  type: 'fire',     power: 90,  cat: 'spec', maxPp: 15, status: { code: 'BRN', chance: 0.25 } },
    { name: 'Extreme Speed', type: 'normal',   power: 85,  cat: 'phys', maxPp: 15 },
    { name: 'Wild Charge',   type: 'electric', power: 90,  cat: 'phys', maxPp: 15, status: { code: 'PAR', chance: 0.20 } },
    { name: 'Flare Blitz',   type: 'fire',     power: 145, cat: 'phys', maxPp: 5,  ultimate: true, status: { code: 'BRN', chance: 0.35 } }
  ],
  9: [
    { name: 'Aqua Tail',    type: 'water', power: 90,  cat: 'phys', maxPp: 15 },
    { name: 'Ice Beam',     type: 'ice',   power: 90,  cat: 'spec', maxPp: 15, status: { code: 'FRZ', chance: 0.25 } },
    { name: 'Flash Cannon', type: 'steel', power: 85,  cat: 'spec', maxPp: 15 },
    { name: 'Hydro Cannon', type: 'water', power: 150, cat: 'spec', maxPp: 5,  ultimate: true }
  ],
  3: [
    { name: 'Giga Drain',   type: 'grass',  power: 85,  cat: 'spec', maxPp: 15, drain: 0.35 },
    { name: 'Sludge Bomb',  type: 'poison', power: 90,  cat: 'spec', maxPp: 15, status: { code: 'PSN', chance: 0.35 } },
    { name: 'Sleep Powder', type: 'grass',  power: 70,  cat: 'spec', maxPp: 10, status: { code: 'SLP', chance: 0.55 } },
    { name: 'Frenzy Plant', type: 'grass',  power: 150, cat: 'spec', maxPp: 5,  ultimate: true }
  ],
  143: [
    { name: 'Body Slam',   type: 'normal', power: 90,  cat: 'phys', maxPp: 15, status: { code: 'PAR', chance: 0.35 } },
    { name: 'Crunch',      type: 'dark',   power: 85,  cat: 'phys', maxPp: 15 },
    { name: 'Earthquake',  type: 'ground', power: 100, cat: 'phys', maxPp: 10 },
    { name: 'Giga Impact', type: 'normal', power: 150, cat: 'phys', maxPp: 5,  ultimate: true }
  ]
};

const TYPE_MOVE_POOL = {
  water:    [
    { name: 'Aqua Tail',   type: 'water',    power: 90,  cat: 'phys' },
    { name: 'Hydro Pump',  type: 'water',    power: 110, cat: 'spec' },
    { name: 'Surf',        type: 'water',    power: 95,  cat: 'spec' },
    { name: 'Hyper Geyser', type: 'water',   power: 130, cat: 'spec', ultimate: true }
  ],
  fire:     [
    { name: 'Flamethrower', type: 'fire',    power: 90,  cat: 'spec' },
    { name: 'Fire Blast',   type: 'fire',    power: 110, cat: 'spec' },
    { name: 'Flare Blitz',  type: 'fire',    power: 120, cat: 'phys' },
    { name: 'Inferno Overdrive', type: 'fire', power: 135, cat: 'spec', ultimate: true }
  ],
  psychic:  [
    { name: 'Psychic',     type: 'psychic',  power: 90,  cat: 'spec' },
    { name: 'Psystrike',   type: 'psychic',  power: 100, cat: 'spec' },
    { name: 'Shadow Ball', type: 'ghost',    power: 85,  cat: 'spec' },
    { name: 'Astral Nova', type: 'psychic',  power: 135, cat: 'spec', ultimate: true }
  ],
  electric: [
    { name: 'Thunderbolt', type: 'electric', power: 90,  cat: 'spec' },
    { name: 'Volt Tackle', type: 'electric', power: 120, cat: 'phys' },
    { name: 'Thunder',     type: 'electric', power: 110, cat: 'spec' },
    { name: 'Giga Volt',   type: 'electric', power: 135, cat: 'spec', ultimate: true }
  ],
  dark:     [
    { name: 'Night Slash',   type: 'dark',   power: 85,  cat: 'phys' },
    { name: 'Dark Pulse',    type: 'dark',   power: 90,  cat: 'spec' },
    { name: 'Sucker Punch',  type: 'dark',   power: 95,  cat: 'phys' },
    { name: 'Disaster Cleave', type: 'dark', power: 130, cat: 'phys', ultimate: true }
  ],
  grass:    [
    { name: 'Energy Ball',  type: 'grass',   power: 90,  cat: 'spec' },
    { name: 'Leaf Blade',   type: 'grass',   power: 90,  cat: 'phys' },
    { name: 'Sludge Bomb',  type: 'poison',  power: 90,  cat: 'spec' },
    { name: 'Solar Beam',   type: 'grass',   power: 130, cat: 'spec', ultimate: true }
  ],
  dragon:   [
    { name: 'Dragon Claw',  type: 'dragon',  power: 85,  cat: 'phys' },
    { name: 'Outrage',      type: 'dragon',  power: 120, cat: 'phys' },
    { name: 'Hurricane',    type: 'flying',  power: 110, cat: 'spec' },
    { name: 'Draco Meteor', type: 'dragon',  power: 135, cat: 'spec', ultimate: true }
  ],
  ice:      [
    { name: 'Ice Beam',     type: 'ice',     power: 90,  cat: 'spec' },
    { name: 'Blizzard',     type: 'ice',     power: 110, cat: 'spec' },
    { name: 'Freeze-Dry',   type: 'ice',     power: 85,  cat: 'spec' },
    { name: 'Subzero Nova', type: 'ice',     power: 130, cat: 'spec', ultimate: true }
  ],
  fairy:    [
    { name: 'Moonblast',    type: 'fairy',   power: 95,  cat: 'spec' },
    { name: 'Dazzling Gleam', type: 'fairy', power: 85,  cat: 'spec' },
    { name: 'Play Rough',   type: 'fairy',   power: 90,  cat: 'phys' },
    { name: 'Starlight Nova', type: 'fairy', power: 130, cat: 'spec', ultimate: true }
  ],
  poison:   [
    { name: 'Sludge Wave',  type: 'poison',  power: 95,  cat: 'spec' },
    { name: 'Gunk Shot',    type: 'poison',  power: 120, cat: 'phys' },
    { name: 'Crunch',       type: 'dark',    power: 85,  cat: 'phys' },
    { name: 'Venom Overdrive', type: 'poison', power: 130, cat: 'phys', ultimate: true }
  ],
  flying:   [
    { name: 'Brave Bird',   type: 'flying',  power: 120, cat: 'phys' },
    { name: 'Air Slash',    type: 'flying',  power: 85,  cat: 'spec' },
    { name: 'Hurricane',    type: 'flying',  power: 110, cat: 'spec' },
    { name: 'Sky Strike',   type: 'flying',  power: 130, cat: 'phys', ultimate: true }
  ],
  fighting: [
    { name: 'Close Combat', type: 'fighting', power: 120, cat: 'phys' },
    { name: 'Aura Sphere',  type: 'fighting', power: 90,  cat: 'spec' },
    { name: 'Drain Punch',  type: 'fighting', power: 85,  cat: 'phys' },
    { name: 'Meteor Assault', type: 'fighting', power: 135, cat: 'phys', ultimate: true }
  ],
  ground:   [
    { name: 'Earthquake',   type: 'ground',  power: 100, cat: 'phys' },
    { name: 'Earth Power',  type: 'ground',  power: 90,  cat: 'spec' },
    { name: 'Stone Edge',   type: 'rock',    power: 100, cat: 'phys' },
    { name: 'Tectonic Rage', type: 'ground', power: 135, cat: 'phys', ultimate: true }
  ],
  rock:     [
    { name: 'Stone Edge',   type: 'rock',    power: 100, cat: 'phys' },
    { name: 'Rock Slide',   type: 'rock',    power: 85,  cat: 'phys' },
    { name: 'Earthquake',   type: 'ground',  power: 100, cat: 'phys' },
    { name: 'Continental Crush', type: 'rock', power: 135, cat: 'phys', ultimate: true }
  ],
  ghost:    [
    { name: 'Shadow Ball',  type: 'ghost',   power: 90,  cat: 'spec' },
    { name: 'Phantom Force', type: 'ghost',  power: 95,  cat: 'phys' },
    { name: 'Dark Pulse',   type: 'dark',    power: 85,  cat: 'spec' },
    { name: 'Phantom Nova', type: 'ghost',   power: 135, cat: 'spec', ultimate: true }
  ],
  steel:    [
    { name: 'Meteor Mash',  type: 'steel',   power: 95,  cat: 'phys' },
    { name: 'Flash Cannon', type: 'steel',   power: 85,  cat: 'spec' },
    { name: 'Iron Head',    type: 'steel',   power: 85,  cat: 'phys' },
    { name: 'Corkscrew Crash', type: 'steel', power: 135, cat: 'phys', ultimate: true }
  ],
  bug:      [
    { name: 'Bug Buzz',     type: 'bug',     power: 90,  cat: 'spec' },
    { name: 'X-Scissor',    type: 'bug',     power: 85,  cat: 'phys' },
    { name: 'Megahorn',     type: 'bug',     power: 120, cat: 'phys' },
    { name: 'Savage Spin-Out', type: 'bug',  power: 130, cat: 'phys', ultimate: true }
  ],
  normal:   [
    { name: 'Body Slam',    type: 'normal',  power: 85,  cat: 'phys' },
    { name: 'Hyper Voice',  type: 'normal',  power: 90,  cat: 'spec' },
    { name: 'Crunch',       type: 'dark',    power: 85,  cat: 'phys' },
    { name: 'Giga Impact',  type: 'normal',  power: 135, cat: 'phys', ultimate: true }
  ]
};

let activeRosterTargetSlot = 1;
let stadiumDockTargetSlot = 1;
let evoChainCache = {};
let partnerState = {
  slot1: { id: 130, name: 'Gyarados', type: 'water', types: ['water', 'flying'], shiny: false, nextId: null, baseId: 129, chain: [129, 130] },
  slot2: { id: 59,  name: 'Arcanine', type: 'fire',  types: ['fire'],            shiny: false, nextId: null, baseId: 58,  chain: [58, 59] },
  cryAudio: true,
  autoLaunch: false,
  cutInFx: true,
  battleAutoClose: false,
  stageMode: 'OPEN'
};

function loadEvoChainCacheFromStorage() {
  try {
    const raw = localStorage.getItem('dropbot_v4_evo_chains_v2');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') evoChainCache = parsed;
    }
  } catch (e) {}
  Object.values(HALL_OF_FAME_DEX).forEach(entry => {
    if (Array.isArray(entry.chain) && entry.chain.length > 0) {
      evoChainCache[entry.id] = {
        chain: entry.chain,
        nextId: entry.nextId || null,
        baseId: entry.baseId || entry.chain[0]
      };
    }
  });
}

function saveEvoChainCacheToStorage() {
  try {
    localStorage.setItem('dropbot_v4_evo_chains_v2', JSON.stringify(evoChainCache));
  } catch (e) {}
}

function hydrateSlotFromDex(slotObj) {
  if (!slotObj || !slotObj.id) return slotObj;
  const dex = HALL_OF_FAME_DEX[slotObj.id];
  const cached = evoChainCache[slotObj.id];
  if (dex && Array.isArray(dex.types) && dex.types.length > 0) {
    slotObj.types = dex.types;
  } else if (!Array.isArray(slotObj.types) || slotObj.types.length === 0) {
    slotObj.types = [slotObj.type || 'normal'];
  }
  if (dex && dex.stats) {
    slotObj.stats = dex.stats;
    slotObj.abilities = dex.abilities || ['Battle Ready'];
  }
  if (dex && Array.isArray(dex.moves) && dex.moves.length > 0) {
    slotObj.moves = dex.moves;
  }
  if (cached && Array.isArray(cached.chain)) {
    slotObj.chain = cached.chain;
    slotObj.nextId = cached.nextId;
    slotObj.baseId = cached.baseId;
  } else if (dex && Array.isArray(dex.chain)) {
    slotObj.chain = dex.chain;
    slotObj.nextId = dex.nextId;
    slotObj.baseId = dex.baseId;
  }
  return slotObj;
}

function loadPartnerStateFromStorage() {
  loadEvoChainCacheFromStorage();
  try {
    const saved = localStorage.getItem('dropbot_v4_partner_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.slot1 && parsed.slot2) {
        partnerState = {
          ...partnerState,
          ...parsed,
          cutInFx: parsed.cutInFx !== false,
          battleAutoClose: Boolean(parsed.battleAutoClose),
          stageMode: parsed.stageMode === 'MINI' ? 'MINI' : 'OPEN',
          slot1: hydrateSlotFromDex({ ...partnerState.slot1, ...parsed.slot1 }),
          slot2: hydrateSlotFromDex({ ...partnerState.slot2, ...parsed.slot2 })
        };
      }
    }
  } catch (e) {}
  resolveFullEvolutionChain(partnerState.slot1.id).then(() => applyPartnerThemeAndHeader());
  resolveFullEvolutionChain(partnerState.slot2.id).then(() => applyPartnerThemeAndHeader());
}

function savePartnerStateToStorage() {
  try {
    localStorage.setItem('dropbot_v4_partner_state', JSON.stringify(partnerState));
  } catch (e) {}
}

function formatPokeDisplayName(rawName) {
  if (!rawName) return 'Pokemon';
  return String(rawName)
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function ensurePokemonMetadata(idOrName) {
  const numId = Number(idOrName);
  if (numId && HALL_OF_FAME_DEX[numId] && HALL_OF_FAME_DEX[numId].name && HALL_OF_FAME_DEX[numId].stats) {
    return HALL_OF_FAME_DEX[numId];
  }
  const res = await fetch('https://pokeapi.co/api/v2/pokemon/' + encodeURIComponent(String(idOrName).toLowerCase()));
  if (!res.ok) throw new Error('Pokémon not found: ' + idOrName);
  const data = await res.json();
  const pokeId = data.id;
  const pokeName = formatPokeDisplayName(data.name);
  const allTypes = Array.isArray(data.types) && data.types.length > 0
    ? data.types.map(t => String(t.type?.name || 'normal').toLowerCase())
    : ['normal'];
  const primaryType = allTypes[0] || 'normal';
  const mappedType = ELEMENTAL_SPECTRUM[primaryType] ? primaryType : 'normal';

  const statMap = { hp: 70, atk: 75, def: 70, spa: 75, spd: 70, spe: 75 };
  if (Array.isArray(data.stats)) {
    data.stats.forEach(s => {
      const sn = s.stat?.name;
      const v = Number(s.base_stat || 60);
      if (sn === 'hp') statMap.hp = v;
      else if (sn === 'attack') statMap.atk = v;
      else if (sn === 'defense') statMap.def = v;
      else if (sn === 'special-attack') statMap.spa = v;
      else if (sn === 'special-defense') statMap.spd = v;
      else if (sn === 'speed') statMap.spe = v;
    });
  }
  statMap.bst = statMap.hp + statMap.atk + statMap.def + statMap.spa + statMap.spd + statMap.spe;

  const abilities = Array.isArray(data.abilities) && data.abilities.length > 0
    ? data.abilities.slice(0, 2).map(a => formatPokeDisplayName(a.ability?.name || 'Battle Ready'))
    : ['Battle Ready'];

  const apiMoves = [];
  if (Array.isArray(data.moves)) {
    for (let i = 0; i < data.moves.length && apiMoves.length < 3; i++) {
      const mvName = data.moves[i]?.move?.name;
      if (mvName && !mvName.includes('protect') && !mvName.includes('rest') && !mvName.includes('snore') && !mvName.includes('substitute')) {
        apiMoves.push(formatPokeDisplayName(mvName));
      }
    }
  }

  const existing = HALL_OF_FAME_DEX[pokeId] || {};
  HALL_OF_FAME_DEX[pokeId] = {
    ...existing,
    id: pokeId,
    name: existing.name || pokeName,
    type: existing.type || mappedType,
    types: allTypes,
    stats: statMap,
    abilities,
    moves: apiMoves
  };
  return HALL_OF_FAME_DEX[pokeId];
}

async function resolveFullEvolutionChain(pokemonIdOrName) {
  try {
    const meta = await ensurePokemonMetadata(pokemonIdOrName);
    const pokeId = meta.id;

    if (evoChainCache[pokeId] && Array.isArray(evoChainCache[pokeId].chain) && evoChainCache[pokeId].chain.length > 0) {
      const cached = evoChainCache[pokeId];
      HALL_OF_FAME_DEX[pokeId] = { ...HALL_OF_FAME_DEX[pokeId], ...cached };
      return cached;
    }

    const spRes = await fetch('https://pokeapi.co/api/v2/pokemon-species/' + pokeId);
    if (!spRes.ok) throw new Error('Species fetch failed');
    const spData = await spRes.json();
    const evoUrl = spData.evolution_chain?.url;
    if (!evoUrl) throw new Error('No evolution_chain URL');

    const chRes = await fetch(evoUrl);
    if (!chRes.ok) throw new Error('Evolution chain fetch failed');
    const chData = await chRes.json();

    const chainIds = [];
    const walkChain = (node) => {
      if (!node) return;
      const m = (node.species?.url || '').match(/\/pokemon-species\/(\d+)\//);
      if (m) {
        const sid = Number(m[1]);
        if (sid && !chainIds.includes(sid)) {
          chainIds.push(sid);
        }
      }
      if (Array.isArray(node.evolves_to)) {
        node.evolves_to.forEach(child => walkChain(child));
      }
    };
    walkChain(chData.chain);

    if (chainIds.length === 0) chainIds.push(pokeId);

    chainIds.forEach((sid, idx) => {
      const nextId = idx < chainIds.length - 1 ? chainIds[idx + 1] : null;
      const baseId = chainIds[0];
      evoChainCache[sid] = { chain: chainIds, nextId, baseId };
      if (HALL_OF_FAME_DEX[sid]) {
        HALL_OF_FAME_DEX[sid].chain = chainIds;
        HALL_OF_FAME_DEX[sid].nextId = nextId;
        HALL_OF_FAME_DEX[sid].baseId = baseId;
      }
    });

    saveEvoChainCacheToStorage();

    ['slot1', 'slot2'].forEach(k => {
      const s = partnerState[k];
      if (s && evoChainCache[s.id]) {
        s.chain = evoChainCache[s.id].chain;
        s.nextId = evoChainCache[s.id].nextId;
        s.baseId = evoChainCache[s.id].baseId;
        if (HALL_OF_FAME_DEX[s.id]?.types) s.types = HALL_OF_FAME_DEX[s.id].types;
        if (HALL_OF_FAME_DEX[s.id]?.stats) s.stats = HALL_OF_FAME_DEX[s.id].stats;
        if (HALL_OF_FAME_DEX[s.id]?.abilities) s.abilities = HALL_OF_FAME_DEX[s.id].abilities;
      }
    });

    return evoChainCache[pokeId];
  } catch (e) {
    const numId = Number(pokemonIdOrName) || 130;
    const fallback = evoChainCache[numId] || { chain: [numId], nextId: null, baseId: numId };
    return fallback;
  }
}

function getSpriteUrl(id, shiny) {
  if (shiny) {
    return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/shiny/' + id + '.gif';
  }
  return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/' + id + '.gif';
}

function getArtworkFallbackUrl(id, shiny) {
  if (shiny) {
    return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/shiny/' + id + '.png';
  }
  return 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/' + id + '.png';
}

function getEffectiveSlotSpectrum(slotObj) {
  const base = ELEMENTAL_SPECTRUM[slotObj.type] || ELEMENTAL_SPECTRUM.water;
  if (!slotObj.shiny) return base;
  if (slotObj.id === 130) {
    return { ...base, hex: '#EF4444', rgb: '239, 68, 68', label: 'SHINY WATER' };
  }
  if (slotObj.id === 59 || slotObj.id === 58) {
    return { ...base, hex: '#FACC15', rgb: '250, 204, 21', label: 'SHINY FIRE' };
  }
  if (slotObj.id === 6) {
    return { ...base, hex: '#F43F5E', rgb: '244, 63, 94', label: 'SHINY FIRE' };
  }
  if (slotObj.id === 197) {
    return { ...base, hex: '#38BDF8', rgb: '56, 189, 248', label: 'SHINY DARK' };
  }
  return { ...base, hex: '#FACC15', rgb: '250, 204, 21', label: 'SHINY ' + base.label };
}

const STATUS_BADGE_STYLES = {
  BRN: { label: '🔥 BURN',      cls: 'bg-orange-500/30 text-orange-200 border border-orange-400/70' },
  PAR: { label: '⚡ PARALYSIS', cls: 'bg-amber-500/30 text-amber-200 border border-amber-400/70' },
  SLP: { label: '💤 SLEEP',     cls: 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/70' },
  PSN: { label: '☠️ POISON',    cls: 'bg-purple-500/30 text-purple-200 border border-purple-400/70' },
  FRZ: { label: '❄️ FREEZE',    cls: 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/70' },
  SHD: { label: '🛡️ SHIELD',    cls: 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/70' }
};

const MOVE_AP_COSTS = [5, 9, 12, 18];
const MOVE_COOLDOWN_TURNS = [0, 1, 2, 0];

function getFourMovesForPokemon(slotObj) {
  const defaultStatusByType = {
    fire:     { code: 'BRN', chance: 0.45 },
    electric: { code: 'PAR', chance: 0.45 },
    ice:      { code: 'FRZ', chance: 0.40 },
    poison:   { code: 'PSN', chance: 0.45 },
    psychic:  { code: 'SLP', chance: 0.40 },
    ghost:    { code: 'SLP', chance: 0.40 },
    steel:    { code: 'SHD', chance: 0.45 },
    rock:     { code: 'SHD', chance: 0.45 },
    water:    { code: 'FRZ', chance: 0.35 },
    dragon:   { code: 'PAR', chance: 0.35 },
    dark:     { code: 'PSN', chance: 0.40 },
    grass:    { code: 'SLP', chance: 0.40 },
    flying:   { code: 'PAR', chance: 0.35 },
    fighting: { code: 'BRN', chance: 0.35 },
    ground:   { code: 'SHD', chance: 0.40 },
    fairy:    { code: 'SLP', chance: 0.40 },
    bug:      { code: 'PSN', chance: 0.45 },
    normal:   { code: 'PAR', chance: 0.35 }
  };

  const sig = SIGNATURE_MOVES_BY_ID[slotObj.id];
  if (Array.isArray(sig) && sig.length === 4) {
    return sig.map((m, idx) => ({
      ...m,
      apCost: MOVE_AP_COSTS[idx] || 5,
      cooldownTurns: MOVE_COOLDOWN_TURNS[idx] || 0,
      ultimate: idx === 3 || Boolean(m.ultimate),
      status: m.status || (idx === 2 ? (defaultStatusByType[String(m.type || 'normal').toLowerCase()] || { code: 'PAR', chance: 0.40 }) : null),
      acc: Number(m.acc || (m.ultimate ? 95 : 100)),
      maxPp: Number(m.maxPp || (m.ultimate ? 5 : 15))
    }));
  }

  const primaryType = String((slotObj.types && slotObj.types[0]) || slotObj.type || 'normal').toLowerCase();
  const secondaryType = String((slotObj.types && slotObj.types[1]) || primaryType).toLowerCase();
  const basePool = TYPE_MOVE_POOL[primaryType] || TYPE_MOVE_POOL.normal;
  const secPool = TYPE_MOVE_POOL[secondaryType] || basePool;

  const moves = [
    { ...basePool[0], apCost: 5,  cooldownTurns: 0, acc: 100, maxPp: 15 },
    { ...basePool[1], apCost: 9,  cooldownTurns: 1, acc: 95,  maxPp: 10 },
    secondaryType !== primaryType
      ? { ...secPool[0], apCost: 12, cooldownTurns: 2, acc: 100, maxPp: 15, status: defaultStatusByType[secondaryType] || { code: 'PAR', chance: 0.40 } }
      : { ...basePool[2], apCost: 12, cooldownTurns: 2, acc: 100, maxPp: 15, status: defaultStatusByType[primaryType] || { code: 'BRN', chance: 0.40 } },
    { ...basePool[3], apCost: 18, cooldownTurns: 0, acc: 95,  maxPp: 5, ultimate: true, status: defaultStatusByType[primaryType] || { code: 'BRN', chance: 0.45 } }
  ];

  if (Array.isArray(slotObj.moves) && slotObj.moves.length > 0) {
    for (let i = 0; i < Math.min(2, slotObj.moves.length); i++) {
      if (slotObj.moves[i]) {
        moves[i].name = slotObj.moves[i];
      }
    }
  }
  return moves;
}

function computeMoveEffectiveness(moveType, defTypes) {
  const atkT = String(moveType || 'normal').toLowerCase();
  const chart = TYPE_CHART_18[atkT] || {};
  const dList = Array.isArray(defTypes) && defTypes.length > 0 ? defTypes : ['normal'];
  let mult = 1;
  dList.forEach(dt => {
    const dKey = String(dt || 'normal').toLowerCase();
    if (chart[dKey] !== undefined) mult *= chart[dKey];
  });
  return Number(mult.toFixed(2));
}

function calcMaxHpForSlot(slotObj) {
  const dex = HALL_OF_FAME_DEX[slotObj.id] || {};
  const baseHp = Number((slotObj.stats && slotObj.stats.hp) || (dex.stats && dex.stats.hp) || 80);
  const megaMult = slotObj.megaActive ? 1.35 : 1.0;
  return Math.round(((baseHp * 2.5) + 110) * megaMult);
}

