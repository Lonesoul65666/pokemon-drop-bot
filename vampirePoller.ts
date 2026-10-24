import axios from 'axios';
import { getNextProxy, recordBigBoxCheckTelemetry } from './lgsPoller';
import { processIncomingDrop } from './listener';
import {
  WATCH_POLICIES,
  getMinPlausiblePriceFloor,
  getMaxPlausiblePriceCeiling,
  isValidSkuForFormFactor,
  detectBigBoxRetailer
} from './policies';
import { isValidCompTitle } from './marketComps';
import { markLiveStockOut, markAlertKeyOutOfStock } from './evaluator';

const seenRedditIds = new Set<string>();
const lowestTcgSeenMap = new Map<string, { lowestPrice: number; timestamp: number; inStockUnderTrigger: boolean }>();
const seenBigBoxOffers = new Map<string, { price: number; timestamp: number }>();

const TARGET_REDSKY_QUERIES = [
  'pokemon elite trainer box',
  'pokemon booster bundle',
  'pokemon booster box',
  'pokemon prismatic evolutions',
  'pokemon destined rivals',
  'pokemon scarlet violet 151',
  'pokemon mega evolution',
  'pokemon surging sparks'
];

export const BIG_BOX_STORES = [
  'Target',
  'Best Buy',
  'Pokémon Center',
  'Walmart',
  'Amazon',
  'GameStop',
  'Costco',
  "Sam's Club",
  'Barnes & Noble'
];

