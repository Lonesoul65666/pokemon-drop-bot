import axios from 'axios';
import { getNextProxy } from './lgsPoller';
import { processIncomingDrop } from './listener';
import { WATCH_POLICIES, getMinPlausiblePriceFloor, getMaxPlausiblePriceCeiling, isValidSkuForFormFactor } from './policies';
import { isValidCompTitle } from './marketComps';
import { markLiveStockOut } from './evaluator';

const seenRedditIds = new Set<string>();
const lowestTcgSeenMap = new Map<string, { lowestPrice: number; timestamp: number }>();
const seenBigBoxOffers = new Map<string, number>();

const TRACKALACKER_PAGES = [
  { slug: 'pokemon-30th-celebration-elite-trainer-box', title: 'Pokemon 30th Celebration Elite Trainer Box', formFactor: 'ETB' },
  { slug: 'pokemon-prismatic-evolutions-elite-trainer-box', title: 'Pokemon Prismatic Evolutions Elite Trainer Box', formFactor: 'ETB' },
  { slug: 'pokemon-prismatic-evolutions-booster-bundle', title: 'Pokemon Prismatic Evolutions Booster Bundle', formFactor: 'Booster Bundle' },
  { slug: 'pokemon-scarlet-and-violet-151-booster-bundle', title: 'Pokemon Scarlet & Violet 151 Booster Bundle', formFactor: 'Booster Bundle' },
  { slug: 'pokemon-scarlet-and-violet-151-elite-trainer-box', title: 'Pokemon Scarlet & Violet 151 Elite Trainer Box', formFactor: 'ETB' },
  { slug: 'pokemon-destined-rivals-elite-trainer-box', title: 'Pokemon Destined Rivals Elite Trainer Box', formFactor: 'ETB' },
  { slug: 'pokemon-destined-rivals-booster-box', title: 'Pokemon Destined Rivals Booster Box', formFactor: 'Booster Box' },
  { slug: 'pokemon-surging-sparks-elite-trainer-box', title: 'Pokemon Surging Sparks Elite Trainer Box', formFactor: 'ETB' },
  { slug: 'pokemon-surging-sparks-booster-box', title: 'Pokemon Surging Sparks Booster Box', formFactor: 'Booster Box' }
];

async function smartGet(url: string, headers: Record<string, string>, timeout = 8000) {
  try {
    return await axios.get(url, { timeout, headers });
  } catch (e) {
    return await axios.get(url, { timeout, httpsAgent: getNextProxy(), headers });
  }
}

async function smartPost(url: string, body: any, headers: Record<string, string>, timeout = 6000) {
  try {
    return await axios.post(url, body, { timeout, headers });
  } catch (e) {
    return await axios.post(url, body, { timeout, httpsAgent: getNextProxy(), headers });
  }
}

let tlCursor = 0;
let isPollingBigBox = false;
export async function pollBigBoxAggregators(): Promise<void> {
  if (isPollingBigBox) return;
  isPollingBigBox = true;
  const target = TRACKALACKER_PAGES[tlCursor % TRACKALACKER_PAGES.length];
  tlCursor = (tlCursor + 1) % TRACKALACKER_PAGES.length;

  try {
    const url = `https://www.trackalacker.com/products/showcase/${target.slug}`;
    const res = await smartGet(url, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml'
    }, 8000);

    const html: string = res.data || '';
    const offerBlocks = [...html.matchAll(/\{[^{}]*"availability"\s*:\s*"https?:\/\/schema\.org\/InStock"[^{}]*\}/gi)];
    for (const m of offerBlocks) {
      const raw = m[0];
      const priceMatch = raw.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/i);
      const sellerMatch = raw.match(/"name"\s*:\s*"([^"]+)"/i);
      const urlMatch = raw.match(/"url"\s*:\s*"([^"]+)"/i);

      if (priceMatch) {
        const price = parseFloat(priceMatch[1]);
        if (!isValidSkuForFormFactor(target.title, target.formFactor, price)) continue;

        const retailer = sellerMatch ? sellerMatch[1] : 'Big-Box Retailer';
        if (/ebay|tcgplayer|stockx|goat|mercari/i.test(retailer)) continue;

        const offerKey = `${target.slug}_${retailer}_${price}`;
        const lastSeen = seenBigBoxOffers.get(offerKey) || 0;
        if (Date.now() - lastSeen > 1000 * 60 * 60 * 4) {
          seenBigBoxOffers.set(offerKey, Date.now());
          const isPreOrder = /pre-?order|pre-?sale/i.test(`${target.title} ${raw}`);
          const isBigBoxFreeShip = price >= 35 && /target|best buy|walmart|amazon|costco|gamestop|pokemon center/i.test(retailer);
          await processIncomingDrop({
            title: target.title,
            retailer: `${retailer} (Big-Box Restock)`,
            url: urlMatch ? urlMatch[1] : url,
            price,
            stock: undefined,
            itemId: offerKey,
            isPreOrder,
            freeShipping: isBigBoxFreeShip
          });
        }
      }
    }
  } catch (e) {
  } finally {
    isPollingBigBox = false;
    setTimeout(pollBigBoxAggregators, 12000);
  }
}

