import axios from 'axios';
import dotenv from 'dotenv';
import { PolicyRule } from './policies';
import { EvaluationResult, DealVerdict, RawRestockItem } from './evaluator';

dotenv.config();

const VERDICT_CONFIG: Record<DealVerdict, { color: number; badge: string }> = {
  'MUST BUY': { color: 0x2ecc71, badge: '🚨 MUST BUY' },
  'GREAT DEAL': { color: 0x3498db, badge: '🔥 GREAT DEAL' },
  'GOOD DEAL': { color: 0x9b59b6, badge: '⚡ GOOD DEAL' },
  'FAIR / MSRP': { color: 0x95a5a6, badge: '🛒 FAIR / MSRP' },
  'COMMUNITY SELLER (VERIFY)': { color: 0xf39c12, badge: '⚠️ COMMUNITY SELLER (VERIFY)' },
  'RUN AWAY': { color: 0xe74c3c, badge: '❌ OVERPRICED' },
  'SUSPICIOUS / SCAM': { color: 0xc0392b, badge: '🛑 SUSPICIOUS / SCAM' },
};

export async function sendEnhancedAlert(item: RawRestockItem, policy: PolicyRule, evalResult: EvaluationResult): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const verdictData = VERDICT_CONFIG[evalResult.verdict];
  
  const embed = {
    title: `${verdictData.badge}: ${item.title}`,
    url: item.url,
    color: verdictData.color,
    fields: [
      { name: 'Retailer', value: item.retailer, inline: true },
      { name: 'Price', value: `$${item.price.toFixed(2)}`, inline: true },
      { name: 'Market Value', value: `$${policy.estimatedMarketValue.toFixed(2)}`, inline: true },
      { name: 'Spread', value: `${evalResult.discountVsMarket}% Under Market`, inline: true },
      { name: 'Direct Link', value: `[Fast Checkout](${item.url})` },
    ],
    timestamp: new Date().toISOString(),
  };

  try {
    await axios.post(webhookUrl, { embeds: [embed] });
    console.log(`[DISCORD] Alert fired for ${item.title}`);
  } catch (err: any) {
    console.error(`[DISCORD] Webhook failed: ${err.message}`);
  }
}