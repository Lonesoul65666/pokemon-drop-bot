import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getDualMarketComps, getLiveTcgPlayerCompFast, CompQuote } from './marketComps';
import {
  markLiveStockOut,
  buildShopifyDirectCartLinks,
  computeAutoPilotTarget,
  isVerified1PBigBoxOrPc
} from './evaluator';
import { atomicWriteJson, computeRipMetrics, isSingleCardOrNonSealed } from './policies';
import { loadGlobalSettings, loadMergedPoliciesRaw } from './src/config/configManager';
import {
  buildCleanDiscordAlertEmbed,
  resolveAlertBoxArt,
  cleanRetailerDisplayUpper,
  extractTcgProductId
} from './src/notifications/discordEmbedBuilder';
import { fetchTcgPlayerQuarterHistoryNote } from './src/engine/watermarkHistory';
import { isSingleEtbFormat } from './src/engine/purchaseMemory';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const DISCORD_MIN_INTERVAL_MS = 1250;
interface DiscordQueueJob {
  method: 'POST' | 'PATCH';
  url: string;
  payload: any;
  localAttachmentPath?: string;
  resolve: (data: any) => void;
  reject: (err: any) => void;
  retries: number;
}

const discordWebhookQueue: DiscordQueueJob[] = [];
let isProcessingDiscordQueue = false;
let lastDiscordSendAt = 0;

function sleepMs(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

const NETWORK_RETRY_BACKOFF_MS = [1500, 4000];

function isTransientNetworkOr5xxError(err: any): boolean {
  const status = Number(err?.response?.status || 0);
  if (status >= 500 && status < 600) return true;
  const code = String(err?.code || err?.cause?.code || '').toUpperCase();
  const msg = String(err?.message || '');
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNABORTED' ||
    code === 'ERR_NETWORK' ||
    /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|timeout/i.test(msg)
  );
}

async function processDiscordQueue(): Promise<void> {
  if (isProcessingDiscordQueue) return;
  isProcessingDiscordQueue = true;

  try {
    while (discordWebhookQueue.length > 0) {
      const job = discordWebhookQueue[0];
      const elapsed = Date.now() - lastDiscordSendAt;
      if (elapsed < DISCORD_MIN_INTERVAL_MS) {
        await sleepMs(DISCORD_MIN_INTERVAL_MS - elapsed);
      }

      try {
        lastDiscordSendAt = Date.now();
        let bodyToSend: any = job.payload;
        if (job.method === 'POST' && job.localAttachmentPath && fs.existsSync(job.localAttachmentPath)) {
          const form = new FormData();
          form.append('payload_json', JSON.stringify(job.payload));
          const imgBuf = fs.readFileSync(job.localAttachmentPath);
          form.append('files[0]', new Blob([imgBuf], { type: 'image/jpeg' }), 'boxart.jpg');
          bodyToSend = form;
        }
        const res = job.method === 'POST'
          ? await axios.post(job.url, bodyToSend, { timeout: 10000 })
          : await axios.patch(job.url, bodyToSend, { timeout: 10000 });
        discordWebhookQueue.shift();
        job.resolve(res.data ?? { ok: true });
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 429 && job.retries < 4) {
          job.retries += 1;
          const retryAfterRaw = err?.response?.data?.retry_after ?? err?.response?.headers?.['retry-after'] ?? 2;
          const retryMs = Math.ceil(Number(retryAfterRaw) * (Number(retryAfterRaw) < 50 ? 1000 : 1)) + 250;
          console.warn(`[DISCORD QUEUE] HTTP 429 Rate Limit hit. Backing off for ${retryMs}ms (Retry ${job.retries}/4)...`);
          await sleepMs(retryMs);
        } else if (isTransientNetworkOr5xxError(err) && job.retries < NETWORK_RETRY_BACKOFF_MS.length) {
          const backoffMs = NETWORK_RETRY_BACKOFF_MS[job.retries];
          job.retries += 1;
          console.warn(`[DISCORD QUEUE] Transient network/DNS/5xx (${err?.code || status || err?.message}). Retrying in ${backoffMs}ms (${job.retries}/${NETWORK_RETRY_BACKOFF_MS.length})...`);
          await sleepMs(backoffMs);
        } else {
          discordWebhookQueue.shift();
          job.reject(err);
        }
      }
    }
  } finally {
    isProcessingDiscordQueue = false;
  }
}

export function enqueueDiscordWebhook(
  url: string,
  payload: any,
  method: 'POST' | 'PATCH' = 'POST',
  priorityFront = false,
  localAttachmentPath?: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const job: DiscordQueueJob = { method, url, payload, localAttachmentPath, resolve, reject, retries: 0 };
    if (priorityFront) {
      discordWebhookQueue.unshift(job);
    } else {
      discordWebhookQueue.push(job);
    }
    processDiscordQueue().catch(() => {});
  });
}

export interface DropPayload {
  title: string;
  titlePrefix?: string;
  retailer: string;
  url: string;
  productUrl?: string;
  imageUrl?: string;
  cart1xUrl?: string;
  cart2xUrl?: string;
  cart3xUrl?: string;
  price?: string;
  priceNum?: number;
  itemPrice?: number;
  shippingPrice?: number;
  landedPrice?: number;
  estimatedShipping?: number;
  freeShipNote?: string;
  packCount?: number;
  pricePerPack?: number;
  isRipValueLeader?: boolean;
  isPreOrder?: boolean;
  isPreRelease?: boolean;
  preReleaseStatusTag?: string;
  releaseDate?: string;
  isMsrpUnicorn?: boolean;
  bypassVaultMute?: boolean;
  stock?: number;
  itemId?: string;
  ruleId?: string;
  ruleName?: string;
  formFactor?: string;
  msrp?: number;
  marketValue?: number;
  maxBuyTarget?: number;
  discountPct?: number;
  savingsDollars?: number;
  ownedInVault?: boolean;
  alertType?: 'NEW_DROP' | 'PRICE_DROP' | 'RESTOCK_REPEAT' | 'PRE_DROP_STAGING';
  previousPrice?: number;
  previousTimeStr?: string;
  bigBoxTier?: string;
  bigBoxBadge?: string;
  marketplaceWarning?: string;
  priorityFront?: boolean;
  statusTier?: string;
  statusTag?: string;
  isCloseCall?: boolean;
  closeCallDelta?: number;
  trendSignal?: string;
  trendVerdictLabel?: string;
  isElasticDip?: boolean;
}

