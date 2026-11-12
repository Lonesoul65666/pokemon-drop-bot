import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getTelemetry } from './marketTelemetry';
import { evaluateItem, RawRestockItem, commitAlertDelivery, releasePendingAlertLock } from './evaluator';
import { sendAlert } from './notifier';
import { isSingleCardOrNonSealed } from './policies';
import { evaluateAndDispatchWireSignal, WIRE_LIVE_MAX_AGE_MS } from './src/pollers/publicRestockWire';

let listenerProcessHandlersRegistered = false;
export function registerProcessSafetyHandlers(serviceLabel = 'Listener') {
  if (listenerProcessHandlersRegistered) return;
  listenerProcessHandlersRegistered = true;

  process.on('uncaughtException', (err: any) => {
    console.error(`[${new Date().toISOString()}] [${serviceLabel}] UNCAUGHT EXCEPTION (Recovered):`, err?.stack || err?.message || err);
  });

  process.on('unhandledRejection', (reason: any) => {
    console.error(`[${new Date().toISOString()}] [${serviceLabel}] UNHANDLED REJECTION (Recovered):`, reason?.stack || reason?.message || reason);
  });
}

registerProcessSafetyHandlers('DropBot-Core');

export async function processIncomingDrop(item: RawRestockItem): Promise<void> {
  try {
    const result = evaluateItem(item);

    if (result.action === 'BUY' && result.rule) {
      const r: any = result.rule;
      console.log(`◈ [BUY ALERT] "${item.title}" ($${item.price?.toFixed(2)}) at ${item.retailer} -> [${result.alertType}] ${result.reason}`);

      const alertPromise = sendAlert({
        title: item.title,
        retailer: item.retailer,
        url: item.url,
        productUrl: item.productUrl,
        cart1xUrl: result.cart1xUrl || item.cart1xUrl,
        cart2xUrl: result.cart2xUrl !== undefined ? result.cart2xUrl : item.cart2xUrl,
        cart3xUrl: result.cart3xUrl !== undefined ? result.cart3xUrl : item.cart3xUrl,
        price: item.price !== undefined ? item.price.toFixed(2) : undefined,
        priceNum: item.price,
        itemPrice: result.itemPrice ?? item.itemPrice,
        shippingPrice: result.shippingPrice ?? item.shippingPrice,
        landedPrice: result.landedPrice,
        estimatedShipping: result.estimatedShipping,
        freeShipNote: result.freeShipNote,
        packCount: result.packCount,
        pricePerPack: result.pricePerPack,
        isRipValueLeader: result.isRipValueLeader,
        isPreOrder: result.isPreOrder,
        isPreRelease: result.isPreRelease,
        preReleaseStatusTag: result.preReleaseStatusTag,
        releaseDate: result.releaseDate,
        isMsrpUnicorn: result.isMsrpUnicorn,
        bypassVaultMute: result.bypassVaultMute,
        stock: item.stock,
        itemId: item.itemId,
        ruleId: r.id,
        ruleName: r.name,
        formFactor: r.formFactor,
        msrp: r.msrpCeiling,
        marketValue: (getTelemetry()[r.id]?.rollingAverage > 0 ? getTelemetry()[r.id].rollingAverage : r.estimatedMarketValue),
        maxBuyTarget: r.maxMarketBuyPrice,
        discountPct: result.discountPct,
        savingsDollars: result.savingsDollars,
        ownedInVault: Boolean(r.inVault ?? r.owned),
        alertType: result.alertType,
        previousPrice: result.previousPrice,
        previousTimeStr: result.previousTimeStr,
        bigBoxTier: result.bigBoxTier,
        bigBoxBadge: result.bigBoxBadge,
        marketplaceWarning: result.marketplaceWarning,
        priorityFront: result.priorityFront,
        statusTier: result.statusTier,
        statusTag: result.statusTag,
        isCloseCall: result.isCloseCall,
        closeCallDelta: result.closeCallDelta,
        trendSignal: result.trendSignal,
        trendVerdictLabel: result.trendVerdictLabel,
        isElasticDip: result.isElasticDip
      });

      const pendingCommit = result.pendingAlertCommit;
      void alertPromise
        .then((delivered) => {
          if (delivered) commitAlertDelivery(pendingCommit);
          else releasePendingAlertLock(pendingCommit?.stateKey);
        })
        .catch((err: any) => {
          releasePendingAlertLock(pendingCommit?.stateKey);
          console.error(`[Listener] Async alert dispatch error: ${err?.message || err}`);
        });
    }
  } catch (err: any) {
    console.error(`[Listener] Error in processIncomingDrop for "${item?.title || 'unknown'}":`, err?.message || err);
  }
}