let isPollingReddit = false;
export async function pollRedditDeals(): Promise<void> {
  if (isPollingReddit) return;
  isPollingReddit = true;
  try {
    const res = await smartGet('https://www.reddit.com/r/PKMNTCGDeals/new.json?limit=15', {
      'User-Agent': 'Windows:DropBotCommander:v3.2 (by /u/Lonesoul65666)',
      Accept: 'application/json'
    }, 8000);

    const posts = res.data?.data?.children || [];
    for (const child of posts) {
      const post = child.data;
      if (!post || seenRedditIds.has(post.id)) continue;
      seenRedditIds.add(post.id);

      const ageSeconds = (Date.now() / 1000) - (post.created_utc || 0);
      if (ageSeconds > 7200) continue;

      const title: string = post.title || '';
      if (/stockx/i.test(title)) continue;

      const priceMatch = title.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[1]);
      if (price < 18) continue;

      const dealUrl = post.url_overridden_by_dest || `https://www.reddit.com${post.permalink}`;

      const storeMatch = title.match(/^\[([^\]]+)\]/);
      const retailer = storeMatch ? `${storeMatch[1]} (via PKMNTCGDeals)` : 'r/PKMNTCGDeals Alert';
      const isPreOrder = /pre-?order|pre-?sale/i.test(`${title} ${post.link_flair_text || ''}`);
      const freeShipping = /free ship|fs/i.test(title);

      await processIncomingDrop({
        title,
        retailer,
        url: dealUrl,
        price,
        stock: undefined,
        itemId: `reddit_${post.id}`,
        isPreOrder,
        freeShipping
      });
    }
  } catch (e) {
  } finally {
    isPollingReddit = false;
    setTimeout(pollRedditDeals, 60000);
  }
}

function doesTcgResultMatchFormFactor(title: string, targetName: string, formFactor: string, price?: number, ruleId?: string): boolean {
  if (!isValidCompTitle(title, targetName, formFactor, price, ruleId)) return false;
  const t = title.toLowerCase();

  if (formFactor === 'ETB Case') {
    return (t.includes('elite trainer') || t.includes('etb')) && t.includes('case');
  }
  if (formFactor === 'Master Case') {
    return (t.includes('booster box') || t.includes('display')) && t.includes('case') && !t.includes('bundle') && !t.includes('etb');
  }
  if (formFactor === 'ETB') {
    return (t.includes('elite trainer') || t.includes('etb')) && !t.includes('case') && !t.includes('center');
  }
  if (formFactor === 'Booster Box') {
    return (t.includes('booster box') || t.includes('display')) && !t.includes('case') && !t.includes('bundle');
  }
  if (formFactor === 'Booster Bundle') {
    return t.includes('bundle') && !t.includes('case');
  }
  return true;
}

