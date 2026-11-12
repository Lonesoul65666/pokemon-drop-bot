import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getDualMarketComps } from './marketComps';
import { markLiveStockOut, buildShopifyDirectCartLinks, buildMobileRetailerLinks, computeAutoPilotTarget } from './evaluator';
import { atomicWriteJson, computeRipMetrics, isSingleCardOrNonSealed } from './policies';
import { getFlashClearEscalation } from './marketTape';
import { loadGlobalSettings, loadMergedPoliciesRaw } from './src/config/configManager';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const DISCORD_MIN_INTERVAL_MS = 1250;
interface DiscordQueueJob {
  method: 'POST' | 'PATCH';
  url: string;
  payload: any;
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
        const res = job.method === 'POST'
          ? await axios.post(job.url, job.payload, { timeout: 10000 })
          : await axios.patch(job.url, job.payload, { timeout: 10000 });
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

export function enqueueDiscordWebhook(url: string, payload: any, method: 'POST' | 'PATCH' = 'POST', priorityFront = false): Promise<any> {
  return new Promise((resolve, reject) => {
    const job: DiscordQueueJob = { method, url, payload, resolve, reject, retries: 0 };
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
  retailer: string;
  url: string;
  productUrl?: string;
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
  const targetUrl = 'https://www.pokemoncenter.com';
  const banner = '◈ ⟦ POKÉMON CENTER WAITING ROOM LIVE — JOIN QUEUE NOW ⟧';

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
  const embed = {
    title: banner,
    description:
      `**Queue-It Virtual Waiting Room detected on Pokémon Center!**\n` +
      `Open the homepage immediately on mobile + desktop to secure your queue position before sealed TCG allocations drop.\n\n` +
      `[**⟦ ⚡ ENTER POKÉMON CENTER QUEUE NOW ↗ ⟧**](${targetUrl})`,
    url: targetUrl,
    color: 0x00F0FF,
    fields: [
      { name: '◈ TARGET URL', value: targetUrl, inline: true },
      { name: '◆ COOLDOWN', value: '30m Queue Dedup Active', inline: true }
    ],
    footer: { text: 'DropBot Commander v6.0 • Honest Queue-It Radar (Zero Fake SKU Stub)' },
    timestamp: new Date().toISOString()
  };

  await Promise.all([
    webhookUrl
      ? enqueueDiscordWebhook(`${webhookUrl}?wait=true`, { content: `@everyone ${banner} — ${targetUrl}`, embeds: [embed] }, 'POST', true)
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
    ? 'ONLINE DRAWING WINDOW LIVE'
    : (params.windowKind === 'INVITE' ? 'INVITE REQUEST WINDOW LIVE' : 'VIRTUAL QUEUE WINDOW LIVE');
  const banner = `◈ ⟦ ${params.retailer.toUpperCase()} // ${kindTag} ⟧`;
  const displayTitle = params.ruleName || params.headline;

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
  const embed = {
    title: banner,
    description:
      `**${displayTitle}**\n` +
      `◈ **Event Type:** \`${kindTag}\` (Not Instant-Add-to-Cart — enter registration/queue window)\n` +
      `◈ **Wire Source:** ${params.sourceLabel || 'Public Restock Wire'}\n\n` +
      `[**⟦ ⚡ OPEN ${params.retailer.toUpperCase()} ${params.windowKind} PAGE ↗ ⟧**](${params.url})`,
    url: params.url,
    color: 0x38bdf8,
    footer: { text: 'DropBot v6.0 Restock Wire • Queue / Invite / Online Drawing Classifier' },
    timestamp: new Date().toISOString()
  };

  await Promise.all([
    webhookUrl
      ? enqueueDiscordWebhook(`${webhookUrl}?wait=true`, { embeds: [embed] }, 'POST', true)
      : Promise.resolve(null),
    sendTelegramAlertFast(`<b>${banner}</b>\n${displayTitle}\n<a href="${params.url}">⚡ OPEN ${params.windowKind} WINDOW ↗</a>`)
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

  const priceVal = drop.priceNum ?? parseFloat(drop.price || '0');
  const msrpVal = drop.msrp ?? 0;
  const fallbackMkt = drop.marketValue ?? 0;

  // 0ms FIRE-THEN-ENRICH: Resolve initial baseline/cached market floor synchronously from RAM (0ms network block!)
  const telEntry = drop.ruleId ? getTelemetryCacheFast()[drop.ruleId] : undefined;
  const cachedLowest = Number(telEntry?.lowestPrice || 0);
  const bestMarketRef = fallbackMkt > 0
    ? fallbackMkt
    : (cachedLowest > 0 ? cachedLowest : msrpVal);
  const effectiveComparePrice = drop.freeShipNote ? priceVal : (drop.landedPrice ?? priceVal);
  const discount = bestMarketRef > 0 ? Math.round(((bestMarketRef - effectiveComparePrice) / bestMarketRef) * 100) : 0;
  const savings = Math.max(0, bestMarketRef - effectiveComparePrice);

  // Format MSRP comparison with tactical typography
  let msrpComparison = 'N/A';
  if (msrpVal > 0) {
    const msrpDiffPct = Math.round(((priceVal - msrpVal) / msrpVal) * 100);
    if (msrpDiffPct <= 0) {
      msrpComparison = `**$${msrpVal.toFixed(2)}** (${msrpDiffPct === 0 ? '✦ Exact MSRP' : `${Math.abs(msrpDiffPct)}% BELOW MSRP!`})`;
    } else {
      msrpComparison = `**$${msrpVal.toFixed(2)}** (${msrpDiffPct}% above MSRP)`;
    }
  }

  const qTcg = encodeURIComponent(drop.ruleName || drop.title);
  const qEbay = encodeURIComponent('Pokemon ' + (drop.ruleName || drop.title) + ' Sealed');
  const initialMarketLines: string[] = [];
  if (cachedLowest > 0 && telEntry?.lowestUrl) {
    initialMarketLines.push(`**$${cachedLowest.toFixed(2)}** (Cached Floor • *Live Comp Syncing...*) [Verified Comp ↗](${telEntry.lowestUrl})`);
  } else {
    initialMarketLines.push(`**$${bestMarketRef.toFixed(2)}** (Market Baseline • *Live Comp Syncing...*) [Search TCGPlayer ↗](https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${qTcg}&view=grid)`);
  }
  initialMarketLines.push(`*Live BIN Check* [View Lowest on eBay ↗](https://www.ebay.com/sch/i.html?_nkw=${qEbay}&LH_BIN=1&_sop=15)`);
  const marketBlock = initialMarketLines.join('\n');

  const flashEscalation = getFlashClearEscalation(drop.ruleId, priceVal);

  const landedOrPrice = drop.landedPrice ?? priceVal;
  const isTierAMsrpHit = Boolean(
    drop.bigBoxTier === 'MSRP_TIER_A' ||
    drop.isMsrpUnicorn ||
    (msrpVal > 0 && landedOrPrice <= Math.round(msrpVal * 1.08 * 100) / 100 && (drop.estimatedShipping ?? 0) <= 6.99)
  );

  // Format-driven tactical prefix & color
  const ffLower = String(drop.formFactor || '').toLowerCase();
  const combinedLabel = `${drop.ruleId || ''} ${drop.formFactor || ''} ${drop.ruleName || ''} ${drop.title || ''}`.toLowerCase();

  let tacticalFormatCallsign = '◈ ⟦ WALL ETB // SINGLE ⟧';
  let embedColor = 0x10b981; // Emerald/Cyan default for Wall ETB

  if (ffLower.includes('etb case') || combinedLabel.includes('etb-case') || (combinedLabel.includes('etb') && combinedLabel.includes('case'))) {
    tacticalFormatCallsign = '❖ ⟦ MASTER CASE // 10x ETB ⟧';
    embedColor = 0xf59e0b; // Gold
  } else if (ffLower.includes('master case') || ffLower.includes('booster case') || combinedLabel.includes('booster-case') || combinedLabel.includes('case')) {
    tacticalFormatCallsign = '❖ ⟦ BOOSTER CASE // 6x BOX ⟧';
    embedColor = 0xf59e0b; // Gold
  } else if (ffLower.includes('booster box') || combinedLabel.includes('booster-box') || combinedLabel.includes('booster box')) {
    tacticalFormatCallsign = '▲ ⟦ BOOSTER BOX // 36-PACK ⟧';
    embedColor = 0xa855f7; // Violet
  } else if (ffLower.includes('bundle') || combinedLabel.includes('bundle')) {
    tacticalFormatCallsign = '◆ ⟦ BOOSTER BUNDLE // 6-PACK ⟧';
    embedColor = 0x3b82f6; // Electric Blue
  }

  let tierBadge = `${tacticalFormatCallsign} • UNDER TRIGGER`;

  if (drop.bigBoxTier === 'BIG_BOX_RESTOCK_RADAR' && drop.bigBoxBadge) {
    tierBadge = `✦ ⟦ BIG-BOX RESTOCK RADAR // MSRP ASSUMED ⟧`;
    embedColor = 0x00F0FF;
  } else if (isTierAMsrpHit) {
    tierBadge = `✦ ⟦ MSRP OVERRIDE // RETAIL HIT ⟧ • ${tacticalFormatCallsign}`;
    embedColor = 0xe11d48;
  } else if (drop.bigBoxTier === 'PC_EXCLUSIVE_MSRP' && drop.bigBoxBadge) {
    tierBadge = `✦ ⟦ POKEMON CENTER // $59.99 EXCLUSIVE MSRP ⟧`;
    embedColor = 0x00F0FF;
  } else if (flashEscalation.isHighVelocityRepeat && flashEscalation.badgeText) {
    tierBadge = `${tacticalFormatCallsign} • HIGH-VELOCITY REPEAT`;
    embedColor = 0xe11d48;
  } else if (drop.isElasticDip) {
    tierBadge = `${tacticalFormatCallsign} • 60D ELASTIC DIP OPPORTUNITY`;
    embedColor = 0x10b981;
  } else if (drop.isPreRelease && drop.preReleaseStatusTag) {
    tierBadge = drop.preReleaseStatusTag.includes('SOLID PRE-LAUNCH GRAB')
      ? `${tacticalFormatCallsign} • SOLID PRE-LAUNCH GRAB`
      : `${tacticalFormatCallsign} • PRE-RELEASE ALLOCATION`;
    embedColor = drop.preReleaseStatusTag.includes('SOLID PRE-LAUNCH GRAB') ? 0x10b981 : 0x8b5cf6;
  } else if (drop.isPreOrder) {
    tierBadge = `${tacticalFormatCallsign} • PRE-ORDER ALLOCATION`;
    embedColor = 0x8b5cf6;
  } else if (msrpVal > 0 && priceVal <= msrpVal * 1.05) {
    tierBadge = `✦ ⟦ AT OR NEAR MSRP // INSTANT COP ⟧ • ${tacticalFormatCallsign}`;
    embedColor = 0x10b981;
  } else if (discount >= 22 || savings >= 60) {
    tierBadge = `${tacticalFormatCallsign} • HEAVY ALPHA (${discount}% UNDER MARKET • SAVE $${savings.toFixed(0)})`;
  }

  let headerPrefix = isTierAMsrpHit
    ? '✦ ⟦ MSRP OVERRIDE // RETAIL HIT ⟧'
    : (drop.bigBoxTier === 'PC_EXCLUSIVE_MSRP'
        ? '✦ ⟦ PC EXCLUSIVE MSRP ⟧'
        : tacticalFormatCallsign);
  let signalLine = drop.isPreOrder ? 'Pre-order allocation live (Slider target active)' : 'Fresh restock detected';

  if (drop.alertType === 'PRICE_DROP' && drop.previousPrice) {
    const cut = (drop.previousPrice - priceVal).toFixed(2);
    if (!isTierAMsrpHit) {
      headerPrefix = `${tacticalFormatCallsign} // PRICE DROP (-$${cut})`;
    }
    signalLine = `Slashed from $${drop.previousPrice.toFixed(2)} (seen at ${drop.previousTimeStr})`;
  } else if (drop.alertType === 'RESTOCK_REPEAT' && drop.previousPrice) {
    if (!isTierAMsrpHit) {
      headerPrefix = `${tacticalFormatCallsign} // RESTOCKED`;
    }
    signalLine = `Previously seen at $${drop.previousPrice.toFixed(2)} (${drop.previousTimeStr})`;
  }

  if (drop.trendVerdictLabel) {
    signalLine += `\n**${drop.trendVerdictLabel}**`;
  } else if (drop.isPreRelease && drop.preReleaseStatusTag) {
    signalLine += `\n**${drop.preReleaseStatusTag}**`;
  }

  if (flashEscalation.isHighVelocityRepeat && flashEscalation.badgeText) {
    signalLine += `\n${flashEscalation.badgeText}`;
  }

  if (drop.freeShipNote) {
    signalLine += `\n◈ **${drop.freeShipNote}**`;
  }

  if (drop.marketplaceWarning) {
    signalLine += `\n**${drop.marketplaceWarning}**`;
  }

  const vaultBadge = drop.ownedInVault
    ? (isTierAMsrpHit ? '✦ ⟦ DEFCON-1 OVERRIDE // IN VAULT MSRP RIP ⟧' : '❖ ⟦ IN VAULT // PASSING TO CREW ⟧')
    : '◈ ⟦ NEEDED FOR WALL // ACTIVE TARGET ⟧';

  const stockDisplay = typeof drop.stock === 'number' && drop.stock > 0
    ? `${drop.stock} Units Loaded`
    : 'In Stock (Qty Hidden)';

  const shipNote = getRetailerShippingNote(
    drop.retailer,
    priceVal,
    drop.estimatedShipping,
    drop.itemPrice,
    drop.shippingPrice,
    drop.freeShipNote
  );
  const landedLine = drop.landedPrice && drop.landedPrice > priceVal
    ? `\n◈ Landed (1x): **$${drop.landedPrice.toFixed(2)}**${drop.freeShipNote ? ` • *${drop.freeShipNote}*` : ''}`
    : '';

  const knownStock = typeof drop.stock === 'number' && drop.stock > 0 ? drop.stock : undefined;
  const directCart = buildShopifyDirectCartLinks({
    url: drop.url,
    productUrl: drop.productUrl,
    cart1xUrl: drop.cart1xUrl,
    cart2xUrl: drop.cart2xUrl,
    cart3xUrl: drop.cart3xUrl,
    itemId: drop.itemId,
    stock: knownStock,
    retailer: drop.retailer
  });
  const c1 = directCart.cart1xUrl;
  const c2 = directCart.cart2xUrl;
  const c3 = directCart.cart3xUrl;
  const isShopifyCart = Boolean(c1 && c1.includes('/cart/'));
  const prodPageUrl = drop.productUrl || (drop.url.includes('/cart/') ? drop.url.split('/cart/')[0] : drop.url);
  const mobileRetailer = buildMobileRetailerLinks({
    retailer: drop.retailer,
    url: drop.url,
    productUrl: prodPageUrl,
    itemId: drop.itemId
  });

  let actionLinks: string;
  let primaryFastUrl = prodPageUrl;
  if (isShopifyCart && c1) {
    primaryFastUrl = c1;
    const segments = [`[**⟦ ⚡ SHOP PAY 1X ↗ ⟧**](${c1})`];
    if (c2) segments.push(`[**⟦ ⚡ 2X ↗ ⟧**](${c2})`);
    if (c3) segments.push(`[**⟦ ⚡ 3X ↗ ⟧**](${c3})`);
    segments.push(`[Product Page ↗](${prodPageUrl})`);
    actionLinks = segments.join('   •   ');
  } else if (mobileRetailer.mobileActionMarkdown) {
    primaryFastUrl = mobileRetailer.primaryCheckoutUrl || drop.url;
    actionLinks = mobileRetailer.mobileActionMarkdown;
  } else {
    primaryFastUrl = drop.url;
    actionLinks = `[**⟦ VIEW & CHECKOUT ON ${drop.retailer.toUpperCase()} ↗ ⟧**](${drop.url})`;
  }

  const thumbUrl = getThumbnailUrl(drop.ruleId);

  const embed: any = {
    title: `${headerPrefix} — ${drop.ruleName || drop.title}`,
    description: `**${tierBadge}**\n*${signalLine}*`,
    url: primaryFastUrl,
    color: embedColor,
    fields: [
      { name: '◈ DROP PRICE', value: `**$${priceVal.toFixed(2)}** (${shipNote})${landedLine}\n**${drop.retailer}**`, inline: true },
      { name: '◆ RETAIL MSRP', value: `${msrpComparison}\n${stockDisplay}`, inline: true },
      { name: '▲ LIVE MARKET COMPS (LOWEST + SHIP)', value: marketBlock, inline: false },
      { name: '❖ VAULT STATUS', value: vaultBadge, inline: true },
      { name: '✦ SPREAD GAIN', value: discount > 0 ? `**${discount}% Below Market** (~$${savings.toFixed(0)} edge)` : 'At Target', inline: true },
      { name: '◈ DIRECT CHECKOUT', value: actionLinks, inline: false }
    ],
    footer: { text: 'DropBot Commander v6.0 • 0ms Fire-Then-Enrich • Tactical OOS Tracker Active' },
    timestamp: new Date().toISOString()
  };

  if (thumbUrl) {
    embed.thumbnail = { url: thumbUrl };
  }

  const webhookPayload: any = { embeds: [embed] };
  if (isTierAMsrpHit) {
    webhookPayload.content = `@everyone ✦ ⟦ **MSRP OVERRIDE // RETAIL HIT** ⟧ — **${drop.ruleName || drop.title}** at **$${priceVal.toFixed(2)}** on **${drop.retailer}**!`;
  }

  const tgBaseHtml =
    `<b>${drop.ruleName || drop.title}</b>\n` +
    `<b>$${priceVal.toFixed(2)}</b> at <b>${drop.retailer}</b> (${shipNote})\n` +
    `MSRP: $${msrpVal.toFixed(2)} • Mkt: ~$${bestMarketRef.toFixed(2)}\n` +
    `<a href="${primaryFastUrl}">⚡ 1-TAP CHECKOUT ↗</a>` +
    (c2 ? `  |  <a href="${c2}">⚡ 2X ↗</a>` : '') +
    (c3 ? `  |  <a href="${c3}">⚡ 3X ↗</a>` : '');

  try {
    // 1. Fire Discord & optional Telegram immediately (priorityFront = true on all BUY alerts!)
    const [discordSettled, tgSettled] = await Promise.allSettled([
      webhookUrl
        ? enqueueDiscordWebhook(`${webhookUrl}?wait=true`, webhookPayload, 'POST', true)
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

    recordDropHistory(drop);
    const sentMsgId: string | undefined = discordData?.id;
    if (sentMsgId && drop.itemId) {
      activeDiscordMessages.set(String(drop.itemId), {
        messageId: sentMsgId,
        embed,
        sentAt: Date.now(),
        ruleName: drop.ruleName || drop.title,
        retailer: drop.retailer
      });
    }
    console.log(`[DISCORD SENT 0ms] [${drop.alertType || 'NEW'}] ${drop.title} ($${priceVal.toFixed(2)} at ${drop.retailer})`);

    // 2. Detached Asynchronous Enrichment: Fetch live TCGPlayer + eBay comps and PATCH message if live comps improve accuracy
    if (sentMsgId || tgMsgId) {
      void (async () => {
        try {
          const comps = await getDualMarketComps(drop.ruleId, drop.ruleName || drop.title, bestMarketRef);
          const hasLiveTcg = Boolean(comps.tcgplayer?.isLiveVerified && comps.tcgplayer.price > 0);
          const hasLiveEbay = Boolean(comps.ebay?.isLiveVerified && comps.ebay.price > 0);
          if (!hasLiveTcg && !hasLiveEbay) return;

          // Abort PATCH if item already sold out while scraping comps so we never overwrite a SOLD OUT strikethrough!
          if (drop.itemId && sentMsgId && !activeDiscordMessages.has(String(drop.itemId))) {
            return;
          }

          const liveMktRef = hasLiveTcg ? comps.tcgplayer!.price : bestMarketRef;
          const liveDiscount = liveMktRef > 0 ? Math.round(((liveMktRef - effectiveComparePrice) / liveMktRef) * 100) : discount;
          const liveSavings = Math.max(0, liveMktRef - effectiveComparePrice);

          const liveLines: string[] = [];
          if (hasLiveTcg && comps.tcgplayer) {
            liveLines.push(`**$${comps.tcgplayer.price.toFixed(2)}** ${comps.tcgplayer.shippingLabel} [TCGPlayer Product ↗](${comps.tcgplayer.url})`);
          } else {
            liveLines.push(initialMarketLines[0].replace(' • *Live Comp Syncing...*', ''));
          }
          if (hasLiveEbay && comps.ebay) {
            liveLines.push(`**$${comps.ebay.price.toFixed(2)}** ${comps.ebay.shippingLabel} [eBay Direct Item ↗](${comps.ebay.url})`);
          } else {
            liveLines.push(`*Live BIN Check* [View Lowest on eBay ↗](https://www.ebay.com/sch/i.html?_nkw=${qEbay}&LH_BIN=1&_sop=15)`);
          }

          if (sentMsgId && webhookUrl) {
            const targetEmbed = (drop.itemId && activeDiscordMessages.get(String(drop.itemId))?.embed) || embed;
            if (Array.isArray(targetEmbed.fields)) {
              const mktField = targetEmbed.fields.find((f: any) => String(f.name).includes('LIVE MARKET COMPS'));
              if (mktField) mktField.value = liveLines.join('\n');
              const spreadField = targetEmbed.fields.find((f: any) => String(f.name).includes('SPREAD GAIN'));
              if (spreadField) {
                spreadField.value = liveDiscount > 0
                  ? `**${liveDiscount}% Below Market** (~$${liveSavings.toFixed(0)} edge)`
                  : 'At Target';
              }
            }
            // Low priority (priorityFront = false) so enrichment PATCH never delays a new BUY alert!
            await enqueueDiscordWebhook(`${webhookUrl}/messages/${sentMsgId}`, { embeds: [targetEmbed] }, 'PATCH', false);
          }

          if (tgMsgId) {
            const tgEnriched =
              `<b>${drop.ruleName || drop.title}</b>\n` +
              `<b>$${priceVal.toFixed(2)}</b> at <b>${drop.retailer}</b> (${shipNote})\n` +
              `MSRP: $${msrpVal.toFixed(2)} • Live Mkt: <b>$${liveMktRef.toFixed(2)}</b> (${liveDiscount > 0 ? `-${liveDiscount}%` : 'At Target'})\n` +
              `<a href="${primaryFastUrl}">⚡ 1-TAP CHECKOUT ↗</a>` +
              (c2 ? `  |  <a href="${c2}">⚡ 2X ↗</a>` : '') +
              (c3 ? `  |  <a href="${c3}">⚡ 3X ↗</a>` : '');
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
    title: `⟦ SOLD OUT // OOS ⟧ — ${tracked.ruleName}`,
    description: `**Restock Depleted.** This allocation on **${tracked.retailer}** lasted **${durationStr}** and is now Out of Stock.`,
    color: 0x475569 // Slate Gray for Sold Out
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
    return `◈ **${d.name}** (\`${d.completionCount}/3\`) — **$${d.price.toFixed(2)}** (${spreadTxt}) @ ${d.store} — ${formatCartPills(d)}`;
  });

  const sectionBLines = nextBestPicks.map((d, idx) => {
    const slotTag = d.completionCount === 0 ? '0/3 NEED WALL' : `${d.completionCount}/3 RIP HUNT`;
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
