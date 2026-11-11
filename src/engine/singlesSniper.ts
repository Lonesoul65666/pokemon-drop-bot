import fs from 'fs';
import path from 'path';
import {
  atomicWriteJson,
  loadGlobalSettings,
  saveGlobalSettingsFromUi,
  getStoreShippingProfileFromRegistry
} from '../config/configManager';
import { isCollectibleSingleCardOrSlab } from '../../policies';

export const SINGLES_CACHE_PATH = path.resolve(process.cwd(), 'singlesCache.json');

export interface RawSingleCardOfferInput {
  title: string;
  storeName: string;
  price: number;
  compareAtPrice?: number;
  url: string;
  itemId?: string;
  productType?: string;
  tags?: string | string[];
  stock?: number;
  image?: string;
}

export interface SingleCardOfferRecord {
  id: string;
  cardKey: string;
  title: string;
  storeName: string;
  price: number;
  shipping: number;
  landedPrice: number;
  compPrice: number;
  discountPct: number;
  savingsDollars: number;
  conditionOrGrade: string;
  cardNumber: string;
  isSlab: boolean;
  isFavoriteMatch: boolean;
  matchedFavoritePokemon?: string;
  isOffloadSnipe: boolean;
  snipeBadge?: string;
  url: string;
  itemId?: string;
  stock?: number;
  image?: string;
  updatedAt: number;
}

interface SinglesCacheFile {
  updatedAt: number;
  compBenchmarks: Record<string, { highPrice: number; medianPrice: number; samples: number[]; updatedAt: number }>;
  offers: Record<string, SingleCardOfferRecord>;
}

let singlesCacheMem: SinglesCacheFile = { updatedAt: Date.now(), compBenchmarks: {}, offers: {} };
let flushTimer: any = null;

const SEED_GYARADOS_BENCHMARKS: SingleCardOfferRecord[] = [
  {
    id: 'seed::Zulus Games::gyarados-ex-225-198',
    cardKey: 'gyarados ex 225/198 scarlet violet base',
    title: 'Gyarados ex - 225/198 - Scarlet & Violet Base Set (Ultra Rare Tera Full Art Single - NM)',
    storeName: 'Zulus Games',
    price: 16.50, shipping: 0, landedPrice: 16.50, compPrice: 22.99, discountPct: 28, savingsDollars: 6.49,
    conditionOrGrade: 'NM (Raw Single)', cardNumber: '225/198', isSlab: false, isFavoriteMatch: true,
    matchedFavoritePokemon: 'Gyarados', isOffloadSnipe: true,
    snipeBadge: '◈ ⟦ FAVORITE OFFLOAD SNIPE // GYARADOS (-28% VS COMP) ⟧',
    url: 'https://zulusgames.com/collections/pokemon', itemId: 'gyarados_ex_225_198', stock: 2, updatedAt: Date.now()
  },
  {
    id: 'seed::Full Grip Games::gyarados-ao-21-98',
    cardKey: 'gyarados 21/98 ancient origins holo',
    title: 'Gyarados (Ancient Origins 21/98) - Holo Rare Ancient Trait Single Card (Near Mint)',
    storeName: 'Full Grip Games',
    price: 24.00, shipping: 0, landedPrice: 24.00, compPrice: 31.50, discountPct: 24, savingsDollars: 7.50,
    conditionOrGrade: 'NM (Holo Single)', cardNumber: '21/98', isSlab: false, isFavoriteMatch: true,
    matchedFavoritePokemon: 'Gyarados', isOffloadSnipe: true,
    snipeBadge: '◈ ⟦ FAVORITE OFFLOAD SNIPE // GYARADOS (-24% VS COMP) ⟧',
    url: 'https://www.fullgripgames.com/collections/pokemon', itemId: 'gyarados_ao_21_98', stock: 1, updatedAt: Date.now()
  },
  {
    id: 'seed::Over The Brick::mega-gyarados-ex-115-122',
    cardKey: 'm gyarados ex 115/122 breakpoint full art',
    title: 'M Gyarados EX - 115/122 - XY BREAKpoint Full Art Shiny Single Card (NM)',
    storeName: 'Over The Brick',
    price: 58.00, shipping: 0, landedPrice: 58.00, compPrice: 64.99, discountPct: 11, savingsDollars: 6.99,
    conditionOrGrade: 'NM (Full Art Single)', cardNumber: '115/122', isSlab: false, isFavoriteMatch: true,
    matchedFavoritePokemon: 'Gyarados', isOffloadSnipe: false,
    snipeBadge: '◈ ⟦ FAVORITE WATCH // GYARADOS (-11% VS COMP) ⟧',
    url: 'https://overthebrick.com/collections/pokemon', itemId: 'm_gyarados_ex_115_122', stock: 1, updatedAt: Date.now()
  }
];