interface ActiveDiscordMessage {
  messageId: string;
  embed: any;
  sentAt: number;
  ruleName: string;
  retailer: string;
}

const activeDiscordMessages = new Map<string, ActiveDiscordMessage>();
const DROPS_HISTORY_PATH = path.resolve(process.cwd(), 'dropsHistory.json');
const TELEMETRY_PATH = path.resolve(process.cwd(), 'marketCache.json');

function getRetailerShippingNote(
  retailer: string,
  price: number,
  estimatedShipping?: number,
  itemPrice?: number,
  shippingPrice?: number,
  freeShipNote?: string
): string {
  const r = (retailer || '').toLowerCase();
  if (r.includes('tcgplayer') || r.includes('ebay')) {
    if (shippingPrice !== undefined && shippingPrice > 0) {
      if (itemPrice !== undefined && itemPrice > 0) {
        return `$${itemPrice.toFixed(2)} + $${shippingPrice.toFixed(2)} Ship`;
      }
      return `+$${shippingPrice.toFixed(2)} Ship`;
    }
    if (shippingPrice === 0) {
      return '+FREE Shipping';
    }
    const effItemPrice = itemPrice !== undefined && itemPrice > 0 ? itemPrice : price;
    if (effItemPrice < 35) {
      return '+Est. Ship / Check Cart — Under $35 Threshold, 2x May Unlock Free Ship';
    }
    return '+FREE Shipping';
  }
  if (freeShipNote && /est\.?\s*ship|under\s*\$35|\+\$[0-9]/i.test(freeShipNote)) {
    return freeShipNote;
  }
  if (estimatedShipping === 0 || price >= 150) return '+FREE Shipping';
  if (
    r.includes('target') ||
    r.includes('best buy') ||
    r.includes('walmart') ||
    r.includes('amazon') ||
    r.includes('costco') ||
    r.includes('gamestop') ||
    r.includes("sam's club") ||
    r.includes('sams club') ||
    r.includes('barnes') ||
    r.includes('pokemon center')
  ) {
    return price >= 35 ? '+FREE Shipping' : `+$${(estimatedShipping ?? 5.99).toFixed(2)} Shipping`;
  }
  return `+$${(estimatedShipping ?? 6.99).toFixed(2)} Est. LGS Ship`;
}

export function recordPreDropStagingEvent(params: {
  ruleId: string;
  ruleName: string;
  formFactor: string;
  rawTitle: string;
  retailer: string;
  price: number;
  msrp: number;
  marketValue: number;
  url: string;
  stagingReason: string;
}) {
  try {
    let history: any[] = [];
    if (fs.existsSync(DROPS_HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(DROPS_HISTORY_PATH, 'utf-8'));
    }
    const rip = computeRipMetrics(params.price, params.ruleId, params.formFactor, params.ruleName);
    const discountPct = params.marketValue > params.price
      ? Math.max(0, Math.round(((params.marketValue - params.price) / params.marketValue) * 100))
      : 0;
    history.unshift({
      timestamp: Date.now(),
      timeStr: `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • STAGING`,
      title: params.ruleName,
      rawTitle: params.rawTitle,
      retailer: params.retailer,
      price: params.price,
      landedPrice: params.price,
      msrp: params.msrp,
      freeShipNote: params.stagingReason,
      packCount: rip.packCount,
      pricePerPack: rip.pricePerPack,
      isRipValueLeader: rip.isRipValueLeader,
      marketValue: params.marketValue,
      discountPct,
      url: params.url,
      productUrl: params.url,
      formFactor: params.formFactor || 'Sealed',
      ruleId: params.ruleId,
      alertType: 'PRE_DROP_STAGING',
      isPreDropStaging: true,
      soldOut: false
    });
    if (history.length > 25) history = history.slice(0, 25);
    atomicWriteJson(DROPS_HISTORY_PATH, history);
  } catch (e) {}
}

function recordDropHistory(drop: DropPayload) {
  try {
    let history: any[] = [];
    if (fs.existsSync(DROPS_HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(DROPS_HISTORY_PATH, 'utf-8'));
    }
    const rawPrice = drop.priceNum || parseFloat(drop.price || '0');
    const effLanded = drop.landedPrice || rawPrice;
    const rip = computeRipMetrics(effLanded, drop.ruleId, drop.formFactor, drop.ruleName || drop.title, drop.packCount);
    history.unshift({
      timestamp: Date.now(),
      timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title: drop.ruleName || drop.title,
      rawTitle: drop.title,
      retailer: drop.retailer,
      price: rawPrice,
      itemPrice: drop.itemPrice,
      shippingPrice: drop.shippingPrice,
      landedPrice: drop.landedPrice,
      freeShipNote: drop.freeShipNote,
      packCount: drop.packCount ?? rip.packCount,
      pricePerPack: drop.pricePerPack ?? rip.pricePerPack,
      isRipValueLeader: drop.isRipValueLeader ?? rip.isRipValueLeader,
      isPreOrder: Boolean(drop.isPreOrder),
      isPreRelease: Boolean(drop.isPreRelease),
      preReleaseStatusTag: drop.preReleaseStatusTag,
      releaseDate: drop.releaseDate,
      isMsrpUnicorn: Boolean(drop.isMsrpUnicorn),
      bigBoxTier: drop.bigBoxTier,
      bigBoxBadge: drop.bigBoxBadge,
      marketplaceWarning: drop.marketplaceWarning,
      statusTier: drop.statusTier,
      statusTag: drop.statusTag,
      isCloseCall: Boolean(drop.isCloseCall),
      closeCallDelta: drop.closeCallDelta,
      trendSignal: drop.trendSignal,
      trendVerdictLabel: drop.trendVerdictLabel,
      isElasticDip: Boolean(drop.isElasticDip),
      marketValue: drop.marketValue || 0,
      discountPct: drop.discountPct || 0,
      url: drop.url,
      productUrl: drop.productUrl,
      cart1xUrl: drop.cart1xUrl,
      cart2xUrl: drop.cart2xUrl,
      cart3xUrl: drop.cart3xUrl,
      stock: drop.stock,
      formFactor: drop.formFactor || 'Sealed',
      ruleId: drop.ruleId || '',
      alertType: drop.alertType || 'NEW_DROP',
      soldOut: false
    });
    if (history.length > 25) history = history.slice(0, 25);
    atomicWriteJson(DROPS_HISTORY_PATH, history);
  } catch (e) {}
}

