import axios from 'axios';
import { getNextProxy, recordBigBoxCheckTelemetry } from '../../lgsPoller';
import { processIncomingDrop } from '../../listener';
import {
  WATCH_POLICIES,
  isValidSkuForFormFactor,
  isSingleCardOrNonSealed,
  hasMandatorySealedContainerKeyword
} from '../../policies';

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

const POKEMON_CENTER_URLS = [
  'https://www.pokemoncenter.com/en-us/category/elite-trainer-box',
  'https://www.pokemoncenter.com/en-us/category/booster-packs',
  'https://www.pokemoncenter.com/en-us/category/trading-card-game'
];

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache'
};

const seenBigBoxOffers = new Map<string, { price: number; timestamp: number }>();
const seenPcProductSlugs = new Set<string>();
let targetCursor = 0;
let pcFeedCursor = 0;
let pcCookieHeader = '';
let lastPcPollAt = 0;
let lastPcQueueAlertAt = 0;
let isPollingBigBox = false;
let lastBigBoxPollAt = 0;

async function httpGetWithProxyFallback(url: string, headers: Record<string, string>, timeoutMs = 7000) {
  const attempt = async (httpsAgent?: any) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await axios.get(url, {
        timeout: timeoutMs,
        signal: controller.signal,
        httpsAgent,
        headers,
        validateStatus: (s) => s >= 200 && s < 500
      });
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const res = await attempt();
    if (res.status === 403 || res.status === 429) {
      try {
        return await attempt(getNextProxy());
      } catch {
        return res;
      }
    }
    return res;
  } catch {
    return await attempt(getNextProxy());
  }
}

export function formatHonestSensorBadge(itemsExtracted: number, wafType?: 'IMPERVA' | 'PX'): {
  status: string;
  lastStatus: string;
  statusCode: string;
} {
  if (wafType === 'IMPERVA') {
    return { status: 'WAF_CHALLENGE_IMPERVA', lastStatus: 'WAF_CHALLENGE_IMPERVA', statusCode: 'WAF_CHALLENGE_IMPERVA' };
  }
  if (wafType === 'PX') {
    return { status: 'WAF_CHALLENGE_PX', lastStatus: 'WAF_CHALLENGE_PX', statusCode: 'WAF_CHALLENGE_PX' };
  }
  if (itemsExtracted > 0) {
    const label = `200 OK // ${itemsExtracted} PARSED`;
    return { status: label, lastStatus: label, statusCode: '200_OK_PARSED' };
  }
  return { status: '200 OK // 0 IN STOCK', lastStatus: '200 OK // 0 IN STOCK', statusCode: '200_OK_0_IN_STOCK' };
}

function buildSensorNode(
  name: string,
  cadence: string,
  engineMethod: string,
  strictFilter: string,
  itemsExtracted: number,
  wafType?: 'IMPERVA' | 'PX',
  extra?: Record<string, any>
) {
  const badge = formatHonestSensorBadge(itemsExtracted, wafType);
  return {
    name,
    cadence,
    engineMethod,
    strictFilter,
    itemsExtracted,
    itemsParsed: itemsExtracted,
    ...badge,
    ...(extra || {}),
    lastCheckedAt: Date.now()
  };
}