// ============================================================================
// Proxy-Routed Reddit Feed (r/PKMNTCGDeals — 25s Interval, ETag, < 15m Gate)
// ============================================================================
const REDDIT_NEW_JSON_URL = 'https://www.reddit.com/r/PKMNTCGDeals/new.json?limit=15&raw_json=1';
const REDDIT_NEW_RSS_URL = 'https://www.reddit.com/r/PKMNTCGDeals/new/.rss';
export const REDDIT_POLL_INTERVAL_MS = 25_000;

interface ProxyRedditPost {
  id: string;
  title: string;
  selftext: string;
  outboundUrl: string;
  createdMs: number;
}

let redditProxyAgent: HttpsProxyAgent<string> | null = null;
const redditEtagCache = new Map<string, { etag?: string; lastModified?: string }>();
const seenRedditPostIds = new Set<string>();
let jsonBlockedUntil = 0;
let isPollingProxyReddit = false;
let redditIntervalStarted = false;

function getRedditWebshareAgent(): HttpsProxyAgent<string> | null {
  const proxyUrl = String(process.env.WEBSHARE_PROXY_URL || '').trim();
  if (!proxyUrl) return null;
  // keepAlive: false rotates Webshare exit IP per request/retry and leaves zero lingering sockets
  return new HttpsProxyAgent(proxyUrl, { keepAlive: false });
}

