import { recordBigBoxCheckTelemetry } from '../../lgsPoller';
import { processIncomingDrop } from '../../listener';
import { sendBigBoxQueueOrDrawingAlert } from '../../notifier';
import { PolicyRule, detectBigBoxRetailer, matchProductToSku } from '../../policies';
import { AMAZON_1P_MERCHANT_ID, claimBigBoxCrossChannelSignal, cleanHtmlText } from './bigBoxAdapters';

export type WireEventClassification = 'INSTANT_BUY_RESTOCK' | 'QUEUE_INVITE_DRAWING';
export type WireWindowKind = 'QUEUE' | 'INVITE' | 'DRAWING';
export interface UnshortenedRetailLink {
  originalUrl: string; finalUrl: string; canonicalUrl: string; checkoutUrl: string;
  cart1xUrl?: string; retailer: string | null; canonicalItemId: string; hops: number;
}
export interface EvaluatedWireSignal {
  source: string; postAgeSec: number; isLiveEligible: boolean; originalUrl: string;
  canonicalUrl: string; checkoutUrl: string; retailer: string | null; canonicalItemId: string;
  hops: number; classification: WireEventClassification; windowKind?: WireWindowKind;
  matchedSkuId: string | null; matchedSkuName: string | null; price?: number; dispatched: boolean;
}

const BSKY_APPVIEW_BASE = 'https://public.api.bsky.app/xrpc';
const BSKY_JETSTREAM_BASE = 'wss://jetstream2.us-east.bsky.network/subscribe';
export const WIRE_LIVE_MAX_AGE_MS = 15 * 60 * 1000;
const DEDICATED_POKEMON_FEED_RE = /(?:^|[@\s])pokemonrestocks\.bsky\.social\b/i;
const POKEMON_RELEVANCE_RE = /\b(30th|celebration|upc|ultra\s+premium|umbreon|espeon|booster|bundle|blister|prismatic|destined\s+rivals|paldean|surging\s+sparks|journey\s+together|delta\s+reign|chaos\s+rising|pitch\s+black|phantasmal|perfect\s+order|ascended\s+heroes|pok[eé]mon|pkmn|tcg|etb|pikachu|charizard|mewtwo|eevee|elite\s+trainer\s+box|pokemon\s*center)\b/i;
const SHORTENER_BARE_RE = /\b((?:buff\.ly|amzn\.to|bit\.ly|mavely\.app\.link|mavelylife\.com|shop-links\.co|howl\.me|linktr\.ee|goto\.target\.com|goto\.walmart\.com|bestbuy\w*\.7tiv\.net)\/[A-Za-z0-9_/-]+)/gi;
const DIRECT_RETAIL_HOST_RE = /(?:^|\.)(?:target\.com|walmart\.com|bestbuy\.com|amazon\.com|pokemoncenter\.com|gamestop\.com|costco\.com|samsclub\.com|barnesandnoble\.com)$/i;
const INTERSTITIAL_WRAPPER_HOST_RE = /(?:^|\.)(?:mavelylife\.com|mavely\.app\.link|shop-links\.co|howl\.me|linktr\.ee|bam-x\.com|narrativ\.com)$/i;
const EMBEDDED_URL_PARAMS = ['u', 'url', 'ulp', 'murl', 'return', 'target', 'dest', 'redirect', 'redirectUrl'];

const seenWirePostUris = new Set<string>(), unshortenCache = new Map<string, UnshortenedRetailLink>();
let activeJetstreamWs: WebSocket | null = null, restPollTimer: any = null, reconnectTimer: any = null, wireStarted = false, reconnectAttempt = 0;

export const wireTelemetry = {
  handles: [] as string[], didMap: {} as Record<string, string>, jetstreamConnected: false,
  lastJetstreamOpenAt: 0, lastJetstreamEventAt: 0, jetstreamReconnects: 0,
  lastRestPollAt: 0, postsInspected: 0, linksUnshortened: 0, signalsDispatched: 0
};

export const getConfiguredBskyHandles = (): string[] =>
  String(process.env.RESTOCK_BSKY_HANDLES || 'pokemonrestocks.bsky.social,hoomandeals.bsky.social').split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