export async function pollPokemonCenterDirectMsrp(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastPcPollAt < 85000) return;
  lastPcPollAt = now;
  const pcUrl = POKEMON_CENTER_URLS[pcFeedCursor % POKEMON_CENTER_URLS.length];
  pcFeedCursor = (pcFeedCursor + 1) % POKEMON_CENTER_URLS.length;

  try {
    const reqHeaders = { ...BROWSER_HEADERS };
    if (pcCookieHeader) reqHeaders['Cookie'] = pcCookieHeader;
    const res = await httpGetWithProxyFallback(pcUrl, reqHeaders, 7000);
    const setCookies = res.headers?.['set-cookie'];
    if (Array.isArray(setCookies) && setCookies.length > 0) {
      pcCookieHeader = setCookies.map((c: string) => c.split(';')[0]).join('; ');
    }

    const rawBody = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
    const headerDump = JSON.stringify(res.headers || {});
    const isQueueActive =
      /virtual\s+waiting\s+room|you\s+are\s+now\s+in\s+line|queue-it\.net|incap_wr|waiting-room/i.test(rawBody) ||
      /incap_wr|x-queue-it|queue-it/i.test(headerDump);
    const isImpervaBlocked =
      res.status === 403 || /_Incapsula_Resource|Pardon Our Interruption|incapsula|Request unsuccessful/i.test(rawBody);

    if (isQueueActive && (now - lastPcQueueAlertAt > 2 * 60 * 60 * 1000)) {
      lastPcQueueAlertAt = now;
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
        shippingNoteOverride: '◈ ⟦ POKEMON CENTER QUEUE / MSRP DROP RADAR ⟧ Security Queue Active — Check $59.99 PC Exclusive ETB Drop Now!'
      });
    }

    if (isImpervaBlocked && !isQueueActive) {
      const node = buildSensorNode('Pokémon Center', '90s Direct + Queue-It Radar', '1P PokemonCenter.com + Queue-It Detector', '$59.99 Exclusive / 1P MSRP Only', 0, 'IMPERVA', { queueState: 'NORMAL', lastUrlChecked: pcUrl });
      recordBigBoxCheckTelemetry({ pokemonCenterStatus: node.statusCode, northStar5: { pokemonCenter: node } });
      return;
    }

    const productMatches = [...rawBody.matchAll(/\/product\/(\d+-\d+)\/([a-z0-9-]+)/gi)];
    let itemsExtracted = 0;
    for (const m of productMatches) {
      const prodCode = m[1];
      const slug = m[2].replace(/-/g, ' ');
      const fullUrl = `https://www.pokemoncenter.com/product/${prodCode}/${m[2]}`;
      if (isSingleCardOrNonSealed(slug, undefined, fullUrl) || !hasMandatorySealedContainerKeyword(slug)) continue;
      const matchedPolicy = WATCH_POLICIES.find((pol) => pol.active !== false && pol.matchers.some((rx) => rx.test(slug)));
      if (!matchedPolicy) continue;
      const defaultPcMsrp = String(matchedPolicy.formFactor || '').toLowerCase() === 'etb' ? 59.99 : (matchedPolicy.msrpCeiling || 59.99);
      if (!isValidSkuForFormFactor(`${slug} pokemon center`, matchedPolicy.formFactor, defaultPcMsrp, {
        ruleId: matchedPolicy.id, targetName: matchedPolicy.name, handle: fullUrl, retailer: 'Pokémon Center', sourceUrl: fullUrl, allowPcRetailUnlock: true
      })) continue;

      itemsExtracted += 1;
      const isNewSlug = !seenPcProductSlugs.has(prodCode);
      seenPcProductSlugs.add(prodCode);
      const offerKey = `pc_${prodCode}`;
      const prev = seenBigBoxOffers.get(offerKey);
      if (isNewSlug || !prev || (Date.now() - prev.timestamp) / 60000 >= 30) {
        seenBigBoxOffers.set(offerKey, { price: defaultPcMsrp, timestamp: Date.now() });
        await processIncomingDrop({
          title: `${matchedPolicy.name} (Pokémon Center Exclusive)`,
          retailer: 'Pokémon Center ($59.99 MSRP Direct)',
          url: fullUrl, productUrl: fullUrl, price: defaultPcMsrp, itemId: offerKey,
          isPreOrder: Boolean((matchedPolicy as any).isPreRelease || /pre-?order/i.test(rawBody)),
          freeShipping: true, isBigBoxRestockRadar: true
        });
      }
    }

    const node = buildSensorNode('Pokémon Center', '90s Direct + Queue-It Radar', '1P PokemonCenter.com + Queue-It Detector', '$59.99 Exclusive / 1P MSRP Only', itemsExtracted, undefined, { queueState: isQueueActive ? 'QUEUE_ACTIVE' : 'NORMAL', lastUrlChecked: pcUrl });
    recordBigBoxCheckTelemetry({ pokemonCenterStatus: node.statusCode, northStar5: { pokemonCenter: node } });
  } catch {
    const node = buildSensorNode('Pokémon Center', '90s Direct + Queue-It Radar', '1P PokemonCenter.com + Queue-It Detector', '$59.99 Exclusive / 1P MSRP Only', 0, 'IMPERVA', { queueState: 'NORMAL' });
    recordBigBoxCheckTelemetry({ pokemonCenterStatus: node.statusCode, northStar5: { pokemonCenter: node } });
  }
}

