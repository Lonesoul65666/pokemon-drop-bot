import { getTelemetry } from './marketTelemetry';
import { evaluateItem, RawRestockItem } from './evaluator';
import { sendAlert } from './notifier';

export async function processIncomingDrop(item: RawRestockItem): Promise<void> {
  const result = evaluateItem(item);

  if (result.action === 'BUY' && result.rule) {
    const r: any = result.rule;
    console.log(`[INGEST] "${item.title}" ($${item.price?.toFixed(2)}) from ${item.retailer} -> 🎯 BUY [${result.alertType}] | ${result.reason}`);

    await sendAlert({
      title: item.title,
      retailer: item.retailer,
      url: item.url,
      price: item.price !== undefined ? item.price.toFixed(2) : undefined,
      priceNum: item.price,
      stock: item.stock,
      ruleId: r.id,
      ruleName: r.name,
      formFactor: r.formFactor,
      msrp: r.msrpCeiling,
      marketValue: (getTelemetry()[r.id]?.rollingAverage > 0 ? getTelemetry()[r.id].rollingAverage : r.estimatedMarketValue),
      maxBuyTarget: r.maxMarketBuyPrice,
      discountPct: result.discountPct,
      savingsDollars: result.savingsDollars,
      ownedInVault: Boolean(r.owned),
      alertType: result.alertType,
      previousPrice: result.previousPrice,
      previousTimeStr: result.previousTimeStr
    });
  } else {
    console.log(`[INGEST] "${item.title}" ($${item.price?.toFixed(2)}) from ${item.retailer} -> IGNORE [RUN AWAY] | ${result.reason}`);
  }
}
