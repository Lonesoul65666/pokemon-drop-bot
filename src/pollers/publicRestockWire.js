"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPokemonTcgRelevantText = exports.getConfiguredBskyHandles = exports.wireTelemetry = exports.WIRE_LIVE_MAX_AGE_MS = void 0;
exports.canonicalizeRetailCheckoutUrl = canonicalizeRetailCheckoutUrl;
exports.unshortenAndCanonicalizeRetailUrl = unshortenAndCanonicalizeRetailUrl;
exports.classifyWireRestockEvent = classifyWireRestockEvent;
exports.evaluateAndDispatchWireSignal = evaluateAndDispatchWireSignal;
exports.extractBlueskyRecordLinks = extractBlueskyRecordLinks;
exports.resolveBlueskyActorDids = resolveBlueskyActorDids;
exports.fetchBlueskyAuthorFeedPosts = fetchBlueskyAuthorFeedPosts;
exports.ingestBlueskyPost = ingestBlueskyPost;
exports.pollBlueskyRestockFeedsOnce = pollBlueskyRestockFeedsOnce;
exports.connectBlueskyJetstream = connectBlueskyJetstream;
exports.startPublicRestockWire = startPublicRestockWire;
exports.stopPublicRestockWire = stopPublicRestockWire;
const lgsPoller_1 = require("../../lgsPoller");
const listener_1 = require("../../listener");
const notifier_1 = require("../../notifier");
const policies_1 = require("../../policies");
const bigBoxAdapters_1 = require("./bigBoxAdapters");
const BSKY_APPVIEW_BASE = 'https://public.api.bsky.app/xrpc';
const BSKY_JETSTREAM_BASE = 'wss://jetstream2.us-east.bsky.network/subscribe';
exports.WIRE_LIVE_MAX_AGE_MS = 15 * 60 * 1000;
const POKEMON_RELEVANCE_RE = /\b(pok[eé]mon|tcg|pikachu|charizard|mewtwo|eevee|prismatic\s+evolutions|destined\s+rivals|surging\s+sparks|journey\s+together|delta\s+reign|chaos\s+rising|ascended\s+heroes|paldean\s+fates|elite\s+trainer\s+box|\betb\b|booster\s+(?:box|bundle)|pokemon\s*center)\b/i;
const SHORTENER_BARE_RE = /\b((?:buff\.ly|amzn\.to|bit\.ly|mavely\.app\.link|goto\.target\.com|goto\.walmart\.com|bestbuy\w*\.7tiv\.net)\/[A-Za-z0-9_-]+)/gi;
const DIRECT_RETAIL_HOST_RE = /(?:^|\.)(?:target\.com|walmart\.com|bestbuy\.com|amazon\.com|pokemoncenter\.com|gamestop\.com|costco\.com|samsclub\.com|barnesandnoble\.com)$/i;
const EMBEDDED_URL_PARAMS = ['u', 'url', 'ulp', 'murl', 'return', 'target', 'dest', 'redirect', 'redirectUrl'];
const seenWirePostUris = new Set();
const unshortenCache = new Map();
let activeJetstreamWs = null;
let restPollTimer = null, reconnectTimer = null, wireStarted = false, reconnectAttempt = 0;
exports.wireTelemetry = {
    handles: [], didMap: {}, jetstreamConnected: false,
    lastJetstreamOpenAt: 0, lastJetstreamEventAt: 0, jetstreamReconnects: 0,
    lastRestPollAt: 0, postsInspected: 0, linksUnshortened: 0, signalsDispatched: 0
};
const getConfiguredBskyHandles = () => String(process.env.RESTOCK_BSKY_HANDLES || 'pokemonrestocks.bsky.social,hoomandeals.bsky.social')
    .split(',').map((s) => s.trim().replace(/^@/, '')).filter(Boolean);
