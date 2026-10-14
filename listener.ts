import { evaluateItem, RawRestockItem } from './evaluator';
import { sendEnhancedAlert } from './notifier';

export function buildFastCheckoutLink(retailer: string, rawUrl: string, itemId?: string): string {
  const cleanRetailer = retailer.toLowerCase();

  if (cleanRetailer.includes('target') && itemId) {
    return `https://www.target.com/co-cart?tcin=${itemId}`;
  }

  if (rawUrl.includes('/products/') && itemId) {
    const origin = new URL(rawUrl).origin;
    return `${origin}/cart/${itemId}:1`;
  }

  return rawUrl;
}

export async function processIncomingDrop(rawEvent: {
  title: string;
  retailer: string;
  url: string;
  price: number;
  stock: number;
  itemId?: string;
}): Promise<void> {
  const fastUrl = buildFastCheckoutLink(rawEvent.retailer, rawEvent.url, rawEvent.itemId);

  const item: RawRestockItem = {
    title: rawEvent.title,
    retailer: rawEvent.retailer,
    url: fastUrl,
    price: rawEvent.price,
    stock: rawEvent.stock,
  };

  const evalResult = evaluateItem(item);

  // Diagnostic log: displays title, price, verdict, and the rejection reason
  console.log(
    `[INGEST] "${item.title}" ($${item.price.toFixed(2)}) from ${item.retailer} -> ${evalResult.action} [${evalResult.verdict}] | ${evalResult.reason}`
  );

  if (evalResult.action === 'ALERT' && evalResult.matchedPolicy) {
    await sendEnhancedAlert(item, evalResult.matchedPolicy, evalResult);
  }
}