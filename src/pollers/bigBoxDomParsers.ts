import {
  AMAZON_1P_MERCHANT_ID, BigBoxAdapterResult, ParsedRetailOffer, cleanHtmlText, resolveBigBoxPolicyMatch
} from './bigBoxAdapters';

function decodeHtmlEntities(s: string): string {
  return String(s || '')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#38;|&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

export function extractJsonLdShelfProducts(html: string, origin: string): {
  totalNodes: number;
  inStockItems: Array<{ title: string; price: number; url: string; sku: string; isPreOrder: boolean }>;
} {
  let totalNodes = 0;
  const inStockItems: Array<{ title: string; price: number; url: string; sku: string; isPreOrder: boolean }> = [];
  const scripts = [...String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
    if (Array.isArray(node.itemListElement)) node.itemListElement.forEach((el: any) => visit(el?.item || el));
    if (/Product/i.test(String(node['@type'] || '')) && node.name) {
      totalNodes += 1;
      const offers = Array.isArray(node.offers) ? node.offers : (node.offers ? [node.offers] : []);
      for (const off of offers) {
        const avail = String(off?.availability || '');
        if (!/(?:^|\/)(InStock|PreOrder|OnlineOnly|LimitedAvailability)$/i.test(avail)) continue;
        const p = parseFloat(String(off?.price ?? off?.lowPrice ?? '0').replace(/[^0-9.]/g, ''));
        const rawUrl = String(off?.url || node.url || '');
        const fullUrl = rawUrl.startsWith('http') ? rawUrl : (rawUrl ? `${origin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}` : origin);
        if (p > 0) {
          inStockItems.push({
            title: String(node.name), price: p, url: fullUrl,
            sku: String(node.sku || node.productID || node.gtin13 || p), isPreOrder: /PreOrder/i.test(avail)
          });
        }
      }
    }
  };
  for (const m of scripts) { try { visit(JSON.parse(m[1].trim())); } catch {} }
  return { totalNodes, inStockItems };
}

export function parseGameStopPayload(html: string): BigBoxAdapterResult {
  const src = String(html || ''), origin = 'https://www.gamestop.com';
  const inStockOffers: ParsedRetailOffer[] = [];
  const seenTileIds = new Set<string>(), seenOfferIds = new Set<string>();
  const ld = extractJsonLdShelfProducts(src, origin);

  for (const it of ld.inStockItems) {
    seenTileIds.add(it.sku);
    if (resolveBigBoxPolicyMatch({ title: it.title, price: it.price, retailer: 'GameStop', url: it.url })) {
      seenOfferIds.add(it.sku);
      inStockOffers.push({ title: cleanHtmlText(it.title), retailer: 'GameStop', url: it.url, productUrl: it.url, price: it.price, itemId: `gamestop_${it.sku}`, isPreOrder: it.isPreOrder, freeShipping: it.price >= 59 });
    }
  }

  for (const g of src.matchAll(/data-gtmdata=(["'])([\s\S]*?)\1/gi)) {
    try {
      const obj = JSON.parse(decodeHtmlEntities(g[2]));
      const pid = String(obj?.id || obj?.sku || obj?.productInfo?.sku || obj?.productInfo?.productID || '').trim();
      const title = cleanHtmlText(obj?.name || obj?.productInfo?.name || '');
      if (!pid && !title) continue;
      seenTileIds.add(pid || title);
      if (pid && seenOfferIds.has(pid)) continue;

      const rawAvail = obj?.availability ?? obj?.productInfo?.availability;
      const isAvail = typeof rawAvail === 'object' && rawAvail !== null
        ? Boolean(rawAvail.available || rawAvail.readyToOrder)
        : /instock|in\s*stock|available|pre-?order/i.test(String(rawAvail || ''));
      if (!isAvail) continue;

      const price = parseFloat(String(obj?.price?.selling ?? obj?.price?.basePrice ?? obj?.price ?? 0).replace(/[^0-9.]/g, ''));
      const relHref = pid ? src.match(new RegExp(`href=["']([^"']*\\/${pid}(?:\\.html)?[^"']*)["']`, 'i'))?.[1] : undefined;
      const url = relHref ? (relHref.startsWith('http') ? relHref : `${origin}${relHref.startsWith('/') ? '' : '/'}${relHref}`) : `${origin}/products/${pid}.html`;
      if (resolveBigBoxPolicyMatch({ title, price, retailer: 'GameStop', url })) {
        if (pid) seenOfferIds.add(pid);
        inStockOffers.push({ title, retailer: 'GameStop', url, productUrl: url, price, itemId: `gamestop_${pid || price}`, freeShipping: price >= 59 });
      }
    } catch {}
  }

  return { totalNodesFound: Math.max(seenTileIds.size, ld.totalNodes), inStockOffers };
}

function extractAmazonNonStrikePrice(scopeHtml: string): number {
  for (const pm of scopeHtml.matchAll(/<span([^>]*\bclass=["'][^"']*\ba-price\b[^"']*["'][^>]*)>([\s\S]{0,650}?)<\/span>\s*<\/span>/gi)) {
    if (/data-a-strike\s*=\s*["']true["']|\ba-text-price\b/i.test(pm[1] || '')) continue;
    const offscreen = (pm[0] || '').match(/class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>\s*\$([0-9]+(?:\.[0-9]{2})?)\s*</i);
    if (offscreen) return parseFloat(offscreen[1]);
  }
  const wholeFrac = scopeHtml.match(/class=["'][^"']*\ba-price-whole\b[^"']*["'][^>]*>([0-9,]+)[\s\S]{0,160}?class=["'][^"']*\ba-price-fraction\b[^"']*["'][^>]*>([0-9]{2})</i);
  return wholeFrac ? parseFloat(`${wholeFrac[1].replace(/,/g, '')}.${wholeFrac[2]}`) : 0;
}

export function parseAmazon1pPayload(html: string, isAtvLockedFeed = false): BigBoxAdapterResult {
  const src = String(html || '');
  const inStockOffers: ParsedRetailOffer[] = [];
  if (!src) return { totalNodesFound: 0, inStockOffers };

  const cardTagMatches = [...src.matchAll(/<div[^>]*\bdata-component-type=["']s-search-result["'][^>]*>/gi)];
  let totalNodesFound = 0;
  const seenAsins = new Set<string>();

  for (let i = 0; i < cardTagMatches.length; i++) {
    const openTag = cardTagMatches[i][0];
    const startIdx = cardTagMatches[i].index ?? 0;
    const nextIdx = i + 1 < cardTagMatches.length ? (cardTagMatches[i + 1].index ?? src.length) : Math.min(src.length, startIdx + 32000);
    const rawCard = src.slice(startIdx, nextIdx);
    const footerCut = rawCard.search(/data-component-type=["']s-(?:bottom-slot|messaging-widget)|class=["'][^"']*s-pagination-strip/i);
    const block = footerCut > 0 ? rawCard.slice(0, footerCut) : rawCard;
    const asin = openTag.match(/\bdata-asin=["'](B0[A-Z0-9]{8})["']/i)?.[1]?.toUpperCase();
    if (!asin || seenAsins.has(asin)) continue;

    let brandPrefix = '', realTitle = '';
    for (const h2 of block.matchAll(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi)) {
      const aria = h2[1]?.match(/\baria-label=["']([^"']+)["']/i)?.[1];
      const txt = cleanHtmlText(aria || h2[2] || '');
      if (!txt || /^(?:more\s+results|results|related\s+searches|need\s+help\??)$/i.test(txt)) continue;
      if (/^(?:pok[eé]mon|the\s+pok[eé]mon\s+company|nintendo)$/i.test(txt) || txt.length < 10) {
        if (!brandPrefix && /pok[eé]mon/i.test(txt)) brandPrefix = 'Pokémon';
        continue;
      }
      realTitle = txt;
      break;
    }
    if (!realTitle) {
      const imgAlt = block.match(/class=["'][^"']*s-image[^"']*["'][^>]*\balt=["']([^"']{12,240})["']/i)?.[1];
      if (imgAlt) realTitle = cleanHtmlText(imgAlt);
    }
    if (!realTitle) continue;
    if (brandPrefix && !/pok[eé]mon/i.test(realTitle)) realTitle = `${brandPrefix} ${realTitle}`;

    seenAsins.add(asin);
    totalNodesFound += 1;
    if (/currently\s+unavailable|temporarily\s+out\s+of\s+stock/i.test(block)) continue;
    const price = extractAmazonNonStrikePrice(block);
    if (!price || /sold\s+by\s+(?!amazon\.com\b)[a-z0-9]/i.test(cleanHtmlText(block))) continue;

    const has1pProof = isAtvLockedFeed || /ATVPDKIKX0DER|ships\s+from\s+and\s+sold\s+by\s+amazon\.com|sold\s+by\s+amazon\.com/i.test(block);
    const hasBuySignal = /add\s+to\s+cart|a-button-atc|pre-?order/i.test(block) || (isAtvLockedFeed && !/see\s+all\s+buying\s+options/i.test(block));
    if (!has1pProof || !hasBuySignal) continue;

    const atcUrl = `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${asin}&Quantity.1=1`;
    const pdpUrl = `https://www.amazon.com/dp/${asin}?smid=${AMAZON_1P_MERCHANT_ID}`;
    if (!resolveBigBoxPolicyMatch({ title: realTitle, price, retailer: 'Amazon', url: pdpUrl, tokenField: 'amazonAsin', tokenValue: asin })) continue;
    inStockOffers.push({ title: realTitle, retailer: 'Amazon', url: atcUrl, productUrl: pdpUrl, cart1xUrl: atcUrl, price, itemId: `amazon_${asin}`, freeShipping: price >= 35 });
  }

  if (totalNodesFound === 0) {
    const pdpAsin = src.match(/(?:name=["']ASIN["'][^>]*value=["']|\/dp\/)(B0[A-Z0-9]{8})/i)?.[1]?.toUpperCase();
    const titleM = src.match(/id=["']productTitle["'][^>]*>([\s\S]{5,260}?)<\/span>/i);
    if (pdpAsin && titleM) {
      totalNodesFound = 1;
      const buyBoxRegion = src.match(/id=["'](?:corePriceDisplay_desktop_feature_div|corePrice_feature_div|apex_desktop)["'][\s\S]{0,4500}/i)?.[0] || '';
      const price = extractAmazonNonStrikePrice(buyBoxRegion);
      const has1p = /merchantID["'][^>]*value=["']ATVPDKIKX0DER["']|"merchantId"\s*:\s*"ATVPDKIKX0DER"|ships\s+from[\s\S]{0,120}?amazon\.com[\s\S]{0,120}?sold\s+by[\s\S]{0,120}?amazon\.com/i.test(src);
      const hasAtc = /id=["']add-to-cart-button["']|id=["']buy-now-button["']/i.test(src) && !/id=["']outOfStock["']|currently\s+unavailable/i.test(src);
      const title = cleanHtmlText(titleM[1]);
      const atcUrl = `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${pdpAsin}&Quantity.1=1`;
      const pdpUrl = `https://www.amazon.com/dp/${pdpAsin}?smid=${AMAZON_1P_MERCHANT_ID}`;
      if (has1p && hasAtc && price > 0 && resolveBigBoxPolicyMatch({ title, price, retailer: 'Amazon', url: pdpUrl, tokenField: 'amazonAsin', tokenValue: pdpAsin })) {
        inStockOffers.push({ title, retailer: 'Amazon', url: atcUrl, productUrl: pdpUrl, cart1xUrl: atcUrl, price, itemId: `amazon_${pdpAsin}`, freeShipping: price >= 35 });
      }
    }
  }
  return { totalNodesFound, inStockOffers };
}

export function parseBarnesAndNoblePayload(html: string): BigBoxAdapterResult {
  const src = String(html || '');
  const inStockOffers: ParsedRetailOffer[] = [];
  const seenAllEans = new Set<string>(), seenHitEans = new Set<string>();
  const ld = extractJsonLdShelfProducts(src, 'https://www.barnesandnoble.com');

  for (const it of ld.inStockItems) {
    seenAllEans.add(it.sku);
    if (resolveBigBoxPolicyMatch({ title: it.title, price: it.price, retailer: 'Barnes & Noble', url: it.url })) {
      seenHitEans.add(it.sku);
      inStockOffers.push({ title: cleanHtmlText(it.title), retailer: 'Barnes & Noble', url: it.url, productUrl: it.url, price: it.price, itemId: `bn_${it.sku}`, isPreOrder: it.isPreOrder, freeShipping: it.price >= 40 });
    }
  }
  const bnLinks = [...src.matchAll(/href=["'](\/w\/[^"']*[?&]ean=(\d{12,13})[^"']*)["']/gi)];
  for (let i = 0; i < bnLinks.length; i++) {
    const relHref = bnLinks[i][1], ean = bnLinks[i][2], start = bnLinks[i].index ?? 0;
    const end = Math.min(start + 4500, i + 1 < bnLinks.length ? (bnLinks[i + 1].index ?? src.length) : src.length);
    const block = cleanHtmlText(src.slice(start, end));
    seenAllEans.add(ean);
    if (seenHitEans.has(ean) || /out\s+of\s+stock|sold\s+out|unavailable/i.test(block)) continue;
    if (!/quick\s+add|add\s+to\s+(?:bag|cart)|pre-?order/i.test(block)) continue;
    const priceM = block.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
    if (!priceM) continue;
    const price = parseFloat(priceM[1]);
    const slugTitle = relHref.split('/w/')[1]?.split('/')[0]?.replace(/-/g, ' ') || '';
    const title = cleanHtmlText(`${slugTitle} ${block.slice(0, 140)}`);
    const url = `https://www.barnesandnoble.com${relHref}`;
    if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Barnes & Noble', url })) continue;
    seenHitEans.add(ean);
    inStockOffers.push({ title, retailer: 'Barnes & Noble', url, productUrl: url, price, itemId: `bn_${ean}`, freeShipping: price >= 40 });
  }
  return { totalNodesFound: Math.max(seenAllEans.size, ld.totalNodes), inStockOffers };
}

export function parsePokemonCenterPayload(html: string): BigBoxAdapterResult {
  const src = String(html || '');
  const inStockOffers: ParsedRetailOffer[] = [];
  const seenNodes = new Set<string>(), seenHits = new Set<string>();
  const ld = extractJsonLdShelfProducts(src, 'https://www.pokemoncenter.com');

  for (const linkM of src.matchAll(/\/product\/(\d{2,4}-\d{4,6}[a-z0-9-]*)/gi)) seenNodes.add(linkM[1].toLowerCase());
  for (const it of ld.inStockItems) {
    seenNodes.add(it.sku.toLowerCase());
    if (resolveBigBoxPolicyMatch({ title: it.title, price: it.price, retailer: 'Pokemon Center', url: it.url, tokenField: 'pcSlug', tokenValue: it.sku, allowPcRetailUnlock: true })) {
      seenHits.add(it.sku);
      inStockOffers.push({ title: cleanHtmlText(it.title), retailer: 'Pokemon Center', url: it.url, productUrl: it.url, price: it.price, itemId: `pc_${it.sku}`, isPreOrder: it.isPreOrder, freeShipping: it.price >= 20 });
    }
  }
  for (const jb of src.matchAll(/"productId"\s*:\s*"(\d+-\d+)"[\s\S]{0,400}?"title"\s*:\s*"([^"]+)"[\s\S]{0,280}?"price"\s*:\s*([0-9.]+)[\s\S]{0,280}?"availability"\s*:\s*"([A-Z_]+)"/gi)) {
    const code = jb[1], title = cleanHtmlText(jb[2]), price = parseFloat(jb[3]), avail = jb[4];
    seenNodes.add(code.toLowerCase());
    if (seenHits.has(code) || !/^(IN_STOCK|AVAILABLE|PRE_ORDER)$/i.test(avail)) continue;
    const url = `https://www.pokemoncenter.com/product/${code}`;
    if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Pokemon Center', url, tokenField: 'pcSlug', tokenValue: code, allowPcRetailUnlock: true })) continue;
    seenHits.add(code);
    inStockOffers.push({ title, retailer: 'Pokemon Center', url, productUrl: url, price, itemId: `pc_${code}`, isPreOrder: /PRE_ORDER/i.test(avail), freeShipping: price >= 20 });
  }
  return { totalNodesFound: Math.max(seenNodes.size, ld.totalNodes), inStockOffers };
}

export function parseBestBuyDom(html: string): BigBoxAdapterResult {
  const src = String(html || '');
  const inStockOffers: ParsedRetailOffer[] = [];
  const seenIds = new Set<string>();
  const liTags = [...src.matchAll(/<li[^>]*\bclass=["'][^"']*\b(?:product-list-item|sku-item)\b[^"']*["'][^>]*>/gi)];

  for (let i = 0; i < liTags.length; i++) {
    const openTag = liTags[i][0], startIdx = liTags[i].index ?? 0;
    const nextIdx = i + 1 < liTags.length ? (liTags[i + 1].index ?? src.length) : Math.min(src.length, startIdx + 18000);
    const block = src.slice(startIdx, nextIdx);
    const skuAttr = openTag.match(/\bdata-(?:sku-id|product-id|testid)=["']([A-Z0-9_-]{5,16})["']/i)?.[1];
    const rawHref = block.match(/href=["'](https?:\/\/www\.bestbuy\.com\/(?:product\/[^"']+|site\/[^"']+)|\/(?:product|site)\/[^"']+)["']/i)?.[1] || '';
    const pdpUrl = rawHref.startsWith('http') ? rawHref : (rawHref ? `https://www.bestbuy.com${rawHref}` : '');
    const urlSku = pdpUrl.match(/skuId=(\d{7})|\/([A-Z0-9]{7,12})(?:\?|$)/i);
    const sku = String(urlSku?.[1] || skuAttr || urlSku?.[2] || '').trim();
    const linkTitleM = block.match(/class=["'][^"']*product-list-item-link[^"']*["'][^>]*>([\s\S]{5,240}?)<\/a>/i)
      || block.match(/class=["'][^"']*sku-(?:title|header)[^"']*["'][\s\S]{0,200}?<a[^>]*>([\s\S]{5,240}?)<\/a>/i);
    const imgAltM = block.match(/data-testid=["']product-image["'][^>]*\balt=["']([^"']{8,240})["']/i);
    const title = cleanHtmlText(linkTitleM?.[1] || imgAltM?.[1] || '');
    if (!sku && !title) continue;
    seenIds.add(sku || title);

    const flatText = cleanHtmlText(block);
    if (!/\b(?:add\s+to\s+cart|pre-?order)\b/i.test(flatText) || /\b(?:sold\s+out|coming\s+soon|unavailable|in-store\s+only)\b/i.test(flatText)) continue;
    const priceM = flatText.match(/\$([0-9]{2,4}(?:\.[0-9]{2})?)/);
    if (!priceM) continue;
    const price = parseFloat(priceM[1]);
    const finalPdp = pdpUrl || `https://www.bestbuy.com/site/-/${sku}.p?skuId=${sku}`;
    const atcUrl = /^\d{7}$/.test(sku) ? `https://api.bestbuy.com/click/-/${sku}/cart` : finalPdp;
    if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Best Buy', url: finalPdp, tokenField: 'bestBuySku', tokenValue: sku })) continue;
    inStockOffers.push({ title, retailer: 'Best Buy', url: atcUrl, productUrl: finalPdp, cart1xUrl: atcUrl, price, itemId: `bestbuy_${sku}`, isPreOrder: /pre-?order/i.test(flatText), freeShipping: price >= 35 });
  }

  for (const b of src.matchAll(/"skuId"\s*:\s*"(\d{7})"[\s\S]{0,400}?"name"\s*:\s*"([^"]+)"[\s\S]{0,400}?"(?:currentPrice|customerPrice)"\s*:\s*([0-9.]+)[\s\S]{0,300}?"buttonState"\s*:\s*"([^"]+)"/gi)) {
    seenIds.add(b[1]);
    if (!/^(ADD_TO_CART|PRE_ORDER|ONLINE_ONLY|INSTOCK|AVAILABLE)$/i.test(b[4].trim())) continue;
    const price = parseFloat(b[3]), pdpUrl = `https://www.bestbuy.com/site/-/${b[1]}.p?skuId=${b[1]}`, atcUrl = `https://api.bestbuy.com/click/-/${b[1]}/cart`;
    if (!resolveBigBoxPolicyMatch({ title: b[2], price, retailer: 'Best Buy', url: pdpUrl, tokenField: 'bestBuySku', tokenValue: b[1] })) continue;
    inStockOffers.push({ title: cleanHtmlText(b[2]), retailer: 'Best Buy', url: atcUrl, productUrl: pdpUrl, cart1xUrl: atcUrl, price, itemId: `bestbuy_${b[1]}`, isPreOrder: /PRE_ORDER/i.test(b[4]), freeShipping: price >= 35 });
  }
  return { totalNodesFound: seenIds.size, inStockOffers };
}

export function parseCostcoDom(html: string): BigBoxAdapterResult {
  const src = String(html || '');
  const inStockOffers: ParsedRetailOffer[] = [];
  const seenIds = new Set<string>();
  const ld = extractJsonLdShelfProducts(src, 'https://www.costco.com');

  for (const it of ld.inStockItems) {
    seenIds.add(it.sku);
    if (resolveBigBoxPolicyMatch({ title: it.title, price: it.price, retailer: 'Costco', url: it.url })) {
      inStockOffers.push({ title: cleanHtmlText(it.title), retailer: 'Costco', url: it.url, productUrl: it.url, price: it.price, itemId: `costco_${it.sku}`, isPreOrder: it.isPreOrder, freeShipping: true });
    }
  }
  for (const tb of src.matchAll(/(?:data-testid=["']ProductTile[^"']*["']|class=["'][^"']*product-tile-set[^"']*["'])([\s\S]{0,3500}?)(?=data-testid=["']ProductTile|class=["'][^"']*product-tile-set|$)/gi)) {
    const block = tb[1], flat = cleanHtmlText(block);
    const linkM = block.match(/href=["']([^"']*\.product\.(\d+)\.html|https?:\/\/www\.costco\.com\/p\/[^"']+)["']/i);
    const id = linkM?.[2] || linkM?.[1] || flat.slice(0, 60);
    if (!id) continue;
    seenIds.add(id);
    if (/out\s+of\s+stock|in-warehouse\s+only|unavailable/i.test(flat)) continue;
    const priceM = flat.match(/\$([0-9]{2,4}(?:\.[0-9]{2})?)/);
    if (!priceM) continue;
    const price = parseFloat(priceM[1]);
    const url = linkM?.[1]?.startsWith('http') ? linkM[1] : `https://www.costco.com${linkM?.[1] || ''}`;
    if (!resolveBigBoxPolicyMatch({ title: flat.slice(0, 180), price, retailer: 'Costco', url })) continue;
    inStockOffers.push({ title: flat.slice(0, 140), retailer: 'Costco', url, productUrl: url, price, itemId: `costco_${id}`, freeShipping: true });
  }
  return { totalNodesFound: Math.max(seenIds.size, ld.totalNodes), inStockOffers };
}
