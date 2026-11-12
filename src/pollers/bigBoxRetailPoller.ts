import axios from 'axios';
import { getSharedProxyAgent, recordBigBoxCheckTelemetry } from '../../lgsPoller';
import { processIncomingDrop } from '../../listener';
import { sendPokemonCenterQueueAlert } from '../../notifier';
import {
  WafBlockType, WafDomain, PC_QUEUE_BANNER, INVISIBLE_HEADLESS_LAUNCH_OPTS,
  getNativeChromeUserAgent, recordBigBoxDirectIpOutcome, sweepWafProtectedTarget
} from './wafBrowserBridge';
import {
  AMAZON_1P_MERCHANT_ID, BigBoxAdapterResult, dispatchVerifiedBigBoxHits,
  parseAmazon1pPayload, parseBarnesAndNoblePayload, parseBestBuyPayload,
  parseCostcoPayload, parseGameStopPayload, parsePokemonCenterPayload,
  parseSamsClubPayload, parseTargetRedskyPayload, parseWalmartPayload
} from './bigBoxAdapters';
import { pollBestBuyOfficialProductsApi } from './bestBuyOfficialApi';

export const BIG_BOX_STORES = [
  'Target', 'Best Buy', 'Pokémon Center', 'Walmart', 'Amazon', 'GameStop', 'Costco', "Sam's Club", 'Barnes & Noble'
];

const TARGET_SEARCH_TERMS = [
  'pokemon elite trainer box', 'pokemon booster bundle', 'pokemon prismatic evolutions',
  'pokemon destined rivals', 'pokemon scarlet violet 151', 'pokemon surging sparks'
];
const AMAZON_SEARCH_QUERIES = ['pokemon+elite+trainer+box', 'pokemon+booster+bundle'];
const POKEMON_CENTER_URLS = [
  'https://www.pokemoncenter.com/en-us/category/elite-trainer-box',
  'https://www.pokemoncenter.com/en-us/category/booster-packs',
  'https://www.pokemoncenter.com/en-us/category/trading-card-game'
];

export interface BigBoxSweepRow {
  key: string; retailer: string; transport: string; httpStatus: number | string;
  totalNodesFound: number; inStockMatches: number; engineRoomStatus: string;
}

let targetCursor = 0, pcFeedCursor = 0, amazonCursor = 0;
let amazonNextEligibleAt = 0, amazonCookieJar = '';
let isPollingBigBox = false, lastBigBoxPollAt = 0;
const syncedShieldTelemetry = new Set<string>();

export function formatHonestSensorBadge(
  totalNodesFound: number, inStockCount: number, wafType?: WafBlockType, isQueueActive = false, isIpShielded = false
): { status: string; lastStatus: string; statusCode: string } {
  if (isQueueActive) return { status: PC_QUEUE_BANNER, lastStatus: PC_QUEUE_BANNER, statusCode: 'QUEUE_ACTIVE' };
  if (isIpShielded) return { status: 'WIRE_ARMED_IP_SHIELD', lastStatus: 'WIRE_ARMED_IP_SHIELD', statusCode: 'WIRE_ARMED_IP_SHIELD' };
  if (wafType === 'ROUTER_TLS_FILTER') return { status: 'ROUTER_TLS_FILTER', lastStatus: 'ROUTER_TLS_FILTER', statusCode: 'ROUTER_TLS_FILTER' };
  if (wafType) {
    const code = `WAF_CHALLENGE_${wafType}`;
    return { status: code, lastStatus: code, statusCode: code };
  }
  if (totalNodesFound <= 0) return { status: 'PARSER_BLIND_0_NODES', lastStatus: 'PARSER_BLIND_0_NODES', statusCode: 'PARSER_BLIND_0_NODES' };
  if (inStockCount > 0) {
    const label = `200 OK // ${inStockCount} IN STOCK`;
    return { status: label, lastStatus: label, statusCode: '200_OK_PARSED' };
  }
  return { status: '200 OK // 0 IN STOCK', lastStatus: '200 OK // 0 IN STOCK', statusCode: '200_OK_0_IN_STOCK' };
}