let cachedTelemetryMap: Record<string, any> = {};
let cachedTelemetryMtimeMs = 0;

function getTelemetryCacheFast(): Record<string, any> {
  try {
    if (!fs.existsSync(TELEMETRY_PATH)) return cachedTelemetryMap;
    const stat = fs.statSync(TELEMETRY_PATH);
    if (stat.mtimeMs > cachedTelemetryMtimeMs) {
      const parsed = JSON.parse(fs.readFileSync(TELEMETRY_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object') {
        cachedTelemetryMap = parsed;
        cachedTelemetryMtimeMs = stat.mtimeMs;
      }
    }
  } catch (e) {}
  return cachedTelemetryMap;
}

function getThumbnailUrl(ruleId?: string): string | undefined {
  if (!ruleId) return undefined;
  try {
    const cache = getTelemetryCacheFast();
    const entry = cache[ruleId] || cache[ruleId.replace(/-case$/, '')] || cache[ruleId.replace(/-booster-case$/, '-booster-box')];
    if (entry && entry.lowestUrl && entry.lowestUrl.includes('tcgplayer.com/product/')) {
      const match = entry.lowestUrl.match(/product\/(\d+)/);
      if (match) return `https://product-images.tcgplayer.com/fit-in/437x437/${match[1]}.jpg`;
    }
  } catch (e) {}
  return undefined;
}

async function sendTelegramAlertFast(textHtml: string): Promise<number | undefined> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return undefined;
  for (let attempt = 0; attempt <= NETWORK_RETRY_BACKOFF_MS.length; attempt++) {
    try {
      const res = await axios.post(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        { chat_id: chatId, text: textHtml, parse_mode: 'HTML', disable_web_page_preview: true },
        { timeout: 6000 }
      );
      return res.data?.result?.message_id;
    } catch (e: any) {
      if (attempt < NETWORK_RETRY_BACKOFF_MS.length && isTransientNetworkOr5xxError(e)) {
        await sleepMs(NETWORK_RETRY_BACKOFF_MS[attempt]);
        continue;
      }
      return undefined;
    }
  }
  return undefined;
}

async function patchTelegramAlertFast(messageId: number, textHtml: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId || !messageId) return;
  try {
    await axios.post(
      `https://api.telegram.org/bot${botToken}/editMessageText`,
      { chat_id: chatId, message_id: messageId, text: textHtml, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 6000 }
    );
  } catch (e) {}
}

let lastPcWaitingRoomAlertTs = 0;
export const PC_WAITING_ROOM_COOLDOWN_MS = 30 * 60 * 1000;

export async function sendPokemonCenterQueueAlert(params?: {
  queueUrl?: string;
  detectedFromUrl?: string;
  force?: boolean;
}): Promise<boolean> {
  const now = Date.now();
  if (!params?.force && now - lastPcWaitingRoomAlertTs < PC_WAITING_ROOM_COOLDOWN_MS) {
    return false;
  }
  lastPcWaitingRoomAlertTs = now;
  const targetUrl = params?.queueUrl || 'https://www.pokemoncenter.com';
  const banner = 'POKÉMON CENTER — Virtual Waiting Room Live';

  try {
    let history: any[] = [];
    if (fs.existsSync(DROPS_HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(DROPS_HISTORY_PATH, 'utf-8'));
    }
    history.unshift({
      timestamp: now,
      timeStr: `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • QUEUE LIVE`,
      title: banner,
      rawTitle: banner,
      retailer: 'Pokémon Center',
      price: 0,
      landedPrice: 0,
      msrp: 59.99,
      freeShipNote: 'Virtual Waiting Room Active — Enter Line Immediately',
      url: targetUrl,
      productUrl: targetUrl,
      formFactor: 'Queue Radar',
      ruleId: '',
      alertType: 'PC_QUEUE_LIVE',
      isPreDropStaging: true,
      isQueueAlert: true,
      soldOut: false
    });
    if (history.length > 25) history = history.slice(0, 25);
    atomicWriteJson(DROPS_HISTORY_PATH, history);
  } catch (e) {}

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const boxArt = resolveAlertBoxArt({});
  const embed = {
    title: banner,
    description:
      `**INVITE OR DRAW LIVE** — Queue-It Virtual Waiting Room Active\n` +
      `Open Pokémon Center immediately on mobile + desktop to hold your queue spot before sealed TCG stock goes live.\n\n` +
      `[⚡ Join Pokémon Center Queue ↗](${targetUrl})`,
    url: targetUrl,
    color: 0xDC2626,
    thumbnail: { url: boxArt.thumbnailUrl },
    footer: { text: 'DropBot V6 • 30m Queue Dedup Active' },
    timestamp: new Date().toISOString()
  };

  await Promise.all([
    webhookUrl
      ? enqueueDiscordWebhook(`${webhookUrl}?wait=true`, { content: '@here', embeds: [embed] }, 'POST', true, boxArt.localFilePath)
      : Promise.resolve(null),
    sendTelegramAlertFast(`<b>${banner}</b>\n<a href="${targetUrl}">⚡ JOIN POKÉMON CENTER QUEUE NOW ↗</a>`)
  ]);
  return true;
}

const bigBoxWindowCooldownMap = new Map<string, number>();

