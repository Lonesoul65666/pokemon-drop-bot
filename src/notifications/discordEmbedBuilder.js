"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTcgProductId = extractTcgProductId;
exports.resolveAlertBoxArt = resolveAlertBoxArt;
exports.resolveAlertPingAndTheme = resolveAlertPingAndTheme;
exports.cleanRetailerDisplayUpper = cleanRetailerDisplayUpper;
exports.detectActiveFloorSlide = detectActiveFloorSlide;
exports.buildCleanDiscordAlertEmbed = buildCleanDiscordAlertEmbed;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const policies_1 = require("../../policies");
const evaluator_1 = require("../../evaluator");
const watermarkHistory_1 = require("../engine/watermarkHistory");
const purchaseMemory_1 = require("../engine/purchaseMemory");
const ART_DIR = path_1.default.resolve(process.cwd(), 'art');
const MARKET_CACHE_PATH = path_1.default.resolve(process.cwd(), 'marketCache.json');
const SET_LOGO_FALLBACKS = [
    [/^me-30th|30th[-\s]*celebration/i, 'https://images.pokemontcg.io/cel25/logo.png'],
    [/^sv-prismatic|prismatic[-\s]*evolutions/i, 'https://images.pokemontcg.io/sv8pt5/logo.png'],
    [/^sv-surging|surging[-\s]*sparks/i, 'https://images.pokemontcg.io/sv8/logo.png'],
    [/^sv-151|\b151\b/i, 'https://images.pokemontcg.io/sv3pt5/logo.png'],
    [/^sv-paldean|paldean[-\s]*fates/i, 'https://images.pokemontcg.io/sv4pt5/logo.png'],
    [/^sv-twilight|twilight[-\s]*masquerade/i, 'https://images.pokemontcg.io/sv6/logo.png'],
    [/^sv-stellar|stellar[-\s]*crown/i, 'https://images.pokemontcg.io/sv7/logo.png'],
    [/^sv-obsidian|obsidian[-\s]*flames/i, 'https://images.pokemontcg.io/sv3/logo.png'],
    [/^sv-paldea|paldea[-\s]*evolved/i, 'https://images.pokemontcg.io/sv2/logo.png'],
    [/^swsh-evolving|evolving[-\s]*skies/i, 'https://images.pokemontcg.io/swsh7/logo.png'],
    [/^swsh-crown|crown[-\s]*zenith/i, 'https://images.pokemontcg.io/swsh12pt5/logo.png'],
    [/^swsh-lost|lost[-\s]*origin/i, 'https://images.pokemontcg.io/swsh11/logo.png'],
    [/^swsh-fusion|fusion[-\s]*strike/i, 'https://images.pokemontcg.io/swsh8/logo.png'],
    [/^swsh-chilling|chilling[-\s]*reign/i, 'https://images.pokemontcg.io/swsh6/logo.png'],
    [/^swsh-brilliant|brilliant[-\s]*stars/i, 'https://images.pokemontcg.io/swsh9/logo.png']
];
let cachedMktMtime = 0;
let cachedMktMap = {};
function getMarketCacheFast() {
    try {
        if (!fs_1.default.existsSync(MARKET_CACHE_PATH))
            return cachedMktMap;
        const st = fs_1.default.statSync(MARKET_CACHE_PATH);
        if (st.mtimeMs > cachedMktMtime) {
            cachedMktMap = JSON.parse(fs_1.default.readFileSync(MARKET_CACHE_PATH, 'utf-8')) || {};
            cachedMktMtime = st.mtimeMs;
        }
    }
    catch { }
    return cachedMktMap;
}
function normalizeHttpImageUrl(raw) {
    const s = String(raw || '').trim();
    if (!s)
        return undefined;
    if (s.startsWith('//'))
        return `https:${s}`;
    return /^https?:\/\//i.test(s) ? s : undefined;
}
function extractTcgProductId(urlOrId) {
    if (typeof urlOrId === 'number' && Number.isFinite(urlOrId) && urlOrId > 0)
        return Math.floor(urlOrId);
    const str = String(urlOrId || '').trim();
    if (/^\d{5,9}$/.test(str))
        return parseInt(str, 10);
    const m = str.match(/tcgplayer\.com\/product\/(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
}
function resolveAlertBoxArt(params) {
    const rule = params.rule ?? (params.ruleId ? policies_1.WATCH_POLICIES.find((p) => p.id === params.ruleId) : null);
    const skuId = params.ruleId || rule?.id || '';
    const cache = getMarketCacheFast();
    const unitFallbacks = skuId
        ? [skuId, skuId.replace(/-etb-case$/i, '-etb'), skuId.replace(/-booster-case$/i, '-booster-box'), skuId.replace(/-case$/i, '')]
        : [];
    let tcgProdId = extractTcgProductId(params.tcgCompUrl) || extractTcgProductId(rule?.tcgProductId);
    if (!tcgProdId) {
        for (const candId of unitFallbacks) {
            const candRule = policies_1.WATCH_POLICIES.find((p) => p.id === candId);
            const pid = extractTcgProductId(candRule?.tcgProductId) || extractTcgProductId(cache[candId]?.lowestUrl);
            if (pid) {
                tcgProdId = pid;
                break;
            }
        }
    }
    const directImg = normalizeHttpImageUrl(params.imageUrl) || normalizeHttpImageUrl(rule?.image);
    if (directImg)
        return { thumbnailUrl: directImg, tcgProductId: tcgProdId || undefined };
    if (params.existingThumbnailUrl && /^attachment:\/\/|^https?:\/\//i.test(params.existingThumbnailUrl)) {
        if (params.existingThumbnailUrl.startsWith('attachment://') && tcgProdId) {
            return { thumbnailUrl: `https://product-images.tcgplayer.com/fit-in/437x437/${tcgProdId}.jpg`, tcgProductId: tcgProdId };
        }
        return { thumbnailUrl: params.existingThumbnailUrl, tcgProductId: tcgProdId || undefined };
    }
    if (tcgProdId) {
        return { thumbnailUrl: `https://product-images.tcgplayer.com/fit-in/437x437/${tcgProdId}.jpg`, tcgProductId: tcgProdId };
    }
    for (const candId of unitFallbacks) {
        if (!candId)
            continue;
        for (const ext of ['.jpg', '.png', '.webp']) {
            const fp = path_1.default.join(ART_DIR, `${candId}${ext}`);
            try {
                if (fs_1.default.existsSync(fp) && fs_1.default.statSync(fp).size > 1000)
                    return { thumbnailUrl: 'attachment://boxart.jpg', localFilePath: fp };
            }
            catch { }
        }
    }
    const hay = `${skuId} ${rule?.name || ''}`;
    for (const [pattern, url] of SET_LOGO_FALLBACKS) {
        if (pattern.test(hay))
            return { thumbnailUrl: url };
    }
    return { thumbnailUrl: 'https://images.pokemontcg.io/sv8pt5/logo.png' };
}
function resolveAlertPingAndTheme(params) {
    if (params.isQueueOrDraw) {
        return { is1PBigBox: true, is1PMsrpDrop: true, mentionContent: '@here', embedColor: 0xDC2626, verdictHeadline: 'INVITE OR DRAW LIVE' };
    }
    const is1PBigBox = (0, evaluator_1.isVerified1PBigBoxOrPc)(params.retailer, params.productUrl || params.url, false);
    const nearMsrp = params.msrp > 0 && params.shelfPrice > 0 && params.shelfPrice <= Math.round(params.msrp * 1.08 * 100) / 100;
    const is1PMsrpDrop = Boolean(is1PBigBox &&
        (params.bigBoxTier === 'BIG_BOX_RESTOCK_RADAR' || params.bigBoxTier === 'PC_EXCLUSIVE_MSRP' || params.bigBoxTier === 'MSRP_TIER_A' || params.isMsrpUnicorn || nearMsrp));
    if (is1PMsrpDrop) {
        const isCrimson = /pok[eé]mon\s*center|\btarget\b|\bcostco\b/i.test(params.retailer);
        return { is1PBigBox: true, is1PMsrpDrop: true, mentionContent: '@here', embedColor: isCrimson ? 0xDC2626 : 0xF59E0B, verdictHeadline: '1P MSRP DROP — BUY NOW' };
    }
    return { is1PBigBox, is1PMsrpDrop: false, mentionContent: '', embedColor: 0x10B981, verdictHeadline: 'SUGGESTED BUY' };
}
function cleanRetailerDisplayUpper(retailer) {
    return String(retailer || 'STORE')
        .replace(/\s*\[BIG-BOX RESTOCK RADAR\]/gi, '')
        .replace(/\s*\(via [^)]+\)/gi, '')
        .trim()
        .toUpperCase();
}
function isTcgQuarterSliding(tcgLow, tcgQuarterNote) {
    if (!tcgQuarterNote)
        return false;
    const nums = Array.from(tcgQuarterNote.matchAll(/\$([0-9,]+(?:\.[0-9]+)?)/g)).map((m) => parseFloat(m[1].replace(/,/g, '')));
    if (nums.length >= 2 && nums[0] < nums[1] * 0.975)
        return true;
    if (nums.length >= 1 && tcgLow > 0 && tcgLow < nums[0] * 0.975)
        return true;
    return false;
}
function detectActiveFloorSlide(params) {
    if (params.wm.isSlidingDown)
        return true;
    if (params.trendSignal === 'FALLING_KNIFE_WAIT')
        return true;
    if (/BLEEDING[_\s-]*DOWN|FALLING[_\s-]*KNIFE/i.test(`${params.trendSignal || ''} ${params.trendVerdictLabel || ''}`))
        return true;
    return isTcgQuarterSliding(params.tcgLow || 0, params.tcgQuarterNote);
}
function buildOneTapActionBar(params) {
    const knownStock = typeof params.stock === 'number' && params.stock > 0 ? params.stock : undefined;
    const isCase = (0, evaluator_1.isCaseSkuFormat)(params.formFactor, params.ruleId, params.productLabel);
    const directCart = (0, evaluator_1.buildShopifyDirectCartLinks)({
        url: params.url, productUrl: params.productUrl, cart1xUrl: params.cart1xUrl,
        cart2xUrl: isCase ? undefined : params.cart2xUrl,
        cart3xUrl: isCase ? undefined : params.cart3xUrl,
        itemId: params.itemId, stock: knownStock, retailer: params.retailer,
        formFactor: params.formFactor, ruleId: params.ruleId, productName: params.productLabel
    });
    const prodPageUrl = params.productUrl || (params.url.includes('/cart/') ? params.url.split('/cart/')[0] : params.url);
    const mobileLinks = (0, evaluator_1.buildMobileRetailerLinks)({ retailer: params.retailer, url: params.url, productUrl: prodPageUrl, itemId: params.itemId });
    const qTcg = encodeURIComponent(params.productLabel);
    const qEbaySold = encodeURIComponent(`Pokemon ${params.productLabel} Sealed`);
    const tcgUrl = params.tcgComp?.url || params.fallbackTcgUrl || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${qTcg}&view=grid`;
    const ebaySoldUrl = `https://www.ebay.com/sch/i.html?_nkw=${qEbaySold}&LH_Complete=1&LH_Sold=1&_sop=13`;
    const pills = [];
    let primaryFastUrl = prodPageUrl || params.url;
    const allowMultiQty = !isCase && /\betb\b|elite\s*trainer|\bbundle\b/i.test(`${params.formFactor || ''} ${params.ruleId || ''} ${params.productLabel}`);
    if (directCart.cart1xUrl && directCart.cart1xUrl.includes('/cart/')) {
        primaryFastUrl = directCart.cart1xUrl;
        pills.push(`[⚡ Shop Pay 1x ↗](${directCart.cart1xUrl})`);
        if (!isCase && directCart.cart2xUrl)
            pills.push(`[⚡ 2x ↗](${directCart.cart2xUrl})`);
        if (allowMultiQty && directCart.cart3xUrl)
            pills.push(`[⚡ 3x ↗](${directCart.cart3xUrl})`);
    }
    else {
        primaryFastUrl = mobileLinks.primaryCheckoutUrl || params.url;
        const cleanStore = cleanRetailerDisplayUpper(params.retailer);
        const label1p = /TARGET/.test(cleanStore) ? 'Open Target' : /BEST BUY/.test(cleanStore) ? 'Best Buy 1-Tap Cart'
            : /WALMART/.test(cleanStore) ? 'Walmart 1-Tap Cart' : /AMAZON/.test(cleanStore) ? 'Amazon 1P Cart' : 'Checkout Now';
        pills.push(`[⚡ ${label1p} ↗](${primaryFastUrl})`);
        if (mobileLinks.secondaryPdpUrl && mobileLinks.secondaryPdpUrl !== primaryFastUrl) {
            pills.push(`[Product Page ↗](${mobileLinks.secondaryPdpUrl})`);
        }
    }
    pills.push(`[TCGPlayer ↗](${tcgUrl})`, `[eBay Sold ↗](${ebaySoldUrl})`);
    return { primaryFastUrl, actionBarMarkdown: pills.join(' • ') };
}
function buildCleanDiscordAlertEmbed(params) {
    const rule = params.ruleId ? policies_1.WATCH_POLICIES.find((p) => p.id === params.ruleId) : null;
    const theme = resolveAlertPingAndTheme({
        retailer: params.retailer, url: params.url, productUrl: params.productUrl,
        shelfPrice: params.shelfPrice, msrp: params.msrp, bigBoxTier: params.bigBoxTier, isMsrpUnicorn: params.isMsrpUnicorn
    });
    const boxArt = resolveAlertBoxArt({
        imageUrl: params.imageUrl, ruleId: params.ruleId, rule, tcgCompUrl: params.tcgComp?.url, existingThumbnailUrl: params.existingThumbnailUrl
    });
    const rip = (0, policies_1.computeRipMetrics)(params.landedPrice, params.ruleId || rule?.id, params.formFactor || rule?.formFactor, params.productName, params.packCount || rule?.packCount);
    const pricePerPack = params.pricePerPack && params.pricePerPack > 0 ? params.pricePerPack : rip.pricePerPack;
    const tcgLow = params.tcgComp && params.tcgComp.price > 0 ? params.tcgComp.price : 0;
    const refComp = tcgLow > 0 ? tcgLow : params.marketFallback;
    const refLabel = tcgLow > 0 ? 'TCGPlayer' : 'Market';
    const savings = Math.round((refComp - params.landedPrice) * 100) / 100;
    const discountPct = refComp > 0 ? ((refComp - params.landedPrice) / refComp) * 100 : 0;
    const wm = (0, watermarkHistory_1.buildEarnedWatermarkSummary)(params.ruleId || rule?.id, params.landedPrice);
    const isSliding = detectActiveFloorSlide({
        wm, trendSignal: params.trendSignal, trendVerdictLabel: params.trendVerdictLabel, tcgLow, tcgQuarterNote: params.tcgQuarterNote
    });
    if (!theme.is1PMsrpDrop) {
        const pctRounded = Math.max(1, Math.round(discountPct));
        if (isSliding) {
            theme.embedColor = 0xF59E0B;
            theme.verdictHeadline = `CAUTIOUS DIP — STILL SLIDING (-${pctRounded}% vs. ${refLabel})`;
        }
        else if (wm.hasStableOrCurlingFloor || discountPct >= 12) {
            theme.embedColor = 0x10B981;
            theme.verdictHeadline = 'SUGGESTED BUY';
        }
        else {
            theme.embedColor = 0xF59E0B;
            theme.verdictHeadline = `CAUTIOUS DIP — EARLY FLOOR (-${pctRounded}% vs. ${refLabel})`;
        }
    }
    const savingsPart = refComp > 0
        ? (savings >= 0.50
            ? (theme.verdictHeadline.includes('vs.') ? `Save $${savings.toFixed(2)}` : `Save $${savings.toFixed(2)} vs. ${refLabel}`)
            : `Matches ${refLabel} Low`)
        : 'Verified Live Stock';
    const line1 = `**${theme.verdictHeadline}** — ${savingsPart} • $${pricePerPack.toFixed(2)} / pack`;
    const shipParen = params.shippingAmount > 0.01
        ? `($${params.shelfPrice.toFixed(2)} + $${params.shippingAmount.toFixed(2)} Ship)`
        : '(Free Ship)';
    const compSeg = tcgLow > 0 ? `TCGPlayer: $${tcgLow.toFixed(2)}` : (params.marketFallback > 0 ? `Market Est: $${params.marketFallback.toFixed(2)}` : '');
    const msrpSeg = params.msrp > 0 ? `MSRP: $${params.msrp.toFixed(2)}` : '';
    let sliderSeg = '';
    if (!theme.is1PMsrpDrop && params.sliderCeiling > 0) {
        const sliderDiff = Math.round((params.sliderCeiling - params.landedPrice) * 100) / 100;
        sliderSeg = Math.abs(sliderDiff) < 0.50
            ? 'On Slider Ceiling'
            : sliderDiff > 0
                ? `-$${sliderDiff.toFixed(2)} Under Your $${Math.round(params.sliderCeiling)} Slider`
                : `+$${Math.abs(sliderDiff).toFixed(2)} vs. Your $${Math.round(params.sliderCeiling)} Slider`;
    }
    const line2 = [`**$${params.landedPrice.toFixed(2)} Landed** ${shipParen}`, compSeg, msrpSeg, sliderSeg].filter(Boolean).join(' • ');
    const floorCore = wm.watermarkStrip.replace(/^Shelf Floor\s*[—-]\s*/i, '');
    const line3 = `**Floor:** ${params.tcgQuarterNote ? `${floorCore} ${params.tcgQuarterNote}` : floorCore}`;
    const ledgerCore = (0, purchaseMemory_1.formatCollectionAndCostLine)({
        skuId: params.ruleId || rule?.id, formFactor: params.formFactor || rule?.formFactor, productName: params.productName,
        landedPrice: params.landedPrice, packCount: rip.packCount, pricePerPack, rule, ownedFallback: params.ownedInVault
    });
    const line4 = `**Ledger:** ${ledgerCore}`;
    const { primaryFastUrl, actionBarMarkdown } = buildOneTapActionBar({
        retailer: params.retailer, url: params.url, productUrl: params.productUrl,
        cart1xUrl: params.cart1xUrl, cart2xUrl: params.cart2xUrl, cart3xUrl: params.cart3xUrl,
        itemId: params.itemId, stock: params.stock, ruleId: params.ruleId || rule?.id,
        formFactor: params.formFactor || rule?.formFactor, productLabel: params.productName,
        tcgComp: params.tcgComp, fallbackTcgUrl: params.fallbackTcgUrl
    });
    const stockNote = typeof params.stock === 'number' && params.stock > 0 ? `Stock: ${params.stock}` : 'In Stock';
    const preOrderNote = params.isPreOrder ? ' • Pre-Order' : '';
    const prefix = params.titlePrefix ? `${params.titlePrefix.trim()} ` : '';
    const embed = {
        title: `${prefix}${cleanRetailerDisplayUpper(params.retailer)} — ${params.productName}`,
        url: primaryFastUrl,
        color: theme.embedColor,
        thumbnail: { url: boxArt.thumbnailUrl },
        description: `${line1}\n${line2}\n\n${line3}\n${line4}\n\n${actionBarMarkdown}`,
        footer: { text: `DropBot V6 • ${stockNote}${preOrderNote}` },
        timestamp: new Date().toISOString()
    };
    return { embed, boxArt, theme, primaryFastUrl, isSliding, discountPct };
}
