import { getTelemetry } from './marketTelemetry';
import { evaluateItem, RawRestockItem } from './evaluator';
import { sendAlert } from './notifier';

export async function processIncomingDrop(item: RawRestockItem): Promise<void> {
  const result = evaluateItem(item);

  if (result.action === 'BUY' && result.rule) {
    const r: any = result.rule;
    console.log(`🎯 [BUY ALERT] "${item.title}" ($${item.price?.toFixed(2)}) at ${item.retailer} -> [${result.alertType}] ${result.reason}`);

    await sendAlert({
      title: item.title,
      retailer: item.retailer,
      url: item.url,
      productUrl: item.productUrl,
      cart1xUrl: result.cart1xUrl || item.cart1xUrl,
      cart2xUrl: result.cart2xUrl !== undefined ? result.cart2xUrl : item.cart2xUrl,
      cart3xUrl: result.cart3xUrl !== undefined ? result.cart3xUrl : item.cart3xUrl,
      price: item.price !== undefined ? item.price.toFixed(2) : undefined,
      priceNum: item.price,
      landedPrice: result.landedPrice,
      estimatedShipping: result.estimatedShipping,
      freeShipNote: result.freeShipNote,
      packCount: result.packCount,
      pricePerPack: result.pricePerPack,
      isRipValueLeader: result.isRipValueLeader,
      isPreOrder: result.isPreOrder,
      isPreRelease: result.isPreRelease,
      preReleaseStatusTag: result.preReleaseStatusTag,
      releaseDate: result.releaseDate,
      isMsrpUnicorn: result.isMsrpUnicorn,
      bypassVaultMute: result.bypassVaultMute,
      stock: item.stock,
      itemId: item.itemId,
      ruleId: r.id,
      ruleName: r.name,
      formFactor: r.formFactor,
      msrp: r.msrpCeiling,
      marketValue: (getTelemetry()[r.id]?.rollingAverage > 0 ? getTelemetry()[r.id].rollingAverage : r.estimatedMarketValue),
      maxBuyTarget: r.maxMarketBuyPrice,
      discountPct: result.discountPct,
      savingsDollars: result.savingsDollars,
      ownedInVault: Boolean(r.inVault ?? r.owned),
      alertType: result.alertType,
      previousPrice: result.previousPrice,
      previousTimeStr: result.previousTimeStr,
      bigBoxTier: result.bigBoxTier,
      bigBoxBadge: result.bigBoxBadge,
      marketplaceWarning: result.marketplaceWarning,
      priorityFront: result.priorityFront
    });
  } else if (result.rule && !result.reason.includes('Deduplicated')) {
    // Only log tracked Pokemon SKUs so you can see live store prices vs. your slider targets without non-Pokemon clutter!
    console.log(`   [SEEN] ${item.retailer.padEnd(16)} | $${(item.price || 0).toFixed(2).padStart(7)} | ${result.rule.name} -> ${result.reason}`);
  }
}