export async function sendBigBoxQueueOrDrawingAlert(params: {
  retailer: string;
  headline: string;
  url: string;
  windowKind: 'QUEUE' | 'INVITE' | 'DRAWING';
  ruleId?: string;
  ruleName?: string;
  sourceLabel?: string;
}): Promise<boolean> {
  if (/pok[eé]mon\s*center/i.test(params.retailer) && params.windowKind === 'QUEUE') {
    return sendPokemonCenterQueueAlert({ queueUrl: params.url, detectedFromUrl: params.url });
  }
  const now = Date.now();
  const dedupKey = `${params.retailer.toLowerCase()}::${params.ruleId || params.url}`;
  const prevAt = bigBoxWindowCooldownMap.get(dedupKey) || 0;
  if (now - prevAt < PC_WAITING_ROOM_COOLDOWN_MS) return false;
  bigBoxWindowCooldownMap.set(dedupKey, now);

  const kindTag = params.windowKind === 'DRAWING'
    ? 'Online Drawing Window'
    : (params.windowKind === 'INVITE' ? 'Invite Request Window' : 'Virtual Queue Window');
  const displayTitle = params.ruleName || params.headline;
  const cleanStore = cleanRetailerDisplayUpper(params.retailer);

  try {
    let history: any[] = [];
    if (fs.existsSync(DROPS_HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(DROPS_HISTORY_PATH, 'utf-8'));
    }
    history.unshift({
      timestamp: now,
      timeStr: `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${params.windowKind}`,
      title: displayTitle,
      rawTitle: params.headline,
      retailer: `${params.retailer} [${params.windowKind}]`,
      price: 0,
      landedPrice: 0,
      msrp: 0,
      freeShipNote: `${kindTag} (${params.sourceLabel || 'Public Restock Wire'})`,
      url: params.url,
      productUrl: params.url,
      formFactor: `${params.windowKind} Window`,
      ruleId: params.ruleId || '',
      alertType: 'PRE_DROP_STAGING',
      isPreDropStaging: true,
      isQueueAlert: true,
      soldOut: false
    });
    if (history.length > 25) history = history.slice(0, 25);
    atomicWriteJson(DROPS_HISTORY_PATH, history);
  } catch {}

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const boxArt = resolveAlertBoxArt({ ruleId: params.ruleId });
  const embed = {
    title: `${cleanStore} — ${displayTitle}`,
    description:
      `**INVITE OR DRAW LIVE** — ${kindTag}\n` +
      `Source: ${params.sourceLabel || 'Public Restock Wire'} • Enter registration or queue window directly.\n\n` +
      `[⚡ Open ${params.retailer} ${params.windowKind} ↗](${params.url})`,
    url: params.url,
    color: 0xDC2626,
    thumbnail: { url: boxArt.thumbnailUrl },
    footer: { text: `DropBot V6 • ${kindTag}` },
    timestamp: new Date().toISOString()
  };

  await Promise.all([
    webhookUrl
      ? enqueueDiscordWebhook(`${webhookUrl}?wait=true`, { content: '@here', embeds: [embed] }, 'POST', true, boxArt.localFilePath)
      : Promise.resolve(null),
    sendTelegramAlertFast(`<b>${cleanStore} — ${displayTitle}</b>\n<a href="${params.url}">⚡ OPEN ${params.windowKind} WINDOW ↗</a>`)
  ]);
  return true;
}

