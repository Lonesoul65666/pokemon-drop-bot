import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { getDualMarketComps } from './marketComps';
import { markLiveStockOut } from './evaluator';
import { atomicWriteJson, computeRipMetrics } from './policies';
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

  const landedOrPrice = drop.landedPrice ?? priceVal;
  const isTierAMsrpHit = Boolean(
    drop.bigBoxTier === 'MSRP_TIER_A' ||
    drop.isMsrpUnicorn ||
    (msrpVal > 0 && landedOrPrice <= Math.round(msrpVal * 1.08 * 100) / 100 && (drop.estimatedShipping ?? 0) <= 6.99)
  );

  let tierBadge = '🟡 SOLID DEAL — UNDER TARGET';
  let embedColor = 0xf59e0b;

  if (drop.bigBoxTier === 'BIG_BOX_RESTOCK_RADAR' && drop.bigBoxBadge) {
    tierBadge = drop.bigBoxBadge;
    embedColor = 0x00F0FF;
  } else if (isTierAMsrpHit) {
    tierBadge = '🚨💎 UNICORN RETAIL MSRP HIT 💎🚨';
    embedColor = 0x00F0FF;
  } else if (drop.bigBoxTier === 'PC_EXCLUSIVE_MSRP' && drop.bigBoxBadge) {
    tierBadge = drop.bigBoxBadge;
    embedColor = 0x00F0FF;
  } else if (flashEscalation.isHighVelocityRepeat && flashEscalation.badgeText) {
    tierBadge = flashEscalation.badgeText;
    embedColor = 0xe11d48;
  } else if (drop.isPreRelease && drop.preReleaseStatusTag) {
    tierBadge = drop.preReleaseStatusTag;
    embedColor = 0x8b5cf6;
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

  let headerPrefix = isTierAMsrpHit
    ? '🚨💎 UNICORN RETAIL MSRP HIT 💎🚨'
    : (drop.bigBoxTier === 'PC_EXCLUSIVE_MSRP'
        ? '💎 PC EXCLUSIVE MSRP:'
        : (drop.isPreRelease
            ? '⏳ PRE-RELEASE:'
            : (drop.isPreOrder ? '⏳ PRE-ORDER:' : (flashEscalation.isHighVelocityRepeat ? '⚡ FLASH REPEAT:' : '🚨 IN STOCK:'))));
  let signalLine = drop.isPreOrder ? 'Pre-order allocation live (Strict MSRP+5% cap enforced)' : 'Fresh restock detected';

  if (drop.alertType === 'PRICE_DROP' && drop.previousPrice) {
    const cut = (drop.previousPrice - priceVal).toFixed(2);
    if (!isTierAMsrpHit) {
      headerPrefix = `📉 PRICE DROP (-$${cut}):`;
      embedColor = 0x06b6d4;
    }
    signalLine = `Slashed from $${drop.previousPrice.toFixed(2)} (seen at ${drop.previousTimeStr})`;
  } else if (drop.alertType === 'RESTOCK_REPEAT' && drop.previousPrice) {
    if (!isTierAMsrpHit) {
      headerPrefix = drop.isPreOrder ? '⏳ PRE-ORDER RESTOCK:' : '🔄 RESTOCKED:';
    }
    signalLine = `Previously seen at $${drop.previousPrice.toFixed(2)} (${drop.previousTimeStr})`;
  }

  if (drop.isPreRelease) {
    const bleedTag = drop.preReleaseStatusTag || '⏳ PRE-RELEASE BLEED (Wait for Launch Week)';
    if (isTierAMsrpHit) {
      signalLine += `\n✅ **PRE-RELEASE AT TRUE RETAIL MSRP** (${bleedTag} bypassed)`;
    } else {
      signalLine += `\n⚠️ **${bleedTag}** — Avoid inflated pre-release allocation dumps above retail MSRP!`;
    }
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
    ? (isTierAMsrpHit ? '🚨💎 DEFCON-1 OVERRIDE (In Vault — MSRP Rip Alert!)' : '🟣 In Vault (Passing to Crew)')
    : '🎯 Needed for Vault';

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
    ? `\n📦 Landed (1x): **$${drop.landedPrice.toFixed(2)}**${drop.freeShipNote ? ` • *${drop.freeShipNote}*` : ''}`
    : '';

  const isShopifyCart = Boolean(drop.cart1xUrl || drop.url.includes('/cart/'));
  const baseCartRoot = (drop.cart1xUrl || drop.url).replace(/:\d+$/, '');
  const c1 = drop.cart1xUrl || drop.url;
  const knownStock = typeof drop.stock === 'number' && drop.stock > 0 ? drop.stock : undefined;
  const c2 = (knownStock === undefined || knownStock >= 2)
    ? (drop.cart2xUrl || (isShopifyCart ? `${baseCartRoot}:2` : undefined))
    : undefined;
  const isEtbDrop = drop.formFactor === 'ETB' || /\b(etb|elite trainer box)\b/i.test(`${drop.ruleName || ''} ${drop.title || ''}`);
  const c3 = isEtbDrop && (knownStock === undefined || knownStock >= 3)
    ? (drop.cart3xUrl || (isShopifyCart ? `${baseCartRoot}:3` : undefined))
    : undefined;
  const prodPageUrl = drop.productUrl || (drop.url.includes('/cart/') ? drop.url.split('/cart/')[0] : drop.url);

  let actionLinks: string;
  if (isShopifyCart) {
    if (isEtbDrop) {
      const segments = [`[**⚡ 1x Single**](${c1})`];
      if (c2) segments.push(`[**⚡ 2x Pair**](${c2})`);
      if (c3) segments.push(`[**⚡ 3x Family Pack (Free Ship Threshold)**](${c3})`);
      segments.push(`[🌐 Product Page](${prodPageUrl})`);
      actionLinks = segments.join('   •   ');
    } else {
      const segments = [`[**⚡ Instant Cart (1x)**](${c1})`];
      if (c2) segments.push(`[**⚡ Instant Cart (2x)**](${c2})`);
      segments.push(`[🌐 Product Page](${prodPageUrl})`);
      actionLinks = segments.join('   •   ');
    }
  } else {
    actionLinks = `[**🛒 View & Checkout on ${drop.retailer} ↗**](${drop.url})`;
  }

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
    footer: { text: 'DropBot Commander v4.0 • Live OOS Tracker Active (Auto-Updates When Sold Out)' },
    timestamp: new Date().toISOString()
  };

  if (thumbUrl) {
    embed.thumbnail = { url: thumbUrl };
  }

  const webhookPayload: any = { embeds: [embed] };
  if (isTierAMsrpHit) {
    webhookPayload.content = `@everyone 🚨💎 **UNICORN RETAIL MSRP HIT** — **${drop.ruleName || drop.title}** at **$${priceVal.toFixed(2)}** on **${drop.retailer}**!`;
  }

  try {
    // Use ?wait=true so Discord returns the message ID, allowing us to auto-edit it when the item sells out!
    const data = await enqueueDiscordWebhook(`${webhookUrl}?wait=true`, webhookPayload, 'POST', Boolean(drop.priorityFront || isTierAMsrpHit));
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
    if (fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (s && typeof s.lastDigestSentAt === 'number') diskLastAt = Math.max(diskLastAt, s.lastDigestSentAt);
      if (s && typeof s.lastDigestHash === 'string' && !diskHash) diskHash = s.lastDigestHash;
      if (s && typeof s.liveDigestEnabled === 'boolean') liveDigestEnabled = s.liveDigestEnabled;
    }
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

export async function sendStockDigestCard(options?: { force?: boolean }): Promise<{ sent: boolean; count: number; reason?: string }> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    return { sent: false, count: 0, reason: 'No DISCORD_WEBHOOK_URL' };
  }

  const digestState = readDigestStateFromDisk();

  if (!options?.force && !digestState.liveDigestEnabled) {
    return { sent: false, count: 0, reason: 'Automatic Live Shelf Digest is disabled (liveDigestEnabled=false)' };
  }

  const nowMs = Date.now();
  if (!options?.force && digestState.lastDigestSentAt > 0 && (nowMs - digestState.lastDigestSentAt) < DIGEST_COOLDOWN_MS) {
    const minsRemaining = Math.ceil((DIGEST_COOLDOWN_MS - (nowMs - digestState.lastDigestSentAt)) / 60000);
    console.log(`[DIGEST] Cooldown active (${minsRemaining}m remaining) — skipping automatic digest.`);
    return { sent: false, count: 0, reason: `Cooldown active (${minsRemaining}m remaining)` };
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
    if (ruleId.startsWith('__') || !entry || !entry.inStock) continue;
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

  const digestHash = topDeals
    .map(d => `${d.ruleId}:${d.store}:${d.price.toFixed(2)}`)
    .join('|');

  if (!options?.force && digestState.lastDigestHash && digestHash === digestState.lastDigestHash) {
    console.log('[DIGEST] Shelf state hash unchanged since last digest — skipping duplicate digest.');
    return { sent: false, count: 0, reason: 'Digest content hash unchanged' };
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
    // Persist lastDigestSentAt and lastDigestHash to disk BEFORE awaiting webhook so any timeout/restart cannot re-fire
    writeDigestStateToDisk(Date.now(), digestHash);
    await enqueueDiscordWebhook(webhookUrl, { embeds: [embed] }, 'POST');
    console.log(`[DIGEST SENT] Pushed 4-Hour Live Shelf Digest (${topDeals.length} items) to Discord.`);
    return { sent: true, count: topDeals.length };
  } catch (err: any) {
    console.error(`[DIGEST ERROR] Failed to send digest card: ${err.message}`);
    return { sent: false, count: 0, reason: err.message };
  }
}

export function startStockDigestScheduler(): void {
  // NEVER fire a Live Shelf Digest on process startup/boot!
  // Only evaluate on the 4-hour interval (which also enforces liveDigestEnabled=false by default + 4h disk cooldown).
  setInterval(() => {
    sendStockDigestCard().catch(() => {});
  }, DIGEST_COOLDOWN_MS);
}