function buildSensorNode(
  name: string, cadence: string, engineMethod: string, strictFilter: string,
  parsed: BigBoxAdapterResult, wafType?: WafBlockType, extra?: Record<string, any>
) {
  const inStockCount = parsed.inStockOffers.length;
  const isShield = Boolean(extra?.isIpShielded);
  const badge = formatHonestSensorBadge(parsed.totalNodesFound, inStockCount, isShield ? undefined : wafType, Boolean(extra?.queueActive), isShield);
  return {
    name,
    cadence: isShield ? '6h Home-IP Shield • Sub-Second Wire Armed' : cadence,
    engineMethod: isShield ? 'Bluesky Jetstream WS + Proxy Reddit Wire' : engineMethod,
    strictFilter,
    totalNodesFound: parsed.totalNodesFound, nodesFound: parsed.totalNodesFound,
    itemsExtracted: inStockCount, itemsParsed: inStockCount,
    ...badge, ...(extra || {}), lastCheckedAt: Date.now()
  };
}

function emitShieldedSensorRow(
  key: string, statusKey: string, name: string, strictFilter: string, ipShieldUntil?: number, force = false
): BigBoxSweepRow | null {
  if (!force && syncedShieldTelemetry.has(key)) return null;
  syncedShieldTelemetry.add(key);
  const emptyRes: BigBoxAdapterResult = { totalNodesFound: 0, inStockOffers: [] };
  const node = buildSensorNode(name, '', '', strictFilter, emptyRes, undefined, { isIpShielded: true, ipShieldUntil });
  recordBigBoxCheckTelemetry({ [statusKey]: 'WIRE_ARMED_IP_SHIELD', northStar5: { [key]: node } });
  return { key, retailer: name, transport: 'Home-IP Shield (Wire Active)', httpStatus: 'SHIELD_6H', totalNodesFound: 0, inStockMatches: 0, engineRoomStatus: 'WIRE_ARMED_IP_SHIELD' };
}

export async function pollPokemonCenterDirectMsrp(force = false): Promise<BigBoxSweepRow | null> {
  const pcUrl = POKEMON_CENTER_URLS[pcFeedCursor % POKEMON_CENTER_URLS.length];
  const sweep = await sweepWafProtectedTarget('pokemoncenter', pcUrl, { force, waitAfterLoadMs: 1800, timeoutMs: 16000 });
  if (sweep.isIpShielded) {
    return emitShieldedSensorRow('pokemonCenter', 'pokemonCenterStatus', 'Pokémon Center', '$59.99 Exclusive / 1P MSRP Only', sweep.ipShieldUntil, force || !sweep.fromSessionCache);
  }
  if (!force && sweep.fromSessionCache) return null;
  syncedShieldTelemetry.delete('pokemonCenter');
  pcFeedCursor = (pcFeedCursor + 1) % POKEMON_CENTER_URLS.length;

  const wafMeta = { headless: true, args: INVISIBLE_HEADLESS_LAUNCH_OPTS.args, intervalSec: 180, sessionCacheFile: 'data/wafSessionCookies.json' };
  const emptyRes: BigBoxAdapterResult = { totalNodesFound: 0, inStockOffers: [] };

  if (sweep.isQueueActive) {
    await sendPokemonCenterQueueAlert({ queueUrl: 'https://www.pokemoncenter.com', detectedFromUrl: pcUrl });
    const qNode = buildSensorNode('Pokémon Center', '180s System Chrome Direct + Queue-It', 'System Chrome Direct + Queue-It Radar', '$59.99 Exclusive / 1P MSRP Only', emptyRes, undefined, { queueState: 'QUEUE_ACTIVE', queueActive: true, queueBanner: PC_QUEUE_BANNER, bridgeMode: sweep.browserChannel, lastUrlChecked: pcUrl });
    recordBigBoxCheckTelemetry({ pokemonCenterStatus: 'QUEUE_ACTIVE', wafBridge: wafMeta, northStar5: { pokemonCenter: qNode } });
    return { key: 'pokemonCenter', retailer: 'Pokémon Center', transport: `Playwright (${sweep.browserChannel || 'chrome'})`, httpStatus: sweep.status, totalNodesFound: 0, inStockMatches: 0, engineRoomStatus: qNode.status };
  }
  if (sweep.isWafChallenged) {
    const cNode = buildSensorNode('Pokémon Center', '180s System Chrome Direct + Queue-It', 'System Chrome Direct + TLS/Imperva Probe', '$59.99 Exclusive / 1P MSRP Only', emptyRes, sweep.wafType || 'IMPERVA', { queueState: 'NORMAL', queueActive: false, bridgeMode: sweep.browserChannel, lastUrlChecked: pcUrl });
    recordBigBoxCheckTelemetry({ pokemonCenterStatus: cNode.statusCode, wafBridge: wafMeta, northStar5: { pokemonCenter: cNode } });
    return { key: 'pokemonCenter', retailer: 'Pokémon Center', transport: `Playwright (${sweep.browserChannel || 'chrome'})`, httpStatus: sweep.status || 'ERR', totalNodesFound: 0, inStockMatches: 0, engineRoomStatus: cNode.status };
  }

  const parsed = parsePokemonCenterPayload(sweep.html || '');
  const shieldOut = recordBigBoxDirectIpOutcome('pokemoncenter', parsed.totalNodesFound <= 0, parsed.totalNodesFound > 0 ? '200_OK' : 'PARSER_BLIND_0_NODES');
  if (shieldOut.shielded) {
    return emitShieldedSensorRow('pokemonCenter', 'pokemonCenterStatus', 'Pokémon Center', '$59.99 Exclusive / 1P MSRP Only', shieldOut.ipShieldUntil, true);
  }
  if (parsed.inStockOffers.length > 0) await dispatchVerifiedBigBoxHits(parsed.inStockOffers, processIncomingDrop, 30);
  const node = buildSensorNode('Pokémon Center', '180s System Chrome Direct + Queue-It', 'System Chrome Direct + InStock Grid', '$59.99 Exclusive / 1P MSRP Only', parsed, undefined, { queueState: 'NORMAL', queueActive: false, bridgeMode: sweep.browserChannel, lastUrlChecked: pcUrl });
  recordBigBoxCheckTelemetry({ pokemonCenterStatus: node.statusCode, wafBridge: wafMeta, northStar5: { pokemonCenter: node } });
  return { key: 'pokemonCenter', retailer: 'Pokémon Center', transport: `Playwright (${sweep.browserChannel || 'chrome'})`, httpStatus: sweep.status, totalNodesFound: parsed.totalNodesFound, inStockMatches: parsed.inStockOffers.length, engineRoomStatus: node.status };
}