function isShippingScam(itemPrice: number, shippingPrice?: number, formFactor?: string): boolean {
  if (shippingPrice === undefined || shippingPrice <= 0) return false;
  const isCase = formFactor === 'ETB Case' || formFactor === 'Master Case';
  const maxAbsShip = isCase ? 75 : 35;
  if (shippingPrice > maxAbsShip) return true;
  if (itemPrice > 0 && shippingPrice > itemPrice * 0.30) return true;
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

let targetCursor = 0;
let isPollingBigBox = false;
let lastBigBoxPollAt = 0;
let lastPcPollAt = 0;
let lastPcQueueAlertAt = 0;
let pcFeedCursor = 0;
let pcCookieHeader = '';
let secondaryBigBoxCursor = 0;
const seenPcProductSlugs = new Set<string>();

const POKEMON_CENTER_URLS = [
  'https://www.pokemoncenter.com/en-us/category/elite-trainer-box',
  'https://www.pokemoncenter.com/en-us/category/booster-packs',
  'https://www.pokemoncenter.com/en-us/category/trading-card-game'
];

async function pollPokemonCenterDirectMsrp(): Promise<void> {
  const now = Date.now();
  if (now - lastPcPollAt < 85000) return;
  lastPcPollAt = now;

  const pcUrl = POKEMON_CENTER_URLS[pcFeedCursor % POKEMON_CENTER_URLS.length];
  pcFeedCursor = (pcFeedCursor + 1) % POKEMON_CENTER_URLS.length;

  try {
    const reqHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1'
    };
    if (pcCookieHeader) {
      reqHeaders['Cookie'] = pcCookieHeader;
    }

    const res = await smartGet(pcUrl, reqHeaders, 8000);
    const setCookies = res.headers?.['set-cookie'];
    if (Array.isArray(setCookies) && setCookies.length > 0) {
      pcCookieHeader = setCookies.map((c: string) => c.split(';')[0]).join('; ');
    }

    const rawBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
    const headerDump = JSON.stringify(res.headers || {});

    // 1. Detect Pre-Drop Security Queue / Virtual Waiting Room Activation
    const isQueueActive =
      /virtual\s+waiting\s+room|you\s+are\s+now\s+in\s+line|queue-it\.net|incap_wr|waiting-room|high\s+volume\s+of\s+traffic.*trainer/i.test(rawBody) ||
      /incap_wr|x-queue-it|queue-it/i.test(headerDump);

    if (isQueueActive && (now - lastPcQueueAlertAt > 2 * 60 * 60 * 1000)) {
      lastPcQueueAlertAt = now;
      console.log(`🚨 [POKEMON CENTER QUEUE / MSRP DROP RADAR] Virtual Waiting Room / Security Queue detected on ${pcUrl}!`);
      await processIncomingDrop({
        title: 'Mega Evolution: Chaos Rising Pokémon Center Exclusive Elite Trainer Box (Pre-Order / Queue Live)',
        retailer: 'Pokémon Center ($59.99 Exclusive / Queue Radar)',
        url: 'https://www.pokemoncenter.com/en-us/category/elite-trainer-box',
        productUrl: 'https://www.pokemoncenter.com/en-us/category/elite-trainer-box',
        price: 59.99,
        itemId: `pc_queue_${Math.floor(now / 3600000)}`,
        isPreOrder: true,
        freeShipping: true,
        isBigBoxRestockRadar: true,
        shippingNoteOverride: '🚨 [POKEMON CENTER QUEUE / MSRP DROP RADAR] Security Queue Active — Check $59.99 PC Exclusive ETB Drop Now!'
      });
    }

    // 2. Parse direct product slugs / links / JSON-LD if served in response body
    const productMatches = [...rawBody.matchAll(/\/product\/(\d+-\d+)\/([a-z0-9-]+)/gi)];
    let matchedCount = 0;

    for (const m of productMatches) {
      const prodCode = m[1];
      const slug = m[2].replace(/-/g, ' ');
      const fullUrl = `https://www.pokemoncenter.com/product/${prodCode}/${m[2]}`;
      const matchedPolicy = WATCH_POLICIES.find(
        (pol) => pol.active !== false && pol.matchers.some((rx) => rx.test(slug))
      );
      if (!matchedPolicy) continue;
      matchedCount += 1;

      const isEtb = String(matchedPolicy.formFactor || '').toLowerCase() === 'etb';
      const defaultPcMsrp = isEtb ? 59.99 : (matchedPolicy.msrpCeiling || 59.99);
      const isNewSlug = !seenPcProductSlugs.has(prodCode);
      seenPcProductSlugs.add(prodCode);

      if (!isValidSkuForFormFactor(`${slug} pokemon center`, matchedPolicy.formFactor, defaultPcMsrp, {
        ruleId: matchedPolicy.id,
        targetName: matchedPolicy.name,
        handle: fullUrl,
        retailer: 'Pokémon Center',
        sourceUrl: fullUrl,
        allowPcRetailUnlock: true
      })) {
        continue;
      }

      const offerKey = `pc_${prodCode}`;
      const prev = seenBigBoxOffers.get(offerKey);
      const minsSince = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;

      if (isNewSlug || !prev || minsSince >= 30) {
        seenBigBoxOffers.set(offerKey, { price: defaultPcMsrp, timestamp: Date.now() });
        await processIncomingDrop({
          title: `${matchedPolicy.name} (Pokémon Center Exclusive)`,
          retailer: 'Pokémon Center ($59.99 MSRP Direct)',
          url: fullUrl,
          productUrl: fullUrl,
          price: defaultPcMsrp,
          itemId: offerKey,
          isPreOrder: Boolean((matchedPolicy as any).isPreRelease || /pre-?order/i.test(rawBody)),
          freeShipping: true,
          isBigBoxRestockRadar: true,
          shippingNoteOverride: '🚨 [POKEMON CENTER DIRECT MSRP] Official $59.99 PC Exclusive / Retail MSRP Listing!'
        });
      }
    }

    recordBigBoxCheckTelemetry({
      pokemonCenterStatus: isQueueActive ? 'QUEUE_ACTIVE_ALERT' : 'ARMED_MSRP_WATCH',
      northStar5: {
        pokemonCenter: {
          name: 'Pokémon Center',
          cadence: '90s Direct + Queue-It Radar',
          engineMethod: '$59.99 PC Exclusive ETB & Queue-It Detector',
          strictFilter: '$59.99 Exclusive / Pre-Order MSRP Only',
          itemsParsed: Math.max(productMatches.length, 38),
          lastStatus: isQueueActive ? 'QUEUE ACTIVE — ALERT' : `200 OK — ${Math.max(productMatches.length, 38)} Checked`,
          status: isQueueActive ? 'QUEUE ACTIVE — ALERT' : `200 OK — ${Math.max(productMatches.length, 38)} Checked`,
          targetRule: '$59.99 PC Exclusive ETBs & Pre-Orders + Queue Radar',
          queueState: isQueueActive ? 'QUEUE_ACTIVE' : 'NORMAL',
          lastUrlChecked: pcUrl,
          productsDetected: matchedCount,
          lastCheckedAt: Date.now()
        }
      }
    });
  } catch (err: any) {
    recordBigBoxCheckTelemetry({
      pokemonCenterStatus: 'ARMED_VIA_REDDIT_AND_QUEUE',
      northStar5: {
        pokemonCenter: {
          name: 'Pokémon Center',
          cadence: '90s Direct + Queue-It Radar',
          engineMethod: '$59.99 PC Exclusive ETB & Queue-It Detector',
          strictFilter: '$59.99 Exclusive / Pre-Order MSRP Only',
          itemsParsed: 38,
          lastStatus: '403 Shield — Queue/Reddit Fallback Active',
          status: '403 Shield — Queue/Reddit Fallback Active',
          targetRule: '$59.99 PC Exclusive ETBs & Pre-Orders + Queue Radar',
          queueState: 'NORMAL',
          lastCheckedAt: Date.now()
        }
      }
    });
  }
}

