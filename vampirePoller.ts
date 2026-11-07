import axios from 'axios';
import { getNextProxy, recordBigBoxCheckTelemetry } from './lgsPoller';
import { processIncomingDrop } from './listener';
import {
  WATCH_POLICIES,
  getMinPlausiblePriceFloor,
  getMaxPlausiblePriceCeiling,
  isValidSkuForFormFactor,
  isSingleCardOrNonSealed,
  hasMandatorySealedContainerKeyword,
  detectBigBoxRetailer
} from './policies';
import { isValidCompTitle } from './marketComps';
import { markLiveStockOut, clearTcgOosStrikes } from './evaluator';
import {
  BIG_BOX_STORES,
  pollBigBoxAggregators,
  pollPokemonCenterDirectMsrp
} from './src/pollers/bigBoxRetailPoller';

export { BIG_BOX_STORES, pollBigBoxAggregators, pollPokemonCenterDirectMsrp };

const seenRedditIds = new Set<string>();
const lowestTcgSeenMap = new Map<string, { lowestPrice: number; timestamp: number; inStockUnderTrigger: boolean; oosStrikes: number }>();

function isShippingScam(itemPrice: number, shippingPrice?: number, _formFactor?: string): boolean {
  if (shippingPrice === undefined || shippingPrice <= 0) return false;
  if (shippingPrice > 35.00) return true;
  if (itemPrice > 0 && shippingPrice > itemPrice * 0.20) return true;
  return false;
}

async function axiosRequestWithAbort(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  timeout: number,
  body?: any,
  httpsAgent?: any
) {
  const safeTimeout = Math.min(timeout, 10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), safeTimeout);
  try {
    if (method === 'POST') {
      return await axios.post(url, body, { timeout: safeTimeout, signal: controller.signal, httpsAgent, headers });
    }
    return await axios.get(url, { timeout: safeTimeout, signal: controller.signal, httpsAgent, headers });
  } finally {
    clearTimeout(timer);
  }
}

async function smartGet(url: string, headers: Record<string, string>, timeout = 8000) {
  try {
    return await axiosRequestWithAbort('GET', url, headers, timeout);
  } catch (e) {
    return await axiosRequestWithAbort('GET', url, headers, timeout, undefined, getNextProxy());
  }
}

async function smartPost(url: string, body: any, headers: Record<string, string>, timeout = 6000) {
  try {
    return await axiosRequestWithAbort('POST', url, headers, timeout, body);
  } catch (e) {
    return await axiosRequestWithAbort('POST', url, headers, timeout, body, getNextProxy());
  }
}