export async function sendAlert(drop: DropPayload): Promise<boolean> {
  // Hard Rule (V5 Slice 6): Single cards and slabs NEVER fire notifications (singlesAlertsEnabled: false enforced)
  if (
    String(drop.ruleId || '').startsWith('single-') ||
    /single|slab|graded/i.test(String(drop.formFactor || '')) ||
    isSingleCardOrNonSealed(drop.title, undefined, drop.url)
  ) {
    return false;
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl && !(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)) {
    console.error('[NOTIFIER] No DISCORD_WEBHOOK_URL (or Telegram credentials) found in .env');
    return false;
  }

  const shelfPrice = drop.itemPrice && drop.itemPrice > 0
    ? drop.itemPrice
    : (drop.priceNum ?? parseFloat(drop.price || '0'));
  const shippingAmount = drop.shippingPrice !== undefined
    ? Number(drop.shippingPrice)
    : (drop.estimatedShipping !== undefined ? Number(drop.estimatedShipping) : Math.max(0, (drop.landedPrice ?? shelfPrice) - shelfPrice));
  const landedPrice = drop.landedPrice && drop.landedPrice > 0
    ? drop.landedPrice
    : Math.round((shelfPrice + shippingAmount) * 100) / 100;
  const msrpVal = drop.msrp ?? 0;
  const sliderCeiling = Math.max(msrpVal, Number(drop.maxBuyTarget || 0));

  const telEntry = drop.ruleId ? getTelemetryCacheFast()[drop.ruleId] : undefined;
  const cachedLowest = Number(telEntry?.lowestPrice || 0);
  const cachedLowestUrl = typeof telEntry?.lowestUrl === 'string' ? telEntry.lowestUrl : undefined;
  const bestMarketRef = (drop.marketValue && drop.marketValue > 0)
    ? drop.marketValue
    : (cachedLowest > 0 ? cachedLowest : msrpVal);

  const is1PBigBox = isVerified1PBigBoxOrPc(drop.retailer, drop.productUrl || drop.url, false);
  const productLabel = drop.ruleName || drop.title;
  let initialTcgComp: CompQuote | undefined = undefined;

  // Phase 2 Live Comp Gate for Non-1P LGS: Verify live TCGPlayer lowest shipped BEFORE pinging Discord!
  // (1P Big-Box MSRP drops skip pre-send wait for 0ms dispatch and enrich immediately after.)
  if (!is1PBigBox) {
    initialTcgComp = await getLiveTcgPlayerCompFast(drop.ruleId, productLabel, bestMarketRef);
    const verifiedTcgLow = (initialTcgComp && initialTcgComp.isLiveVerified && initialTcgComp.price > 0)
      ? initialTcgComp.price
      : ((cachedLowest > 0 && /tcgplayer/i.test(`${telEntry?.lowestStore || ''} ${cachedLowestUrl || ''}`) && !/Case Baseline/i.test(String(telEntry?.lowestStore || ''))) ? cachedLowest : 0);

    if (verifiedTcgLow > 0 && landedPrice > verifiedTcgLow + 0.01) {
      console.log(`[Notifier] Suppressed worse-than-TCGPlayer LGS alert: ${drop.retailer} $${landedPrice.toFixed(2)} landed > TCGPlayer $${verifiedTcgLow.toFixed(2)}`);
      return false;
    }
  }

  const built = buildCleanDiscordAlertEmbed({
    titlePrefix: drop.titlePrefix,
    retailer: drop.retailer,
    productName: productLabel,
    url: drop.url,
    productUrl: drop.productUrl,
    imageUrl: drop.imageUrl,
    cart1xUrl: drop.cart1xUrl,
    cart2xUrl: drop.cart2xUrl,
    itemId: drop.itemId,
    stock: drop.stock,
    ruleId: drop.ruleId,
    formFactor: drop.formFactor,
    shelfPrice,
    landedPrice,
    shippingAmount,
    msrp: msrpVal,
    sliderCeiling,
    marketFallback: bestMarketRef,
    packCount: drop.packCount,
    pricePerPack: drop.pricePerPack,
    ownedInVault: drop.ownedInVault,
    bigBoxTier: drop.bigBoxTier,
    isMsrpUnicorn: drop.isMsrpUnicorn,
    isPreOrder: drop.isPreOrder,
    tcgComp: initialTcgComp,
    fallbackTcgUrl: cachedLowestUrl
  });

  const { embed, boxArt, theme, primaryFastUrl } = built;
  const webhookPayload: any = { embeds: [embed] };
  if (theme.mentionContent) {
    webhookPayload.content = theme.mentionContent;
  }

  const shipNote = shippingAmount > 0.01 ? `$${shelfPrice.toFixed(2)} + $${shippingAmount.toFixed(2)} Ship` : 'Free Ship';
  const tgBaseHtml =
    `<b>${cleanRetailerDisplayUpper(drop.retailer)} — ${productLabel}</b>\n` +
    `<b>$${landedPrice.toFixed(2)} Landed</b> (${shipNote})\n` +
    `MSRP: $${msrpVal.toFixed(2)} • Comp: ~$${(initialTcgComp?.price || bestMarketRef).toFixed(2)}\n` +
    `<a href="${primaryFastUrl}">⚡ 1-Tap Checkout ↗</a>` +
    (drop.cart2xUrl ? `  |  <a href="${drop.cart2xUrl}">⚡ 2x ↗</a>` : '');

  try {
    const [discordSettled, tgSettled] = await Promise.allSettled([
      webhookUrl
        ? enqueueDiscordWebhook(`${webhookUrl}?wait=true`, webhookPayload, 'POST', true, boxArt.localFilePath)
        : Promise.resolve(null),
      sendTelegramAlertFast(tgBaseHtml)
    ]);

    const discordOk = Boolean(webhookUrl && discordSettled.status === 'fulfilled' && discordSettled.value);
    const discordData = discordSettled.status === 'fulfilled' ? discordSettled.value : null;
    const tgMsgId: number | undefined = tgSettled.status === 'fulfilled' ? tgSettled.value : undefined;
    const tgOk = Boolean(tgMsgId);

    if (!discordOk && !tgOk) {
      const errReason = discordSettled.status === 'rejected'
        ? (discordSettled.reason?.message || String(discordSettled.reason))
        : 'All notification channels failed';
      console.error(`Failed to send Discord alert (alertState NOT locked — will retry next sweep): ${errReason}`);
      return false;
    }

    if (!drop.titlePrefix) {
      recordDropHistory(drop);
    }
    const sentMsgId: string | undefined = discordData?.id;
    if (sentMsgId && drop.itemId) {
      activeDiscordMessages.set(String(drop.itemId), {
        messageId: sentMsgId,
        embed,
        sentAt: Date.now(),
        ruleName: productLabel,
        retailer: drop.retailer
      });
    }
    console.log(`[DISCORD SENT] [${drop.alertType || 'NEW'}] ${productLabel} ($${landedPrice.toFixed(2)} landed at ${drop.retailer})`);

    // 2. Detached Asynchronous Enrichment: Fetch TCGPlayer comp + TCG 30d/60d quarter history and PATCH cleanly while preserving Box Art!
    if (sentMsgId || tgMsgId) {
      void (async () => {
        try {
          const comps = await getDualMarketComps(drop.ruleId, productLabel, bestMarketRef);
          const bestTcg = comps.tcgplayer || initialTcgComp;
          const resolvedProdId = extractTcgProductId(bestTcg?.url) || boxArt.tcgProductId || extractTcgProductId(cachedLowestUrl);
          const tcgQuarterNote = resolvedProdId
            ? await fetchTcgPlayerQuarterHistoryNote(resolvedProdId, {
                formFactor: drop.formFactor,
                skuId: drop.ruleId,
                productName: productLabel
              })
            : '';

          if (!bestTcg && !tcgQuarterNote) return;
          if (drop.itemId && sentMsgId && !activeDiscordMessages.has(String(drop.itemId))) {
            return;
          }

          const enriched = buildCleanDiscordAlertEmbed({
            titlePrefix: drop.titlePrefix,
            retailer: drop.retailer,
            productName: productLabel,
            url: drop.url,
            productUrl: drop.productUrl,
            imageUrl: drop.imageUrl,
            existingThumbnailUrl: embed.thumbnail?.url,
            cart1xUrl: drop.cart1xUrl,
            cart2xUrl: drop.cart2xUrl,
            itemId: drop.itemId,
            stock: drop.stock,
            ruleId: drop.ruleId,
            formFactor: drop.formFactor,
            shelfPrice,
            landedPrice,
            shippingAmount,
            msrp: msrpVal,
            sliderCeiling,
            marketFallback: bestMarketRef,
            packCount: drop.packCount,
            pricePerPack: drop.pricePerPack,
            ownedInVault: drop.ownedInVault,
            bigBoxTier: drop.bigBoxTier,
            isMsrpUnicorn: drop.isMsrpUnicorn,
            isPreOrder: drop.isPreOrder,
            tcgComp: bestTcg,
            fallbackTcgUrl: cachedLowestUrl,
            tcgQuarterNote
          });

          if (sentMsgId && webhookUrl) {
            if (drop.itemId && activeDiscordMessages.has(String(drop.itemId))) {
              activeDiscordMessages.get(String(drop.itemId))!.embed = enriched.embed;
            }
            await enqueueDiscordWebhook(`${webhookUrl}/messages/${sentMsgId}`, { embeds: [enriched.embed] }, 'PATCH', false);
          }

          if (tgMsgId && bestTcg) {
            const liveMktRef = bestTcg.price || bestMarketRef;
            const liveDiscount = liveMktRef > 0 ? Math.round(((liveMktRef - landedPrice) / liveMktRef) * 100) : 0;
            const tgEnriched =
              `<b>${cleanRetailerDisplayUpper(drop.retailer)} — ${productLabel}</b>\n` +
              `<b>$${landedPrice.toFixed(2)} Landed</b> (${shipNote})\n` +
              `MSRP: $${msrpVal.toFixed(2)} • TCGPlayer: <b>$${liveMktRef.toFixed(2)}</b> (${liveDiscount > 0 ? `-${liveDiscount}%` : 'Matches Low'})\n` +
              `<a href="${primaryFastUrl}">⚡ 1-Tap Checkout ↗</a>` +
              (drop.cart2xUrl ? `  |  <a href="${drop.cart2xUrl}">⚡ 2x ↗</a>` : '');
            await patchTelegramAlertFast(tgMsgId, tgEnriched);
          }
        } catch (enrichErr) {
          // Non-fatal background enrichment error
        }
      })();
    }
    return true;
  } catch (err: any) {
    console.error(`Failed to send Discord alert: ${err.message}`);
    return false;
  }
}

