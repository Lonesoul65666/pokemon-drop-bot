import { RawRestockItem } from '../../evaluator';
import { processIncomingDrop } from '../../listener';
import {
  PolicyRule, WATCH_POLICIES, matchProductToSku,
  isSingleCardOrNonSealed, hasMandatorySealedContainerKeyword, isValidSkuForFormFactor
} from '../../policies';

export const WALMART_1P_SELLER_ID = 'F55CDC31AB754BB68FE0B39041159D63';
export const AMAZON_1P_MERCHANT_ID = 'ATVPDKIKX0DER';

const seenBigBoxOffers = new Map<string, { price: number; timestamp: number }>();
export const discoveredRetailIds = new Map<string, string>();
export const resetBigBoxAdapterDedup = (): void => { seenBigBoxOffers.clear(); };

function cleanHtmlText(s: string): string {
  return String(s || '')
    .replace(/&#38;|&amp;/gi, '&').replace(/&#8212;|&mdash;/gi, ' - ')
    .replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function resolveBigBoxPolicyMatch(params: {
  title: string; price: number; retailer: string; url: string;
  tokenField?: 'targetTcin' | 'walmartItemId' | 'bestBuySku' | 'amazonAsin' | 'pcSlug';
  tokenValue?: string; allowPcRetailUnlock?: boolean;
}): PolicyRule | null {
  const title = cleanHtmlText(params.title);
  const price = Number(params.price);
  if (!title || !Number.isFinite(price) || price < 18) return null;
  if (isSingleCardOrNonSealed(title, undefined, params.url) || !hasMandatorySealedContainerKeyword(title)) return null;

  let rule: PolicyRule | null = null;
  if (params.tokenField && params.tokenValue) {
    const tok = String(params.tokenValue).trim().toLowerCase();
    const seeded = WATCH_POLICIES.find(
      (p) => p.active !== false && String((p as any)[params.tokenField!] || '').toLowerCase().includes(tok)
    );
    if (seeded && hasMandatorySealedContainerKeyword(title, seeded.formFactor) &&
        isValidSkuForFormFactor(title, seeded.formFactor, price, {
          ruleId: seeded.id, targetName: seeded.name, handle: params.url,
          retailer: params.retailer, sourceUrl: params.url, allowPcRetailUnlock: Boolean(params.allowPcRetailUnlock)
        })) {
      rule = seeded;
    }
  }
  if (!rule) {
    rule = matchProductToSku(title, price, {
      handle: params.url, retailer: params.retailer, sourceUrl: params.url,
      allowPcRetailUnlock: Boolean(params.allowPcRetailUnlock)
    });
  }
  if (!rule) return null;

  const isPc = Boolean(params.allowPcRetailUnlock);
  const baseMsrp = isPc && String(rule.formFactor || '').toUpperCase() === 'ETB'
    ? Math.max(59.99, rule.msrpCeiling || 59.99)
    : (rule.msrpCeiling || 54.99);
  if (price > Math.round(baseMsrp * 1.08 * 100) / 100) return null;
  if (params.tokenField && params.tokenValue) discoveredRetailIds.set(`${params.tokenField}:${params.tokenValue}`, rule.id);
  return rule;
}

function extractJsonLdInStockProducts(html: string, origin: string): Array<{
  title: string; price: number; url: string; sku: string; isPreOrder: boolean;
}> {
  const out: Array<{ title: string; price: number; url: string; sku: string; isPreOrder: boolean }> = [];
  const scripts = [...String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (Array.isArray(node['@graph'])) node['@graph'].forEach(visit);
    if (Array.isArray(node.itemListElement)) node.itemListElement.forEach((el: any) => visit(el?.item || el));
    if (/Product/i.test(String(node['@type'] || '')) && node.name) {
      const offers = Array.isArray(node.offers) ? node.offers : (node.offers ? [node.offers] : []);
      for (const off of offers) {
        const avail = String(off?.availability || '');
        if (!/(?:^|\/)(InStock|PreOrder|OnlineOnly|LimitedAvailability)$/i.test(avail)) continue;
        const p = parseFloat(String(off?.price ?? off?.lowPrice ?? '0').replace(/[^0-9.]/g, ''));
        const rawUrl = String(off?.url || node.url || '');
        const fullUrl = rawUrl.startsWith('http') ? rawUrl : (rawUrl ? `${origin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}` : origin);
        if (p > 0) out.push({ title: String(node.name), price: p, url: fullUrl, sku: String(node.sku || node.productID || node.gtin13 || p), isPreOrder: /PreOrder/i.test(avail) });
      }
    }
  };
  for (const m of scripts) { try { visit(JSON.parse(m[1].trim())); } catch {} }
  return out;
}

export function parseTargetRedskyPayload(payload: any): RawRestockItem[] {
  const hits: RawRestockItem[] = [];
  const rawList: any[] = payload?.data?.search?.products || payload?.data?.product_summaries || (payload?.data?.product ? [payload.data.product] : []);
  if (!Array.isArray(rawList)) return hits;
  for (const p of rawList) {
    const tcin = String(p?.tcin || '').trim();
    const title = cleanHtmlText(p?.item?.product_description?.title || p?.title || '');
    const price = parseFloat(String(p?.price?.current_retail ?? p?.price?.reg_retail ?? 0));
    const vendors = Array.isArray(p?.item?.product_vendors) ? p.item.product_vendors.map((v: any) => String(v?.vendor_name || '')).join(' ') : String(p?.sold_by || '');
    const is3p = Boolean(p?.fulfillment?.is_marketplace || p?.item?.relationship_type_code === 'MP' || /target\s*plus|blueproton|collectors\s*emporium|marketplace/i.test(vendors));
    if (is3p || !tcin || !title || !price) continue;
    const shipOpt = p?.fulfillment?.shipping_options;
    const availStatus = String(shipOpt?.availability_status || p?.availability_status || '').toUpperCase();
    const allOos = p?.fulfillment?.is_out_of_stock_in_all_online_locations;
    const isOnlineInStock = availStatus === 'IN_STOCK' || availStatus === 'PRE_ORDER_SELLABLE' || availStatus === 'LIMITED_STOCK' ||
      (!availStatus && allOos === false && Number(shipOpt?.available_to_promise_quantity ?? 1) > 0);
    if (!isOnlineInStock || /OUT_OF_STOCK|SOLD_OUT|UNAVAILABLE|DISCONTINUED/i.test(availStatus)) continue;
    const targetUrl = `https://www.target.com/p/-/A-${tcin}`;
    if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Target', url: targetUrl, tokenField: 'targetTcin', tokenValue: tcin })) continue;
    hits.push({ title, retailer: 'Target', url: targetUrl, productUrl: targetUrl, price, itemId: `target_${tcin}`, isPreOrder: availStatus === 'PRE_ORDER_SELLABLE' || /pre-?order/i.test(title), freeShipping: price >= 35 });
  }
  return hits;
}

export function parseWalmartPayload(raw: any): RawRestockItem[] {
  const hits: RawRestockItem[] = [];
  let data = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return hits;
    try { data = JSON.parse(m[1]); } catch { return hits; }
  }
  const items: any[] = [];
  for (const st of (data?.props?.pageProps?.initialData?.searchResult?.itemStacks || data?.itemStacks || [])) {
    if (Array.isArray(st?.items)) items.push(...st.items);
  }
  const pdpProd = data?.props?.pageProps?.initialData?.data?.product || data?.product;
  if (pdpProd) items.push(pdpProd);

  for (const it of items) {
    const itemId = String(it?.usItemId || it?.id || '').trim();
    const title = cleanHtmlText(it?.name || it?.title || '');
    const price = parseFloat(String(it?.priceInfo?.currentPrice?.price ?? it?.priceInfo?.linePrice ?? it?.price ?? 0).replace(/[^0-9.]/g, ''));
    const sellerId = String(it?.sellerId || it?.catalogSellerId || '');
    const sellerName = String(it?.sellerName || '');
    const is1pWalmart = sellerId === WALMART_1P_SELLER_ID || /^walmart(\.com)?$/i.test(sellerName.trim()) || /sold\s+and\s+shipped\s+by\s+walmart/i.test(sellerName);
    const avail = String(it?.availabilityStatusV2?.value || it?.availabilityStatus || '').toUpperCase();
    if (!is1pWalmart || !itemId || !title || !price || avail !== 'IN_STOCK') continue;
    const pacUrl = `https://www.walmart.com/pac?id=${itemId}&quantity=1`;
    const pdpUrl = `https://www.walmart.com/ip/${itemId}`;
    if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Walmart', url: pdpUrl, tokenField: 'walmartItemId', tokenValue: itemId })) continue;
    hits.push({ title, retailer: 'Walmart', url: pacUrl, productUrl: pdpUrl, cart1xUrl: pacUrl, price, itemId: `walmart_${itemId}`, isPreOrder: Boolean(it?.isPreorder || /pre-?order/i.test(title)), freeShipping: price >= 35 });
  }
  return hits;
}

export function parseBestBuyPayload(raw: any): RawRestockItem[] {
  const hits: RawRestockItem[] = [];
  const candidates: Array<{ sku: string; title: string; price: number; state: string }> = [];
  if (typeof raw === 'object' && raw !== null && Array.isArray(raw.products)) {
    for (const p of raw.products) {
      const state = p.onlineAvailability === true ? 'ADD_TO_CART' : String(p.buttonState || p.orderable || 'SOLD_OUT');
      candidates.push({ sku: String(p.sku || p.skuId || ''), title: String(p.name || ''), price: Number(p.salePrice ?? p.regularPrice ?? p.currentPrice ?? 0), state });
    }
  } else {
    const blocks = [...String(raw || '').matchAll(/"skuId"\s*:\s*"(\d{7})"[\s\S]{0,400}?"name"\s*:\s*"([^"]+)"[\s\S]{0,400}?"(?:currentPrice|customerPrice)"\s*:\s*([0-9.]+)[\s\S]{0,300}?"buttonState"\s*:\s*"([^"]+)"/gi)];
    for (const b of blocks) candidates.push({ sku: b[1], title: b[2], price: parseFloat(b[3]), state: b[4] });
  }
  for (const c of candidates) {
    if (!/^(ADD_TO_CART|PRE_ORDER|ONLINE_ONLY|INSTOCK|AVAILABLE)$/i.test(c.state.trim())) continue;
    const atcUrl = `https://api.bestbuy.com/click/-/${c.sku}/cart`;
    const pdpUrl = `https://www.bestbuy.com/site/-/${c.sku}.p?skuId=${c.sku}`;
    if (!resolveBigBoxPolicyMatch({ title: c.title, price: c.price, retailer: 'Best Buy', url: pdpUrl, tokenField: 'bestBuySku', tokenValue: c.sku })) continue;
    hits.push({ title: cleanHtmlText(c.title), retailer: 'Best Buy', url: atcUrl, productUrl: pdpUrl, cart1xUrl: atcUrl, price: c.price, itemId: `bestbuy_${c.sku}`, isPreOrder: /PRE_ORDER/i.test(c.state), freeShipping: c.price >= 35 });
  }
  return hits;
}

export function parseAmazon1pPayload(html: string, isAtvLockedFeed = false): RawRestockItem[] {
  const hits: RawRestockItem[] = [];
  const src = String(html || '');
  if (!src) return hits;
  const cards = [...src.matchAll(/<div[^>]+data-asin=["'](B0[A-Z0-9]{8})["'][^>]*>([\s\S]{0,4500}?)(?=<div[^>]+data-asin=|$)/gi)];
  for (const m of cards) {
    const asin = m[1].toUpperCase();
    const block = m[2];
    if (/currently\s+unavailable|temporarily\s+out\s+of\s+stock|see\s+all\s+buying\s+options/i.test(block)) continue;
    const has1pProof = isAtvLockedFeed || /ATVPDKIKX0DER|ships\s+from\s+and\s+sold\s+by\s+amazon\.com|sold\s+by\s+amazon\.com/i.test(block);
    if (!has1pProof || !/add\s+to\s+cart|a-button-atc|prime/i.test(block)) continue;
    const titleMatch = block.match(/<h2[^>]*>([\s\S]{5,260}?)<\/h2>/i) || block.match(/alt=["']([^"']{10,220})["']/i);
    const priceMatch = block.match(/class=["']a-offscreen["'][^>]*>\$([0-9]+(?:\.[0-9]{2})?)</i);
    if (!titleMatch || !priceMatch) continue;
    const title = cleanHtmlText(titleMatch[1]);
    const price = parseFloat(priceMatch[1]);
    const atcUrl = `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${asin}&Quantity.1=1`;
    const pdpUrl = `https://www.amazon.com/dp/${asin}?smid=${AMAZON_1P_MERCHANT_ID}`;
    if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Amazon', url: pdpUrl, tokenField: 'amazonAsin', tokenValue: asin })) continue;
    hits.push({ title, retailer: 'Amazon', url: atcUrl, productUrl: pdpUrl, cart1xUrl: atcUrl, price, itemId: `amazon_${asin}`, freeShipping: price >= 35 });
  }
  if (hits.length === 0) {
    const pdpAsin = src.match(/(?:name=["']ASIN["'][^>]*value=["']|\/dp\/)(B0[A-Z0-9]{8})/i)?.[1]?.toUpperCase();
    const has1p = /merchantID["'][^>]*value=["']ATVPDKIKX0DER["']|"merchantId"\s*:\s*"ATVPDKIKX0DER"|ships\s+from[\s\S]{0,120}?amazon\.com[\s\S]{0,120}?sold\s+by[\s\S]{0,120}?amazon\.com/i.test(src);
    const hasAtc = /id=["']add-to-cart-button["']|id=["']buy-now-button["']/i.test(src) && !/id=["']outOfStock["']|currently\s+unavailable/i.test(src);
    const titleM = src.match(/id=["']productTitle["'][^>]*>([\s\S]{5,260}?)<\/span>/i);
    const priceM = src.match(/class=["']a-offscreen["'][^>]*>\$([0-9]+(?:\.[0-9]{2})?)</i);
    if (pdpAsin && has1p && hasAtc && titleM && priceM) {
      const title = cleanHtmlText(titleM[1]);
      const price = parseFloat(priceM[1]);
      const atcUrl = `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${pdpAsin}&Quantity.1=1`;
      const pdpUrl = `https://www.amazon.com/dp/${pdpAsin}?smid=${AMAZON_1P_MERCHANT_ID}`;
      if (resolveBigBoxPolicyMatch({ title, price, retailer: 'Amazon', url: pdpUrl, tokenField: 'amazonAsin', tokenValue: pdpAsin })) {
        hits.push({ title, retailer: 'Amazon', url: atcUrl, productUrl: pdpUrl, cart1xUrl: atcUrl, price, itemId: `amazon_${pdpAsin}`, freeShipping: price >= 35 });
      }
    }
  }
  return hits;
}

export function parsePokemonCenterPayload(html: string): RawRestockItem[] {
  const hits: RawRestockItem[] = [];
  for (const ld of extractJsonLdInStockProducts(html, 'https://www.pokemoncenter.com')) {
    if (!resolveBigBoxPolicyMatch({ title: ld.title, price: ld.price, retailer: 'Pokemon Center', url: ld.url, tokenField: 'pcSlug', tokenValue: ld.sku, allowPcRetailUnlock: true })) continue;
    hits.push({ title: ld.title, retailer: 'Pokemon Center', url: ld.url, productUrl: ld.url, price: ld.price, itemId: `pc_${ld.sku}`, isPreOrder: ld.isPreOrder, freeShipping: ld.price >= 20 });
  }
  const jsonBlocks = [...String(html || '').matchAll(/"productId"\s*:\s*"(\d+-\d+)"[\s\S]{0,350}?"title"\s*:\s*"([^"]+)"[\s\S]{0,250}?"price"\s*:\s*([0-9.]+)[\s\S]{0,250}?"availability"\s*:\s*"(IN_STOCK|AVAILABLE|PRE_ORDER)"/gi)];
  for (const jb of jsonBlocks) {
    const code = jb[1], title = cleanHtmlText(jb[2]), price = parseFloat(jb[3]), url = `https://www.pokemoncenter.com/product/${code}`;
    if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Pokemon Center', url, tokenField: 'pcSlug', tokenValue: code, allowPcRetailUnlock: true })) continue;
    hits.push({ title, retailer: 'Pokemon Center', url, productUrl: url, price, itemId: `pc_${code}`, isPreOrder: /PRE_ORDER/i.test(jb[4]), freeShipping: price >= 20 });
  }
  return hits;
}

function parseGenericJsonLdOrTileRetailer(html: string, retailer: string, origin: string, idPrefix: string, freeShipMin: number): RawRestockItem[] {
  const hits: RawRestockItem[] = [];
  for (const ld of extractJsonLdInStockProducts(html, origin)) {
    if (!resolveBigBoxPolicyMatch({ title: ld.title, price: ld.price, retailer, url: ld.url })) continue;
    hits.push({ title: ld.title, retailer, url: ld.url, productUrl: ld.url, price: ld.price, itemId: `${idPrefix}_${ld.sku}`, isPreOrder: ld.isPreOrder, freeShipping: ld.price >= freeShipMin });
  }
  const gtmBlocks = [...String(html || '').matchAll(/data-gtmdata=["']([^"']+)["']/gi)];
  for (const g of gtmBlocks) {
    try {
      const obj = JSON.parse(cleanHtmlText(g[1]));
      const avail = String(obj?.availability || obj?.productInfo?.availability || '');
      if (!/^(in\s*stock|available|pre-?order)$/i.test(avail)) continue;
      const pid = String(obj?.id || obj?.sku || obj?.productInfo?.sku || '');
      const title = cleanHtmlText(obj?.name || obj?.productInfo?.name || '');
      const price = parseFloat(String(obj?.price?.selling || obj?.price || 0));
      const url = `${origin}/products/${pid}.html`;
      if (pid && resolveBigBoxPolicyMatch({ title, price, retailer, url })) {
        hits.push({ title, retailer, url, productUrl: url, price, itemId: `${idPrefix}_${pid}`, freeShipping: price >= freeShipMin });
      }
    } catch {}
  }
  return hits;
}

export const parseGameStopPayload = (html: string) => parseGenericJsonLdOrTileRetailer(html, 'GameStop', 'https://www.gamestop.com', 'gamestop', 59);
export function parseBarnesAndNoblePayload(html: string): RawRestockItem[] {
  const hits = parseGenericJsonLdOrTileRetailer(html, 'Barnes & Noble', 'https://www.barnesandnoble.com', 'bn', 40);
  if (hits.length > 0) return hits;
  const seenEans = new Set<string>();
  const cardBlocks = [...String(html || '').matchAll(/href=["'](\/w\/[^"']+\?ean=(\d{12,13}))["']([\s\S]{0,1600}?)(?=href=["']\/w\/|$)/gi)];
  for (const m of cardBlocks) {
    const relHref = m[1], ean = m[2], block = cleanHtmlText(m[3]);
    if (seenEans.has(ean) || /out\s+of\s+stock|sold\s+out|unavailable/i.test(block)) continue;
    if (!/quick\s+add|add\s+to\s+(?:bag|cart)|pre-?order/i.test(block)) continue;
    const priceM = block.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
    if (!priceM) continue;
    const price = parseFloat(priceM[1]);
    const slugTitle = relHref.split('/w/')[1]?.split('/')[0]?.replace(/-/g, ' ') || '';
    const title = cleanHtmlText(`${slugTitle} ${block.slice(0, 140)}`);
    const url = `https://www.barnesandnoble.com${relHref}`;
    if (!resolveBigBoxPolicyMatch({ title, price, retailer: 'Barnes & Noble', url })) continue;
    seenEans.add(ean);
    hits.push({ title, retailer: 'Barnes & Noble', url, productUrl: url, price, itemId: `bn_${ean}`, freeShipping: price >= 40 });
  }
  return hits;
}
export const parseCostcoPayload = (html: string) => parseGenericJsonLdOrTileRetailer(html, 'Costco', 'https://www.costco.com', 'costco', 0);

export function parseSamsClubPayload(raw: any): RawRestockItem[] {
  if (typeof raw === 'string') {
    const ldHits = parseGenericJsonLdOrTileRetailer(raw, "Sam's Club", 'https://www.samsclub.com', 'sams', 50);
    if (ldHits.length > 0) return ldHits;
    const m = raw.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!m) return [];
    try { raw = JSON.parse(m[1]); } catch { return []; }
  }
  const hits: RawRestockItem[] = [];
  for (const r of (raw?.props?.pageProps?.initialData?.searchResult?.records || raw?.records || [])) {
    const prodId = String(r?.productId || r?.itemId || '').trim();
    const title = cleanHtmlText(r?.titles?.simpleTitle || r?.title || '');
    const price = parseFloat(String(r?.skus?.[0]?.onlineOffer?.price?.finalPrice?.amount ?? r?.price ?? 0));
    const status = String(r?.skus?.[0]?.onlineOffer?.inventory?.status || r?.inventoryStatus || '').toUpperCase();
    if (!prodId || !title || !price || !/^(AVAILABLE|IN_STOCK)$/i.test(status)) continue;
    const url = `https://www.samsclub.com/p/-/${prodId}`;
    if (!resolveBigBoxPolicyMatch({ title, price, retailer: "Sam's Club", url })) continue;
    hits.push({ title, retailer: "Sam's Club", url, productUrl: url, price, itemId: `sams_${prodId}`, freeShipping: price >= 50 });
  }
  return hits;
}

export async function dispatchVerifiedBigBoxHits(
  hits: RawRestockItem[],
  dropSink: (item: RawRestockItem) => Promise<any> | any = processIncomingDrop,
  cooldownMins = 15
): Promise<number> {
  let dispatched = 0;
  const now = Date.now();
  for (const hit of hits) {
    const key = String(hit.itemId || `${hit.retailer}_${hit.title}`);
    const prev = seenBigBoxOffers.get(key);
    const curPrice = Number(hit.price || 0);
    if (!prev || curPrice < prev.price || (now - prev.timestamp) / 60000 >= cooldownMins) {
      seenBigBoxOffers.set(key, { price: curPrice, timestamp: now });
      await dropSink(hit);
      dispatched += 1;
    }
  }
  return dispatched;
}