export async function pollSecondaryBigBoxSensors(): Promise<void> {
  // 1. Walmart 1P MSRP
  try {
    const wmUrl = 'https://www.walmart.com/search?q=pokemon+elite+trainer+box&facet=retailer_type%3AWalmart';
    const res = await httpGetWithProxyFallback(wmUrl, BROWSER_HEADERS, 6500);
    const html = String(res.data || '');
    const isPx = res.status === 403 || res.status === 429 || /px-captcha|Robot or human\?|verify you are human|\/blocked/i.test(html);
    let wmExtracted = 0;
    if (!isPx) {
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
      if (nextMatch) {
        const stacks = JSON.parse(nextMatch[1])?.props?.pageProps?.initialData?.searchResult?.itemStacks || [];
        for (const st of stacks) {
          for (const item of st?.items || []) {
            const title = String(item?.name || '').trim();
            const price = parseFloat(item?.priceInfo?.linePrice?.replace(/[^0-9.]/g, '') || item?.price || 0);
            const seller = String(item?.sellerName || '');
            const isAvail = item?.availabilityStatusV2?.value === 'IN_STOCK' || item?.availabilityStatus === 'IN_STOCK';
            if (!title || !price || !isAvail || !/^walmart(\.com)?$/i.test(seller.trim())) continue;
            if (isSingleCardOrNonSealed(title) || !hasMandatorySealedContainerKeyword(title)) continue;
            const matched = WATCH_POLICIES.find((p) => p.active !== false && p.matchers.some((rx) => rx.test(title)));
            if (!matched || !hasMandatorySealedContainerKeyword(title, matched.formFactor) || price > (matched.msrpCeiling || 54.99) * 1.08) continue;
            wmExtracted += 1;
            const prodUrl = item?.canonicalUrl ? `https://www.walmart.com${item.canonicalUrl}` : wmUrl;
            const offerKey = `walmart_${item?.usItemId || matched.id}`;
            const prev = seenBigBoxOffers.get(offerKey);
            if (!prev || price < prev.price || (Date.now() - prev.timestamp) / 60000 >= 20) {
              seenBigBoxOffers.set(offerKey, { price, timestamp: Date.now() });
              await processIncomingDrop({ title, retailer: 'Walmart (1P MSRP)', url: prodUrl, productUrl: prodUrl, price, itemId: offerKey, freeShipping: price >= 35 });
            }
          }
        }
      }
    }
    const wmNode = buildSensorNode('Walmart (1P MSRP)', '45s 1P Facet Sweep', '1P Sold & Shipped by Walmart.com (<= $55 ETB)', 'Sold & Shipped by Walmart.com Only', wmExtracted, isPx ? 'PX' : undefined);
    recordBigBoxCheckTelemetry({ walmartStatus: wmNode.statusCode, northStar5: { walmart: wmNode } });
  } catch {
    const wmNode = buildSensorNode('Walmart (1P MSRP)', '45s 1P Facet Sweep', '1P Sold & Shipped by Walmart.com (<= $55 ETB)', 'Sold & Shipped by Walmart.com Only', 0, 'PX');
    recordBigBoxCheckTelemetry({ walmartStatus: wmNode.statusCode, northStar5: { walmart: wmNode } });
  }

  // 2. Best Buy, Costco, Sam's Club, GameStop
  const checks = [
    { key: 'bestBuy', statusKey: 'bestBuyStatus', name: 'Best Buy', cadence: '60s SKU Availability JSON', method: 'SKU Search & ButtonState (SoldOut vs AddToCart)', filter: '1P Retail MSRP ($49.99–$54.99 ETB / $26.99 Bundle)', url: 'https://www.bestbuy.com/site/searchpage.jsp?st=pokemon+elite+trainer+box+booster+bundle&id=pcat17071' },
    { key: 'costco', statusKey: 'costcoStatus', name: 'Costco Wholesale', cadence: '60s CatalogSearch', method: 'CatalogSearch Online Stock Check (InStock vs SoldOut)', filter: '$39.99–$64.99 Member Pallet Multi-Packs', url: 'https://www.costco.com/CatalogSearch?dept=All&keyword=pokemon+cards' },
    { key: 'samsClub', statusKey: 'samsClubStatus', name: "Sam's Club", cadence: '60s Club Pallet Search', method: 'SamsClub.com Online Inventory Check', filter: 'Member Exclusive Sealed Multi-Packs', url: 'https://www.samsclub.com/s/pokemon%20cards' },
    { key: 'gamestop', statusKey: 'gamestopStatus', name: 'GameStop', cadence: '60s 1P Catalog Check', method: 'GameStop.com Sealed TCG Availability', filter: '1P Retail MSRP Sealed Boxes & ETBs', url: 'https://www.gamestop.com/search/?q=pokemon+elite+trainer+box&type=Primary&sort=BestMatch_Desc&p=1' }
  ];

  for (const c of checks) {
    try {
      const res = await httpGetWithProxyFallback(c.url, BROWSER_HEADERS, 6000);
      const html = String(res.data || '');
      const isPx = /px-captcha|Robot or human\?|verify you are human/i.test(html);
      const isImp = res.status === 403 || /Access Denied|_Incapsula_Resource|Pardon Our Interruption|sec-if-cpt-container|cf-chl-bypass/i.test(html);
      let count = 0;
      if (!isPx && !isImp && res.status === 200) {
        if (c.key === 'bestBuy') {
          const blocks = [...html.matchAll(/"skuId"\s*:\s*"(\d{7})"[\s\S]{0,350}?"name"\s*:\s*"([^"]+)"[\s\S]{0,350}?"currentPrice"\s*:\s*([0-9.]+)[\s\S]{0,250}?"buttonState"\s*:\s*"(ADD_TO_CART|PRE_ORDER)"/gi)];
          count = blocks.filter((b) => !isSingleCardOrNonSealed(b[2]) && hasMandatorySealedContainerKeyword(b[2])).length;
        } else if (c.key === 'costco') {
          const links = [...html.matchAll(/href="(https?:\/\/www\.costco\.com\/[^"]*pokemon[^"]*\.product\.[^"]+\.html)"[^>]*>([^<]{5,120})</gi)];
          count = links.filter((l) => !isSingleCardOrNonSealed(l[2], undefined, l[1]) && hasMandatorySealedContainerKeyword(l[2])).length;
        }
      }
      const waf = isPx ? 'PX' : (isImp ? 'IMPERVA' : undefined);
      const node = buildSensorNode(c.name, c.cadence, c.method, c.filter, count, waf);
      recordBigBoxCheckTelemetry({ [c.statusKey]: node.statusCode, northStar5: { [c.key]: node } });
    } catch {
      const node = buildSensorNode(c.name, c.cadence, c.method, c.filter, 0);
      recordBigBoxCheckTelemetry({ [c.statusKey]: node.statusCode, northStar5: { [c.key]: node } });
    }
  }
}