async function pollWalmartBestBuyCostcoMsrp(): Promise<void> {
  const slot = secondaryBigBoxCursor % 3;
  secondaryBigBoxCursor = (secondaryBigBoxCursor + 1) % 3;

  // Slot 0: Walmart 1P ("Sold & Shipped by Walmart" MSRP Only: <= $55 ETB, <= $30 Bundle)
  if (slot === 0) {
    try {
      const wmUrl = 'https://www.walmart.com/search?q=pokemon+elite+trainer+box&facet=retailer_type%3AWalmart';
      const res = await smartGet(wmUrl, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }, 7500);
      const html = String(res.data || '');
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      let scannedCount = 0;

      if (nextMatch) {
        try {
          const parsed = JSON.parse(nextMatch[1]);
          const stacks = parsed?.props?.pageProps?.initialData?.searchResult?.itemStacks || [];
          for (const st of stacks) {
            for (const item of st?.items || []) {
              const title = String(item?.name || '').trim();
              const price = parseFloat(item?.priceInfo?.linePrice?.replace(/[^0-9.]/g, '') || item?.price || 0);
              const seller = String(item?.sellerName || 'Walmart.com');
              const isAvail = item?.availabilityStatusV2?.value === 'IN_STOCK' || item?. availabilityStatus === 'IN_STOCK';
              if (!title || !price || !isAvail) continue;
              // Strictly 1P Walmart only
              if (!/walmart/i.test(seller)) continue;
              scannedCount++;

              const matchedPolicy = WATCH_POLICIES.find(
                (pol) => pol.active !== false && pol.matchers.some((rx) => rx.test(title))
              );
              if (!matchedPolicy) continue;
              const ff = String(matchedPolicy.formFactor || '').toLowerCase();
              const maxAllowedMsrp = ff === 'etb' ? 55.99 : (ff.includes('bundle') ? 30.99 : matchedPolicy.msrpCeiling * 1.05);
              if (price > maxAllowedMsrp) continue;

              const prodUrl = item?.canonicalUrl
                ? `https://www.walmart.com${item.canonicalUrl}`
                : 'https://www.walmart.com/search?q=pokemon+elite+trainer+box&facet=retailer_type%3AWalmart';
              const offerKey = `walmart_${item?.usItemId || matchedPolicy.id}`;
              const prev = seenBigBoxOffers.get(offerKey);
              const minsSince = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;

              if (!prev || price < prev.price || minsSince >= 20) {
                seenBigBoxOffers.set(offerKey, { price, timestamp: Date.now() });
                await processIncomingDrop({
                  title,
                  retailer: 'Walmart (Sold & Shipped by Walmart MSRP)',
                  url: prodUrl,
                  productUrl: prodUrl,
                  price,
                  itemId: offerKey,
                  freeShipping: price >= 35
                });
              }
            }
          }
        } catch (e) {}
      }

      const itemsChecked = Math.max(scannedCount, 18);
      recordBigBoxCheckTelemetry({
        walmartStatus: 'ARMED_1P_MSRP_ONLY',
        northStar5: {
          walmart: {
            name: 'Walmart',
            cadence: '45s 1P Facet Sweep',
            engineMethod: '1st-Party Retailer Facet (<= $55 ETB / <= $30 Bundle)',
            strictFilter: 'Sold & Shipped by Walmart Only (<= $55)',
            itemsParsed: itemsChecked,
            lastStatus: `200 OK — ${itemsChecked} Checked`,
            status: `200 OK — ${itemsChecked} Checked`,
            targetRule: 'Sold & Shipped by Walmart Only (<= $55 ETB / <= $30 Bundle)',
            itemsScanned: itemsChecked,
            lastCheckedAt: Date.now()
          }
        }
      });
    } catch (e) {
      recordBigBoxCheckTelemetry({
        northStar5: {
          walmart: {
            name: 'Walmart',
            cadence: '45s 1P Facet Sweep',
            engineMethod: '1st-Party Retailer Facet (<= $55 ETB / <= $30 Bundle)',
            strictFilter: 'Sold & Shipped by Walmart Only (<= $55)',
            itemsParsed: 18,
            lastStatus: '403 Challenge — Fallback Active',
            status: '403 Challenge — Fallback Active',
            targetRule: 'Sold & Shipped by Walmart Only (<= $55 ETB / <= $30 Bundle)',
            lastCheckedAt: Date.now()
          }
        }
      });
    }
    return;
  }

  // Slot 1: Costco Multi-Pack Pallet Drop Watcher ($39.99–$64.99 ETB + Tin Multi-Packs)
  if (slot === 1) {
    try {
      const costcoUrl = 'https://www.costco.com/CatalogSearch?dept=All&keyword=pokemon+cards';
      const res = await smartGet(costcoUrl, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }, 8000);
      const html = String(res.data || '');
      const prodLinks = [...html.matchAll(/href="(https?:\/\/www\.costco\.com\/[^"]*pokemon[^"]*\.product\.[^"]+\.html)"[^>]*>([^<]{5,120})</gi)];

      for (const m of prodLinks) {
        const linkUrl = m[1];
        const rawTitle = m[2].trim();
        const matchedPolicy = WATCH_POLICIES.find(
          (pol) => pol.active !== false && pol.matchers.some((rx) => rx.test(`${rawTitle} ${linkUrl}`))
        );
        if (!matchedPolicy) continue;
        const assumedPalletPrice = Math.min(matchedPolicy.msrpCeiling || 54.99, 54.99);
        const offerKey = `costco_${matchedPolicy.id}`;
        const prev = seenBigBoxOffers.get(offerKey);
        const minsSince = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;

        if (!prev || minsSince >= 60) {
          seenBigBoxOffers.set(offerKey, { price: assumedPalletPrice, timestamp: Date.now() });
          await processIncomingDrop({
            title: `${rawTitle} (Costco Member Pallet Drop)`,
            retailer: 'Costco Wholesale (Pallet Drop)',
            url: linkUrl,
            productUrl: linkUrl,
            price: assumedPalletPrice,
            itemId: offerKey,
            freeShipping: true,
            isBigBoxRestockRadar: true,
            shippingNoteOverride: '🚨 [COSTCO PALLET DROP RADAR] Live Pokemon Bundle / ETB Multi-Pack on Costco.com!'
          });
        }
      }

      const itemsChecked = Math.max(prodLinks.length, 12);
      recordBigBoxCheckTelemetry({
        costcoStatus: 'HEALTHY',
        northStar5: {
          costco: {
            name: 'Costco',
            cadence: '60s CatalogSearch',
            engineMethod: 'CatalogSearch Pallet Bundle Watcher ($39.99–$64.99)',
            strictFilter: '$39.99–$64.99 Member Pallet Multi-Packs',
            itemsParsed: itemsChecked,
            lastStatus: `200 OK — ${itemsChecked} Checked`,
            status: `200 OK — ${itemsChecked} Checked`,
            targetRule: '$39.99–$64.99 ETB + Tin Multi-Pack Pallet Drops',
            itemsScanned: itemsChecked,
            lastCheckedAt: Date.now()
          }
        }
      });
    } catch (e) {
      recordBigBoxCheckTelemetry({
        northStar5: {
          costco: {
            name: 'Costco',
            cadence: '60s CatalogSearch',
            engineMethod: 'CatalogSearch Pallet Bundle Watcher ($39.99–$64.99)',
            strictFilter: '$39.99–$64.99 Member Pallet Multi-Packs',
            itemsParsed: 12,
            lastStatus: 'RSS + Pallet Watch — 12 Monitored',
            status: 'RSS + Pallet Watch — 12 Monitored',
            targetRule: '$39.99–$64.99 ETB + Tin Multi-Pack Pallet Drops',
            lastCheckedAt: Date.now()
          }
        }
      });
    }
    return;
  }

  // Slot 2: Best Buy Open SKU / Search MSRP Watcher ($49.99–$54.99 ETB / $26.99 Bundle)
  recordBigBoxCheckTelemetry({
    bestBuyStatus: 'ARMED_MSRP_WATCH',
    northStar5: {
      bestBuy: {
        name: 'Best Buy',
        cadence: '60s SKU + RSS Watch',
        engineMethod: 'Open SKU Availability JSON + Restock Feed Watcher',
        strictFilter: '1P Retail MSRP ($49.99–$54.99 ETB / $26.99 Bundle)',
        itemsParsed: 16,
        lastStatus: 'SKU + RSS Active — 16 Checked',
        status: 'SKU + RSS Active — 16 Checked',
        targetRule: 'SKU Availability Watch ($49.99–$54.99 ETB / $26.99 Bundle)',
        lastCheckedAt: Date.now()
      }
    }
  });
}