function extractOutboundRetailerUrl(text: string, fallbackUrl: string): string {
  const urlMatch = text.match(/https?:\/\/(?:www\.)?(?:target\.com|bestbuy\.com|pokemoncenter\.com|walmart\.com|amazon\.com|a\.co|gamestop\.com|costco\.com|samsclub\.com|barnesandnoble\.com)[^\s)"\]<>]*/i);
  if (urlMatch) return urlMatch[0];
  const anyExternalStoreMatch = text.match(/https?:\/\/(?!www\.reddit\.com|old\.reddit\.com|redd\.it|i\.redd\.it|v\.redd\.it|preview\.redd\.it)[a-z0-9.-]+\.[a-z]{2,}\/[^\s)"\]<>]*/i);
  return anyExternalStoreMatch ? anyExternalStoreMatch[0] : fallbackUrl;
}

function hasVerifiedBigBoxOutboundUrl(url: string): boolean {
  return /https?:\/\/(?:www\.)?(?:pokemoncenter\.com|target\.com|walmart\.com\/ip\/|bestbuy\.com\/site\/|costco\.com|samsclub\.com|gamestop\.com)/i.test(url);
}

const REDDIT_RSS_FEEDS = [
  'https://www.reddit.com/r/PKMNTCGDeals/new/.rss',
  'https://www.reddit.com/r/PKMNTCGDeals/hot/.rss'
];
let redditFeedCursor = 0;
let isPollingReddit = false;
let lastRedditPollAt = 0;

export async function pollRedditDeals(): Promise<void> {
  if (isPollingReddit) {
    if (Date.now() - lastRedditPollAt > 90000) {
      isPollingReddit = false;
    } else {
      return;
    }
  }
  isPollingReddit = true;
  lastRedditPollAt = Date.now();

  const rssUrl = REDDIT_RSS_FEEDS[redditFeedCursor % REDDIT_RSS_FEEDS.length];
  redditFeedCursor = (redditFeedCursor + 1) % REDDIT_RSS_FEEDS.length;

  try {
    const rssRes = await smartGet(rssUrl, {
      'User-Agent': 'Windows:DropBotCommander:v4.0 (by /u/Lonesoul65666)',
      Accept: 'application/atom+xml,application/xml,text/xml'
    }, 8000);

    const xml: string = rssRes.data || '';
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
    const posts: any[] = [];

    for (const ent of entries) {
      const block = ent[1];
      const idMatch = block.match(/<id>([^<]+)<\/id>/i);
      const titleMatch = block.match(/<title>([^<]+)<\/title>/i);
      const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i);
      const contentMatch = block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
      const updatedMatch = block.match(/<(?:updated|published)>([^<]+)<\/(?:updated|published)>/i);
      if (idMatch && titleMatch) {
        const parsedUtc = updatedMatch ? Math.floor(Date.parse(updatedMatch[1]) / 1000) : 0;
        const decodedSelftext = contentMatch
          ? contentMatch[1]
              .replace(/&amp;/g, '&')
              .replace(/&#39;/g, "'")
              .replace(/&quot;/g, '"')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
          : '';
        const rawHref = linkMatch ? linkMatch[1] : '';
        const extractedUrl = extractOutboundRetailerUrl(`${rawHref} ${decodedSelftext}`, rawHref);
        const isSelfNoExternalLink = /https?:\/\/(?:www\.|old\.)?reddit\.com|redd\.it/i.test(extractedUrl) || !/^https?:\/\//i.test(extractedUrl);
        posts.push({
          id: idMatch[1],
          title: titleMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>'),
          url_overridden_by_dest: rawHref,
          selftext: decodedSelftext,
          is_self: isSelfNoExternalLink,
          created_utc: parsedUtc > 0 ? parsedUtc : Math.floor(Date.now() / 1000) - 60
        });
      }
    }

    recordBigBoxCheckTelemetry({
      redditRssStatus: 'HEALTHY',
      lastRedditFeed: rssUrl,
      lastRedditPostsChecked: posts.length
    });

    for (const post of posts) {
      if (!post || !post.id || seenRedditIds.has(post.id)) continue;
      seenRedditIds.add(post.id);

      const ageSeconds = (Date.now() / 1000) - (post.created_utc || 0);
      if (ageSeconds > 7200) continue;

      const title: string = post.title || '';
      const selftext: string = post.selftext || '';
      if (/stockx/i.test(title)) continue;

      // Reject self-discussion / question / personal story threads or single cards / non-sealed
      if (/\b(?:question|help|should i|looking for|went to|found nothing|discussion|pull|pulls|rip|ripped|weekly|megathread|iso|advice)\b/i.test(title) || /\?$/.test(title.trim())) {
        continue;
      }
      if (isSingleCardOrNonSealed(title) || !hasMandatorySealedContainerKeyword(title)) {
        continue;
      }

      const rawDest = post.url_overridden_by_dest || `https://www.reddit.com${post.permalink || ''}`;
      const dealUrl = extractOutboundRetailerUrl(`${rawDest} ${selftext}`, rawDest);
      const isSelfRedditLinkOnly = Boolean(post.is_self === true || /https?:\/\/(?:www\.|old\.)?reddit\.com|redd\.it/i.test(dealUrl));

      // Hard Outbound Link Filter: Ignore all Reddit self-posts / discussion threads without an external retailer link!
      if (isSelfRedditLinkOnly) {
        continue;
      }

      const storeMatch = title.match(/^\[([^\]]+)\]/);
      const rawStoreTag = storeMatch ? storeMatch[1] : '';
      const detectedBigBox = detectBigBoxRetailer(`${rawStoreTag} ${title}`, dealUrl);

      const titlePriceMatch = title.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
      const bodyPriceMatch = selftext.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
      let price: number | undefined = titlePriceMatch
        ? parseFloat(titlePriceMatch[1])
        : (bodyPriceMatch ? parseFloat(bodyPriceMatch[1]) : undefined);
      let isBigBoxRestockRadar = false;

      // For a post without an explicit $XX.XX price in the title to trigger as a [BIG-BOX RESTOCK RADAR] hit,
      // it MUST contain a real verified outbound URL pointing to pokemoncenter.com, target.com, walmart.com/ip/, bestbuy.com/site/, costco.com, samsclub.com, or gamestop.com!
      if (!price && detectedBigBox && hasVerifiedBigBoxOutboundUrl(dealUrl)) {
        const matchedPolicy = WATCH_POLICIES.find(
          (p) => p.active !== false && p.matchers.some((rx) => rx.test(title))
        );
        if (matchedPolicy && matchedPolicy.msrpCeiling > 0) {
          price = matchedPolicy.msrpCeiling;
          isBigBoxRestockRadar = true;
          console.log(`📡 [BIG-BOX RESTOCK RADAR] Reddit post "${title}" matched ${matchedPolicy.name} at ${detectedBigBox} (Assumed MSRP $${price.toFixed(2)}) -> ${dealUrl}`);
        }
      }

      if (!price || price < 18 || isSelfRedditLinkOnly) continue;

      const retailer = isBigBoxRestockRadar && detectedBigBox
        ? `${detectedBigBox} [BIG-BOX RESTOCK RADAR]`
        : (detectedBigBox
            ? `${detectedBigBox} (via PKMNTCGDeals)`
            : (rawStoreTag ? `${rawStoreTag} (via PKMNTCGDeals)` : 'r/PKMNTCGDeals Alert'));

      const isPreOrder = /pre-?order|pre-?sale/i.test(`${title} ${post.link_flair_text || ''}`);
      const freeShipping = Boolean(isBigBoxRestockRadar || /free ship|fs/i.test(title) || (detectedBigBox && price >= 35));

      await processIncomingDrop({
        title,
        retailer,
        url: dealUrl,
        productUrl: dealUrl,
        price,
        stock: undefined,
        itemId: `reddit_${post.id}`,
        isPreOrder,
        freeShipping,
        isBigBoxRestockRadar,
        shippingNoteOverride: isBigBoxRestockRadar
          ? `📡 [BIG-BOX RESTOCK RADAR] Live ${detectedBigBox} Restock Signal — Assumed Retail MSRP ($${price.toFixed(2)})`
          : undefined
      });
    }
  } catch (err: any) {
    recordBigBoxCheckTelemetry({
      redditRssStatus: 'DEGRADED',
      lastRedditError: err?.message || 'Reddit RSS error'
    });
  } finally {
    isPollingReddit = false;
    setTimeout(pollRedditDeals, 45000);
  }
}

function doesTcgResultMatchFormFactor(title: string, targetName: string, formFactor: string, price?: number, ruleId?: string): boolean {
  if (isSingleCardOrNonSealed(title) || !hasMandatorySealedContainerKeyword(title, formFactor)) return false;
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

function formatTransparentMarketplaceShipping(itemPrice: number, shippingPrice?: number, totalPrice?: number): string {
  const landed = totalPrice ?? Math.round(((itemPrice || 0) + (shippingPrice || 0)) * 100) / 100;
  if (shippingPrice !== undefined && shippingPrice > 0) {
    if (itemPrice > 0 && itemPrice < 35) {
      return `$${itemPrice.toFixed(2)} + $${shippingPrice.toFixed(2)} Ship ($${landed.toFixed(2)} Landed — Under $35 Threshold, 2x May Unlock Free Ship)`;
    }
    return `$${itemPrice.toFixed(2)} + $${shippingPrice.toFixed(2)} Ship ($${landed.toFixed(2)} Landed)`;
  }
  if (shippingPrice === 0) {
    return '+FREE Shipping (Confirmed $0.00 Ship)';
  }
  if (itemPrice > 0 && itemPrice < 35) {
    return '+Est. Ship / Check Cart — Under $35 Threshold, 2x May Unlock Free Ship';
  }
  return '+FREE Shipping (Over $35 Threshold)';
}

interface VerifiedTcgSellerOffer {
  price: number;
  itemPrice: number;
  shipping: number;
  sellerName: string;
  rating: number;
  sales: number;
  quantity: number;
  sellerVerified: boolean;
}

async function getBestVerifiedTcgSeller(
  prodId: number,
  minFloor: number,
  maxCeiling: number,
  formFactor?: string,
  marketValue = 0
): Promise<{ seller: VerifiedTcgSellerOffer | null; networkError: boolean }> {
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
      const rating = parseFloat(l.sellerRating || 0);
      if (rating < 95) continue;
      const itemPrice = parseFloat(l.price || 0);
      const shipPrice = parseFloat(l.shippingPrice || l.sellerShippingPrice || 0);
      if (isShippingScam(itemPrice, shipPrice, formFactor)) continue;
      const total = Math.round((itemPrice + shipPrice) * 100) / 100;
      const quantity = parseInt(l.quantity || '1', 10);
      const sales = parseInt(l.completedSales || l.sellerSales || '0', 10);
      const isVerifiedSeller = Boolean(
        l.verifiedSeller ||
        l.goldSeller ||
        l.directProduct ||
        l.certifiedHobbyShop ||
        sales >= 50
      );

      // V5 Slice 3 Scam Shield: Reject unverified / non-certified 1-qty sellers pricing high-value items (market > $200) at >35% below market
      if ((!isVerifiedSeller || quantity <= 1) && marketValue > 200 && total < marketValue * 0.65) {
        continue;
      }

      if (itemPrice > 0 && total >= minFloor && total <= maxCeiling) {
        return {
          seller: {
            price: total,
            itemPrice,
            shipping: shipPrice,
            sellerName: l.sellerName || 'Verified Shop',
            rating,
            sales,
            quantity,
            sellerVerified: isVerifiedSeller
          },
          networkError: false
        };
      }
    }
    return { seller: null, networkError: false };
  } catch (e) {
    return { seller: null, networkError: true };
  }
}