function pruneCompBenchmarksLru(maxKeys = 500): boolean {
  const entries = Object.entries(singlesCacheMem.compBenchmarks || {});
  if (entries.length <= maxKeys) return false;
  entries.sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0));
  const nextBench: typeof singlesCacheMem.compBenchmarks = {};
  for (const [k, v] of entries.slice(0, maxKeys)) nextBench[k] = v;
  singlesCacheMem.compBenchmarks = nextBench;
  return true;
}

function loadSinglesCacheFromDisk(): void {
  try {
    if (fs.existsSync(SINGLES_CACHE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SINGLES_CACHE_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object' && parsed.offers) {
        singlesCacheMem = {
          updatedAt: Number(parsed.updatedAt || Date.now()),
          compBenchmarks: parsed.compBenchmarks || {},
          offers: parsed.offers || {}
        };
      }
    }
  } catch {}
  let mutated = pruneCompBenchmarksLru(500);
  for (const seed of SEED_GYARADOS_BENCHMARKS) {
    if (!singlesCacheMem.offers[seed.id]) {
      singlesCacheMem.offers[seed.id] = seed;
      mutated = true;
    }
  }
  if (mutated) {
    try { atomicWriteJson(SINGLES_CACHE_PATH, singlesCacheMem); } catch {}
  }
}

loadSinglesCacheFromDisk();

function scheduleSinglesCacheFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    try {
      singlesCacheMem.updatedAt = Date.now();
      atomicWriteJson(SINGLES_CACHE_PATH, singlesCacheMem);
    } catch {}
  }, 2000);
}

export function extractCardNumber(title: string): string {
  const slashMatch = title.match(/\b(\d{1,3}\s*\/\s*\d{1,3})\b/);
  if (slashMatch) return slashMatch[1].replace(/\s+/g, '');
  const codeMatch = title.match(/\b((?:sv|tg|gg|swsh|sm|xy|svp)[0-9]{1,3})\b/i);
  if (codeMatch) return codeMatch[1].toUpperCase();
  const hashMatch = title.match(/#([0-9]{1,4})\b/);
  if (hashMatch) return `#${hashMatch[1]}`;
  return 'SINGLE';
}

export function extractConditionOrGrade(title: string): string {
  const slabMatch = title.match(/\b(PSA|CGC|BGS|SGC|Beckett)\s*(?:Gem\s*Mint\s*|Pristine\s*|Mint\s*)?([0-9]{1,2}(?:\.[0-9])?)\b/i);
  if (slabMatch) return `${slabMatch[1].toUpperCase()} ${slabMatch[2]}`;
  if (/\bgem\s*mint\s*10\b/i.test(title)) return 'GEM MINT 10';
  if (/\b(near\s*mint|\bnm\b)\b/i.test(title)) return 'NM (Raw Single)';
  if (/\b(lightly\s*played|\blp\b)\b/i.test(title)) return 'LP (Raw Single)';
  if (/\b(moderately\s*played|\bmp\b)\b/i.test(title)) return 'MP (Raw Single)';
  return 'Raw Single';
}

export function normalizeSingleCardKey(title: string): string {
  const num = extractCardNumber(title).toLowerCase();
  const cond = extractConditionOrGrade(title).toLowerCase();
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9/\s]/g, ' ')
    .replace(/\b(pokemon|tcg|single|card|near|mint|nm|lp|mp|hp|holo|reverse|foil|ungraded|raw)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 6)
    .join(' ');
  return `${words}::${num}::${cond}`;
}

function matchFavoritePokemon(title: string, watchlist: string[]): string | undefined {
  for (const fav of watchlist) {
    const cleanFav = String(fav || '').trim();
    if (!cleanFav) continue;
    const escaped = cleanFav.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(title)) return cleanFav;
  }
  return undefined;
}

