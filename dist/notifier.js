"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEnhancedAlert = sendEnhancedAlert;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const VERDICT_CONFIG = {
    'MUST BUY': { color: 0x2ecc71, badge: '🚨 MUST BUY' },
    'GREAT DEAL': { color: 0x3498db, badge: '🔥 GREAT DEAL' },
    'GOOD DEAL': { color: 0x9b59b6, badge: '⚡ GOOD DEAL' },
    'FAIR / MSRP': { color: 0x95a5a6, badge: '🛒 FAIR / MSRP' },
    'COMMUNITY SELLER (VERIFY)': { color: 0xf39c12, badge: '⚠️ COMMUNITY SELLER (VERIFY)' },
    'RUN AWAY': { color: 0xe74c3c, badge: '❌ OVERPRICED' },
    'SUSPICIOUS / SCAM': { color: 0xc0392b, badge: '🛑 SUSPICIOUS / SCAM' },
};
async function sendEnhancedAlert(item, policy, evalResult) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl)
        return;
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
        await axios_1.default.post(webhookUrl, { embeds: [embed] });
        console.log(`[DISCORD] Alert fired for ${item.title}`);
    }
    catch (err) {
        console.error(`[DISCORD] Webhook failed: ${err.message}`);
    }
}