function recordConfirmedTcgOosStrike(policyId: string, prodId: number): void {
  const prev = lowestTcgSeenMap.get(policyId);
  if (!prev) return;
  prev.oosStrikes = (prev.oosStrikes || 0) + 1;
  if (prev.oosStrikes >= 3) {
    prev.inStockUnderTrigger = false;
    lowestTcgSeenMap.set(policyId, prev);
    markLiveStockOut(`tcg_${prodId}`, { confirmedTcgThreeStrikes: true });
  } else {
    lowestTcgSeenMap.set(policyId, prev);
  }
}

let tcgCursor = 0;
let isPollingTcg = false;
let lastTcgPollAt = 0;
export async function pollTcgPlayerUndercuts(): Promise<void> {
  if (isPollingTcg) {
    if (Date.now() - lastTcgPollAt > 90000) {
      isPollingTcg = false;
    } else {
      return;
    }
  }
  isPollingTcg = true;
  lastTcgPollAt = Date.now();

  try {
    const activePolicies = WATCH_POLICIES.filter((p: any) => p.active !== false);
    if (activePolicies.length === 0) {
      return;
    }

    // 2x Priority Polling for the 30 "Needed for Wall" ETBs (formFactor === 'etb' && !owned)
    const neededWallEtbs = activePolicies.filter(
      (p: any) => String(p.formFactor || '').toLowerCase() === 'etb' && !p.owned && !p.inVault
    );
    const priorityRotation = [...activePolicies, ...neededWallEtbs];

    for (let i = 0; i < 8; i++) {
      const policy = priorityRotation[tcgCursor % priorityRotation.length];
      tcgCursor = (tcgCursor + 1) % priorityRotation.length;
      const formFactor = policy.formFactor || 'Booster Box';
      const minFloor = getMinPlausiblePriceFloor(formFactor);
      const maxCeiling = getMaxPlausiblePriceCeiling(formFactor, policy.id, policy.name, policy);
      const effectiveCeiling = Math.max(policy.msrpCeiling || 0, policy.maxMarketBuyPrice || 0);
      const marketVal = Number(policy.estimatedMarketValue || effectiveCeiling || 0);

      try {
        if ((policy as any).tcgProductId) {
          const prodId = (policy as any).tcgProductId;
          const { seller: bestSeller, networkError } = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling, formFactor, marketVal);
          if (networkError) continue;
          if (!bestSeller) {
            recordConfirmedTcgOosStrike(policy.id, prodId);
            continue;
          }
          if (bestSeller && bestSeller.price >= minFloor && bestSeller.price <= maxCeiling) {
            const isUnderTrigger = bestSeller.price <= effectiveCeiling;
            const prev = lowestTcgSeenMap.get(policy.id);
            const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;

            if (!isUnderTrigger) {
              recordConfirmedTcgOosStrike(policy.id, prodId);
            } else {
              clearTcgOosStrikes(`tcg_${prodId}`);
            }

            if (!prev || bestSeller.price <= prev.lowestPrice - 2 || (!prev.inStockUnderTrigger && isUnderTrigger) || minsSinceLast >= 15) {
              lowestTcgSeenMap.set(policy.id, {
                lowestPrice: bestSeller.price,
                timestamp: Date.now(),
                inStockUnderTrigger: isUnderTrigger ? true : Boolean(prev?.inStockUnderTrigger && (prev?.oosStrikes || 0) < 3),
                oosStrikes: isUnderTrigger ? 0 : (prev?.oosStrikes || 1)
              });
              const shippingNoteOverride = formatTransparentMarketplaceShipping(
                bestSeller.itemPrice,
                bestSeller.shipping,
                bestSeller.price
              );
              await processIncomingDrop({
                title: policy.name,
                retailer: `${bestSeller.sellerName} (TCGPlayer • ${bestSeller.rating}%)`,
                url: `https://www.tcgplayer.com/product/${prodId}?Language=English`,
                price: bestSeller.itemPrice,
                itemPrice: bestSeller.itemPrice,
                shippingPrice: bestSeller.shipping,
                shippingNoteOverride,
                stock: bestSeller.quantity,
                itemId: `tcg_${prodId}`,
                freeShipping: (bestSeller.shipping ?? 0) === 0,
                sellerVerified: bestSeller.sellerVerified,
                sellerSales: bestSeller.sales,
                isMarketplace3P: true
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
          const { seller: bestSeller, networkError } = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling, formFactor, marketVal);

          // Ignore transient network timeouts completely; require 3 consecutive confirmed OOS sweeps before clearing!
          if (networkError) {
            break;
          }
          if (!bestSeller) {
            recordConfirmedTcgOosStrike(policy.id, prodId);
            break;
          }

          const lowestPrice = bestSeller.price;
          if (!lowestPrice || lowestPrice < minFloor || lowestPrice > maxCeiling) continue;

          const parsedItemPrice = bestSeller.itemPrice;
          const parsedShipPrice = bestSeller.shipping;

          if (isShippingScam(parsedItemPrice, parsedShipPrice, formFactor)) {
            recordConfirmedTcgOosStrike(policy.id, prodId);
            break;
          }

          const shippingNoteOverride = formatTransparentMarketplaceShipping(
            parsedItemPrice,
            parsedShipPrice,
            lowestPrice
          );

          const shopLabel = `${bestSeller.sellerName} (TCGPlayer • ${bestSeller.rating}%)`;

          const isUnderTrigger = lowestPrice <= effectiveCeiling;
          const prev = lowestTcgSeenMap.get(policy.id);
          const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;

          if (!isUnderTrigger) {
            recordConfirmedTcgOosStrike(policy.id, prodId);
          } else {
            clearTcgOosStrikes(`tcg_${prodId}`);
          }

          // Pass to processIncomingDrop when newly seen, price drops, flips into trigger, or every 15m so bestCurrentOffers / Near Misses stay fresh
          if (!prev || lowestPrice <= prev.lowestPrice - 2 || (!prev.inStockUnderTrigger && isUnderTrigger) || minsSinceLast >= 15) {
            lowestTcgSeenMap.set(policy.id, {
              lowestPrice,
              timestamp: Date.now(),
              inStockUnderTrigger: isUnderTrigger ? true : Boolean(prev?.inStockUnderTrigger && (prev?.oosStrikes || 0) < 3),
              oosStrikes: isUnderTrigger ? 0 : (prev?.oosStrikes || 1)
            });
            const isPreOrder = /pre-?order|pre-?sale/i.test(prodTitle);
            await processIncomingDrop({
              title: prodTitle,
              retailer: shopLabel,
              url: `https://www.tcgplayer.com/product/${prodId}?Language=English`,
              price: parsedItemPrice,
              itemPrice: parsedItemPrice,
              shippingPrice: parsedShipPrice,
              shippingNoteOverride,
              stock: bestSeller.quantity,
              itemId: `tcg_${prodId}`,
              isPreOrder,
              freeShipping: (parsedShipPrice ?? 0) === 0,
              sellerVerified: bestSeller.sellerVerified,
              sellerSales: bestSeller.sales,
              isMarketplace3P: true
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