async function sweepTargetPassiveRedsky(force = false): Promise<BigBoxSweepRow | null> {
  const kw = TARGET_SEARCH_TERMS[targetCursor % TARGET_SEARCH_TERMS.length];
  const plpUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(kw)}&facetedValue=dq4mn`;
  const sw = await sweepWafProtectedTarget('target', plpUrl, {
    force, captureUrlPattern: /redsky\.target\.com\/.*\/plp_search_v2|cdui_orchestrations\/v1\/pages\/slp/i,
    waitForSelector: '[data-test="@web/site-top-of-funnel/ProductCardWrapper"], a[href*="/p/"]', waitAfterLoadMs: 2800, timeoutMs: 16000
  });
  if (sw.isIpShielded) {
    return emitShieldedSensorRow('target', 'targetRedskyStatus', 'Target (RedSky)', '1P Target Sold Only (facetedValue=dq4mn)', sw.ipShieldUntil, force || !sw.fromSessionCache);
  }
  if (!force && sw.fromSessionCache) return null;
  syncedShieldTelemetry.delete('target');
  targetCursor = (targetCursor + 1) % TARGET_SEARCH_TERMS.length;

  const waf = sw.isWafChallenged ? (sw.wafType || 'PX') : undefined;
  const parsed = waf ? { totalNodesFound: 0, inStockOffers: [] } : parseTargetRedskyPayload(sw.capturedJson, sw.html);
  if (!waf) {
    const out = recordBigBoxDirectIpOutcome('target', parsed.totalNodesFound <= 0, parsed.totalNodesFound > 0 ? '200_OK' : 'PARSER_BLIND_0_NODES');
    if (out.shielded) return emitShieldedSensorRow('target', 'targetRedskyStatus', 'Target (RedSky)', '1P Target Sold Only (facetedValue=dq4mn)', out.ipShieldUntil, true);
  }
  if (parsed.inStockOffers.length > 0) await dispatchVerifiedBigBoxHits(parsed.inStockOffers, processIncomingDrop, 15);
  const node = buildSensorNode('Target (RedSky)', '75s Passive RedSky XHR Wire-Tap', 'System Chrome PLP + Passive plp_search_v2', '1P Target Sold Only (facetedValue=dq4mn)', parsed, waf, { lastKeyword: kw, bridgeMode: sw.browserChannel });
  recordBigBoxCheckTelemetry({ targetRedskyStatus: node.statusCode, lastTargetKeyword: kw, itemsScanned: parsed.totalNodesFound, northStar5: { target: node } });
  return { key: 'target', retailer: 'Target', transport: `Playwright Passive XHR (${sw.browserChannel || 'chrome'})`, httpStatus: waf ? 435 : sw.status, totalNodesFound: parsed.totalNodesFound, inStockMatches: parsed.inStockOffers.length, engineRoomStatus: node.status };
}

async function sweepAmazon1pProxyFirst(force = false): Promise<BigBoxSweepRow | null> {
  const now = Date.now();
  if (!force && now < amazonNextEligibleAt) return null;
  amazonNextEligibleAt = now + 95_000 + Math.floor(Math.random() * 10_000);

  const q = AMAZON_SEARCH_QUERIES[amazonCursor % AMAZON_SEARCH_QUERIES.length];
  amazonCursor += 1;
  const amzUrl = `https://www.amazon.com/s?k=${q}&rh=p_6%3A${AMAZON_1P_MERCHANT_ID}&s=date-desc-rank`;
  const navHeaders: Record<string, string> = {
    'User-Agent': getNativeChromeUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1', 'Upgrade-Insecure-Requests': '1',
    ...(amazonCookieJar ? { Cookie: amazonCookieJar } : {})
  };

  let transport = 'Webshare Proxy HTTP', status: number | string = 0, html = '', waf: WafBlockType | undefined;
  const proxyAgent = getSharedProxyAgent();
  if (proxyAgent) {
    try {
      const r = await axios.get(amzUrl, { httpsAgent: proxyAgent, proxy: false, timeout: 9500, validateStatus: () => true, headers: navHeaders });
      status = r.status;
      const sc = r.headers?.['set-cookie'];
      if (Array.isArray(sc) && sc.length > 0) amazonCookieJar = sc.map((c: string) => c.split(';')[0]).join('; ');
      html = String(r.data || '');
    } catch { status = 503; }
  }

  if (!html || Number(status) >= 400 || /validateCaptcha|api-services-support@amazon\.com|Enter the characters you see below/i.test(html)) {
    const sw = await sweepWafProtectedTarget('amazon', amzUrl, { force, waitForSelector: 'div[data-component-type="s-search-result"]', waitAfterLoadMs: 1200, timeoutMs: 15000 });
    if (sw.html) {
      transport = `Playwright Fallback (${sw.browserChannel || 'chrome'})`;
      status = sw.status || 200;
      html = sw.html;
      if (sw.cookieHeader) amazonCookieJar = sw.cookieHeader;
    }
  }
  if (/validateCaptcha|api-services-support@amazon\.com|Enter the characters you see below/i.test(html) || Number(status) >= 400 || !html) {
    waf = 'BOT_CHECK';
  }

  const parsed = waf ? { totalNodesFound: 0, inStockOffers: [] } : parseAmazon1pPayload(html, true);
  if (parsed.inStockOffers.length > 0) await dispatchVerifiedBigBoxHits(parsed.inStockOffers, processIncomingDrop, 20);
  const node = buildSensorNode('Amazon (1P MSRP)', '95s Webshare Proxy + Polite Fallback', 's-search-result 1P ATVPDKIKX0DER + 1-Tap Cart', 'Ships & Sold by Amazon.com (<= MSRP*1.08)', parsed, waf);
  recordBigBoxCheckTelemetry({ amazonStatus: node.statusCode, northStar5: { amazon: node } });
  return { key: 'amazon', retailer: 'Amazon 1P', transport, httpStatus: status, totalNodesFound: parsed.totalNodesFound, inStockMatches: parsed.inStockOffers.length, engineRoomStatus: node.status };
}