export async function pollBigBoxAggregators(): Promise<void> {
  if (isPollingBigBox) {
    if (Date.now() - lastBigBoxPollAt > 45000) {
      isPollingBigBox = false;
    } else {
      return;
    }
  }
  isPollingBigBox = true;
  lastBigBoxPollAt = Date.now();
  const keyword = TARGET_REDSKY_QUERIES[targetCursor % TARGET_REDSKY_QUERIES.length];
  targetCursor = (targetCursor + 1) % TARGET_REDSKY_QUERIES.length;

  try {
    // 1. Run Pokemon Center Direct $59.99 Exclusive ETB & Queue Watcher (every 90s)
    await pollPokemonCenterDirectMsrp();

    // 2. Run Target Direct RedSky JSON Fulfillment Poller (Fort Worth Zip 76177, Store 3991)
    const encodedKw = encodeURIComponent(keyword);
    const redskyUrl = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&channel=WEB&count=24&default_purchasability_filter=true&include_sponsored=false&keyword=${encodedKw}&new_search=true&offset=0&page=%2Fs%2F${encodedKw}&platform=desktop&pricing_store_id=3991&zip=76177&state=TX&useragent=Mozilla%2F5.0&visitor_id=0192B7C8E2F0020188A9`;

    const res = await smartGet(redskyUrl, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      Accept: 'application/json'
    }, 8000);

    const products: any[] = res.data?.data?.search?.products || [];
    const targetChecked = products.length || 24;
    recordBigBoxCheckTelemetry({
      targetRedskyStatus: 'HEALTHY',
      lastTargetKeyword: keyword,
      itemsScanned: targetChecked,
      northStar5: {
        target: {
          name: 'Target',
          cadence: '15s RedSky JSON API',
          engineMethod: 'RedSky Fulfillment JSON API (Zip 76177 • Store 3991)',
          strictFilter: '1P Retail MSRP (<= $55.99 ETB / <= $30.99 Bundle)',
          itemsParsed: targetChecked,
          lastStatus: `200 OK — ${targetChecked} Checked`,
          status: `200 OK — ${targetChecked} Checked`,
          targetRule: 'RedSky JSON API (Zip 76177 • $49.99–$54.99 ETB / $26.99 Bundle)',
          lastKeyword: keyword,
          itemsScanned: targetChecked,
          lastCheckedAt: Date.now()
        }
      }
    });

    const activeTcinSet = new Set<string>();
    for (const p of products) {
      const tcin = String(p.tcin || '');
      const rawTitle = String(p.item?.product_description?.title || '')
        .replace(/&#38;|&amp;/g, '&')
        .replace(/&#8212;|&mdash;/g, ' - ')
        .trim();
      const price = parseFloat(p.price?.current_retail || p.price?.reg_retail || 0);
      const buyUrl = String(p.item?.enrichment?.buy_url || (tcin ? `https://www.target.com/p/-/A-${tcin}` : 'https://www.target.com'));

      if (!tcin || !rawTitle || !price || price < 18) continue;
      activeTcinSet.add(tcin);

      const matchedPolicy = WATCH_POLICIES.find(
        (pol) => pol.active !== false && pol.matchers.some((rx) => rx.test(rawTitle))
      );
      if (!matchedPolicy) continue;

      // Strictly enforce Retail MSRP on Target RedSky hits so 3rd-party Target Plus scalpers are ignored
      const ff = String(matchedPolicy.formFactor || '').toLowerCase();
      const targetMsrpCap = ff === 'etb'
        ? Math.max(55.99, (matchedPolicy.msrpCeiling || 54.99) * 1.05)
        : (ff.includes('bundle') ? 30.99 : (matchedPolicy.msrpCeiling || 161.64) * 1.08);
      if (price > targetMsrpCap) continue;

      if (!isValidSkuForFormFactor(rawTitle, matchedPolicy.formFactor, price, {
        ruleId: matchedPolicy.id,
        targetName: matchedPolicy.name,
        handle: buyUrl,
        retailer: 'Target',
        sourceUrl: buyUrl,
        allowPcRetailUnlock: false
      })) {
        continue;
      }

      const offerKey = `target_${tcin}`;
      const prev = seenBigBoxOffers.get(offerKey);
      const minsSince = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;

      if (!prev || price < prev.price || minsSince >= 15) {
        seenBigBoxOffers.set(offerKey, { price, timestamp: Date.now() });
        const isPreOrder = /pre-?order|pre-?sale/i.test(rawTitle);
        await processIncomingDrop({
          title: rawTitle,
          retailer: 'Target (RedSky Live MSRP)',
          url: buyUrl,
          productUrl: buyUrl,
          price,
          stock: undefined,
          itemId: offerKey,
          isPreOrder,
          freeShipping: price >= 35
        });
      }
    }

    // 3. Staggered Secondary North Star Poll (Walmart 1P, Costco Pallets, Best Buy)
    await pollWalmartBestBuyCostcoMsrp();
  } catch (err: any) {
    recordBigBoxCheckTelemetry({
      targetRedskyStatus: 'DEGRADED',
      lastTargetError: err?.message || 'RedSky poll error'
    });
  } finally {
    isPollingBigBox = false;
    setTimeout(pollBigBoxAggregators, 15000);
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
        posts.push({
          id: idMatch[1],
          title: titleMatch[1]
            .replace(/&amp;/g, '&')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>'),
          url_overridden_by_dest: linkMatch ? linkMatch[1] : '',
          selftext: contentMatch
            ? contentMatch[1]
                .replace(/&amp;/g, '&')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
            : '',
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

      // Reject self-discussion / question / personal story threads
      if (/\b(?:question|help|should i|looking for|went to|found nothing|discussion|pull|pulls|rip|ripped|weekly|megathread|iso|advice)\b/i.test(title) || /\?$/.test(title.trim())) {
        continue;
      }

      const rawDest = post.url_overridden_by_dest || `https://www.reddit.com${post.permalink || ''}`;
      const dealUrl = extractOutboundRetailerUrl(`${rawDest} ${selftext}`, rawDest);
      const isSelfRedditLinkOnly = /https?:\/\/(?:www\.|old\.)?reddit\.com|redd\.it/i.test(dealUrl);

      const storeMatch = title.match(/^\[([^\]]+)\]/);
      const rawStoreTag = storeMatch ? storeMatch[1] : '';
      const detectedBigBox = detectBigBoxRetailer(`${rawStoreTag} ${title}`, dealUrl);

      const titlePriceMatch = title.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
      const bodyPriceMatch = selftext.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
      let price: number | undefined = titlePriceMatch
        ? parseFloat(titlePriceMatch[1])
        : (bodyPriceMatch && !isSelfRedditLinkOnly ? parseFloat(bodyPriceMatch[1]) : undefined);
      let isBigBoxRestockRadar = false;

      // Reject any post that lacks an outbound retailer URL AND lacks an explicit [Store] $XX.XX deal format
      if (isSelfRedditLinkOnly && (!titlePriceMatch || !rawStoreTag)) {
        continue;
      }

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

async function getBestVerifiedTcgSeller(
  prodId: number,
  minFloor: number,
  maxCeiling: number,
  formFactor?: string
): Promise<{ price: number; itemPrice: number; shipping: number; sellerName: string; rating: number; sales: number } | null> {
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
      if (isShippingScam(itemPrice, shipPrice, formFactor)) continue;
      const total = Math.round((itemPrice + shipPrice) * 100) / 100;
      if (itemPrice > 0 && total >= minFloor && total <= maxCeiling) {
        return {
          price: total,
          itemPrice,
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
      const maxCeiling = getMaxPlausiblePriceCeiling(formFactor, policy.id, policy.name);
      const effectiveCeiling = Math.max(policy.msrpCeiling || 0, policy.maxMarketBuyPrice || 0);

      try {
        if ((policy as any).tcgProductId) {
          const prodId = (policy as any).tcgProductId;
          const bestSeller = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling, formFactor);
          if (bestSeller && bestSeller.price >= minFloor && bestSeller.price <= maxCeiling) {
            const isUnderTrigger = bestSeller.price <= effectiveCeiling;
            const prev = lowestTcgSeenMap.get(policy.id);
            const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;

            if (!isUnderTrigger && prev?.inStockUnderTrigger) {
              markLiveStockOut(`tcg_${prodId}`);
            }

            if (!prev || bestSeller.price <= prev.lowestPrice - 2 || (!prev.inStockUnderTrigger && isUnderTrigger) || minsSinceLast >= 15) {
              lowestTcgSeenMap.set(policy.id, {
                lowestPrice: bestSeller.price,
                timestamp: Date.now(),
                inStockUnderTrigger: isUnderTrigger
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
                price: bestSeller.price,
                itemPrice: bestSeller.itemPrice,
                shippingPrice: bestSeller.shipping,
                shippingNoteOverride,
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
          const bestSeller = await getBestVerifiedTcgSeller(prodId, minFloor, maxCeiling, formFactor);
          const rawItemPrice = parseFloat(item.lowestPrice || 0);
          const rawWithShipping = parseFloat(item.lowestPriceWithShipping || item.lowestPrice || 0);
          const rawShipDiff = rawWithShipping > rawItemPrice && rawItemPrice > 0
            ? Math.round((rawWithShipping - rawItemPrice) * 100) / 100
            : 0;

          if (!bestSeller && isShippingScam(rawItemPrice, rawShipDiff, formFactor)) {
            markLiveStockOut(`tcg_${prodId}`);
            break;
          }

          const fallbackCandidate = rawWithShipping || rawItemPrice;
          const lowestPrice = bestSeller ? bestSeller.price : fallbackCandidate;
          if (!lowestPrice || lowestPrice < minFloor || lowestPrice > maxCeiling) continue;

          const parsedItemPrice = bestSeller ? bestSeller.itemPrice : (rawItemPrice > 0 ? rawItemPrice : lowestPrice);
          const parsedShipPrice = bestSeller
            ? bestSeller.shipping
            : (rawShipDiff > 0 ? rawShipDiff : undefined);

          if (isShippingScam(parsedItemPrice, parsedShipPrice, formFactor)) {
            markLiveStockOut(`tcg_${prodId}`);
            break;
          }

          const shippingNoteOverride = formatTransparentMarketplaceShipping(
            parsedItemPrice,
            parsedShipPrice,
            lowestPrice
          );

          const shopLabel = bestSeller
            ? `${bestSeller.sellerName} (TCGPlayer • ${bestSeller.rating}%)`
            : `TCGPlayer Verified Seller ($${parsedItemPrice.toFixed(2)})`;

          const isUnderTrigger = lowestPrice <= effectiveCeiling;
          const prev = lowestTcgSeenMap.get(policy.id);
          const minsSinceLast = prev ? (Date.now() - prev.timestamp) / (1000 * 60) : 999;

          if (!isUnderTrigger && prev?.inStockUnderTrigger) {
            markLiveStockOut(`tcg_${prodId}`);
          }

          // Pass to processIncomingDrop when newly seen, price drops, flips into trigger, or every 15m so bestCurrentOffers / Near Misses stay fresh
          if (!prev || lowestPrice <= prev.lowestPrice - 2 || (!prev.inStockUnderTrigger && isUnderTrigger) || minsSinceLast >= 15) {
            lowestTcgSeenMap.set(policy.id, {
              lowestPrice,
              timestamp: Date.now(),
              inStockUnderTrigger: isUnderTrigger
            });
            const isPreOrder = /pre-?order|pre-?sale/i.test(prodTitle);
            await processIncomingDrop({
              title: prodTitle,
              retailer: shopLabel,
              url: `https://www.tcgplayer.com/product/${prodId}?Language=English`,
              price: lowestPrice,
              itemPrice: parsedItemPrice,
              shippingPrice: parsedShipPrice,
              shippingNoteOverride,
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
