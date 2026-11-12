import fs from 'fs';
import path from 'path';
import { WATCH_POLICIES, PolicyRule, computeRipMetrics } from '../../policies';
import { isVerified1PBigBoxOrPc, buildShopifyDirectCartLinks, buildMobileRetailerLinks } from '../../evaluator';
import { CompQuote } from '../../marketComps';
import { buildEarnedWatermarkSummary } from '../engine/watermarkHistory';
import { formatCollectionAndCostLine } from '../engine/purchaseMemory';

const ART_DIR = path.resolve(process.cwd(), 'art');
const MARKET_CACHE_PATH = path.resolve(process.cwd(), 'marketCache.json');

const SET_LOGO_FALLBACKS: Array<[RegExp, string]> = [
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
let cachedMktMap: Record<string, any> = {};

function getMarketCacheFast(): Record<string, any> {
  try {
    if (!fs.existsSync(MARKET_CACHE_PATH)) return cachedMktMap;
    const st = fs.statSync(MARKET_CACHE_PATH);
    if (st.mtimeMs > cachedMktMtime) {
      cachedMktMap = JSON.parse(fs.readFileSync(MARKET_CACHE_PATH, 'utf-8')) || {};
      cachedMktMtime = st.mtimeMs;
    }
  } catch {}
  return cachedMktMap;
}

function normalizeHttpImageUrl(raw?: string | null): string | undefined {
  const s = String(raw || '').trim();
  if (!s) return undefined;
  if (s.startsWith('//')) return `https:${s}`;
  return /^https?:\/\//i.test(s) ? s : undefined;
}

export function extractTcgProductId(urlOrId?: string | number | null): number | null {
  if (typeof urlOrId === 'number' && Number.isFinite(urlOrId) && urlOrId > 0) return Math.floor(urlOrId);
  const str = String(urlOrId || '').trim();
  if (/^\d{5,9}$/.test(str)) return parseInt(str, 10);
  const m = str.match(/tcgplayer\.com\/product\/(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

export interface ResolvedBoxArt {
  thumbnailUrl: string;
  localFilePath?: string;
  tcgProductId?: number;
}

export function resolveAlertBoxArt(params: {
  imageUrl?: string; ruleId?: string; rule?: PolicyRule | null; tcgCompUrl?: string; existingThumbnailUrl?: string;
}): ResolvedBoxArt {
  const rule = params.rule ?? (params.ruleId ? WATCH_POLICIES.find((p) => p.id === params.ruleId) : null);
  const skuId = params.ruleId || rule?.id || '';
  const cache = getMarketCacheFast();
  const unitFallbacks = skuId
    ? [skuId, skuId.replace(/-etb-case$/i, '-etb'), skuId.replace(/-booster-case$/i, '-booster-box'), skuId.replace(/-case$/i, '')]
    : [];

  let tcgProdId = extractTcgProductId(params.tcgCompUrl) || extractTcgProductId(rule?.tcgProductId);
  if (!tcgProdId) {
    for (const candId of unitFallbacks) {
      const candRule = WATCH_POLICIES.find((p) => p.id === candId);
      const pid = extractTcgProductId(candRule?.tcgProductId) || extractTcgProductId(cache[candId]?.lowestUrl);
      if (pid) { tcgProdId = pid; break; }
    }
  }

  const directImg = normalizeHttpImageUrl(params.imageUrl) || normalizeHttpImageUrl(rule?.image);
  if (directImg) return { thumbnailUrl: directImg, tcgProductId: tcgProdId || undefined };

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
    if (!candId) continue;
    for (const ext of ['.jpg', '.png', '.webp']) {
      const fp = path.join(ART_DIR, `${candId}${ext}`);
      try {
        if (fs.existsSync(fp) && fs.statSync(fp).size > 1000) return { thumbnailUrl: 'attachment://boxart.jpg', localFilePath: fp };
      } catch {}
    }
  }

  const hay = `${skuId} ${rule?.name || ''}`;
  for (const [pattern, url] of SET_LOGO_FALLBACKS) {
    if (pattern.test(hay)) return { thumbnailUrl: url };
  }
  return { thumbnailUrl: 'https://images.pokemontcg.io/sv8pt5/logo.png' };
}

export interface AlertPingTheme {
  is1PBigBox: boolean;
  is1PMsrpDrop: boolean;
  mentionContent: string;
  embedColor: number;
  verdictHeadline: string;
}

export function resolveAlertPingAndTheme(params: {
  retailer: string; url?: string; productUrl?: string; shelfPrice: number; msrp: number;
  bigBoxTier?: string; isMsrpUnicorn?: boolean; isQueueOrDraw?: boolean;
}): AlertPingTheme {
  if (params.isQueueOrDraw) {
    return { is1PBigBox: true, is1PMsrpDrop: true, mentionContent: '@here', embedColor: 0xDC2626, verdictHeadline: 'INVITE OR DRAW LIVE' };
  }
  const is1PBigBox = isVerified1PBigBoxOrPc(params.retailer, params.productUrl || params.url, false);
  const nearMsrp = params.msrp > 0 && params.shelfPrice > 0 && params.shelfPrice <= Math.round(params.msrp * 1.08 * 100) / 100;
  const is1PMsrpDrop = Boolean(
    is1PBigBox &&
    (params.bigBoxTier === 'BIG_BOX_RESTOCK_RADAR' || params.bigBoxTier === 'PC_EXCLUSIVE_MSRP' || params.bigBoxTier === 'MSRP_TIER_A' || params.isMsrpUnicorn || nearMsrp)
  );
  if (is1PMsrpDrop) {
    const isCrimson = /pok[eé]mon\s*center|\btarget\b|\bcostco\b/i.test(params.retailer);
    return { is1PBigBox: true, is1PMsrpDrop: true, mentionContent: '@here', embedColor: isCrimson ? 0xDC2626 : 0xF59E0B, verdictHeadline: '1P MSRP DROP — BUY NOW' };
  }
  return { is1PBigBox, is1PMsrpDrop: false, mentionContent: '', embedColor: 0x10B981, verdictHeadline: 'SUGGESTED BUY' };
}

export function cleanRetailerDisplayUpper(retailer: string): string {
  return String(retailer || 'STORE')
    .replace(/\s*\[BIG-BOX RESTOCK RADAR\]/gi, '')
    .replace(/\s*\(via [^)]+\)/gi, '')
    .trim()
    .toUpperCase();
}

function buildOneTapActionBar(params: {
  retailer: string; url: string; productUrl?: string; cart1xUrl?: string; cart2xUrl?: string;
  itemId?: string; stock?: number; productLabel: string; tcgComp?: CompQuote; fallbackTcgUrl?: string;
}): { primaryFastUrl: string; actionBarMarkdown: string } {
  const knownStock = typeof params.stock === 'number' && params.stock > 0 ? params.stock : undefined;
  const directCart = buildShopifyDirectCartLinks({
    url: params.url, productUrl: params.productUrl, cart1xUrl: params.cart1xUrl, cart2xUrl: params.cart2xUrl,
    itemId: params.itemId, stock: knownStock, retailer: params.retailer
  });
  const prodPageUrl = params.productUrl || (params.url.includes('/cart/') ? params.url.split('/cart/')[0] : params.url);
  const mobileLinks = buildMobileRetailerLinks({ retailer: params.retailer, url: params.url, productUrl: prodPageUrl, itemId: params.itemId });

  const qTcg = encodeURIComponent(params.productLabel);
  const qEbaySold = encodeURIComponent(`Pokemon ${params.productLabel} Sealed`);
  const tcgUrl = params.tcgComp?.url || params.fallbackTcgUrl || `https://www.tcgplayer.com/search/pokemon/product?productLineName=pokemon&q=${qTcg}&view=grid`;
  const ebaySoldUrl = `https://www.ebay.com/sch/i.html?_nkw=${qEbaySold}&LH_Complete=1&LH_Sold=1&_sop=13`;

  const pills: string[] = [];
  let primaryFastUrl = prodPageUrl || params.url;
  if (directCart.cart1xUrl && directCart.cart1xUrl.includes('/cart/')) {
    primaryFastUrl = directCart.cart1xUrl;
    pills.push(`[⚡ Shop Pay 1x ↗](${directCart.cart1xUrl})`);
    if (directCart.cart2xUrl) pills.push(`[⚡ 2x ↗](${directCart.cart2xUrl})`);
  } else {
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

export function buildCleanDiscordAlertEmbed(params: {
  titlePrefix?: string; retailer: string; productName: string; url: string; productUrl?: string;
  imageUrl?: string; existingThumbnailUrl?: string; cart1xUrl?: string; cart2xUrl?: string;
  itemId?: string; stock?: number; ruleId?: string; formFactor?: string; shelfPrice: number;
  landedPrice: number; shippingAmount: number; msrp: number; sliderCeiling: number; marketFallback: number;
  packCount?: number; pricePerPack?: number; ownedInVault?: boolean; bigBoxTier?: string;
  isMsrpUnicorn?: boolean; isPreOrder?: boolean; tcgComp?: CompQuote; fallbackTcgUrl?: string; tcgQuarterNote?: string;
}): { embed: any; boxArt: ResolvedBoxArt; theme: AlertPingTheme; primaryFastUrl: string } {
  const rule = params.ruleId ? WATCH_POLICIES.find((p) => p.id === params.ruleId) : null;
  const theme = resolveAlertPingAndTheme({
    retailer: params.retailer, url: params.url, productUrl: params.productUrl,
    shelfPrice: params.shelfPrice, msrp: params.msrp, bigBoxTier: params.bigBoxTier, isMsrpUnicorn: params.isMsrpUnicorn
  });
  const boxArt = resolveAlertBoxArt({
    imageUrl: params.imageUrl, ruleId: params.ruleId, rule, tcgCompUrl: params.tcgComp?.url, existingThumbnailUrl: params.existingThumbnailUrl
  });
  const rip = computeRipMetrics(
    params.landedPrice, params.ruleId || rule?.id, params.formFactor || rule?.formFactor, params.productName, params.packCount || rule?.packCount
  );
  const pricePerPack = params.pricePerPack && params.pricePerPack > 0 ? params.pricePerPack : rip.pricePerPack;

  const tcgLow = params.tcgComp && params.tcgComp.price > 0 ? params.tcgComp.price : 0;
  const refComp = tcgLow > 0 ? tcgLow : params.marketFallback;
  const refLabel = tcgLow > 0 ? 'TCGPlayer' : 'Market';
  const savings = Math.round((refComp - params.landedPrice) * 100) / 100;
  const savingsPart = refComp > 0
    ? (savings >= 0.50 ? `Save $${savings.toFixed(2)} vs. ${refLabel}` : `Matches ${refLabel} Low`)
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
  const wm = buildEarnedWatermarkSummary(params.ruleId || rule?.id, params.landedPrice);
  const line3 = params.tcgQuarterNote ? `${wm.watermarkStrip} ${params.tcgQuarterNote}` : wm.watermarkStrip;
  const line4 = formatCollectionAndCostLine({
    skuId: params.ruleId || rule?.id, formFactor: params.formFactor || rule?.formFactor, productName: params.productName,
    landedPrice: params.landedPrice, packCount: rip.packCount, pricePerPack, rule, ownedFallback: params.ownedInVault
  });

  const { primaryFastUrl, actionBarMarkdown } = buildOneTapActionBar({
    retailer: params.retailer, url: params.url, productUrl: params.productUrl, cart1xUrl: params.cart1xUrl, cart2xUrl: params.cart2xUrl,
    itemId: params.itemId, stock: params.stock, productLabel: params.productName, tcgComp: params.tcgComp, fallbackTcgUrl: params.fallbackTcgUrl
  });

  const stockNote = typeof params.stock === 'number' && params.stock > 0 ? `Stock: ${params.stock}` : 'In Stock';
  const preOrderNote = params.isPreOrder ? ' • Pre-Order' : '';
  const prefix = params.titlePrefix ? `${params.titlePrefix.trim()} ` : '';

  const embed: any = {
    title: `${prefix}${cleanRetailerDisplayUpper(params.retailer)} — ${params.productName}`,
    url: primaryFastUrl,
    color: theme.embedColor,
    thumbnail: { url: boxArt.thumbnailUrl },
    description: `${line1}\n${line2}\n${line3}\n${line4}\n\n${actionBarMarkdown}`,
    footer: { text: `DropBot V6 • ${stockNote}${preOrderNote}` },
    timestamp: new Date().toISOString()
  };

  return { embed, boxArt, theme, primaryFastUrl };
}