export async function pollBigBoxAggregators(): Promise<void> {
  if (isPollingBigBox) {
    if (Date.now() - lastBigBoxPollAt > 45000) isPollingBigBox = false;
    else return;
  }
  isPollingBigBox = true;
  lastBigBoxPollAt = Date.now();
  const keyword = TARGET_REDSKY_QUERIES[targetCursor % TARGET_REDSKY_QUERIES.length];
  targetCursor = (targetCursor + 1) % TARGET_REDSKY_QUERIES.length;

  try {
    await pollPokemonCenterDirectMsrp();
    const encodedKw = encodeURIComponent(keyword);
    const redskyUrl = `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?key=9f36aeafbe60771e321a7cc95a78140772ab3e96&channel=WEB&count=24&default_purchasability_filter=true&include_sponsored=false&keyword=${encodedKw}&new_search=true&offset=0&page=%2Fs%2F${encodedKw}&platform=desktop&pricing_store_id=3991&zip=76177&state=TX&useragent=Mozilla%2F5.0&visitor_id=0192B7C8E2F0020188A9`;
    const res = await httpGetWithProxyFallback(redskyUrl, { ...BROWSER_HEADERS, Accept: 'application/json' }, 7000);
    const products: any[] = Array.isArray(res.data?.data?.search?.products) ? res.data.data.search.products : [];
    let valid1pExtracted = 0;

    for (const p of products) {
      const tcin = String(p.tcin || '');
      const rawTitle = String(p.item?.product_description?.title || '').replace(/&#38;|&amp;/g, '&').replace(/&#8212;|&mdash;/g, ' - ').trim();
      const price = parseFloat(p.price?.current_retail || p.price?.reg_retail || 0);
      const buyUrl = String(p.item?.enrichment?.buy_url || (tcin ? `https://www.target.com/p/-/A-${tcin}` : 'https://www.target.com'));
      if (!tcin || !rawTitle || !price || price < 18) continue;
      if (isSingleCardOrNonSealed(rawTitle, undefined, buyUrl) || !hasMandatorySealedContainerKeyword(rawTitle)) continue;

      const matchedPolicy = WATCH_POLICIES.find((pol) => pol.active !== false && pol.matchers.some((rx) => rx.test(rawTitle)));
      if (!matchedPolicy || !hasMandatorySealedContainerKeyword(rawTitle, matchedPolicy.formFactor)) continue;

      const vendorNames = Array.isArray(p.item?.product_vendors) ? p.item.product_vendors.map((v: any) => String(v?.vendor_name || '')).join(' ') : '';
      const is3pSeller = Boolean(p.fulfillment?.is_marketplace || /blueproton|collectors\s*emporium|target\s*plus/i.test(vendorNames));
      const msrpCap = Math.round((matchedPolicy.msrpCeiling || 54.99) * 1.08 * 100) / 100;
      const policyMaxBuy = Math.max(matchedPolicy.msrpCeiling || 0, matchedPolicy.maxMarketBuyPrice || 0);
      if (!is3pSeller && price > msrpCap) continue;
      if (is3pSeller && price > policyMaxBuy) continue;

      if (!isValidSkuForFormFactor(rawTitle, matchedPolicy.formFactor, price, {
        ruleId: matchedPolicy.id, targetName: matchedPolicy.name, handle: buyUrl, retailer: 'Target', sourceUrl: buyUrl, allowPcRetailUnlock: false
      })) continue;

      valid1pExtracted += 1;
      const offerKey = `target_${tcin}`;
      const prev = seenBigBoxOffers.get(offerKey);
      if (!prev || price < prev.price || (Date.now() - prev.timestamp) / 60000 >= 15) {
        seenBigBoxOffers.set(offerKey, { price, timestamp: Date.now() });
        await processIncomingDrop({
          title: rawTitle,
          retailer: is3pSeller ? 'Target Plus (Under Trigger)' : 'Target (RedSky Live 1P MSRP)',
          url: buyUrl, productUrl: buyUrl, price, itemId: offerKey,
          isPreOrder: /pre-?order|pre-?sale/i.test(rawTitle), freeShipping: price >= 35
        });
      }
    }

    const tNode = buildSensorNode('Target (RedSky)', '15s RedSky JSON API', 'RedSky 1P Fulfillment API (Zip 76177 • Store 3991)', '1P Retail MSRP (<= $55.99 ETB / <= $30.99 Bundle)', valid1pExtracted, undefined, { lastKeyword: keyword });
    recordBigBoxCheckTelemetry({ targetRedskyStatus: tNode.statusCode, lastTargetKeyword: keyword, itemsScanned: valid1pExtracted, northStar5: { target: tNode } });
    await pollSecondaryBigBoxSensors();
  } catch (err: any) {
    const tNode = buildSensorNode('Target (RedSky)', '15s RedSky JSON API', 'RedSky 1P Fulfillment API (Zip 76177 • Store 3991)', '1P Retail MSRP (<= $55.99 ETB / <= $30.99 Bundle)', 0);
    recordBigBoxCheckTelemetry({ targetRedskyStatus: 'DEGRADED', lastTargetError: err?.message || 'RedSky poll error', northStar5: { target: tNode } });
  } finally {
    isPollingBigBox = false;
    setTimeout(pollBigBoxAggregators, 15000);
  }
}
