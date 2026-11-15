import { WATCH_POLICIES } from '../../policies';
import { BigBoxAdapterResult, parseBestBuyPayload } from './bigBoxAdapters';

export interface BestBuyOfficialApiOutcome {
  configured: boolean;
  ok: boolean;
  status: number;
  parsed: BigBoxAdapterResult;
}

export function isBestBuyOfficialApiConfigured(): boolean {
  return Boolean(String(process.env.BESTBUY_API_KEY || '').trim());
}

export async function pollBestBuyOfficialProductsApi(): Promise<BestBuyOfficialApiOutcome> {
  const apiKey = String(process.env.BESTBUY_API_KEY || '').trim();
  const empty: BigBoxAdapterResult = { totalNodesFound: 0, inStockOffers: [] };
  if (!apiKey) {
    return { configured: false, ok: false, status: 0, parsed: empty };
  }

  const seededSkus = WATCH_POLICIES
    .map((p) => String(p.bestBuySku || '').trim())
    .filter((sku) => /^\d{7}$/.test(sku))
    .slice(0, 25);

  const queries = seededSkus.length > 0
    ? [`sku in(${seededSkus.join(',')})`]
    : ['search=pokemon&search=elite&search=trainer&search=box', 'search=pokemon&search=ultra&search=premium'];

  try {
    let totalNodesFound = 0, lastStatus = 0;
    const mergedOffers: BigBoxAdapterResult['inStockOffers'] = [];
    for (const filter of queries) {
      const apiUrl =
        `https://api.bestbuy.com/v1/products(${filter})` +
        `?apiKey=${encodeURIComponent(apiKey)}&format=json&pageSize=25` +
        `&show=sku,name,salePrice,regularPrice,onlineAvailability,buttonState`;
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
      lastStatus = res.status;
      if (!res.ok) continue;
      const p = parseBestBuyPayload(await res.json());
      totalNodesFound += p.totalNodesFound;
      mergedOffers.push(...p.inStockOffers);
    }
    return { configured: true, ok: lastStatus >= 200 && lastStatus < 300, status: lastStatus, parsed: { totalNodesFound, inStockOffers: mergedOffers } };
  } catch {
    return { configured: true, ok: false, status: 0, parsed: empty };
  }
}