async function sweepBestBuyHybrid(force = false): Promise<BigBoxSweepRow | null> {
  const apiRes = await pollBestBuyOfficialProductsApi();
  if (apiRes.configured && apiRes.ok) {
    if (apiRes.parsed.inStockOffers.length > 0) await dispatchVerifiedBigBoxHits(apiRes.parsed.inStockOffers, processIncomingDrop, 20);
    const node = buildSensorNode('Best Buy', '95s Official API + 1-Tap Cart', 'Best Buy Products REST API', '1P Retail MSRP ($49.99–$54.99 ETB)', apiRes.parsed);
    recordBigBoxCheckTelemetry({ bestBuyStatus: node.statusCode, northStar5: { bestBuy: node } });
    return { key: 'bestBuy', retailer: 'Best Buy', transport: 'BestBuy REST API', httpStatus: apiRes.status, totalNodesFound: apiRes.parsed.totalNodesFound, inStockMatches: apiRes.parsed.inStockOffers.length, engineRoomStatus: node.status };
  }

  const bbUrl = 'https://www.bestbuy.com/site/searchpage.jsp?st=pokemon+elite+trainer+box';
  const sw = await sweepWafProtectedTarget('bestbuy', bbUrl, { force, waitForSelector: 'li.product-list-item, .sku-item', waitAfterLoadMs: 1800, timeoutMs: 16000 });
  if (!force && sw.fromSessionCache) return null;
  const waf = sw.isWafChallenged ? (sw.wafType || 'AKAMAI') : undefined;
  const parsed = waf ? { totalNodesFound: 0, inStockOffers: [] } : parseBestBuyPayload(sw.html);
  if (parsed.inStockOffers.length > 0) await dispatchVerifiedBigBoxHits(parsed.inStockOffers, processIncomingDrop, 20);
  const node = buildSensorNode('Best Buy', '95s System Chrome + 1-Tap Cart', 'System Chrome .product-list-item + ButtonState', '1P Retail MSRP ($49.99–$54.99 ETB / $27.99 Bundle)', parsed, waf, { bridgeMode: sw.browserChannel });
  recordBigBoxCheckTelemetry({ bestBuyStatus: node.statusCode, northStar5: { bestBuy: node } });
  return { key: 'bestBuy', retailer: 'Best Buy', transport: `Playwright (${sw.browserChannel || 'chrome'})`, httpStatus: sw.status || 'TIMEOUT', totalNodesFound: parsed.totalNodesFound, inStockMatches: parsed.inStockOffers.length, engineRoomStatus: node.status };
}