async function getBestVerifiedTcgSeller(prodId: number, minFloor: number, maxCeiling: number): Promise<{ price: number; shipping: number; sellerName: string; rating: number; sales: number } | null> {
  try {
    const url = `https://mp-search-api.tcgplayer.com/v1/product/${prodId}/listings`;
    const body = {
      filters: {
        term: { sellerStatus: "Live", channelId: 0, language: ["English"] },
        range: { quantity: { gte: 1 } },
        exclude: { channelExclusion: 0 }
      },
      from: 0,
      size: 10,
      sort: { field: "price+shipping", order: "asc" },
      context: { shippingCountry: "US", cart: {} }
    };
    const res = await smartPost(url, body, { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, 8000);
    const listings = res.data?.results?.[0]?.results || [];
    for (const l of listings) {
      const rating = parseFloat(l.sellerRating || 100);
      if (rating < 95) continue;
      const itemPrice = parseFloat(l.price || 0);
      const shipPrice = parseFloat(l.shippingPrice || 0);
      const total = Math.round((itemPrice + shipPrice) * 100) / 100;
      if (itemPrice > 0 && total >= minFloor && total <= maxCeiling) {
        return {
          price: total,
          shipping: shipPrice,
          sellerName: l.sellerName || 'Verified Shop',
          rating,
          sales: parseInt(l.completedSales || l.sellerSales || '500', 10)
        };
      }
    }
  } catch (e) {}
  return null;
}

let tcgCursor = 0;
let isPollingTcg = false;
export async function pollTcgPlayerUndercuts(): Promise<void> {
  if (isPollingTcg) return;
  isPollingTcg = true;

  try {
    const activePolicies = WATCH_POLICIES.filter((p: any) => p.active !== false);
    if (activePolicies.length === 0) {
      return;
    }

    for (let i = 0; i < 6; i++) {
      const policy = activePolicies[tcgCursor % activePolicies.length];
      tcgCursor = (tcgCursor + 1) % activePolicies.length;
      const formFactor = policy.formFactor || 'Booster Box';
      const minFloor = getMinPlausiblePriceFloor(formFactor);
      const maxCeiling = getMaxPlausiblePriceCeiling(formFactor, policy.id, policy.name);

      try {
        if ((policy as any).tcgProductId) {
          const prodId = (policy as any).tcgProductId;
          const bestSeller = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling);
          if (bestSeller && bestSeller.price >= minFloor && bestSeller.price <= maxCeiling) {
            const prev = lowestTcgSeenMap.get(policy.id);
            const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;
            if (!prev || bestSeller.price <= prev.lowestPrice - 2 || minsSinceLast >= 15) {
              lowestTcgSeenMap.set(policy.id, { lowestPrice: bestSeller.price, timestamp: Date.now() });
              await processIncomingDrop({
                title: policy.name,
                retailer: `${bestSeller.sellerName} (TCGPlayer • ${bestSeller.rating}%)`,
                url: `https://www.tcgplayer.com/product/${prodId}?Language=English`,
                price: bestSeller.price,
                stock: undefined,
                itemId: `tcg_${prodId}`,
                freeShipping: true
              });
            }
          }
          continue;
        }

        const cleanQ = policy.name
          .replace(/\(.*?\)/g, '')
          .replace(/6-Pack /gi, '')
          .replace(/Sealed /gi, '')
          .replace(/Mega Evolution:/gi, '')
          .replace(/Scarlet & Violet:/gi, '')
          .replace(/ETB/gi, 'Elite Trainer Box')
          .trim();

        const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(cleanQ)}&isList=false`;
        const body = {
          algorithm: "sales_synonym_v2",
          from: 0,
          size: 12,
          filters: { term: { productLineName: ["pokemon"] }, range: {}, match: {} },
          listingSearch: { context: { cart: {} }, filters: { term: { sellerStatus: "Live", channelId: 0 }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } } },
          context: { cart: {}, shippingCountry: "US" },
          settings: { useFuzzySearch: true, didYouMean: {} },
          sort: {}
        };

        const res = await smartPost(url, body, { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, 8000);

        const results = res.data?.results?.[0]?.results || [];
        for (const item of results) {
          if (item.customAttributes?.number) continue;
          const prodTitle = `${item.productName || ''} ${item.setName || ''}`.trim();
          if (!doesTcgResultMatchFormFactor(prodTitle, policy.name, formFactor, undefined, policy.id)) continue;

          const prodId = Math.floor(Number(item.productId));
          const bestSeller = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling);
          const fallbackCandidate = parseFloat(item.lowestPriceWithShipping || item.lowestPrice || 0);
          const lowestPrice = bestSeller ? bestSeller.price : fallbackCandidate;
          if (!lowestPrice || lowestPrice < minFloor || lowestPrice > maxCeiling) continue;

          const shopLabel = bestSeller
            ? `${bestSeller.sellerName} (TCGPlayer • ${bestSeller.rating}%)`
            : 'TCGPlayer Verified Seller';

          const effectiveCeiling = Math.max(policy.msrpCeiling || 0, policy.maxMarketBuyPrice || 0);
          if (lowestPrice > effectiveCeiling) {
            markLiveStockOut(`tcg_${prodId}`);
            break;
          }

          const prev = lowestTcgSeenMap.get(policy.id);
          const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;

          if (!prev || lowestPrice <= prev.lowestPrice - 2 || minsSinceLast >= 15) {
            lowestTcgSeenMap.set(policy.id, { lowestPrice, timestamp: Date.now() });
            const isPreOrder = /pre-?order|pre-?sale/i.test(prodTitle);
            await processIncomingDrop({
              title: prodTitle,
              retailer: shopLabel,
              url: `https://www.tcgplayer.com/product/${prodId}?Language=English`,
              price: lowestPrice,
              stock: undefined,
              itemId: `tcg_${prodId}`,
              isPreOrder,
              freeShipping: true
            });
          }
          break;
        }
      } catch (e) {}
    }
  } finally {
    isPollingTcg = false;
    setTimeout(pollTcgPlayerUndercuts, 12000);
  }
}
