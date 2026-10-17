import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getDualMarketComps } from './marketComps';
import { markLiveStockOut } from './evaluator';
import { atomicWriteJson } from './policies';
import { getFlashClearEscalation } from './marketTape';

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
        job.resolve(res.data);
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 429 && job.retries < 4) {
          job.retries += 1;
          const retryAfterRaw = err?.response?.data?.retry_after ?? err?.response?.headers?.['retry-after'] ?? 2;
          const retryMs = Math.ceil(Number(retryAfterRaw) * (Number(retryAfterRaw) < 50 ? 1000 : 1)) + 250;
          console.warn(`[DISCORD QUEUE] HTTP 429 Rate Limit hit. Backing off for ${retryMs}ms (Retry ${job.retries}/4)...`);
          await sleepMs(retryMs);
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
  price?: string;
  priceNum?: number;
  landedPrice?: number;
  estimatedShipping?: number;
  freeShipNote?: string;
  isPreOrder?: boolean;
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
  alertType?: 'NEW_DROP' | 'PRICE_DROP' | 'RESTOCK_REPEAT';
  previousPrice?: number;
  previousTimeStr?: string;
  bigBoxTier?: string;
  bigBoxBadge?: string;
  marketplaceWarning?: string;
  priorityFront?: boolean;
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

function getRetailerShippingNote(retailer: string, price: number, estimatedShipping?: number): string {
  if (estimatedShipping === 0 || price >= 150) return '+FREE Shipping';
  const r = retailer.toLowerCase();
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

function recordDropHistory(drop: DropPayload) {
  try {
    let history: any[] = [];
    if (fs.existsSync(DROPS_HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(DROPS_HISTORY_PATH, 'utf-8'));
    }
    history.unshift({
      timestamp: Date.now(),
      timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      title: drop.ruleName || drop.title,
      rawTitle: drop.title,
      retailer: drop.retailer,
      price: drop.priceNum || parseFloat(drop.price || '0'),
      landedPrice: drop.landedPrice,
      freeShipNote: drop.freeShipNote,
      isPreOrder: Boolean(drop.isPreOrder),
      bigBoxTier: drop.bigBoxTier,
      bigBoxBadge: drop.bigBoxBadge,
      marketplaceWarning: drop.marketplaceWarning,
      marketValue: drop.marketValue || 0,
      discountPct: drop.discountPct || 0,
      url: drop.url,
      productUrl: drop.productUrl,
      cart1xUrl: drop.cart1xUrl,
      cart2xUrl: drop.cart2xUrl,
      formFactor: drop.formFactor || 'Sealed',
      ruleId: drop.ruleId || '',
      alertType: drop.alertType || 'NEW_DROP',
      soldOut: false
    });
    if (history.length > 25) history = history.slice(0, 25);
    atomicWriteJson(DROPS_HISTORY_PATH, history);
  } catch (e) {}
}

function getThumbnailUrl(ruleId?: string): string | undefined {
  if (!ruleId) return undefined;
  try {
    if (fs.existsSync(TELEMETRY_PATH)) {
      const cache = JSON.parse(fs.readFileSync(TELEMETRY_PATH, 'utf-8'));
      const entry = cache[ruleId] || cache[ruleId.replace(/-case$/, '')] || cache[ruleId.replace(/-booster-case$/, '-booster-box')];
      if (entry && entry.lowestUrl && entry.lowestUrl.includes('tcgplayer.com/product/')) {
        const match = entry.lowestUrl.match(/product\/(\d+)/);
        if (match) return `https://product-images.tcgplayer.com/fit-in/437x437/${match[1]}.jpg`;
      }
    }
  } catch (e) {}
  return undefined;
}

export async function sendAlert(drop: DropPayload): Promise<void> {
  recordDropHistory(drop);

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('[NOTIFIER] No DISCORD_WEBHOOK_URL found in .env');
    return;
  }

  const priceVal = drop.priceNum ?? parseFloat(drop.price || '0');
  const msrpVal = drop.msrp ?? 0;
  const fallbackMkt = drop.marketValue ?? 0;

  // Fetch live TCGPlayer + eBay Buy-It-Now comps with shipping breakdown!
  const comps = await getDualMarketComps(drop.ruleId, drop.ruleName || drop.title, fallbackMkt);
  const bestMarketRef = comps.tcgplayer?.price || fallbackMkt;
  const effectiveComparePrice = drop.freeShipNote ? priceVal : (drop.landedPrice ?? priceVal);
  const discount = bestMarketRef > 0 ? Math.round(((bestMarketRef - effectiveComparePrice) / bestMarketRef) * 100) : 0;
  const savings = Math.max(0, bestMarketRef - effectiveComparePrice);

  // Format MSRP comparison exactly like TrackaLacker ("$49.99 (40% above)" or "$49.99 (AT MSRP!)")
  let msrpComparison = 'N/A';
  if (msrpVal > 0) {
    const msrpDiffPct = Math.round(((priceVal - msrpVal) / msrpVal) * 100);
    if (msrpDiffPct <= 0) {
      msrpComparison = `**$${msrpVal.toFixed(2)}** (${msrpDiffPct === 0 ? '🎯 Exact MSRP' : `${Math.abs(msrpDiffPct)}% BELOW MSRP!`})`;
    } else {
      msrpComparison = `**$${msrpVal.toFixed(2)}** (${msrpDiffPct}% above MSRP)`;
    }
  }

  // Format 100% Verified Dual Market Block (Direct Product & Item URLs!)
  const marketLines: string[] = [];
  if (comps.tcgplayer && comps.tcgplayer.isLiveVerified && comps.tcgplayer.price > 0) {
    marketLines.push(`**${comps.tcgplayer.price.toFixed(2)}** ${comps.tcgplayer.shippingLabel} [TCGPlayer Product ↗](${comps.tcgplayer.url})`);
  } else {
    const q = encodeURIComponent(drop.ruleName || drop.title);
    marketLines.push(`**${bestMarketRef.toFixed(2)}** (Baseline) [Search TCGPlayer ↗](https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${q}&view=grid)`);
  }

  if (comps.ebay && comps.ebay.isLiveVerified && comps.ebay.price > 0) {
    marketLines.push(`**${comps.ebay.price.toFixed(2)}** ${comps.ebay.shippingLabel} [eBay Direct Item ↗](${comps.ebay.url})`);
  } else {
    const q = encodeURIComponent('Pokemon ' + (drop.ruleName || drop.title) + ' Sealed');
    marketLines.push(`*Live BIN Check* [View Lowest on eBay ↗](https://www.ebay.com/sch/i.html?_nkw=${q}&LH_BIN=1&_sop=15)`);
  }
  const marketBlock = marketLines.join('\n');

  const flashEscalation = getFlashClearEscalation(drop.ruleId, priceVal);

  let tierBadge = '🟡 SOLID DEAL — UNDER TARGET';
  let embedColor = 0xf59e0b;

  if (drop.bigBoxTier === 'PC_EXCLUSIVE_MSRP' && drop.bigBoxBadge) {
    tierBadge = drop.bigBoxBadge;
    embedColor = 0x38bdf8;
  } else if (drop.bigBoxTier === 'MSRP_TIER_A' && drop.bigBoxBadge) {
    tierBadge = drop.bigBoxBadge;
    embedColor = 0x10b981;
  } else if (flashEscalation.isHighVelocityRepeat && flashEscalation.badgeText) {
    tierBadge = flashEscalation.badgeText;
    embedColor = 0xe11d48;
  } else if (drop.isPreOrder) {
    tierBadge = '⏳ PRE-ORDER — AT OR NEAR MSRP CEILING';
    embedColor = 0x8b5cf6;
  } else if (msrpVal > 0 && priceVal <= msrpVal * 1.05) {
    tierBadge = '🟢 AT OR NEAR MSRP — INSTANT COP';
    embedColor = 0x10b981;
  } else if (discount >= 22 || savings >= 60) {
    tierBadge = `🔴 HEAVY ALPHA — ${discount}% UNDER MARKET (Save $${savings.toFixed(0)})`;
    embedColor = 0xe60012;
  }

  let headerPrefix = drop.bigBoxTier === 'PC_EXCLUSIVE_MSRP'
    ? '💎 PC EXCLUSIVE MSRP:'
    : (drop.bigBoxTier === 'MSRP_TIER_A'
        ? '🎯 RETAIL MSRP DROP:'
        : (drop.isPreOrder ? '⏳ PRE-ORDER:' : (flashEscalation.isHighVelocityRepeat ? '⚡ FLASH REPEAT:' : '🚨 IN STOCK:')));
  let signalLine = drop.isPreOrder ? 'Pre-order allocation live (Strict MSRP+5% cap enforced)' : 'Fresh restock detected';

  if (drop.alertType === 'PRICE_DROP' && drop.previousPrice) {
    const cut = (drop.previousPrice - priceVal).toFixed(2);
    headerPrefix = `📉 PRICE DROP (-$${cut}):`;
    signalLine = `Slashed from $${drop.previousPrice.toFixed(2)} (seen at ${drop.previousTimeStr})`;
    embedColor = 0x06b6d4;
  } else if (drop.alertType === 'RESTOCK_REPEAT' && drop.previousPrice) {
    headerPrefix = drop.isPreOrder ? '⏳ PRE-ORDER RESTOCK:' : '🔄 RESTOCKED:';
    signalLine = `Previously seen at $${drop.previousPrice.toFixed(2)} (${drop.previousTimeStr})`;
  }

  if (flashEscalation.isHighVelocityRepeat && flashEscalation.badgeText) {
    signalLine += `\n${flashEscalation.badgeText}`;
  }

  if (drop.freeShipNote) {
    signalLine += `\n📦 **${drop.freeShipNote}**`;
  }

  if (drop.marketplaceWarning) {
    signalLine += `\n**${drop.marketplaceWarning}**`;
  }

  const vaultBadge = drop.ownedInVault
    ? '🟣 In Vault (Passing to Crew)'
    : '🎯 Needed for Vault';

  const stockDisplay = typeof drop.stock === 'number' && drop.stock > 0
    ? `${drop.stock} Units Loaded`
    : 'In Stock (Qty Hidden)';

  const shipNote = getRetailerShippingNote(drop.retailer, priceVal, drop.estimatedShipping);
  const landedLine = drop.landedPrice && drop.landedPrice > priceVal
    ? `\n📦 Landed (1x): **$${drop.landedPrice.toFixed(2)}**${drop.freeShipNote ? ` • *${drop.freeShipNote}*` : ''}`
    : '';

  const isShopifyCart = Boolean(drop.cart1xUrl || drop.url.includes('/cart/'));
  const c1 = drop.cart1xUrl || drop.url;
  const c2 = drop.cart2xUrl || (drop.url.includes('/cart/') ? drop.url.replace(/:1$/, ':2') : undefined);
  const prodPageUrl = drop.productUrl || (drop.url.includes('/cart/') ? drop.url.split('/cart/')[0] : drop.url);

  const actionLinks = isShopifyCart
    ? `[**⚡ Instant Cart (1x)**](${c1})${c2 ? `   •   [**⚡ Instant Cart (2x)**](${c2})` : ''}   •   [🌐 Product Page](${prodPageUrl})`
    : `[**🛒 View & Checkout on ${drop.retailer} ↗**](${drop.url})`;

  const thumbUrl = getThumbnailUrl(drop.ruleId);

  const embed: any = {
    title: `${headerPrefix} ${drop.ruleName || drop.title}`,
    description: `**${tierBadge}**\n*${signalLine}*`,
    url: prodPageUrl,
    color: embedColor,
    fields: [
      { name: '💵 DROP PRICE', value: `**$${priceVal.toFixed(2)}** (${shipNote})${landedLine}\n🏪 **${drop.retailer}**`, inline: true },
      { name: '🏷️ RETAIL MSRP', value: `${msrpComparison}\n📦 ${stockDisplay}`, inline: true },
      { name: '📊 LIVE MARKET COMPS (LOWEST + SHIP)', value: marketBlock, inline: false },
      { name: '🔒 VAULT STATUS', value: vaultBadge, inline: true },
      { name: '💰 SPREAD GAIN', value: discount > 0 ? `🔥 **${discount}% Below Market** (~$${savings.toFixed(0)} edge)` : 'At Target', inline: true },
      { name: '🚀 DIRECT CHECKOUT', value: actionLinks, inline: false }
    ],
    footer: { text: 'DropBot Commander v3.0 • Live OOS Tracker Active (Auto-Updates When Sold Out)' },
    timestamp: new Date().toISOString()
  };

  if (thumbUrl) {
    embed.thumbnail = { url: thumbUrl };
  }

  try {
    // Use ?wait=true so Discord returns the message ID, allowing us to auto-edit it when the item sells out!
    const data = await enqueueDiscordWebhook(`${webhookUrl}?wait=true`, { embeds: [embed] }, 'POST', Boolean(drop.priorityFront));
    if (data?.id && drop.itemId) {
      activeDiscordMessages.set(String(drop.itemId), {
        messageId: data.id,
        embed,
        sentAt: Date.now(),
        ruleName: drop.ruleName || drop.title,
        retailer: drop.retailer
      });
    }
    console.log(`[DISCORD SENT] [${drop.alertType || 'NEW'}] ${drop.title} ($${priceVal.toFixed(2)} at ${drop.retailer})`);
  } catch (err: any) {
    console.error(`Failed to send Discord alert: ${err.message}`);
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
    title: `❌ SOLD OUT: ${tracked.ruleName}`,
    description: `**You missed it.** This restock on **${tracked.retailer}** lasted **${durationStr}** and is now Out of Stock.`,
    color: 0x475569 // Slate Gray for Sold Out
  };

  try {
    await enqueueDiscordWebhook(`${webhookUrl}/messages/${tracked.messageId}`, { embeds: [updatedEmbed] }, 'PATCH');
    console.log(`[DISCORD AUTO-EDIT] Marked ${tracked.ruleName} at ${tracked.retailer} as SOLD OUT (Lasted ${durationStr})`);
  } catch (e) {}
}

export async function sendStockDigestCard(options?: { force?: boolean }): Promise<{ sent: boolean; count: number; reason?: string }> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return { sent: false, count: 0, reason: 'No DISCORD_WEBHOOK_URL' };
  }

  const nowDate = new Date();
  const hour = nowDate.getHours();
  if (!options?.force && hour >= 0 && hour < 7) {
    console.log('[DIGEST] Skipping scheduled 4-hour digest during quiet hours (12:00 AM - 7:00 AM).');
    return { sent: false, count: 0, reason: 'Quiet hours (12 AM - 7 AM)' };
  }

  const liveStockPath = path.resolve(process.cwd(), 'liveStock.json');
  const policiesPath = path.resolve(process.cwd(), 'policies.json');

  let liveMap: Record<string, any> = {};
  let policies: any[] = [];
  let cache: Record<string, any> = {};

  try {
    if (fs.existsSync(liveStockPath)) liveMap = JSON.parse(fs.readFileSync(liveStockPath, 'utf-8'));
  } catch (e) {}
  try {
    if (fs.existsSync(policiesPath)) policies = JSON.parse(fs.readFileSync(policiesPath, 'utf-8'));
  } catch (e) {}
  try {
    if (fs.existsSync(TELEMETRY_PATH)) cache = JSON.parse(fs.readFileSync(TELEMETRY_PATH, 'utf-8'));
  } catch (e) {}

  const policyMap = new Map<string, any>(policies.map(p => [p.id, p]));
  const now = Date.now();

  interface DigestDeal {
    ruleId: string;
    name: string;
    price: number;
    spreadPct: number;
    store: string;
    url: string;
    cartUrl?: string;
    owned: boolean;
    isPreOrder?: boolean;
  }

  const validDeals: DigestDeal[] = [];

  for (const [ruleId, entry] of Object.entries(liveMap)) {
    if (ruleId === '__recentOos' || !entry || !entry.inStock) continue;
    const pol = policyMap.get(ruleId);
    if (!pol || pol.active === false) continue;

    const rawMaxBuy = Math.max(pol.msrpCeiling || 0, pol.maxMarketBuyPrice || 0);
    const effectiveMaxBuy = entry.isPreOrder
      ? Math.min(rawMaxBuy, Math.round((pol.msrpCeiling || 0) * 1.05))
      : rawMaxBuy;
    const landed = entry.landedPrice || entry.price;
    const eligible = entry.price <= effectiveMaxBuy && (landed <= effectiveMaxBuy || Boolean(entry.freeShipNote));
    if (!eligible || (now - (entry.updatedAt || 0)) > 6 * 60 * 60 * 1000) continue;

    const mkt = (cache[ruleId]?.rollingAverage > 0)
      ? cache[ruleId].rollingAverage
      : (pol.estimatedMarketValue || effectiveMaxBuy);
    const spreadPct = mkt > 0 ? Math.round(((mkt - entry.price) / mkt) * 100) : 0;

    const c1 = entry.cart1xUrl || (typeof entry.url === 'string' && entry.url.includes('/cart/') ? entry.url : undefined);
    const prodUrl = entry.productUrl || (c1 ? c1.split('/cart/')[0] : entry.url);

    validDeals.push({
      ruleId,
      name: pol.name || entry.ruleName || entry.title,
      price: Number(entry.price),
      spreadPct,
      store: entry.retailer || 'LGS',
      url: prodUrl,
      cartUrl: c1,
      owned: Boolean(pol.owned),
      isPreOrder: Boolean(entry.isPreOrder)
    });
  }

  if (validDeals.length === 0) {
    console.log('[DIGEST] 0 eligible items in stock under buy threshold — skipping digest card.');
    return { sent: false, count: 0, reason: '0 items in stock' };
  }

  // Sort by highest % below market and cap at top 12 best deals
  validDeals.sort((a, b) => b.spreadPct - a.spreadPct);
  const topDeals = validDeals.slice(0, 12);

  const formatDealLine = (d: DigestDeal) => {
    const spreadText = d.spreadPct >= 0 ? `${d.spreadPct}% Under Mkt` : `${Math.abs(d.spreadPct)}% Above Mkt`;
    const preTag = d.isPreOrder ? ' `[⏳PRE]`' : '';
    const cartSegment = d.cartUrl ? ` • [⚡1x](${d.cartUrl})` : '';
    return `• **${d.name}**${preTag} — **$${d.price.toFixed(2)}** (${spreadText}) @ ${d.store} — [Checkout](${d.url})${cartSegment}`;
  };

  const neededDeals = topDeals.filter(d => !d.owned);
  const crewDeals = topDeals.filter(d => d.owned);

  const fields: any[] = [];
  if (neededDeals.length > 0) {
    fields.push({
      name: `🎯 NEEDED FOR VAULT (${neededDeals.length})`,
      value: neededDeals.map(formatDealLine).join('\n').slice(0, 1020),
      inline: false
    });
  }
  if (crewDeals.length > 0) {
    fields.push({
      name: `🔒 IN VAULT / CREW DEALS (${crewDeals.length})`,
      value: crewDeals.map(formatDealLine).join('\n').slice(0, 1020),
      inline: false
    });
  }

  // Recent 4-Hour OOS tracker line
  let recentOosList: Array<{ ruleName: string; retailer: string; price: number; oosAt: number }> = [];
  if (Array.isArray(liveMap.__recentOos)) {
    recentOosList = liveMap.__recentOos.filter((x: any) => now - (x.oosAt || 0) < 4 * 60 * 60 * 1000);
  }
  if (recentOosList.length > 0) {
    const oosSummary = recentOosList
      .slice(0, 4)
      .map(x => `${x.ruleName} ($${Number(x.price).toFixed(2)} @ ${x.retailer})`)
      .join(' • ');
    fields.push({
      name: '💨 SOLD OUT IN LAST 4 HOURS',
      value: oosSummary.slice(0, 1020),
      inline: false
    });
  }

  const embed = {
    title: `📋 4-HOUR LIVE SHELF DIGEST (${validDeals.length} Active Deal${validDeals.length === 1 ? '' : 's'})`,
    description: `Real-time snapshot of verified in-stock targets at or below your buy triggers.${validDeals.length > 12 ? ` *(Showing top 12 of ${validDeals.length} by % spread)*` : ''}`,
    color: 0x3b82f6,
    fields,
    footer: {
      text: `DropBot Commander • Auto-Digest Every 4h (Quiet 12AM–7AM) • ${nowDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    },
    timestamp: nowDate.toISOString()
  };

  try {
    await enqueueDiscordWebhook(webhookUrl, { embeds: [embed] }, 'POST');
    console.log(`[DIGEST SENT] Pushed 4-Hour Live Shelf Digest (${topDeals.length} items) to Discord.`);
    return { sent: true, count: topDeals.length };
  } catch (err: any) {
    console.error(`[DIGEST ERROR] Failed to send digest card: ${err.message}`);
    return { sent: false, count: 0, reason: err.message };
  }
}

export function startStockDigestScheduler(): void {
  // Fire initial digest 60 seconds after startup so live shelf state is verified immediately
  setTimeout(() => {
    sendStockDigestCard().catch(() => {});
  }, 60 * 1000);

  // Schedule every 4 hours
  setInterval(() => {
    sendStockDigestCard().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}