exports.getConfiguredBskyHandles = getConfiguredBskyHandles;
const isPokemonTcgRelevantText = (txt) => POKEMON_RELEVANCE_RE.test(String(txt || ''));
exports.isPokemonTcgRelevantText = isPokemonTcgRelevantText;
function isDirectRetailFinalUrl(candidateUrl) {
    try {
        const u = new URL(candidateUrl);
        return DIRECT_RETAIL_HOST_RE.test(u.hostname) && !/^\/c\/\d+\//i.test(u.pathname);
    }
    catch {
        return false;
    }
}
function tryDecodeEmbeddedRetailUrl(candidateUrl) {
    try {
        const parsed = new URL(candidateUrl);
        for (const key of EMBEDDED_URL_PARAMS) {
            let val = parsed.searchParams.get(key);
            if (!val)
                continue;
            for (let d = 0; d < 2 && /^https?%3A/i.test(val); d++) {
                try {
                    val = decodeURIComponent(val);
                }
                catch {
                    break;
                }
            }
            if (/^https?:\/\//i.test(val)) {
                const inner = tryDecodeEmbeddedRetailUrl(val);
                if (inner)
                    return inner;
                if (isDirectRetailFinalUrl(val))
                    return val;
            }
        }
        if (isDirectRetailFinalUrl(candidateUrl))
            return candidateUrl;
    }
    catch { }
    return null;
}
function canonicalizeRetailCheckoutUrl(rawUrl, postContext = '', isQueueOrDrawing = false) {
    let u;
    try {
        u = new URL(rawUrl);
    }
    catch {
        return { finalUrl: rawUrl, canonicalUrl: rawUrl, checkoutUrl: rawUrl, retailer: (0, policies_1.detectBigBoxRetailer)(postContext, rawUrl), canonicalItemId: rawUrl };
    }
    const host = u.hostname.toLowerCase();
    if (host.endsWith('target.com')) {
        const tcin = rawUrl.match(/A-(\d{8,10})/i)?.[1] || u.searchParams.get('tcin') || '';
        const canonicalUrl = tcin ? `https://www.target.com/p/-/A-${tcin}` : `https://www.target.com${u.pathname}`;
        return { finalUrl: rawUrl, canonicalUrl, checkoutUrl: canonicalUrl, retailer: 'Target', canonicalItemId: tcin ? `target_${tcin}` : canonicalUrl };
    }
    if (host.endsWith('walmart.com')) {
        const wmId = rawUrl.match(/\/ip\/(?:[^/?#]+\/)?(\d{7,14})/i)?.[1] || u.searchParams.get('id') || u.searchParams.get('items') || '';
        const canonicalUrl = wmId ? `https://www.walmart.com/ip/${wmId}` : `https://www.walmart.com${u.pathname}`;
        const pacUrl = wmId && !isQueueOrDrawing ? `https://www.walmart.com/pac?id=${wmId}&quantity=1` : canonicalUrl;
        return { finalUrl: rawUrl, canonicalUrl, checkoutUrl: pacUrl, cart1xUrl: wmId && !isQueueOrDrawing ? pacUrl : undefined, retailer: 'Walmart', canonicalItemId: wmId ? `walmart_${wmId}` : canonicalUrl };
    }
    if (host.endsWith('bestbuy.com')) {
        const numSku = u.searchParams.get('skuId') || rawUrl.match(/\/click\/-\/(\d{7})\/cart|\/(\d{7})\.p/i)?.slice(1).find(Boolean) || '';
        const prodMatch = u.pathname.match(/\/product\/([^/?#]+)\/([A-Z0-9]{7,14})/i);
        if (/^\d{7}$/.test(numSku)) {
            const canonicalUrl = `https://www.bestbuy.com/site/-/${numSku}.p?skuId=${numSku}`;
            const atc = isQueueOrDrawing ? canonicalUrl : `https://api.bestbuy.com/click/-/${numSku}/cart`;
            return { finalUrl: rawUrl, canonicalUrl, checkoutUrl: atc, cart1xUrl: isQueueOrDrawing ? undefined : atc, retailer: 'Best Buy', canonicalItemId: `bestbuy_${numSku}` };
        }
        const cleanBb = prodMatch ? `https://www.bestbuy.com/product/${prodMatch[1]}/${prodMatch[2]}` : `https://www.bestbuy.com${u.pathname}`;
        return { finalUrl: rawUrl, canonicalUrl: cleanBb, checkoutUrl: cleanBb, retailer: 'Best Buy', canonicalItemId: prodMatch ? `bestbuy_${prodMatch[2]}` : cleanBb };
    }
    if (host.endsWith('amazon.com') || host === 'a.co') {
        const asin = rawUrl.match(/(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|ASIN\.1=)(B0[A-Z0-9]{8})/i)?.[1]?.toUpperCase() || '';
        if (asin) {
            const canonicalUrl = `https://www.amazon.com/dp/${asin}?smid=${bigBoxAdapters_1.AMAZON_1P_MERCHANT_ID}`;
            const atc = `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${asin}&Quantity.1=1`;
            return { finalUrl: rawUrl, canonicalUrl, checkoutUrl: canonicalUrl, cart1xUrl: isQueueOrDrawing ? undefined : atc, retailer: 'Amazon', canonicalItemId: `amazon_${asin}` };
        }
    }
    if (host.endsWith('pokemoncenter.com')) {
        const cleanPc = `https://www.pokemoncenter.com${u.pathname}`;
        return { finalUrl: rawUrl, canonicalUrl: cleanPc, checkoutUrl: cleanPc, retailer: 'Pokémon Center', canonicalItemId: `pc_${u.pathname.split('/').filter(Boolean).pop() || 'pc'}` };
    }
    const keepEan = host.endsWith('barnesandnoble.com') ? u.searchParams.get('ean') : null;
    const cleanGeneric = `${u.origin}${u.pathname}${keepEan ? `?ean=${encodeURIComponent(keepEan)}` : ''}`;
    return { finalUrl: rawUrl, canonicalUrl: cleanGeneric, checkoutUrl: cleanGeneric, retailer: (0, policies_1.detectBigBoxRetailer)(postContext, cleanGeneric), canonicalItemId: cleanGeneric };
}
async function unshortenAndCanonicalizeRetailUrl(rawInputUrl, postContext = '', isQueueOrDrawing = false) {
    const normalized = /^https?:\/\//i.test(rawInputUrl) ? rawInputUrl.trim().replace(/^http:\/\//i, 'https://') : `https://${rawInputUrl.trim()}`;
    const cacheKey = `${normalized}::${isQueueOrDrawing ? 'Q' : 'B'}`;
    const hit = unshortenCache.get(cacheKey);
    if (hit)
        return hit;
    let currentUrl = tryDecodeEmbeddedRetailUrl(normalized) || normalized;
    let hops = 0;
    while (hops < 4 && !isDirectRetailFinalUrl(currentUrl)) {
        try {
            const res = await fetch(currentUrl, {
                redirect: 'manual',
                signal: AbortSignal.timeout(5000),
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8'
                }
            });
            const loc = String(res.headers.get('location') || '').trim();
            await res.body?.cancel().catch(() => { });
            if (res.status >= 300 && res.status < 400 && loc) {
                hops += 1;
                const nextUrl = new URL(loc, currentUrl).toString().replace(/^http:\/\//i, 'https://');
                const embedded = tryDecodeEmbeddedRetailUrl(nextUrl);
                currentUrl = embedded || nextUrl;
                if (embedded)
                    break;
                continue;
            }
            break;
        }
        catch {
            break;
        }
    }
    exports.wireTelemetry.linksUnshortened += 1;
    const out = { originalUrl: normalized, hops, ...canonicalizeRetailCheckoutUrl(currentUrl, postContext, isQueueOrDrawing) };
    if (unshortenCache.size > 500)
        unshortenCache.clear();
    unshortenCache.set(cacheKey, out);
    return out;
}
function classifyWireRestockEvent(text, url = '') {
    const hay = `${text || ''} ${url || ''}`;
    if (/\b(?:online\s+drawings?|drawings?\b|raffle|lottery)\b/i.test(hay))
        return { classification: 'QUEUE_INVITE_DRAWING', windowKind: 'DRAWING' };
    if (/\b(?:request\s+invite|invite[\s-]*only|invitations?\b)\b/i.test(hay))
        return { classification: 'QUEUE_INVITE_DRAWING', windowKind: 'INVITE' };
    if (/\b(?:waiting\s+room|\bqueue\b|queue-it|virtual\s+line)\b/i.test(hay))
        return { classification: 'QUEUE_INVITE_DRAWING', windowKind: 'QUEUE' };
    return { classification: 'INSTANT_BUY_RESTOCK' };
}
function extractExplicitDealPrice(text) {
    const m = String(text || '').replace(/(?:free\s+ship(?:ping)?\s+(?:on\s+|over\s+)?)\$\d+(?:\.\d{1,2})?/gi, '').match(/\$([0-9]{2,4}(?:\.[0-9]{1,2})?)/);
    return m ? parseFloat(m[1]) : undefined;
}
async function evaluateAndDispatchWireSignal(params) {
    const combinedText = (0, bigBoxAdapters_1.cleanHtmlText)(`${params.lineContext || ''} ${params.headlineText || ''}`);
    const cls = classifyWireRestockEvent(combinedText, params.rawUrl);
    const isQueue = cls.classification === 'QUEUE_INVITE_DRAWING';
    const link = await unshortenAndCanonicalizeRetailUrl(params.rawUrl, combinedText, isQueue);
    const postAgeSec = Math.max(0, Math.round((Date.now() - params.postCreatedMs) / 1000));
    const isLiveEligible = (Date.now() - params.postCreatedMs) <= exports.WIRE_LIVE_MAX_AGE_MS;
    const urlSlugWords = (() => { try {
        return new URL(link.canonicalUrl).pathname.replace(/[/_-]+/g, ' ');
    }
    catch {
        return '';
    } })();
    const explicitPrice = extractExplicitDealPrice(params.lineContext || params.headlineText);
    const matchOpts = { handle: link.canonicalUrl, retailer: link.retailer || undefined, sourceUrl: link.canonicalUrl, allowPcRetailUnlock: link.retailer === 'Pokémon Center' };
    const rule = (params.lineContext ? (0, policies_1.matchProductToSku)(params.lineContext, explicitPrice, matchOpts) : null) ||
        (urlSlugWords ? (0, policies_1.matchProductToSku)(`Pokemon TCG ${urlSlugWords}`, explicitPrice, matchOpts) : null) ||
        (0, policies_1.matchProductToSku)(params.headlineText, explicitPrice, matchOpts);
    let checkoutUrl = link.checkoutUrl, cart1xUrl = link.cart1xUrl;
    if (!isQueue && link.retailer === 'Best Buy' && rule?.bestBuySku && /^\d{7}$/.test(String(rule.bestBuySku))) {
        cart1xUrl = `https://api.bestbuy.com/click/-/${rule.bestBuySku}/cart`;
        checkoutUrl = cart1xUrl;
    }
    let dispatched = false;
    const price = explicitPrice ?? (rule?.msrpCeiling || undefined);
    if (!params.dryRun && isLiveEligible && link.retailer) {
        const dedupIds = [link.canonicalItemId, rule?.id || ''].filter(Boolean);
        if (isQueue && cls.windowKind && (0, exports.isPokemonTcgRelevantText)(`${combinedText} ${urlSlugWords}`)) {
            if ((0, bigBoxAdapters_1.claimBigBoxCrossChannelSignal)(link.retailer, dedupIds, 0, params.sourceLabel)) {
                dispatched = await (0, notifier_1.sendBigBoxQueueOrDrawingAlert)({
                    retailer: link.retailer, headline: params.lineContext || params.headlineText,
                    url: link.canonicalUrl, windowKind: cls.windowKind, ruleId: rule?.id, ruleName: rule?.name, sourceLabel: params.sourceLabel
                });
            }
        }
        else if (!isQueue && rule && price && price >= 18 && (0, bigBoxAdapters_1.claimBigBoxCrossChannelSignal)(link.retailer, dedupIds, price, params.sourceLabel)) {
            const isAssumedMsrp = explicitPrice === undefined;
            await (0, listener_1.processIncomingDrop)({
                title: rule.name || params.lineContext || params.headlineText,
                retailer: isAssumedMsrp ? `${link.retailer} [BIG-BOX RESTOCK RADAR]` : `${link.retailer} (via ${params.sourceLabel})`,
                url: checkoutUrl, productUrl: link.canonicalUrl, cart1xUrl, price, itemId: `wire_${params.postId}_${rule.id}`,
                isPreOrder: /pre-?order|pre-?sale/i.test(combinedText), freeShipping: Boolean(isAssumedMsrp || price >= 35),
                isBigBoxRestockRadar: isAssumedMsrp,
                shippingNoteOverride: isAssumedMsrp ? `📡 [${params.sourceLabel}] Live ${link.retailer} Restock Signal — Canonical Checkout Armed` : undefined
            });
            dispatched = true;
        }
        if (dispatched)
            exports.wireTelemetry.signalsDispatched += 1;
    }
    return {
        source: params.sourceLabel, postAgeSec, isLiveEligible, originalUrl: link.originalUrl, canonicalUrl: link.canonicalUrl,
        checkoutUrl, retailer: link.retailer, canonicalItemId: link.canonicalItemId, hops: link.hops,
        classification: cls.classification, windowKind: cls.windowKind, matchedSkuId: rule?.id || null,
        matchedSkuName: rule?.name || null, price, dispatched
    };
}
function extractBlueskyRecordLinks(record) {
    const text = String(record?.text || ''), utf8 = Buffer.from(text, 'utf8'), lines = text.split(/\r?\n/);
    const results = [], seen = new Set();
    const add = (raw, ctx) => {
        const clean = String(raw || '').trim().replace(/[).,!]+$/, '');
        if (!clean || /bsky\.app/i.test(clean))
            return;
        const full = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
        if (!seen.has(full)) {
            seen.add(full);
            results.push({ url: full, lineContext: (0, bigBoxAdapters_1.cleanHtmlText)(ctx || text) });
        }
    };
    for (const facet of record?.facets || []) {
        const bStart = Number(facet?.index?.byteStart ?? 0);
        const lineIdx = utf8.subarray(0, Math.min(bStart, utf8.length)).toString('utf8').split(/\r?\n/).length - 1;
        for (const feat of facet?.features || []) {
            if (feat?.$type === 'app.bsky.richtext.facet#link' && feat.uri)
                add(feat.uri, lines[lineIdx] || text);
        }
    }
    const ext = record?.embed?.external || record?.embed?.media?.external;
    if (ext?.uri)
        add(ext.uri, `${ext.title || ''} ${text}`);
    for (const line of lines) {
        for (const m of line.matchAll(/https?:\/\/[^\s)"\]<>]+/gi))
            add(m[0], line);
        for (const m of line.matchAll(SHORTENER_BARE_RE))
            add(`https://${m[1]}`, line);
    }
    return results;
}
async function resolveBlueskyActorDids(handles = (0, exports.getConfiguredBskyHandles)()) {
    const qs = handles.map((h) => `actors=${encodeURIComponent(h)}`).join('&');
    const res = await fetch(`${BSKY_APPVIEW_BASE}/app.bsky.actor.getProfiles?${qs}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok)
        throw new Error(`Bluesky getProfiles HTTP ${res.status}`);
    const data = await res.json(), map = {};
    for (const p of data?.profiles || [])
        if (p?.handle && p?.did)
            map[String(p.handle).toLowerCase()] = String(p.did);
    exports.wireTelemetry.handles = handles;
    exports.wireTelemetry.didMap = map;
    return map;
}
async function fetchBlueskyAuthorFeedPosts(handle, limit = 15) {
    const res = await fetch(`${BSKY_APPVIEW_BASE}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=${limit}&filter=posts_no_replies`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok)
        throw new Error(`Bluesky getAuthorFeed(${handle}) HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data?.feed) ? data.feed.map((f) => f?.post).filter(Boolean) : [];
}
async function ingestBlueskyPost(uri, handle, record, dryRun = false) {
    if (!dryRun) {
        if (seenWirePostUris.has(uri))
            return [];
        if (seenWirePostUris.size > 1000)
            seenWirePostUris.clear();
        seenWirePostUris.add(uri);
    }
    exports.wireTelemetry.postsInspected += 1;
    const fullText = `${record?.text || ''} ${record?.embed?.external?.title || ''}`;
    if (!(0, exports.isPokemonTcgRelevantText)(fullText))
        return [];
    const createdMs = Date.parse(String(record?.createdAt || '')) || Date.now();
    if (!dryRun && Date.now() - createdMs > exports.WIRE_LIVE_MAX_AGE_MS)
        return [];
    const rkey = uri.split('/').pop() || String(createdMs), out = [];
    for (const l of extractBlueskyRecordLinks(record)) {
        out.push(await evaluateAndDispatchWireSignal({ sourceLabel: `Bluesky @${handle}`, postId: `bsky_${rkey}`, postCreatedMs: createdMs, headlineText: fullText, lineContext: l.lineContext, rawUrl: l.url, dryRun }));
    }
    return out;
}
async function pollBlueskyRestockFeedsOnce() {
    exports.wireTelemetry.lastRestPollAt = Date.now();
    for (const handle of (0, exports.getConfiguredBskyHandles)()) {
        try {
            for (const p of await fetchBlueskyAuthorFeedPosts(handle, 15))
                if (p?.uri && p?.record)
                    await ingestBlueskyPost(p.uri, handle, p.record, false);
        }
        catch { }
    }
    (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ restockWire: { ...exports.wireTelemetry } });
}
function connectBlueskyJetstream(didMap) {
    const didEntries = Object.entries(didMap);
    if (didEntries.length === 0 || typeof WebSocket !== 'function')
        return null;
    const didToHandle = new Map(didEntries.map(([h, did]) => [did, h]));
    const wsUrl = `${BSKY_JETSTREAM_BASE}?wantedCollections=app.bsky.feed.post&${didEntries.map(([, did]) => `wantedDids=${encodeURIComponent(did)}`).join('&')}`;
    if (activeJetstreamWs) {
        try {
            activeJetstreamWs.close();
        }
        catch { }
        activeJetstreamWs = null;
    }
    const ws = (activeJetstreamWs = new WebSocket(wsUrl));
    ws.addEventListener('open', () => {
        exports.wireTelemetry.jetstreamConnected = true;
        exports.wireTelemetry.lastJetstreamOpenAt = Date.now();
        reconnectAttempt = 0;
        (0, lgsPoller_1.recordBigBoxCheckTelemetry)({ restockWire: { ...exports.wireTelemetry } });
    });
    ws.addEventListener('message', (ev) => {
        try {
            exports.wireTelemetry.lastJetstreamEventAt = Date.now();
            const msg = JSON.parse(String(ev.data || ''));
            if (msg?.kind === 'commit' && msg?.commit?.collection === 'app.bsky.feed.post' && msg?.commit?.operation === 'create') {
                void ingestBlueskyPost(`at://${msg.did}/app.bsky.feed.post/${msg.commit.rkey}`, didToHandle.get(String(msg.did || '')) || 'bsky', msg.commit.record, false);
            }
        }
        catch { }
    });
    ws.addEventListener('close', () => {
        exports.wireTelemetry.jetstreamConnected = false;
        if (!wireStarted || reconnectTimer)
            return;
        exports.wireTelemetry.jetstreamReconnects += 1;
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connectBlueskyJetstream(exports.wireTelemetry.didMap); }, Math.min(30_000, 2_000 * Math.pow(2, reconnectAttempt++)));
        reconnectTimer?.unref?.();
    });
    ws.addEventListener('error', () => { try {
        ws.close();
    }
    catch { } });
    return ws;
}
async function startPublicRestockWire() {
    if (wireStarted)
        return;
    wireStarted = true;
    try {
        connectBlueskyJetstream(await resolveBlueskyActorDids());
    }
    catch (err) {
        console.warn(`[RestockWire] DID warning: ${err?.message || err}`);
    }
    await pollBlueskyRestockFeedsOnce();
    restPollTimer = setInterval(() => { void pollBlueskyRestockFeedsOnce(); }, 25_000);
}
function stopPublicRestockWire() {
    wireStarted = false;
    if (restPollTimer) {
        clearInterval(restPollTimer);
        restPollTimer = null;
    }
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (activeJetstreamWs) {
        try {
            activeJetstreamWs.close();
        }
        catch { }
        activeJetstreamWs = null;
    }
}
