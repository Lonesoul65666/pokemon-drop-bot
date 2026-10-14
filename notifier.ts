import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export interface DropPayload {
  title: string;
  retailer: string;
  url: string;
  price?: string;
  priceNum?: number;
  stock?: number;
  ruleId?: string;
  ruleName?: string;
  formFactor?: string;
  msrp?: number;
  marketValue?: number;
  maxBuyTarget?: number;
  discountPct?: number;
  savingsDollars?: number;
  ownedInVault?: boolean;
  isPriceDropOverride?: boolean;
}

const DROPS_HISTORY_PATH = path.resolve(process.cwd(), 'dropsHistory.json');
const TELEMETRY_PATH = path.resolve(process.cwd(), 'marketCache.json');

function recordDropHistory(drop: DropPayload) {
  try {
    let history: any[] = [];
    if (fs.existsSync(DROPS_HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(DROPS_HISTORY_PATH, 'utf-8'));
    }
    history.unshift({
      timestamp: Date.now(),
      timeStr: new Date().toLocaleTimeString(),
      title: drop.ruleName || drop.title,
      rawTitle: drop.title,
      retailer: drop.retailer,
      price: drop.priceNum || parseFloat(drop.price || '0'),
      marketValue: drop.marketValue || 0,
      discountPct: drop.discountPct || 0,
      url: drop.url,
      formFactor: drop.formFactor || 'Sealed',
      ruleId: drop.ruleId || ''
    });
    if (history.length > 25) history = history.slice(0, 25);
    fs.writeFileSync(DROPS_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
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
  const marketVal = drop.marketValue ?? 0;
  const discount = drop.discountPct ?? (marketVal > 0 ? Math.round(((marketVal - priceVal) / marketVal) * 100) : 0);
  const savings = drop.savingsDollars ?? Math.max(0, marketVal - priceVal);

  // Determine Deal Tier Badge & Embed Color
  let tierBadge = '🟡 SOLID DEAL — UNDER TARGET';
  let embedColor = 0xf59e0b; // Amber/Gold

  if (msrpVal > 0 && priceVal <= msrpVal * 1.02) {
    tierBadge = '🟢 AT OR UNDER MSRP — INSTANT COP';
    embedColor = 0x10b981; // Emerald Green
  } else if (discount >= 22 || savings >= 75) {
    tierBadge = '🔴 HEAVY ALPHA — 20%+ UNDER MARKET';
    embedColor = 0xe60012; // Siren Red
  }

  if (drop.isPriceDropOverride) {
    tierBadge = '📉 FURTHER PRICE SLASH — ' + tierBadge;
  }

  const vaultBadge = drop.ownedInVault
    ? '🟣 Already in Vault (Passing to Crew)'
    : '🎯 Active Target (Needed)';

  const storeBaseUrl = drop.url.includes('/cart/') ? drop.url.split('/cart/')[0] : drop.url;
  const actionLinks = drop.url.includes('/cart/')
    ? `[**⚡ 1-Click Add to Cart**](${drop.url})  |  [🌐 Store Home](${storeBaseUrl})`
    : `[**🛒 Go to Listing / Buy Now**](${drop.url})`;

  const thumbUrl = getThumbnailUrl(drop.ruleId);

  const embed: any = {
    title: `🚨 ${drop.ruleName || drop.title}`,
    description: `**Listing:** ${drop.title}\n**Tier:** ${tierBadge}`,
    url: drop.url,
    color: embedColor,
    fields: [
      { name: '🏪 Retailer', value: `**${drop.retailer}**`, inline: true },
      { name: '💵 Drop Price', value: `**$${priceVal.toFixed(2)}** ${msrpVal > 0 ? `(MSRP: $${msrpVal.toFixed(2)})` : ''}`, inline: true },
      { name: '📈 Market Spread', value: marketVal > 0 ? `**$${marketVal.toFixed(2)}** (${discount >= 0 ? `🔥 ${discount}% Off / Save $${savings.toFixed(2)}` : 'At Target'})` : 'N/A', inline: true },
      { name: '📦 Format & Stock', value: `${drop.formFactor || 'Sealed'} • Stock: ${drop.stock ?? 'In Stock'}`, inline: true },
      { name: '🔒 Vault Status', value: vaultBadge, inline: true },
      { name: '🚀 Quick Checkout', value: actionLinks, inline: false }
    ],
    footer: { text: 'DropBot Commander v2.5 • Direct-to-Cart Arbitrage Engine' },
    timestamp: new Date().toISOString()
  };

  if (thumbUrl) {
    embed.thumbnail = { url: thumbUrl };
  }

  try {
    await axios.post(webhookUrl, { embeds: [embed] });
    console.log(`[DISCORD SENT] ${drop.title} ($${priceVal.toFixed(2)} at ${drop.retailer})`);
  } catch (err: any) {
    console.error(`Failed to send Discord alert: ${err.message}`);
  }
}
