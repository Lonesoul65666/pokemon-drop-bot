"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueueDiscordWebhook = enqueueDiscordWebhook;
exports.recordPreDropStagingEvent = recordPreDropStagingEvent;
exports.sendAlert = sendAlert;
exports.markAlertSoldOut = markAlertSoldOut;
exports.sendStockDigestCard = sendStockDigestCard;
exports.startStockDigestScheduler = startStockDigestScheduler;
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const marketComps_1 = require("./marketComps");
const evaluator_1 = require("./evaluator");
const policies_1 = require("./policies");
const marketTape_1 = require("./marketTape");
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '.env') });
const DISCORD_MIN_INTERVAL_MS = 1250;
const discordWebhookQueue = [];
let isProcessingDiscordQueue = false;
let lastDiscordSendAt = 0;
function sleepMs(ms) {
    return new Promise(r => setTimeout(r, ms));
}
async function processDiscordQueue() {
    if (isProcessingDiscordQueue)
        return;
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
                    ? await axios_1.default.post(job.url, job.payload, { timeout: 10000 })
                    : await axios_1.default.patch(job.url, job.payload, { timeout: 10000 });
                discordWebhookQueue.shift();
                job.resolve(res.data);
            }
            catch (err) {
                const status = err?.response?.status;
                if (status === 429 && job.retries < 4) {
                    job.retries += 1;
                    const retryAfterRaw = err?.response?.data?.retry_after ?? err?.response?.headers?.['retry-after'] ?? 2;
                    const retryMs = Math.ceil(Number(retryAfterRaw) * (Number(retryAfterRaw) < 50 ? 1000 : 1)) + 250;
                    console.warn(`[DISCORD QUEUE] HTTP 429 Rate Limit hit. Backing off for ${retryMs}ms (Retry ${job.retries}/4)...`);
                    await sleepMs(retryMs);
                }
                else {
                    discordWebhookQueue.shift();
                    job.reject(err);
                }
            }
        }
    }
    finally {
        isProcessingDiscordQueue = false;
    }
}
function enqueueDiscordWebhook(url, payload, method = 'POST', priorityFront = false) {
    return new Promise((resolve, reject) => {
        const job = { method, url, payload, resolve, reject, retries: 0 };
        if (priorityFront) {
            discordWebhookQueue.unshift(job);
        }
        else {
            discordWebhookQueue.push(job);
        }
        processDiscordQueue().catch(() => { });
    });
}
const activeDiscordMessages = new Map();
const DROPS_HISTORY_PATH = path_1.default.resolve(process.cwd(), 'dropsHistory.json');
const TELEMETRY_PATH = path_1.default.resolve(process.cwd(), 'marketCache.json');
function getRetailerShippingNote(retailer, price, estimatedShipping, itemPrice, shippingPrice, freeShipNote) {
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
    if (estimatedShipping === 0 || price >= 150)
        return '+FREE Shipping';
    if (r.includes('target') ||
        r.includes('best buy') ||
        r.includes('walmart') ||
        r.includes('amazon') ||
        r.includes('costco') ||
        r.includes('gamestop') ||
        r.includes("sam's club") ||
        r.includes('sams club') ||
        r.includes('barnes') ||
        r.includes('pokemon center')) {
        return price >= 35 ? '+FREE Shipping' : `+$${(estimatedShipping ?? 5.99).toFixed(2)} Shipping`;
    }
    return `+$${(estimatedShipping ?? 6.99).toFixed(2)} Est. LGS Ship`;
}
function recordPreDropStagingEvent(params) {
    try {
        let history = [];
        if (fs_1.default.existsSync(DROPS_HISTORY_PATH)) {
            history = JSON.parse(fs_1.default.readFileSync(DROPS_HISTORY_PATH, 'utf-8'));
        }
        const rip = (0, policies_1.computeRipMetrics)(params.price, params.ruleId, params.formFactor, params.ruleName);
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
        if (history.length > 25)
            history = history.slice(0, 25);
        (0, policies_1.atomicWriteJson)(DROPS_HISTORY_PATH, history);
    }
    catch (e) { }
}
function recordDropHistory(drop) {
    try {
        let history = [];
        if (fs_1.default.existsSync(DROPS_HISTORY_PATH)) {
            history = JSON.parse(fs_1.default.readFileSync(DROPS_HISTORY_PATH, 'utf-8'));
        }
        const rawPrice = drop.priceNum || parseFloat(drop.price || '0');
        const effLanded = drop.landedPrice || rawPrice;
        const rip = (0, policies_1.computeRipMetrics)(effLanded, drop.ruleId, drop.formFactor, drop.ruleName || drop.title, drop.packCount);
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
        if (history.length > 25)
            history = history.slice(0, 25);
        (0, policies_1.atomicWriteJson)(DROPS_HISTORY_PATH, history);
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
    const fallbackMkt = drop.marketValue ?? 0;
    // Fetch live TCGPlayer + eBay Buy-It-Now comps with shipping breakdown!
    const comps = await (0, marketComps_1.getDualMarketComps)(drop.ruleId, drop.ruleName || drop.title, fallbackMkt);
    const bestMarketRef = comps.tcgplayer?.price || fallbackMkt;
    const effectiveComparePrice = drop.freeShipNote ? priceVal : (drop.landedPrice ?? priceVal);
    const discount = bestMarketRef > 0 ? Math.round(((bestMarketRef - effectiveComparePrice) / bestMarketRef) * 100) : 0;
    const savings = Math.max(0, bestMarketRef - effectiveComparePrice);
    // Format MSRP comparison with tactical typography
    let msrpComparison = 'N/A';
    if (msrpVal > 0) {
        const msrpDiffPct = Math.round(((priceVal - msrpVal) / msrpVal) * 100);
        if (msrpDiffPct <= 0) {
            msrpComparison = `**$${msrpVal.toFixed(2)}** (${msrpDiffPct === 0 ? '✦ Exact MSRP' : `${Math.abs(msrpDiffPct)}% BELOW MSRP!`})`;
        }
        else {
            msrpComparison = `**$${msrpVal.toFixed(2)}** (${msrpDiffPct}% above MSRP)`;
        }
    }
    // Format 100% Verified Dual Market Block (Direct Product & Item URLs!)
    const marketLines = [];
    if (comps.tcgplayer && comps.tcgplayer.isLiveVerified && comps.tcgplayer.price > 0) {
        marketLines.push(`**${comps.tcgplayer.price.toFixed(2)}** ${comps.tcgplayer.shippingLabel} [TCGPlayer Product ↗](${comps.tcgplayer.url})`);
    }
    else {
        const q = encodeURIComponent(drop.ruleName || drop.title);
        marketLines.push(`**${bestMarketRef.toFixed(2)}** (Baseline) [Search TCGPlayer ↗](https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${q}&view=grid)`);
    }
    if (comps.ebay && comps.ebay.isLiveVerified && comps.ebay.price > 0) {
        marketLines.push(`**${comps.ebay.price.toFixed(2)}** ${comps.ebay.shippingLabel} [eBay Direct Item ↗](${comps.ebay.url})`);
    }
    else {
        const q = encodeURIComponent('Pokemon ' + (drop.ruleName || drop.title) + ' Sealed');
        marketLines.push(`*Live BIN Check* [View Lowest on eBay ↗](https://www.ebay.com/sch/i.html?_nkw=${q}&LH_BIN=1&_sop=15)`);
    }
    const marketBlock = marketLines.join('\n');
    const flashEscalation = (0, marketTape_1.getFlashClearEscalation)(drop.ruleId, priceVal);
    const landedOrPrice = drop.landedPrice ?? priceVal;
    const isTierAMsrpHit = Boolean(drop.bigBoxTier === 'MSRP_TIER_A' ||
        drop.isMsrpUnicorn ||
        (msrpVal > 0 && landedOrPrice <= Math.round(msrpVal * 1.08 * 100) / 100 && (drop.estimatedShipping ?? 0) <= 6.99));
    // Format-driven tactical prefix & color
    const ffLower = String(drop.formFactor || '').toLowerCase();
    const combinedLabel = `${drop.ruleId || ''} ${drop.formFactor || ''} ${drop.ruleName || ''} ${drop.title || ''}`.toLowerCase();
    let tacticalFormatCallsign = '◈ ⟦ WALL ETB // SINGLE ⟧';
    let embedColor = 0x10b981; // Emerald/Cyan default for Wall ETB
    if (ffLower.includes('etb case') || combinedLabel.includes('etb-case') || (combinedLabel.includes('etb') && combinedLabel.includes('case'))) {
        tacticalFormatCallsign = '❖ ⟦ MASTER CASE // 10x ETB ⟧';
        embedColor = 0xf59e0b; // Gold
    }
    else if (ffLower.includes('master case') || ffLower.includes('booster case') || combinedLabel.includes('booster-case') || combinedLabel.includes('case')) {
        tacticalFormatCallsign = '❖ ⟦ BOOSTER CASE // 6x BOX ⟧';
        embedColor = 0xf59e0b; // Gold
    }
    else if (ffLower.includes('booster box') || combinedLabel.includes('booster-box') || combinedLabel.includes('booster box')) {
        tacticalFormatCallsign = '▲ ⟦ BOOSTER BOX // 36-PACK ⟧';
        embedColor = 0xa855f7; // Violet
    }
    else if (ffLower.includes('bundle') || combinedLabel.includes('bundle')) {
        tacticalFormatCallsign = '◆ ⟦ BOOSTER BUNDLE // 6-PACK ⟧';
        embedColor = 0x3b82f6; // Electric Blue
    }
    let tierBadge = `${tacticalFormatCallsign} • UNDER TRIGGER`;
    if (drop.bigBoxTier === 'BIG_BOX_RESTOCK_RADAR' && drop.bigBoxBadge) {
        tierBadge = `✦ ⟦ BIG-BOX RESTOCK RADAR // MSRP ASSUMED ⟧`;
        embedColor = 0x00F0FF;
    }
    else if (isTierAMsrpHit) {
        tierBadge = `✦ ⟦ MSRP OVERRIDE // RETAIL HIT ⟧ • ${tacticalFormatCallsign}`;
        embedColor = 0xe11d48;
    }
    else if (drop.bigBoxTier === 'PC_EXCLUSIVE_MSRP' && drop.bigBoxBadge) {
        tierBadge = `✦ ⟦ POKEMON CENTER // $59.99 EXCLUSIVE MSRP ⟧`;
        embedColor = 0x00F0FF;
    }
    else if (flashEscalation.isHighVelocityRepeat && flashEscalation.badgeText) {
        tierBadge = `${tacticalFormatCallsign} • HIGH-VELOCITY REPEAT`;
        embedColor = 0xe11d48;
    }
    else if (drop.isPreRelease && drop.preReleaseStatusTag) {
        tierBadge = `${tacticalFormatCallsign} • PRE-RELEASE BLEED`;
        embedColor = 0x8b5cf6;
    }
    else if (drop.isPreOrder) {
        tierBadge = `${tacticalFormatCallsign} • PRE-ORDER ALLOCATION`;
        embedColor = 0x8b5cf6;
    }
    else if (msrpVal > 0 && priceVal <= msrpVal * 1.05) {
        tierBadge = `✦ ⟦ AT OR NEAR MSRP // INSTANT COP ⟧ • ${tacticalFormatCallsign}`;
        embedColor = 0x10b981;
    }
    else if (discount >= 22 || savings >= 60) {
        tierBadge = `${tacticalFormatCallsign} • HEAVY ALPHA (${discount}% UNDER MARKET • SAVE $${savings.toFixed(0)})`;
    }
    let headerPrefix = isTierAMsrpHit
        ? '✦ ⟦ MSRP OVERRIDE // RETAIL HIT ⟧'
        : (drop.bigBoxTier === 'PC_EXCLUSIVE_MSRP'
            ? '✦ ⟦ PC EXCLUSIVE MSRP ⟧'
            : tacticalFormatCallsign);
    let signalLine = drop.isPreOrder ? 'Pre-order allocation live (Strict MSRP+5% cap enforced)' : 'Fresh restock detected';
    if (drop.alertType === 'PRICE_DROP' && drop.previousPrice) {
        const cut = (drop.previousPrice - priceVal).toFixed(2);
        if (!isTierAMsrpHit) {
            headerPrefix = `${tacticalFormatCallsign} // PRICE DROP (-$${cut})`;
        }
        signalLine = `Slashed from $${drop.previousPrice.toFixed(2)} (seen at ${drop.previousTimeStr})`;
    }
    else if (drop.alertType === 'RESTOCK_REPEAT' && drop.previousPrice) {
        if (!isTierAMsrpHit) {
            headerPrefix = `${tacticalFormatCallsign} // RESTOCKED`;
        }
        signalLine = `Previously seen at $${drop.previousPrice.toFixed(2)} (${drop.previousTimeStr})`;
    }
    if (drop.isPreRelease) {
        const bleedTag = '⟦ PRE-RELEASE BLEED // WAIT FOR LAUNCH WEEK ⟧';
        if (isTierAMsrpHit) {
            signalLine += `\n✦ **PRE-RELEASE AT TRUE RETAIL MSRP** (${bleedTag} bypassed)`;
        }
        else {
            signalLine += `\n▲ **${bleedTag}** — Avoid inflated pre-release allocation dumps above retail MSRP!`;
        }
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
    const shipNote = getRetailerShippingNote(drop.retailer, priceVal, drop.estimatedShipping, drop.itemPrice, drop.shippingPrice, drop.freeShipNote);
    const landedLine = drop.landedPrice && drop.landedPrice > priceVal
        ? `\n◈ Landed (1x): **$${drop.landedPrice.toFixed(2)}**${drop.freeShipNote ? ` • *${drop.freeShipNote}*` : ''}`
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
    let actionLinks;
    if (isShopifyCart) {
        if (isEtbDrop) {
            const segments = [`[**⟦ 1x SINGLE ↗ ⟧**](${c1})`];
            if (c2)
                segments.push(`[**⟦ 2x PAIR ↗ ⟧**](${c2})`);
            if (c3)
                segments.push(`[**⟦ 3x FAMILY PACK (FREE SHIP) ↗ ⟧**](${c3})`);
            segments.push(`[Product Page ↗](${prodPageUrl})`);
            actionLinks = segments.join('   •   ');
        }
        else {
            const segments = [`[**⟦ INSTANT CART 1x ↗ ⟧**](${c1})`];
            if (c2)
                segments.push(`[**⟦ INSTANT CART 2x ↗ ⟧**](${c2})`);
            segments.push(`[Product Page ↗](${prodPageUrl})`);
            actionLinks = segments.join('   •   ');
        }
    }
    else {
        actionLinks = `[**⟦ VIEW & CHECKOUT ON ${drop.retailer.toUpperCase()} ↗ ⟧**](${drop.url})`;
    }
    const thumbUrl = getThumbnailUrl(drop.ruleId);
    const embed = {
        title: `${headerPrefix} — ${drop.ruleName || drop.title}`,
        description: `**${tierBadge}**\n*${signalLine}*`,
        url: prodPageUrl,
        color: embedColor,
        fields: [
            { name: '◈ DROP PRICE', value: `**$${priceVal.toFixed(2)}** (${shipNote})${landedLine}\n**${drop.retailer}**`, inline: true },
            { name: '◆ RETAIL MSRP', value: `${msrpComparison}\n${stockDisplay}`, inline: true },
            { name: '▲ LIVE MARKET COMPS (LOWEST + SHIP)', value: marketBlock, inline: false },
            { name: '❖ VAULT STATUS', value: vaultBadge, inline: true },
            { name: '✦ SPREAD GAIN', value: discount > 0 ? `**${discount}% Below Market** (~$${savings.toFixed(0)} edge)` : 'At Target', inline: true },
            { name: '◈ DIRECT CHECKOUT', value: actionLinks, inline: false }
        ],
        footer: { text: 'DropBot Commander v4.0 • Tactical OOS Tracker Active (Auto-Updates When Sold Out)' },
        timestamp: new Date().toISOString()
    };
    if (thumbUrl) {
        embed.thumbnail = { url: thumbUrl };
    }
    const webhookPayload = { embeds: [embed] };
    if (isTierAMsrpHit) {
        webhookPayload.content = `@everyone ✦ ⟦ **MSRP OVERRIDE // RETAIL HIT** ⟧ — **${drop.ruleName || drop.title}** at **$${priceVal.toFixed(2)}** on **${drop.retailer}**!`;
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
    }
    catch (err) {
        console.error(`Failed to send Discord alert: ${err.message}`);
    }
}
// Automatically edits the Discord embed in-place when a restock sells out!
async function markAlertSoldOut(itemId) {
    (0, evaluator_1.markLiveStockOut)(String(itemId));
    const tracked = activeDiscordMessages.get(String(itemId));
    if (!tracked)
        return;
    activeDiscordMessages.delete(String(itemId));
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl)
        return;
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
    }
    catch (e) { }
}
const DIGEST_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 14,400,000 ms (4 hours)
let memLastDigestSentAt = 0;
let memLastDigestHash = '';
function readDigestStateFromDisk() {
    const alertStatePath = path_1.default.resolve(process.cwd(), 'alertState.json');
    const settingsPath = path_1.default.resolve(process.cwd(), 'botSettings.json');
    let diskLastAt = 0;
    let diskHash = '';
    let liveDigestEnabled = false;
    try {
        if (fs_1.default.existsSync(alertStatePath)) {
            const a = JSON.parse(fs_1.default.readFileSync(alertStatePath, 'utf-8'));
            if (a && typeof a.__lastDigestSentAt === 'number')
                diskLastAt = Math.max(diskLastAt, a.__lastDigestSentAt);
            if (a && typeof a.__lastDigestHash === 'string')
                diskHash = a.__lastDigestHash;
        }
    }
    catch (e) { }
    try {
        if (fs_1.default.existsSync(settingsPath)) {
            const s = JSON.parse(fs_1.default.readFileSync(settingsPath, 'utf-8'));
            if (s && typeof s.lastDigestSentAt === 'number')
                diskLastAt = Math.max(diskLastAt, s.lastDigestSentAt);
            if (s && typeof s.lastDigestHash === 'string' && !diskHash)
                diskHash = s.lastDigestHash;
            if (s && typeof s.liveDigestEnabled === 'boolean')
                liveDigestEnabled = s.liveDigestEnabled;
        }
    }
    catch (e) { }
    return {
        lastDigestSentAt: Math.max(memLastDigestSentAt, diskLastAt),
        lastDigestHash: memLastDigestHash || diskHash,
        liveDigestEnabled
    };
}
function writeDigestStateToDisk(sentAt, digestHash) {
    memLastDigestSentAt = sentAt;
    memLastDigestHash = digestHash;
    const alertStatePath = path_1.default.resolve(process.cwd(), 'alertState.json');
    const settingsPath = path_1.default.resolve(process.cwd(), 'botSettings.json');
    try {
        let a = {};
        if (fs_1.default.existsSync(alertStatePath)) {
            a = JSON.parse(fs_1.default.readFileSync(alertStatePath, 'utf-8')) || {};
        }
        a.__lastDigestSentAt = sentAt;
        a.__lastDigestHash = digestHash;
        (0, policies_1.atomicWriteJson)(alertStatePath, a);
    }
    catch (e) { }
    try {
        let s = { muteVaulted: true, liveDigestEnabled: false };
        if (fs_1.default.existsSync(settingsPath)) {
            s = { ...s, ...(JSON.parse(fs_1.default.readFileSync(settingsPath, 'utf-8')) || {}) };
        }
        s.lastDigestSentAt = sentAt;
        s.lastDigestHash = digestHash;
        (0, policies_1.atomicWriteJson)(settingsPath, s);
    }
    catch (e) { }
}
async function sendStockDigestCard(options) {
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
    const liveStockPath = path_1.default.resolve(process.cwd(), 'liveStock.json');
    const policiesPath = path_1.default.resolve(process.cwd(), 'policies.json');
    let liveMap = {};
    let policies = [];
    let cache = {};
    try {
        if (fs_1.default.existsSync(liveStockPath))
            liveMap = JSON.parse(fs_1.default.readFileSync(liveStockPath, 'utf-8'));
    }
    catch (e) { }
    try {
        if (fs_1.default.existsSync(policiesPath))
            policies = JSON.parse(fs_1.default.readFileSync(policiesPath, 'utf-8'));
    }
    catch (e) { }
    try {
        if (fs_1.default.existsSync(TELEMETRY_PATH))
            cache = JSON.parse(fs_1.default.readFileSync(TELEMETRY_PATH, 'utf-8'));
    }
    catch (e) { }
    const policyMap = new Map(policies.map(p => [p.id, p]));
    const now = Date.now();
    const validDeals = [];
    for (const [ruleId, entry] of Object.entries(liveMap)) {
        if (ruleId.startsWith('__') || !entry || !entry.inStock)
            continue;
        const pol = policyMap.get(ruleId);
        if (!pol || pol.active === false)
            continue;
        const rawMaxBuy = Math.max(pol.msrpCeiling || 0, pol.maxMarketBuyPrice || 0);
        const effectiveMaxBuy = entry.isPreOrder
            ? Math.min(rawMaxBuy, Math.round((pol.msrpCeiling || 0) * 1.05))
            : rawMaxBuy;
        const landed = entry.landedPrice || entry.price;
        const eligible = entry.price <= effectiveMaxBuy && (landed <= effectiveMaxBuy || Boolean(entry.freeShipNote));
        if (!eligible || (now - (entry.updatedAt || 0)) > 6 * 60 * 60 * 1000)
            continue;
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
    const formatDealLine = (d) => {
        const spreadText = d.spreadPct >= 0 ? `${d.spreadPct}% Under Mkt` : `${Math.abs(d.spreadPct)}% Above Mkt`;
        const preTag = d.isPreOrder ? ' `[PRE-ORDER]`' : '';
        const cartSegment = d.cartUrl ? ` • [1x Cart ↗](${d.cartUrl})` : '';
        return `◈ **${d.name}**${preTag} — **$${d.price.toFixed(2)}** (${spreadText}) @ ${d.store} — [Checkout ↗](${d.url})${cartSegment}`;
    };
    const neededDeals = topDeals.filter(d => !d.owned);
    const crewDeals = topDeals.filter(d => d.owned);
    const fields = [];
    if (neededDeals.length > 0) {
        fields.push({
            name: `◈ ⟦ NEEDED FOR WALL // ACTIVE (${neededDeals.length}) ⟧`,
            value: neededDeals.map(formatDealLine).join('\n').slice(0, 1020),
            inline: false
        });
    }
    if (crewDeals.length > 0) {
        fields.push({
            name: `❖ ⟦ IN VAULT // CREW DEALS (${crewDeals.length}) ⟧`,
            value: crewDeals.map(formatDealLine).join('\n').slice(0, 1020),
            inline: false
        });
    }
    // Recent 4-Hour OOS tracker line
    let recentOosList = [];
    if (Array.isArray(liveMap.__recentOos)) {
        recentOosList = liveMap.__recentOos.filter((x) => now - (x.oosAt || 0) < 4 * 60 * 60 * 1000);
    }
    if (recentOosList.length > 0) {
        const oosSummary = recentOosList
            .slice(0, 4)
            .map(x => `${x.ruleName} ($${Number(x.price).toFixed(2)} @ ${x.retailer})`)
            .join(' • ');
        fields.push({
            name: '▲ ⟦ DEPLETED IN LAST 4 HOURS ⟧',
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
        title: `◈ ⟦ 4-HOUR LIVE SHELF DIGEST // ${validDeals.length} ACTIVE DEALS ⟧`,
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
    }
    catch (err) {
        console.error(`[DIGEST ERROR] Failed to send digest card: ${err.message}`);
        return { sent: false, count: 0, reason: err.message };
    }
}
function startStockDigestScheduler() {
    // NEVER fire a Live Shelf Digest on process startup/boot!
    // Only evaluate on the 4-hour interval (which also enforces liveDigestEnabled=false by default + 4h disk cooldown).
    setInterval(() => {
        sendStockDigestCard().catch(() => { });
    }, DIGEST_COOLDOWN_MS);
}