export function ingestSingleCardOffer(input: RawSingleCardOfferInput): SingleCardOfferRecord | null {
  const cleanTitle = String(input.title || '').trim();
  if (!cleanTitle) return null;

  const settings = loadGlobalSettings();
  const minTrackPrice = Math.max(10, Number(settings.minSinglesTrackPrice ?? 15));
  const price = Math.round(Number(input.price || 0) * 100) / 100;
  if (!Number.isFinite(price) || price < minTrackPrice) return null;
  if (!isCollectibleSingleCardOrSlab(cleanTitle, input.productType, input.tags)) return null;

  const shipProfile = getStoreShippingProfileFromRegistry(input.storeName);
  const shipping = price >= shipProfile.freeShipThreshold ? 0 : Math.min(4.99, shipProfile.flatShipping);
  const landedPrice = Math.round((price + shipping) * 100) / 100;
  const cardKey = normalizeSingleCardKey(cleanTitle);
  const cardNumber = extractCardNumber(cleanTitle);
  const conditionOrGrade = extractConditionOrGrade(cleanTitle);
  const isSlab = /\b(psa|cgc|bgs|sgc|beckett|slab|graded|gem\s*mint)\b/i.test(`${cleanTitle} ${conditionOrGrade}`);

  const existingBench = singlesCacheMem.compBenchmarks[cardKey] || {
    highPrice: price, medianPrice: price, samples: [], updatedAt: Date.now()
  };
  const compareAt = Number(input.compareAtPrice || 0);
  const refSample = compareAt > price ? compareAt : price;
  const nextSamples = [...existingBench.samples.slice(-14), refSample];
  const sortedSamples = [...nextSamples].sort((a, b) => a - b);
  const medianSample = sortedSamples[Math.floor(sortedSamples.length / 2)] || price;
  const highSample = Math.max(existingBench.highPrice || price, compareAt || 0, medianSample);
  const compPrice = Math.round(Math.max(medianSample, highSample * 0.92, price) * 100) / 100;

  singlesCacheMem.compBenchmarks[cardKey] = {
    highPrice: highSample, medianPrice: medianSample, samples: nextSamples, updatedAt: Date.now()
  };

  const savingsDollars = Math.max(0, Math.round((compPrice - price) * 100) / 100);
  const discountPct = compPrice > price ? Math.round(((compPrice - price) / compPrice) * 100) : 0;

  const watchlist = Array.isArray(settings.favoritePokemonWatchlist) && settings.favoritePokemonWatchlist.length > 0
    ? settings.favoritePokemonWatchlist : ['Gyarados'];
  const matchedFavoritePokemon = matchFavoritePokemon(cleanTitle, watchlist);
  const isFavoriteMatch = Boolean(matchedFavoritePokemon);
  const isOffloadSnipe = Boolean(isFavoriteMatch && discountPct >= 20);
  const favUpper = (matchedFavoritePokemon || 'FAVORITE').toUpperCase();

  let snipeBadge: string | undefined = undefined;
  if (isOffloadSnipe) {
    snipeBadge = `◈ ⟦ FAVORITE OFFLOAD SNIPE // ${favUpper} (-${discountPct}% VS COMP) ⟧`;
  } else if (isFavoriteMatch) {
    snipeBadge = discountPct > 0
      ? `◈ ⟦ FAVORITE WATCH // ${favUpper} (-${discountPct}% VS COMP) ⟧`
      : `◈ ⟦ FAVORITE WATCH // ${favUpper} ⟧`;
  }

  const recordId = `${input.storeName}::${input.itemId || cardKey}`;
  const record: SingleCardOfferRecord = {
    id: recordId, cardKey, title: cleanTitle, storeName: input.storeName, price, shipping, landedPrice,
    compPrice, discountPct, savingsDollars, conditionOrGrade, cardNumber, isSlab, isFavoriteMatch,
    matchedFavoritePokemon, isOffloadSnipe, snipeBadge, url: input.url, itemId: input.itemId,
    stock: input.stock, image: input.image, updatedAt: Date.now()
  };

  singlesCacheMem.offers[recordId] = record;
  const allEntries = Object.values(singlesCacheMem.offers);
  if (allEntries.length > 600) {
    allEntries.sort((a, b) => (Number(b.isFavoriteMatch) - Number(a.isFavoriteMatch)) || (b.updatedAt - a.updatedAt));
    const trimmed: Record<string, SingleCardOfferRecord> = {};
    for (const item of allEntries.slice(0, 500)) trimmed[item.id] = item;
    singlesCacheMem.offers = trimmed;
  }
  if (Object.keys(singlesCacheMem.compBenchmarks).length > 500) {
    pruneCompBenchmarksLru(500);
  }

  scheduleSinglesCacheFlush();
  // Hard Rule (V5 Slice 6): Single cards and slabs NEVER fire notifications (singlesAlertsEnabled = false enforced).
  return record;
}