export async function pollSecondaryBigBoxSensors(force = false): Promise<BigBoxSweepRow[]> {
  const rows: BigBoxSweepRow[] = [];
  const amz = await sweepAmazon1pProxyFirst(force);
  if (amz) rows.push(amz);
  const bb = await sweepBestBuyHybrid(force);
  if (bb) rows.push(bb);

  const chromeTargets: Array<{
    domain: WafDomain; key: string; statusKey: string; name: string; cadence: string; method: string; filter: string;
    url: string; waitSel?: string; waitMs: number; captureRe?: RegExp; defaultWaf: WafBlockType;
    parse: (html: string, jsons: any[]) => BigBoxAdapterResult;
  }> = [
    { domain: 'walmart', key: 'walmart', statusKey: 'walmartStatus', name: 'Walmart (1P MSRP)', cadence: '95s System Chrome 1P Sweep', method: 'System Chrome #__NEXT_DATA__ F55CDC31 + /pac', filter: 'Sold & Shipped by Walmart.com Only', url: 'https://www.walmart.com/search?q=pokemon+elite+trainer+box&facet=retailer_type%3AWalmart', waitMs: 1500, defaultWaf: 'PX', parse: (h, j) => parseWalmartPayload(h, j) },
    { domain: 'costco', key: 'costco', statusKey: 'costcoStatus', name: 'Costco Wholesale', cadence: '105s System Chrome + Search XHR', method: 'Passive Search API + ProductTile Hydration', filter: '1P Member Sealed Multi-Packs & ETBs', url: 'https://www.costco.com/s?keyword=pokemon+cards', waitSel: '[data-testid="ProductTile"], .product-tile-set', waitMs: 2800, captureRe: /gdx-api\.costco\.com\/catalog\/search/i, defaultWaf: 'KASADA', parse: (h, j) => parseCostcoPayload(h, j) },
    { domain: 'samsclub', key: 'samsClub', statusKey: 'samsClubStatus', name: "Sam's Club", cadence: '105s System Chrome Club Sweep', method: 'System Chrome #__NEXT_DATA__ Club Inventory', filter: '1P Member Sealed Multi-Packs & ETBs', url: 'https://www.samsclub.com/s/pokemon%20cards', waitMs: 2000, defaultWaf: 'PX', parse: (h, j) => parseSamsClubPayload(h, j) },
    { domain: 'gamestop', key: 'gamestop', statusKey: 'gamestopStatus', name: 'GameStop', cadence: '150s System Chrome WAF Bridge', method: 'System Chrome data-gtmdata + Slider Fallthrough', filter: '1P MSRP + Sub-Slider Sealed Boxes & ETBs', url: 'https://www.gamestop.com/search/?q=pokemon+elite+trainer+box&type=Primary&sort=BestMatch_Desc&p=1', waitMs: 1400, defaultWaf: 'CF', parse: (h) => parseGameStopPayload(h) },
    { domain: 'barnesandnoble', key: 'barnesNoble', statusKey: 'barnesNobleStatus', name: 'Barnes & Noble', cadence: '150s System Chrome Hydrogen', method: 'System Chrome Hydrogen /w/?ean= Cards', filter: '1P Retail MSRP ETBs & Booster Bundles', url: 'https://www.barnesandnoble.com/search?q=pokemon+trading+card+game', waitSel: 'a[href*="/w/"]', waitMs: 1800, defaultWaf: 'CF', parse: (h) => parseBarnesAndNoblePayload(h) }
  ];

  for (const ct of chromeTargets) {
    const sw = await sweepWafProtectedTarget(ct.domain, ct.url, { force, waitForSelector: ct.waitSel, waitAfterLoadMs: ct.waitMs, captureUrlPattern: ct.captureRe, timeoutMs: 16000 });
    if (sw.isIpShielded) {
      const sRow = emitShieldedSensorRow(ct.key, ct.statusKey, ct.name, ct.filter, sw.ipShieldUntil, force || !sw.fromSessionCache);
      if (sRow) rows.push(sRow);
      continue;
    }
    if (!force && sw.fromSessionCache) continue;
    syncedShieldTelemetry.delete(ct.key);
    const waf = sw.isWafChallenged ? (sw.wafType || ct.defaultWaf) : undefined;
    const parsed = waf ? { totalNodesFound: 0, inStockOffers: [] } : ct.parse(sw.html, sw.capturedJson);
    if (!waf) {
      const out = recordBigBoxDirectIpOutcome(ct.domain, parsed.totalNodesFound <= 0, parsed.totalNodesFound > 0 ? '200_OK' : 'PARSER_BLIND_0_NODES');
      if (out.shielded) {
        const sRow = emitShieldedSensorRow(ct.key, ct.statusKey, ct.name, ct.filter, out.ipShieldUntil, true);
        if (sRow) rows.push(sRow);
        continue;
      }
    }
    if (parsed.inStockOffers.length > 0) await dispatchVerifiedBigBoxHits(parsed.inStockOffers, processIncomingDrop, 20);
    const node = buildSensorNode(ct.name, ct.cadence, ct.method, ct.filter, parsed, waf, { bridgeMode: sw.browserChannel });
    recordBigBoxCheckTelemetry({ [ct.statusKey]: node.statusCode, northStar5: { [ct.key]: node } });
    rows.push({
      key: ct.key, retailer: ct.name, transport: `Playwright (${sw.browserChannel || 'chrome'})`,
      httpStatus: waf === 'PX' && sw.status === 200 ? '200->PX' : (sw.status || 'ERR'),
      totalNodesFound: parsed.totalNodesFound, inStockMatches: parsed.inStockOffers.length, engineRoomStatus: node.status
    });
  }
  return rows;
}

export async function runSinglePassBigBoxSweep(force = true): Promise<BigBoxSweepRow[]> {
  const isForce = force === true;
  const out: BigBoxSweepRow[] = [];
  const pc = await pollPokemonCenterDirectMsrp(isForce);
  if (pc) out.push(pc);
  const tgt = await sweepTargetPassiveRedsky(isForce);
  if (tgt) out.push(tgt);
  out.push(...(await pollSecondaryBigBoxSensors(isForce)));
  return out;
}

export async function pollBigBoxAggregators(): Promise<void> {
  if (isPollingBigBox) {
    if (Date.now() - lastBigBoxPollAt > 180_000) isPollingBigBox = false;
    else return;
  }
  isPollingBigBox = true;
  lastBigBoxPollAt = Date.now();
  try {
    await runSinglePassBigBoxSweep(false);
  } catch (err: any) {
    recordBigBoxCheckTelemetry({ lastTargetError: err?.message || 'BigBox sweep error' });
  } finally {
    isPollingBigBox = false;
    setTimeout(pollBigBoxAggregators, 25_000);
  }
}
