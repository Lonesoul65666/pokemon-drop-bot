"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendAlert = sendAlert;
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const DROPS_HISTORY_PATH = path_1.default.resolve(process.cwd(), 'dropsHistory.json');
const TELEMETRY_PATH = path_1.default.resolve(process.cwd(), 'marketCache.json');
function recordDropHistory(drop) {
    try {
        let history = [];
        if (fs_1.default.existsSync(DROPS_HISTORY_PATH)) {
            history = JSON.parse(fs_1.default.readFileSync(DROPS_HISTORY_PATH, 'utf-8'));
        }
        history.unshift({
            timestamp: Date.now(),
            timeStr: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            title: drop.ruleName || drop.title,
            rawTitle: drop.title,
            retailer: drop.retailer,
            price: drop.priceNum || parseFloat(drop.price || '0'),
            marketValue: drop.marketValue || 0,
            discountPct: drop.discountPct || 0,
            url: drop.url,
            formFactor: drop.formFactor || 'Sealed',
            ruleId: drop.ruleId || '',
            alertType: drop.alertType || 'NEW_DROP'
        });
        if (history.length > 25)
            history = history.slice(0, 25);
        fs_1.default.writeFileSync(DROPS_HISTORY_PATH, JSON.stringify(history, null, 2), 'utf-8');
    }
    catch (e) { }
}
function getThumbnailUrl(ruleId) {
    if (!ruleId)
        return undefined;
    try {
        if (fs_1.default.existsSync(TELEMETRY_PATH)) {
            const cache = JSON.parse(fs_1.default.readFileSync(TELEMETRY_PATH, 'utf-8'));
            const entry = cache[ruleId] || cache[ruleId.replace(/-case$/, '')] || cache[ruleId.replace(/-booster-case$/, '-booster-box')];
            if (entry && entry.lowestUrl && entry.lowestUrl.includes('tcgplayer.com/product/')) {
                const match = entry.lowestUrl.match(/product\/(\d+)/);
                if (match)
                    return `https://product-images.tcgplayer.com/fit-in/437x437/${match[1]}.jpg`;
            }
        }
    }
    catch (e) { }
    return undefined;
}
async function sendAlert(drop) {
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
    let tierBadge = '🟡 SOLID DEAL — UNDER TARGET';
    let embedColor = 0xf59e0b;
    if (msrpVal > 0 && priceVal <= msrpVal * 1.02) {
        tierBadge = '🟢 AT OR UNDER MSRP — INSTANT COP';
        embedColor = 0x10b981;
    }
    else if (discount >= 22 || savings >= 75) {
        tierBadge = '🔴 HEAVY ALPHA — 20%+ UNDER MARKET';
        embedColor = 0xe60012;
    }
    // Clear Visual Header Prefix for NEW DROP vs PRICE DROP vs REPEAT
    let headerPrefix = '🚨 NEW DROP:';
    let historyNote = 'First sighting at this store in the last 12h';
    if (drop.alertType === 'PRICE_DROP' && drop.previousPrice) {
        const cut = (drop.previousPrice - priceVal).toFixed(2);
        headerPrefix = `📉 PRICE SLASH (-$${cut}):`;
        historyNote = `Dropped from $${drop.previousPrice.toFixed(2)} (seen at ${drop.previousTimeStr})`;
        embedColor = 0x06b6d4; // Cyan highlight for price drops
    }
    else if (drop.alertType === 'RESTOCK_REPEAT' && drop.previousPrice) {
        headerPrefix = '🔄 RESTOCK / STILL LIVE:';
        historyNote = `Previously alerted at $${drop.previousPrice.toFixed(2)} (${drop.previousTimeStr})`;
    }
    const vaultBadge = drop.ownedInVault
        ? '🟣 Already in Vault (Passing to Crew)'
        : '🎯 Active Target (Needed)';
    const stockDisplay = typeof drop.stock === 'number' && drop.stock > 0
        ? `${drop.stock} Units Reported`
        : 'In Stock (Qty Hidden by Store)';
    const storeBaseUrl = drop.url.includes('/cart/') ? drop.url.split('/cart/')[0] : drop.url;
    const actionLinks = drop.url.includes('/cart/')
        ? `[**⚡ 1-Click Add to Cart**](${drop.url})  |  [🌐 Store Home](${storeBaseUrl})`
        : `[**🛒 Go to Listing / Buy Now**](${drop.url})`;
    const thumbUrl = getThumbnailUrl(drop.ruleId);
    const embed = {
        title: `${headerPrefix} ${drop.ruleName || drop.title}`,
        description: `**Listing:** ${drop.title}\n**Tier:** ${tierBadge}\n**Signal:** ${historyNote}`,
        url: drop.url,
        color: embedColor,
        fields: [
            { name: '🏪 Retailer', value: `**${drop.retailer}**`, inline: true },
            { name: '💵 Drop Price', value: `**$${priceVal.toFixed(2)}** ${msrpVal > 0 ? `(MSRP: $${msrpVal.toFixed(2)})` : ''}`, inline: true },
            { name: '📈 Market Spread', value: marketVal > 0 ? `**$${marketVal.toFixed(2)}** (${discount >= 0 ? `🔥 ${discount}% Off / Save $${savings.toFixed(2)}` : 'At Target'})` : 'N/A', inline: true },
            { name: '📦 Format & Stock', value: `${drop.formFactor || 'Sealed'} • ${stockDisplay}`, inline: true },
            { name: '🔒 Vault Status', value: vaultBadge, inline: true },
            { name: '🚀 Quick Checkout', value: actionLinks, inline: false }
        ],
        footer: { text: 'DropBot Commander v2.6 • State-Deduplicated Arbitrage Engine' },
        timestamp: new Date().toISOString()
    };
    if (thumbUrl) {
        embed.thumbnail = { url: thumbUrl };
    }
    try {
        await axios_1.default.post(webhookUrl, { embeds: [embed] });
        console.log(`[DISCORD SENT] [${drop.alertType}] ${drop.title} ($${priceVal.toFixed(2)} at ${drop.retailer})`);
    }
    catch (err) {
        console.error(`Failed to send Discord alert: ${err.message}`);
    }
}