export const isDedicatedPokemonFeed = (sourceOrHandle: string): boolean => DEDICATED_POKEMON_FEED_RE.test(String(sourceOrHandle || ''));
export const isPokemonTcgRelevantText = (txt: string): boolean => POKEMON_RELEVANCE_RE.test(String(txt || ''));

function isDirectRetailFinalUrl(candidateUrl: string): boolean {
  try { const u = new URL(candidateUrl); return DIRECT_RETAIL_HOST_RE.test(u.hostname) && !/^\/c\/\d+\//i.test(u.pathname); } catch { return false; }
}

function tryDecodeEmbeddedRetailUrl(candidateUrl: string): string | null {
  try {
    const parsed = new URL(candidateUrl);
    for (const key of EMBEDDED_URL_PARAMS) {
      let val = parsed.searchParams.get(key);
      if (!val) continue;
      for (let d = 0; d < 2 && /^https?%3A/i.test(val); d++) { try { val = decodeURIComponent(val); } catch { break; } }
      if (/^https?:\/\//i.test(val)) {
        const inner = tryDecodeEmbeddedRetailUrl(val);
        if (inner) return inner;
        if (isDirectRetailFinalUrl(val)) return val;
      }
    }
    if (isDirectRetailFinalUrl(candidateUrl)) return candidateUrl;
  } catch {}
  return null;
}

export function extractRetailTargetFromWrapperHtml(htmlChunk: string): { retailUrl?: string; inferredRetailer?: string } {
  const normalized = String(htmlChunk || '').slice(0, 32768).replace(/&amp;/gi, '&').replace(/\\\//g, '/');
  const candidates: string[] = Array.from(normalized.matchAll(/https?:\/\/[^\s"'<>\\)]+/gi), (m) => m[0]);
  for (const m of normalized.matchAll(/https?%3A%2F%2F[A-Za-z0-9%._~:/?#[\]@!$&'()*+,;=-]+/gi)) {
    let dec = m[0];
    for (let d = 0; d < 2 && /^https?%3A/i.test(dec); d++) { try { dec = decodeURIComponent(dec); } catch { break; } }
    candidates.push(dec);
  }
  for (const rawCand of candidates) {
    const clean = rawCand.replace(/[).,;]+$/, ''), embedded = tryDecodeEmbeddedRetailUrl(clean);
    if (embedded && isDirectRetailFinalUrl(embedded)) return { retailUrl: embedded };
    if (isDirectRetailFinalUrl(clean)) return { retailUrl: clean };
  }
  if (/walmartimages\.com|walmart_logo/i.test(normalized)) return { inferredRetailer: 'Walmart' };
  if (/target\.scene7\.com|target_logo/i.test(normalized)) return { inferredRetailer: 'Target' };
  if (/bbystatic\.com|bestbuy_logo/i.test(normalized)) return { inferredRetailer: 'Best Buy' };
  if (/media-amazon\.com|ssl-images-amazon\.com/i.test(normalized)) return { inferredRetailer: 'Amazon' };
  return {};
}

async function readFirst32KbText(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try { while (total < 32768) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); total += value.byteLength; } }
  catch {} finally { try { await reader.cancel(); } catch {} }
  return Buffer.concat(chunks).subarray(0, 32768).toString('utf8');
}

export function canonicalizeRetailCheckoutUrl(rawUrl: string, postContext = '', isQueueOrDrawing = false): Omit<UnshortenedRetailLink, 'originalUrl' | 'hops'> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { finalUrl: rawUrl, canonicalUrl: rawUrl, checkoutUrl: rawUrl, retailer: detectBigBoxRetailer(postContext, rawUrl), canonicalItemId: rawUrl }; }
  const host = u.hostname.toLowerCase();
  if (host.endsWith('target.com')) {
    const tcin = rawUrl.match(/A-(\d{8,10})/i)?.[1] || u.searchParams.get('tcin') || '', canonicalUrl = tcin ? `https://www.target.com/p/-/A-${tcin}` : `https://www.target.com${u.pathname}`;
    return { finalUrl: rawUrl, canonicalUrl, checkoutUrl: canonicalUrl, retailer: 'Target', canonicalItemId: tcin ? `target_${tcin}` : canonicalUrl };
  }
  if (host.endsWith('walmart.com')) {
    const wmId = rawUrl.match(/\/ip\/(?:[^/?#]+\/)?(\d{7,14})/i)?.[1] || u.searchParams.get('id') || u.searchParams.get('items') || '';
    const canonicalUrl = wmId ? `https://www.walmart.com/ip/${wmId}` : `https://www.walmart.com${u.pathname}`, pacUrl = wmId && !isQueueOrDrawing ? `https://www.walmart.com/pac?id=${wmId}&quantity=1` : canonicalUrl;
    return { finalUrl: rawUrl, canonicalUrl, checkoutUrl: pacUrl, cart1xUrl: wmId && !isQueueOrDrawing ? pacUrl : undefined, retailer: 'Walmart', canonicalItemId: wmId ? `walmart_${wmId}` : canonicalUrl };
  }
  if (host.endsWith('bestbuy.com')) {
    const numSku = u.searchParams.get('skuId') || rawUrl.match(/\/click\/-\/(\d{7})\/cart|\/(\d{7})\.p/i)?.slice(1).find(Boolean) || '', prodMatch = u.pathname.match(/\/product\/([^/?#]+)\/([A-Z0-9]{7,14})/i);
    if (/^\d{7}$/.test(numSku)) {
      const canonicalUrl = `https://www.bestbuy.com/site/-/${numSku}.p?skuId=${numSku}`, atc = isQueueOrDrawing ? canonicalUrl : `https://api.bestbuy.com/click/-/${numSku}/cart`;
      return { finalUrl: rawUrl, canonicalUrl, checkoutUrl: atc, cart1xUrl: isQueueOrDrawing ? undefined : atc, retailer: 'Best Buy', canonicalItemId: `bestbuy_${numSku}` };
    }
    const cleanBb = prodMatch ? `https://www.bestbuy.com/product/${prodMatch[1]}/${prodMatch[2]}` : `https://www.bestbuy.com${u.pathname}`;
    return { finalUrl: rawUrl, canonicalUrl: cleanBb, checkoutUrl: cleanBb, retailer: 'Best Buy', canonicalItemId: prodMatch ? `bestbuy_${prodMatch[2]}` : cleanBb };
  }
  if (host.endsWith('amazon.com') || host === 'a.co') {
    const asin = rawUrl.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|ASIN\.1=)(B0[A-Z0-9]{8})/i)?.[1]?.toUpperCase() || '';
    if (asin) return { finalUrl: rawUrl, canonicalUrl: `https://www.amazon.com/dp/${asin}?smid=${AMAZON_1P_MERCHANT_ID}`, checkoutUrl: `https://www.amazon.com/dp/${asin}?smid=${AMAZON_1P_MERCHANT_ID}`, cart1xUrl: isQueueOrDrawing ? undefined : `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${asin}&Quantity.1=1`, retailer: 'Amazon', canonicalItemId: `amazon_${asin}` };
  }
  if (host.endsWith('pokemoncenter.com')) {
    const cleanPc = `https://www.pokemoncenter.com${u.pathname}`;
    return { finalUrl: rawUrl, canonicalUrl: cleanPc, checkoutUrl: cleanPc, retailer: 'Pokémon Center', canonicalItemId: `pc_${u.pathname.split('/').filter(Boolean).pop() || 'pc'}` };
  }
  const keepEan = host.endsWith('barnesandnoble.com') ? u.searchParams.get('ean') : null, cleanGeneric = `${u.origin}${u.pathname}${keepEan ? `?ean=${encodeURIComponent(keepEan)}` : ''}`;
  return { finalUrl: rawUrl, canonicalUrl: cleanGeneric, checkoutUrl: cleanGeneric, retailer: detectBigBoxRetailer(postContext, cleanGeneric), canonicalItemId: cleanGeneric };
}

export async function unshortenAndCanonicalizeRetailUrl(rawInputUrl: string, postContext = '', isQueueOrDrawing = false): Promise<UnshortenedRetailLink> {
  const normalized = /^https?:\/\//i.test(rawInputUrl) ? rawInputUrl.trim().replace(/^http:\/\//i, 'https://') : `https://${rawInputUrl.trim()}`;
  const cacheKey = `${normalized}::${isQueueOrDrawing ? 'Q' : 'B'}::${postContext.slice(0, 48)}`;
  const hit = unshortenCache.get(cacheKey);
  if (hit) return hit;

  let currentUrl = tryDecodeEmbeddedRetailUrl(normalized) || normalized;
  let lastMavelyBranchUrl = /mavely\.app\.link/i.test(currentUrl) ? currentUrl : '';
  let inferredWrapperRetailer: string | undefined, hops = 0;

  while (hops < 5 && !isDirectRetailFinalUrl(currentUrl)) {
    try {
      const res = await fetch(currentUrl, {
        redirect: 'manual', signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36', Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }
      });
      const loc = String(res.headers.get('location') || '').trim();
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel().catch(() => {}); hops += 1;
        const nextUrl = new URL(loc, currentUrl).toString().replace(/^http:\/\//i, 'https://');
        if (/mavely\.app\.link/i.test(nextUrl)) lastMavelyBranchUrl = nextUrl;
        const embedded = tryDecodeEmbeddedRetailUrl(nextUrl);
        currentUrl = embedded || nextUrl;
        if (embedded) break;
        continue;
      }
      const curHost = (() => { try { return new URL(currentUrl).hostname; } catch { return ''; } })();
      if (INTERSTITIAL_WRAPPER_HOST_RE.test(curHost)) {
        const html32k = res.status === 200 ? await readFirst32KbText(res) : (await res.body?.cancel().catch(() => {}), '');
        let parsed = html32k ? extractRetailTargetFromWrapperHtml(html32k) : {};
        if (!parsed.retailUrl && lastMavelyBranchUrl) {
          try {
            const brRes = await fetch(lastMavelyBranchUrl, { redirect: 'manual', signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' } });
            parsed = extractRetailTargetFromWrapperHtml(await readFirst32KbText(brRes));
          } catch {}
        }
        if (parsed.retailUrl) { hops += 1; currentUrl = parsed.retailUrl; }
        else {
          inferredWrapperRetailer = parsed.inferredRetailer || detectBigBoxRetailer(postContext, currentUrl) || undefined;
          const hubMap: Record<string, string> = {
            Walmart: isQueueOrDrawing ? 'https://www.walmart.com/shop/collectibles/draw' : 'https://www.walmart.com/browse/toys/pokemon-cards/4171_4191_9807313',
            Target: 'https://www.target.com/s?searchTerm=pokemon+tcg', 'Best Buy': 'https://www.bestbuy.com/site/searchpage.jsp?st=pokemon+tcg', 'Pokémon Center': 'https://www.pokemoncenter.com'
          };
          if (inferredWrapperRetailer && hubMap[inferredWrapperRetailer]) currentUrl = hubMap[inferredWrapperRetailer];
        }
      } else { await res.body?.cancel().catch(() => {}); }
      break;
    } catch { break; }
  }
  wireTelemetry.linksUnshortened += 1;
  const canon = canonicalizeRetailCheckoutUrl(currentUrl, postContext, isQueueOrDrawing);
  const out: UnshortenedRetailLink = { originalUrl: normalized, hops, ...canon, retailer: canon.retailer || inferredWrapperRetailer || null };
  if (unshortenCache.size > 500) unshortenCache.clear();
  unshortenCache.set(cacheKey, out);
  return out;
}

export function classifyWireRestockEvent(text: string, url = ''): { classification: WireEventClassification; windowKind?: WireWindowKind } {
  const hay = `${text || ''} ${url || ''}`;
  if (/\b(?:online\s+drawings?|drawings?\b|raffle|lottery)\b/i.test(hay)) return { classification: 'QUEUE_INVITE_DRAWING', windowKind: 'DRAWING' };
  if (/\b(?:request\s+invite|invite[\s-]*only|invitations?\b)\b/i.test(hay)) return { classification: 'QUEUE_INVITE_DRAWING', windowKind: 'INVITE' };
  if (/\b(?:waiting\s+room|\bqueue\b|queue-it|virtual\s+line)\b/i.test(hay)) return { classification: 'QUEUE_INVITE_DRAWING', windowKind: 'QUEUE' };
  return { classification: 'INSTANT_BUY_RESTOCK' };
}

const extractExplicitDealPrice = (text: string): number | undefined => {
  const m = String(text || '').replace(/(?:free\s+ship(?:ping)?\s+(?:on\s+|over\s+)?)\$\d+(?:\.\d{1,2})?/gi, '').match(/\$([0-9]{2,4}(?:\.[0-9]{1,2})?)/);
  return m ? parseFloat(m[1]) : undefined;
};

export async function evaluateAndDispatchWireSignal(params: {
  sourceLabel: string; postId: string; postCreatedMs: number; headlineText: string; lineContext?: string; rawUrl: string; dryRun?: boolean;
}): Promise<EvaluatedWireSignal> {
  const combinedText = cleanHtmlText(`${params.lineContext || ''} ${params.headlineText || ''}`);
  const cls = classifyWireRestockEvent(combinedText, params.rawUrl), isQueue = cls.classification === 'QUEUE_INVITE_DRAWING';
  const link = await unshortenAndCanonicalizeRetailUrl(params.rawUrl, combinedText, isQueue);
  const postAgeSec = Math.max(0, Math.round((Date.now() - params.postCreatedMs) / 1000)), isLiveEligible = (Date.now() - params.postCreatedMs) <= WIRE_LIVE_MAX_AGE_MS;
  const urlSlugWords = (() => { try { return new URL(link.canonicalUrl).pathname.replace(/[/_-]+/g, ' '); } catch { return ''; } })();
  const explicitPrice = extractExplicitDealPrice(params.lineContext || params.headlineText);
  const matchOpts = { handle: link.canonicalUrl, retailer: link.retailer || undefined, sourceUrl: link.canonicalUrl, allowPcRetailUnlock: link.retailer === 'Pokémon Center' };
  const rule: PolicyRule | null =
    (params.lineContext ? matchProductToSku(params.lineContext, explicitPrice, matchOpts) : null) ||
    (urlSlugWords ? matchProductToSku(`Pokemon TCG ${urlSlugWords}`, explicitPrice, matchOpts) : null) ||
    matchProductToSku(params.headlineText, explicitPrice, matchOpts);

  let canonicalUrl = link.canonicalUrl, checkoutUrl = link.checkoutUrl, cart1xUrl = link.cart1xUrl;
  if (!isQueue && rule) {
    if (link.retailer === 'Walmart' && !/\/ip\//i.test(canonicalUrl) && (rule as any).walmartItemId) {
      canonicalUrl = `https://www.walmart.com/ip/${(rule as any).walmartItemId}`; cart1xUrl = checkoutUrl = `https://www.walmart.com/pac?id=${(rule as any).walmartItemId}&quantity=1`;
    } else if (link.retailer === 'Target' && !/A-\d+/i.test(canonicalUrl) && (rule as any).targetTcin) {
      canonicalUrl = checkoutUrl = `https://www.target.com/p/-/A-${(rule as any).targetTcin}`;
    } else if (link.retailer === 'Best Buy' && rule.bestBuySku && /^\d{7}$/.test(String(rule.bestBuySku))) {
      cart1xUrl = checkoutUrl = `https://api.bestbuy.com/click/-/${rule.bestBuySku}/cart`;
    }
  }

  let dispatched = false;
  const price = explicitPrice ?? (rule?.msrpCeiling || undefined);
  if (!params.dryRun && isLiveEligible && link.retailer) {
    const dedupIds = [link.canonicalItemId, rule?.id || ''].filter(Boolean);
    if (isQueue && cls.windowKind && (isDedicatedPokemonFeed(params.sourceLabel) || isPokemonTcgRelevantText(`${combinedText} ${urlSlugWords}`))) {
      if (claimBigBoxCrossChannelSignal(link.retailer, dedupIds, 0, params.sourceLabel)) {
        dispatched = await sendBigBoxQueueOrDrawingAlert({ retailer: link.retailer, headline: params.lineContext || params.headlineText, url: canonicalUrl, windowKind: cls.windowKind, ruleId: rule?.id, ruleName: rule?.name, sourceLabel: params.sourceLabel });
      }
    } else if (!isQueue && rule && price && price >= 18 && claimBigBoxCrossChannelSignal(link.retailer, dedupIds, price, params.sourceLabel)) {
      const isAssumedMsrp = explicitPrice === undefined;
      await processIncomingDrop({
        title: rule.name || params.lineContext || params.headlineText,
        retailer: isAssumedMsrp ? `${link.retailer} [BIG-BOX RESTOCK RADAR]` : `${link.retailer} (via ${params.sourceLabel})`,
        url: checkoutUrl, productUrl: canonicalUrl, cart1xUrl, price, itemId: `wire_${params.postId}_${rule.id}`,
        isPreOrder: /pre-?order|pre-?sale/i.test(combinedText), freeShipping: Boolean(isAssumedMsrp || price >= 35), isBigBoxRestockRadar: isAssumedMsrp,
        shippingNoteOverride: isAssumedMsrp ? `📡 [${params.sourceLabel}] Live ${link.retailer} Restock Signal — Canonical Checkout Armed` : undefined
      });
      dispatched = true;
    }
    if (dispatched) wireTelemetry.signalsDispatched += 1;
  }
  return {
    source: params.sourceLabel, postAgeSec, isLiveEligible, originalUrl: link.originalUrl, canonicalUrl, checkoutUrl,
    retailer: link.retailer, canonicalItemId: link.canonicalItemId, hops: link.hops, classification: cls.classification,
    windowKind: cls.windowKind, matchedSkuId: rule?.id || null, matchedSkuName: rule?.name || null, price, dispatched
  };
}

export function extractBlueskyRecordLinks(record: any): Array<{ url: string; lineContext: string }> {
  const text = String(record?.text || ''), utf8 = Buffer.from(text, 'utf8'), lines = text.split(/\r?\n/), results: Array<{ url: string; lineContext: string }> = [], seen = new Set<string>();
  const add = (raw: string, ctx: string) => {
    const clean = String(raw || '').trim().replace(/[).,!]+$/, '');
    if (!clean || /bsky\.app/i.test(clean)) return;
    const full = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    if (!seen.has(full)) { seen.add(full); results.push({ url: full, lineContext: cleanHtmlText(ctx || text) }); }
  };
  for (const facet of record?.facets || []) {
    const lineIdx = utf8.subarray(0, Math.min(Number(facet?.index?.byteStart ?? 0), utf8.length)).toString('utf8').split(/\r?\n/).length - 1;
    for (const feat of facet?.features || []) if (feat?.$type === 'app.bsky.richtext.facet#link' && feat.uri) add(feat.uri, lines[lineIdx] || text);
  }
  const ext = record?.embed?.external || record?.embed?.media?.external;
  if (ext?.uri) add(ext.uri, `${ext.title || ''} ${text}`);
  for (const line of lines) {
    for (const m of line.matchAll(/https?:\/\/[^\s)"\]<>]+/gi)) add(m[0], line);
    for (const m of line.matchAll(SHORTENER_BARE_RE)) add(`https://${m[1]}`, line);
  }
  return results;
}

export async function resolveBlueskyActorDids(handles = getConfiguredBskyHandles()): Promise<Record<string, string>> {
  const res = await fetch(`${BSKY_APPVIEW_BASE}/app.bsky.actor.getProfiles?${handles.map((h) => `actors=${encodeURIComponent(h)}`).join('&')}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Bluesky getProfiles HTTP ${res.status}`);
  const data: any = await res.json(), map: Record<string, string> = {};
  for (const p of data?.profiles || []) if (p?.handle && p?.did) map[String(p.handle).toLowerCase()] = String(p.did);
  wireTelemetry.handles = handles; wireTelemetry.didMap = map;
  return map;
}

export async function fetchBlueskyAuthorFeedPosts(handle: string, limit = 15): Promise<any[]> {
  const res = await fetch(`${BSKY_APPVIEW_BASE}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${limit}&filter=posts_no_replies`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Bluesky getAuthorFeed(${handle}) HTTP ${res.status}`);
  const data: any = await res.json();
  return Array.isArray(data?.feed) ? data.feed.map((f: any) => f?.post).filter(Boolean) : [];
}

export async function ingestBlueskyPost(uri: string, handle: string, record: any, dryRun = false): Promise<EvaluatedWireSignal[]> {
  if (!dryRun) { if (seenWirePostUris.has(uri)) return []; if (seenWirePostUris.size > 1000) seenWirePostUris.clear(); seenWirePostUris.add(uri); }
  wireTelemetry.postsInspected += 1;
  const fullText = `${record?.text || ''} ${record?.embed?.external?.title || ''}`;
  if (!isDedicatedPokemonFeed(handle) && !isPokemonTcgRelevantText(fullText)) return [];
  const createdMs = Date.parse(String(record?.createdAt || '')) || Date.now();
  if (!dryRun && Date.now() - createdMs > WIRE_LIVE_MAX_AGE_MS) return [];
  const rkey = uri.split('/').pop() || String(createdMs), out: EvaluatedWireSignal[] = [];
  for (const l of extractBlueskyRecordLinks(record)) {
    out.push(await evaluateAndDispatchWireSignal({ sourceLabel: `Bluesky @${handle}`, postId: `bsky_${rkey}`, postCreatedMs: createdMs, headlineText: fullText, lineContext: l.lineContext, rawUrl: l.url, dryRun }));
  }
  return out;
}

export async function pollBlueskyRestockFeedsOnce(): Promise<void> {
  wireTelemetry.lastRestPollAt = Date.now();
  for (const handle of getConfiguredBskyHandles()) {
    try { for (const p of await fetchBlueskyAuthorFeedPosts(handle, 15)) if (p?.uri && p?.record) await ingestBlueskyPost(p.uri, handle, p.record, false); } catch {}
  }
  recordBigBoxCheckTelemetry({ restockWire: { ...wireTelemetry } });
}

export function connectBlueskyJetstream(didMap: Record<string, string>): WebSocket | null {
  const didEntries = Object.entries(didMap);
  if (didEntries.length === 0 || typeof WebSocket !== 'function') return null;
  const didToHandle = new Map<string, string>(didEntries.map(([h, did]) => [did, h]));
  if (activeJetstreamWs) { try { activeJetstreamWs.close(); } catch {} activeJetstreamWs = null; }
  const ws = (activeJetstreamWs = new WebSocket(`${BSKY_JETSTREAM_BASE}?wantedCollections=app.bsky.feed.post&${didEntries.map(([, did]) => `wantedDids=${encodeURIComponent(did)}`).join('&')}`));
  ws.addEventListener('open', () => { wireTelemetry.jetstreamConnected = true; wireTelemetry.lastJetstreamOpenAt = Date.now(); reconnectAttempt = 0; recordBigBoxCheckTelemetry({ restockWire: { ...wireTelemetry } }); });
  ws.addEventListener('message', (ev: any) => {
    try {
      wireTelemetry.lastJetstreamEventAt = Date.now(); const msg = JSON.parse(String(ev.data || ''));
      if (msg?.kind === 'commit' && msg?.commit?.collection === 'app.bsky.feed.post' && msg?.commit?.operation === 'create') void ingestBlueskyPost(`at://${msg.did}/app.bsky.feed.post/${msg.commit.rkey}`, didToHandle.get(String(msg.did || '')) || 'bsky', msg.commit.record, false);
    } catch {}
  });
  ws.addEventListener('close', () => {
    wireTelemetry.jetstreamConnected = false; if (!wireStarted || reconnectTimer) return;
    wireTelemetry.jetstreamReconnects += 1;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connectBlueskyJetstream(wireTelemetry.didMap); }, Math.min(30_000, 2_000 * Math.pow(2, reconnectAttempt++)));
    reconnectTimer?.unref?.();
  });
  ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  return ws;
}

export async function startPublicRestockWire(): Promise<void> {
  if (wireStarted) return;
  wireStarted = true;
  try { connectBlueskyJetstream(await resolveBlueskyActorDids()); } catch (err: any) { console.warn(`[RestockWire] DID warning: ${err?.message || err}`); }
  await pollBlueskyRestockFeedsOnce();
  restPollTimer = setInterval(() => { void pollBlueskyRestockFeedsOnce(); }, 25_000);
}
export function stopPublicRestockWire(): void {
  wireStarted = false;
  if (restPollTimer) { clearInterval(restPollTimer); restPollTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (activeJetstreamWs) { try { activeJetstreamWs.close(); } catch {} activeJetstreamWs = null; }
}