function decodeXmlEntities(s: string): string {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function extractOutboundDealUrl(text: string, fallback = ''): string {
  const m = String(text || '').match(
    /https?:\/\/(?!www\.reddit\.com|old\.reddit\.com|sh\.reddit\.com|redd\.it|i\.redd\.it|v\.redd\.it|preview\.redd\.it)[a-z0-9.-]+\.[a-z]{2,}\/[^\s)"\]<>']*/i
  );
  return m ? m[0] : fallback;
}

function parseRedditNewJsonPayload(body: any): ProxyRedditPost[] {
  const children: any[] = body?.data?.children || [];
  const out: ProxyRedditPost[] = [];
  for (const ch of children) {
    const d = ch?.data;
    if (!d?.id || !d?.title) continue;
    const rawDest = String(d.url_overridden_by_dest || d.url || '');
    const selftext = String(d.selftext || '');
    const outboundUrl = extractOutboundDealUrl(`${rawDest} ${selftext}`, rawDest);
    if (!/^https?:\/\//i.test(outboundUrl) || /reddit\.com|redd\.it/i.test(outboundUrl)) continue;
    out.push({
      id: `t3_${String(d.id).replace(/^t3_/, '')}`,
      title: String(d.title),
      selftext,
      outboundUrl,
      createdMs: Number(d.created_utc || 0) > 0 ? Number(d.created_utc) * 1000 : Date.now()
    });
  }
  return out;
}

function parseRedditNewRssPayload(xml: string): ProxyRedditPost[] {
  const out: ProxyRedditPost[] = [];
  for (const ent of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const b = ent[1];
    const id = b.match(/<id>([^<]+)<\/id>/i)?.[1]?.trim();
    const title = decodeXmlEntities(b.match(/<title>([^<]+)<\/title>/i)?.[1] || '');
    const href = decodeXmlEntities(b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '');
    const content = decodeXmlEntities(b.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] || '');
    const tsRaw = b.match(/<(?:published|updated)>([^<]+)<\/(?:published|updated)>/i)?.[1];
    if (!id || !title) continue;
    const outboundUrl = extractOutboundDealUrl(`${href} ${content}`, href);
    if (!/^https?:\/\//i.test(outboundUrl) || /reddit\.com|redd\.it/i.test(outboundUrl)) continue;
    out.push({
      id, title, selftext: content, outboundUrl,
      createdMs: tsRaw ? (Date.parse(tsRaw) || Date.now()) : Date.now()
    });
  }
  return out;
}

export async function pollProxyRedditDealsOnce(opts?: { dryRun?: boolean; maxDryRunEval?: number }): Promise<{
  ok: boolean; httpStatus: number; feedUrl: string; viaProxy: boolean; postsParsed: number; liveEligibleCount: number;
}> {
  if (!getRedditWebshareAgent()) {
    return { ok: false, httpStatus: 0, feedUrl: REDDIT_NEW_JSON_URL, viaProxy: false, postsParsed: 0, liveEligibleCount: 0 };
  }

  const fetchFeedViaProxy = async (url: string, accept: string) => {
    const cached = redditEtagCache.get(url);
    const headers: Record<string, string> = {
      'User-Agent': 'Windows:DropBotCommander:v6.0 (by /u/Lonesoul65666)',
      Accept: accept
    };
    if (cached?.etag && !opts?.dryRun) headers['If-None-Match'] = cached.etag;
    if (cached?.lastModified && !opts?.dryRun) headers['If-Modified-Since'] = cached.lastModified;
    let res = await axios.get(url, {
      httpsAgent: getRedditWebshareAgent()!, proxy: false, timeout: 5000, signal: AbortSignal.timeout(5000), validateStatus: () => true, headers
    });
    if (res.status === 429 || res.status === 403) {
      await new Promise((r) => setTimeout(r, 800));
      res = await axios.get(url, { httpsAgent: getRedditWebshareAgent()!, proxy: false, timeout: 5000, signal: AbortSignal.timeout(5000), validateStatus: () => true, headers });
    }
    if (res.status === 200) {
      const etag = res.headers?.etag ? String(res.headers.etag) : undefined;
      const lastMod = res.headers?.['last-modified'] ? String(res.headers['last-modified']) : undefined;
      if (etag || lastMod) redditEtagCache.set(url, { etag, lastModified: lastMod });
    }
    return res;
  };

  let feedUrl = Date.now() < jsonBlockedUntil ? REDDIT_NEW_RSS_URL : REDDIT_NEW_JSON_URL;
  let res = await fetchFeedViaProxy(feedUrl, 'application/json,application/atom+xml,text/xml;q=0.9,*/*;q=0.8');

  if (feedUrl === REDDIT_NEW_JSON_URL && (res.status === 403 || res.status === 429)) {
    jsonBlockedUntil = Date.now() + 30 * 60 * 1000;
    feedUrl = REDDIT_NEW_RSS_URL;
    res = await fetchFeedViaProxy(feedUrl, 'application/atom+xml,application/xml,text/xml;q=0.9');
  }

  if (res.status === 304) {
    return { ok: true, httpStatus: 304, feedUrl, viaProxy: true, postsParsed: 0, liveEligibleCount: 0 };
  }
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, httpStatus: res.status, feedUrl, viaProxy: true, postsParsed: 0, liveEligibleCount: 0 };
  }

  const posts = feedUrl === REDDIT_NEW_JSON_URL && typeof res.data === 'object'
    ? parseRedditNewJsonPayload(res.data)
    : parseRedditNewRssPayload(String(res.data || ''));

  let liveEligibleCount = 0;
  let dryRunEvaluated = 0;
  const dryRunCap = opts?.maxDryRunEval ?? 3;
  for (const post of posts) {
    if (!opts?.dryRun) {
      if (seenRedditPostIds.has(post.id)) continue;
      if (seenRedditPostIds.size > 800) seenRedditPostIds.clear();
      seenRedditPostIds.add(post.id);
    }
    if (/stockx/i.test(post.title) || /\?$/.test(post.title.trim())) continue;
    if (/\b(?:question|help|should i|looking for|went to|found nothing|discussion|pull|pulls|weekly|megathread|iso|advice)\b/i.test(post.title)) continue;
    if (isSingleCardOrNonSealed(post.title)) continue;

    const isFresh = (Date.now() - post.createdMs) <= WIRE_LIVE_MAX_AGE_MS;
    if (isFresh) liveEligibleCount += 1;
    if (!isFresh && !opts?.dryRun) continue;
    if (opts?.dryRun && dryRunEvaluated >= dryRunCap) continue;
    dryRunEvaluated += 1;

    await evaluateAndDispatchWireSignal({
      sourceLabel: 'PKMNTCGDeals', postId: `reddit_${post.id}`, postCreatedMs: post.createdMs,
      headlineText: `${post.title} ${post.selftext}`, lineContext: post.title,
      rawUrl: post.outboundUrl, dryRun: Boolean(opts?.dryRun)
    });
  }

  return { ok: true, httpStatus: res.status, feedUrl, viaProxy: true, postsParsed: posts.length, liveEligibleCount };
}

export function startProxyRedditDealsPoller( recordTel?: (patch: Record<string, any>) => void ): void {
  if (redditIntervalStarted) return;
  redditIntervalStarted = true;
  const tick = async () => {
    if (isPollingProxyReddit) return;
    isPollingProxyReddit = true;
    try {
      const r = await pollProxyRedditDealsOnce();
      if (recordTel) {
        recordTel({
          redditRssStatus: r.ok ? 'HEALTHY' : `HTTP_${r.httpStatus}`,
          lastRedditFeed: r.feedUrl,
          lastRedditPostsChecked: r.postsParsed
        });
      }
    } catch (err: any) {
      if (recordTel) recordTel({ redditRssStatus: 'DEGRADED', lastRedditError: err?.message || 'Proxy Reddit error' });
    } finally {
      isPollingProxyReddit = false;
    }
  };
  void tick();
  setInterval(() => { void tick(); }, REDDIT_POLL_INTERVAL_MS);
}