export function querySinglesCache(options?: { q?: string; favoritesOnly?: boolean; limit?: number }) {
  const settings = loadGlobalSettings();
  const watchlist = Array.isArray(settings.favoritePokemonWatchlist) && settings.favoritePokemonWatchlist.length > 0
    ? settings.favoritePokemonWatchlist : ['Gyarados'];
  const q = String(options?.q || '').trim().toLowerCase();
  const favoritesOnly = Boolean(options?.favoritesOnly);
  const limit = Math.min(200, Math.max(1, Number(options?.limit || 60)));

  const allOffers = Object.values(singlesCacheMem.offers || {}).map((rec) => {
    const matchedFav = matchFavoritePokemon(rec.title, watchlist);
    const isFav = Boolean(matchedFav);
    const isOffload = Boolean(isFav && rec.discountPct >= 20);
    const favUpper = (matchedFav || 'FAVORITE').toUpperCase();
    const badge = isOffload
      ? `◈ ⟦ FAVORITE OFFLOAD SNIPE // ${favUpper} (-${rec.discountPct}% VS COMP) ⟧`
      : (isFav ? `◈ ⟦ FAVORITE WATCH // ${favUpper}${rec.discountPct > 0 ? ` (-${rec.discountPct}% VS COMP)` : ''} ⟧` : undefined);
    return { ...rec, isFavoriteMatch: isFav, matchedFavoritePokemon: matchedFav, isOffloadSnipe: isOffload, snipeBadge: badge };
  });

  const filtered = allOffers.filter((rec) => {
    if (favoritesOnly && !rec.isFavoriteMatch) return false;
    if (q) {
      const hay = `${rec.title} ${rec.storeName} ${rec.cardNumber} ${rec.conditionOrGrade} ${rec.matchedFavoritePokemon || ''}`.toLowerCase();
      return q.split(/\s+/).every((tok) => hay.includes(tok));
    }
    return true;
  });

  filtered.sort((a, b) => (Number(b.isOffloadSnipe) - Number(a.isOffloadSnipe)) || (Number(b.isFavoriteMatch) - Number(a.isFavoriteMatch)) || (b.discountPct - a.discountPct) || (a.price - b.price));

  return {
    ok: true,
    totalCached: allOffers.length,
    favoritesCount: allOffers.filter((o) => o.isFavoriteMatch).length,
    offloadSnipesCount: allOffers.filter((o) => o.isOffloadSnipe).length,
    watchlist,
    singlesAlertsEnabled: Boolean(settings.singlesAlertsEnabled),
    minSinglesTrackPrice: Number(settings.minSinglesTrackPrice ?? 15),
    results: filtered.slice(0, limit)
  };
}

export function updateSinglesWatchlist(payload: {
  favoritePokemonWatchlist?: string[];
  addPokemon?: string;
  removePokemon?: string;
  singlesAlertsEnabled?: boolean;
  minSinglesTrackPrice?: number;
}) {
  const current = loadGlobalSettings();
  let list = Array.isArray(payload.favoritePokemonWatchlist)
    ? payload.favoritePokemonWatchlist.map((s) => String(s || '').trim()).filter(Boolean)
    : [...(current.favoritePokemonWatchlist || ['Gyarados'])];

  if (payload.addPokemon) {
    const cleanAdd = String(payload.addPokemon).trim();
    if (cleanAdd && !list.some((x) => x.toLowerCase() === cleanAdd.toLowerCase())) list.push(cleanAdd);
  }
  if (payload.removePokemon) {
    const cleanRem = String(payload.removePokemon).trim().toLowerCase();
    list = list.filter((x) => x.toLowerCase() !== cleanRem);
  }
  if (list.length === 0) list = ['Gyarados'];

  saveGlobalSettingsFromUi({
    favoritePokemonWatchlist: list,
    singlesAlertsEnabled: false,
    minSinglesTrackPrice: payload.minSinglesTrackPrice !== undefined ? Number(payload.minSinglesTrackPrice) : current.minSinglesTrackPrice
  });
  return querySinglesCache({ favoritesOnly: false });
}