// Automatically edits the Discord embed in-place when a restock sells out!
export async function markAlertSoldOut(itemId: string): Promise<void> {
  markLiveStockOut(String(itemId));
  const tracked = activeDiscordMessages.get(String(itemId));
  if (!tracked) return;
  activeDiscordMessages.delete(String(itemId));

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const durationSec = Math.max(1, Math.round((Date.now() - tracked.sentAt) / 1000));
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;
  const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs} seconds`;

  const updatedEmbed = {
    ...tracked.embed,
    title: `SOLD OUT — ${cleanRetailerDisplayUpper(tracked.retailer)} — ${tracked.ruleName}`,
    description: `**Restock Depleted.** Allocation on **${tracked.retailer}** lasted **${durationStr}** and is now Out of Stock.`,
    color: 0x475569
  };

  try {
    await enqueueDiscordWebhook(`${webhookUrl}/messages/${tracked.messageId}`, { embeds: [updatedEmbed] }, 'PATCH');
    console.log(`[DISCORD AUTO-EDIT] Marked ${tracked.ruleName} at ${tracked.retailer} as SOLD OUT (Lasted ${durationStr})`);
  } catch (e) {}
}

const DIGEST_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 14,400,000 ms (4 hours)
let memLastDigestSentAt = 0;
let memLastDigestHash = '';

function readDigestStateFromDisk(): { lastDigestSentAt: number; lastDigestHash: string; liveDigestEnabled: boolean } {
  const alertStatePath = path.resolve(process.cwd(), 'alertState.json');
  const settingsPath = path.resolve(process.cwd(), 'botSettings.json');
  let diskLastAt = 0;
  let diskHash = '';
  let liveDigestEnabled = false;

  try {
    if (fs.existsSync(alertStatePath)) {
      const a = JSON.parse(fs.readFileSync(alertStatePath, 'utf-8'));
      if (a && typeof a.__lastDigestSentAt === 'number') diskLastAt = Math.max(diskLastAt, a.__lastDigestSentAt);
      if (a && typeof a.__lastDigestHash === 'string') diskHash = a.__lastDigestHash;
    }
  } catch (e) {}

  try {
    const gs = loadGlobalSettings();
    if (typeof gs.liveDigestEnabled === 'boolean') liveDigestEnabled = gs.liveDigestEnabled;
    if (typeof gs.lastDigestSentAt === 'number') diskLastAt = Math.max(diskLastAt, gs.lastDigestSentAt);
    if (typeof gs.lastDigestHash === 'string' && !diskHash) diskHash = gs.lastDigestHash;
  } catch (e) {}

  return {
    lastDigestSentAt: Math.max(memLastDigestSentAt, diskLastAt),
    lastDigestHash: memLastDigestHash || diskHash,
    liveDigestEnabled
  };
}

function writeDigestStateToDisk(sentAt: number, digestHash: string): void {
  memLastDigestSentAt = sentAt;
  memLastDigestHash = digestHash;

  const alertStatePath = path.resolve(process.cwd(), 'alertState.json');
  const settingsPath = path.resolve(process.cwd(), 'botSettings.json');

  try {
    let a: Record<string, any> = {};
    if (fs.existsSync(alertStatePath)) {
      a = JSON.parse(fs.readFileSync(alertStatePath, 'utf-8')) || {};
    }
    a.__lastDigestSentAt = sentAt;
    a.__lastDigestHash = digestHash;
    atomicWriteJson(alertStatePath, a);
  } catch (e) {}

  try {
    let s: Record<string, any> = { muteVaulted: true, liveDigestEnabled: false };
    if (fs.existsSync(settingsPath)) {
      s = { ...s, ...(JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) || {}) };
    }
    s.lastDigestSentAt = sentAt;
    s.lastDigestHash = digestHash;
    atomicWriteJson(settingsPath, s);
  } catch (e) {}
}

export async function sendStockDigestCard(options?: { force?: boolean; windowLabel?: string }): Promise<{
  ok: boolean;
  sent: boolean;
  count: number;
  reason?: string;
  summary?: any;
}> {
  const digestState = readDigestStateFromDisk();

  if (!options?.force && !digestState.liveDigestEnabled) {
    return { ok: false, sent: false, count: 0, reason: 'Automatic Roundup Digest is disabled (liveDigestEnabled=false)' };
  }

  const nowMs = Date.now();
  if (!options?.force && digestState.lastDigestSentAt > 0 && (nowMs - digestState.lastDigestSentAt) < DIGEST_COOLDOWN_MS) {
    const minsRemaining = Math.ceil((DIGEST_COOLDOWN_MS - (nowMs - digestState.lastDigestSentAt)) / 60000);
    return { ok: false, sent: false, count: 0, reason: `Cooldown active (${minsRemaining}m remaining)` };
  }

  const nowDate = new Date();
  const liveStockPath = path.resolve(process.cwd(), 'liveStock.json');
  const storeOffersPath = path.resolve(process.cwd(), 'storeOffersCache.json');

  let liveMap: Record<string, any> = {};
  let offersMap: Record<string, Record<string, any>> = {};
  let policies: any[] = [];
  let cache: Record<string, any> = {};

  try { if (fs.existsSync(liveStockPath)) liveMap = JSON.parse(fs.readFileSync(liveStockPath, 'utf-8')) || {}; } catch {}
  try { if (fs.existsSync(storeOffersPath)) offersMap = JSON.parse(fs.readFileSync(storeOffersPath, 'utf-8')) || {}; } catch {}
  try { policies = loadMergedPoliciesRaw(); } catch {}
  try { if (fs.existsSync(TELEMETRY_PATH)) cache = JSON.parse(fs.readFileSync(TELEMETRY_PATH, 'utf-8')) || {}; } catch {}

  const policyMap = new Map<string, any>(policies.map(p => [p.id, p]));

  // Family Rule of 3 progress stats
  const etbPolicies = policies.filter(p => String(p.formFactor || '').toUpperCase() === 'ETB');
  const wallEtbsConquered = etbPolicies.filter(p => Boolean(p.wallOwned ?? p.owned)).length;
  const totalWallOwned = policies.filter(p => Boolean(p.wallOwned ?? p.owned)).length;
  const totalDadRipOwned = policies.filter(p => Boolean(p.dadRipOwned)).length;
  const totalLoganRipOwned = policies.filter(p => Boolean(p.loganRipOwned)).length;
  const total3of3Complete = policies.filter(p => Boolean(p.fullyConquered)).length;
  const totalRipHuntActive = policies.filter(p => (p.completionCount || 0) >= 1 && !p.fullyConquered).length;

  interface DigestOfferItem {
    skuId: string;
    name: string;
    store: string;
    price: number;
    landedPrice: number;
    marketValue: number;
    triggerPrice: number;
    spreadPct: number;
    url: string;
    cart1xUrl?: string;
    cart2xUrl?: string;
    cart3xUrl?: string;
    completionCount: number;
    fullyConquered: boolean;
    isUnderOrCushion: boolean;
    isBleedingDown: boolean;
    delta14dPct: number;
    autoPilotCeiling: number;
    badge?: string;
  }

  const candidateOffers: DigestOfferItem[] = [];

  for (const [skuId, skuStores] of Object.entries(offersMap)) {
    if (!skuStores || typeof skuStores !== 'object') continue;
    const pol = policyMap.get(skuId);
    if (!pol || pol.active === false) continue;
    const storeList = Object.values(skuStores).filter((o: any) => o && Number(o.price || o.landedPrice) > 0);
    if (storeList.length === 0) continue;
    storeList.sort((a: any, b: any) => Number(a.landedPrice || a.price) - Number(b.landedPrice || b.price));
    const best = storeList[0] as any;
    const price = Number(best.price || best.landedPrice);
    const landedPrice = Number(best.landedPrice || price);
    const mkt = Number(cache[skuId]?.rollingAverage || pol.estimatedMarketValue || best.marketValue || pol.msrpCeiling || price);
    const ap = computeAutoPilotTarget({
      skuId,
      msrpCeiling: Number(pol.msrpCeiling || 54.99),
      policyMaxBuy: Math.max(Number(pol.msrpCeiling || 0), Number(pol.maxMarketBuyPrice || 0)),
      marketBaseline: mkt,
      autoPilotEnabled: pol.autoPilotEnabled !== false,
      activeStoreCount: storeList.length,
      wallOwned: Boolean(pol.wallOwned ?? pol.owned),
      dadRipOwned: Boolean(pol.dadRipOwned),
      loganRipOwned: Boolean(pol.loganRipOwned),
      completionCount: Number(pol.completionCount || 0),
      fullyConquered: Boolean(pol.fullyConquered)
    });
    const effTrig = ap.effectiveTargetCeiling;
    const spreadPct = mkt > 0 ? Math.round(((mkt - landedPrice) / mkt) * 100) : 0;
    const grace = /box|case/i.test(pol.formFactor || '') ? 10 : 5;
    const isUnderOrCushion = price <= effTrig + grace || landedPrice <= effTrig + grace || best.statusTier === 'UNDER_TARGET' || best.statusTier === 'CLOSE_CALL';
    const cartLinks = buildShopifyDirectCartLinks({
      url: best.url,
      productUrl: best.productUrl,
      cart1xUrl: best.cart1xUrl,
      cart2xUrl: best.cart2xUrl,
      cart3xUrl: best.cart3xUrl,
      itemId: best.itemId,
      stock: best.stock,
      retailer: best.storeName
    });

    candidateOffers.push({
      skuId,
      name: pol.name || best.productName || skuId,
      store: best.storeName || 'Verified Store',
      price,
      landedPrice,
      marketValue: mkt,
      triggerPrice: effTrig,
      spreadPct,
      url: best.productUrl || best.url,
      cart1xUrl: cartLinks.cart1xUrl,
      cart2xUrl: cartLinks.cart2xUrl,
      cart3xUrl: cartLinks.cart3xUrl,
      completionCount: Number(pol.completionCount || (pol.owned ? 1 : 0)),
      fullyConquered: Boolean(pol.fullyConquered),
      isUnderOrCushion,
      isBleedingDown: ap.isBleedingDown,
      delta14dPct: -6,
      autoPilotCeiling: ap.autoPilotCeiling,
      badge: ap.autoPilotBadge || best.trendVerdictLabel
    });
  }

  const formatCartPills = (d: DigestOfferItem) => {
    const links: string[] = [];
    if (d.cart1xUrl) links.push(`[CART 1X](${d.cart1xUrl})`);
    if (d.cart2xUrl) links.push(`[CART 2X](${d.cart2xUrl})`);
    if (d.cart3xUrl) links.push(`[CART 3X](${d.cart3xUrl})`);
    if (links.length === 0 && d.url) links.push(`[VIEW ↗](${d.url})`);
    return links.join(' • ');
  };

  // (A) Top 5 Live Deals Under Target / In Cushion
  const liveUnderOrCushion = candidateOffers
    .filter(d => !d.fullyConquered && d.isUnderOrCushion && !d.isBleedingDown)
    .sort((a, b) => b.spreadPct - a.spreadPct)
    .slice(0, 5);

  // (B) Top 3 "Next Best Buy" Dip/Breakout Picks ($200–$500 budget range)
  const nextBestPicks = candidateOffers
    .filter(d => !d.fullyConquered && !d.isBleedingDown && d.landedPrice <= 500)
    .sort((a, b) => (Number(a.completionCount === 0) - Number(b.completionCount === 0)) * -10 + (b.spreadPct - a.spreadPct))
    .slice(0, 3);

  // (C) Bleeding Sets to Skip Today
  const bleedingSkipList = candidateOffers
    .filter(d => d.isBleedingDown)
    .slice(0, 4);

  const sectionALines = (liveUnderOrCushion.length > 0 ? liveUnderOrCushion : nextBestPicks).map(d => {
    const spreadTxt = d.spreadPct >= 0 ? `${d.spreadPct}% Under Mkt` : `${Math.abs(d.spreadPct)}% Over Mkt`;
    const isEtb = isSingleEtbFormat(undefined, d.skuId, d.name);
    const fmtTag = isEtb ? ` (\`${d.completionCount}/3\`)` : '';
    return `◈ **${d.name}**${fmtTag} — **$${d.price.toFixed(2)}** (${spreadTxt}) @ ${d.store} — ${formatCartPills(d)}`;
  });

  const sectionBLines = nextBestPicks.map((d, idx) => {
    const isEtb = isSingleEtbFormat(undefined, d.skuId, d.name);
    const slotTag = isEtb ? (d.completionCount === 0 ? '0/3 WALL ETB' : `${d.completionCount}/3 RIP HUNT`) : 'RIP / PACK FORMAT';
    return `**#${idx + 1}** **${d.name}** [\`${slotTag}\`] — **$${d.landedPrice.toFixed(2)} Landed** vs $${d.marketValue.toFixed(0)} Mkt • ${formatCartPills(d)}`;
  });

  const sectionCLines = bleedingSkipList.length > 0
    ? bleedingSkipList.map(d => `▼ **${d.name}** — Sitting @ $${d.price.toFixed(2)} (${d.store}) • **HOLD OFF** (Auto-Pilot Floor: **$${d.autoPilotCeiling.toFixed(0)}**)`)
    : ['◈ Zero tracked sets in active 14D freefall — shelves stable.'];

  const sectionDText =
    `◈ **ETB Display Wall:** \`${wallEtbsConquered} / ${etbPolicies.length || 38} Conquered\` (${totalWallOwned} Total Wall Boxes)\n` +
    `◈ **Rip Slots Checked:** \`Dad Rip: ${totalDadRipOwned}\` • \`Logan Rip: ${totalLoganRipOwned}\` • \`Rip Hunt Active: ${totalRipHuntActive}\`\n` +
    `◈ **3/3 Family Complete:** \`${total3of3Complete} SKUs Fully Conquered (Standard Alerts Muted)\``;

  const fields: any[] = [
    {
      name: `◈ ⟦ (A) TOP LIVE DEALS UNDER TARGET / IN CUSHION (${sectionALines.length}) ⟧`,
      value: (sectionALines.join('\n') || 'No active deals under target right now.').slice(0, 1020),
      inline: false
    },
    {
      name: `✦ ⟦ (B) TOP 3 "NEXT BEST BUY" DIP / BREAKOUT PICKS ($200–$500) ⟧`,
      value: (sectionBLines.join('\n') || 'Scanning live shelves for dip candidates...').slice(0, 1020),
      inline: false
    },
    {
      name: `▼ ⟦ (C) BLEEDING SETS TO SKIP TODAY (WAIT FOR FLOOR) ⟧`,
      value: sectionCLines.join('\n').slice(0, 1020),
      inline: false
    },
    {
      name: `❖ ⟦ (D) FAMILY "RULE OF 3" WALL + RIP PROGRESS ⟧`,
      value: sectionDText.slice(0, 1020),
      inline: false
    }
  ];

  const digestHash = [...liveUnderOrCushion, ...nextBestPicks]
    .map(d => `${d.skuId}:${d.store}:${d.price.toFixed(2)}`)
    .join('|') || `roundup-${nowDate.toISOString().slice(0, 13)}`;

  const windowTag = options?.windowLabel || (options?.force ? 'ON-DEMAND COMMAND BRIEFING' : 'SCHEDULED TWICE-DAILY BRIEFING');
  const embed = {
    title: `◈ ⟦ DROPBOT MARKET & DEAL ROUNDUP DIGEST // ${windowTag} ⟧`,
    description: `Autonomous 90-Store LGS + Big-Box + TCGPlayer Capital Briefing • **1-Click Shopify Cart Links Armed**`,
    color: 0x8b5cf6,
    fields,
    footer: {
      text: `DropBot v5.6 Roundup • Auto-Fires 09:00 & 18:00 Local • ${nowDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    },
    timestamp: nowDate.toISOString()
  };

  writeDigestStateToDisk(Date.now(), digestHash);

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  let discordDispatched = false;
  if (webhookUrl) {
    try {
      await enqueueDiscordWebhook(webhookUrl, { embeds: [embed] }, 'POST');
      discordDispatched = true;
      console.log(`[ROUNDUP DIGEST SENT] Pushed DropBot Market & Deal Roundup (${windowTag}) to Discord.`);
    } catch (err: any) {
      console.error(`[DIGEST WARNING] Webhook dispatch error: ${err.message}`);
    }
  }

  return {
    ok: true,
    sent: true,
    count: sectionALines.length,
    summary: {
      windowTag,
      discordDispatched,
      topDealsCount: sectionALines.length,
      nextBestPicksCount: sectionBLines.length,
      bleedingSkipCount: bleedingSkipList.length,
      familyProgress: {
        wallEtbsConquered,
        totalEtbSets: etbPolicies.length || 38,
        totalWallOwned,
        totalDadRipOwned,
        totalLoganRipOwned,
        total3of3Complete,
        totalRipHuntActive
      }
    }
  };
}

let lastScheduledRoundupSlot = '';

export function startStockDigestScheduler(): void {
  // Twice-Daily Roundup Digest Scheduler (09:00 and 18:00 local time)
  setInterval(() => {
    try {
      const now = new Date();
      const hour = now.getHours();
      const min = now.getMinutes();
      if ((hour === 9 || hour === 18) && min <= 4) {
        const slotKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}-${hour}`;
        if (lastScheduledRoundupSlot !== slotKey) {
          lastScheduledRoundupSlot = slotKey;
          const label = hour === 9 ? '09:00 MORNING ROUNDUP' : '18:00 EVENING ROUNDUP';
          sendStockDigestCard({ force: false, windowLabel: label }).catch(() => {});
        }
      }
    } catch {}
  }, 60 * 1000);
}
