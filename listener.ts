import { getTelemetry } from './marketTelemetry';
import { evaluateItem, RawRestockItem, commitAlertDelivery, releasePendingAlertLock } from './evaluator';
import { sendAlert } from './notifier';

let listenerProcessHandlersRegistered = false;
export function registerProcessSafetyHandlers(serviceLabel = 'Listener') {
  if (listenerProcessHandlersRegistered) return;
  listenerProcessHandlersRegistered = true;

  process.on('uncaughtException', (err: any) => {
    console.error(`[${new Date().toISOString()}] [${serviceLabel}] UNCAUGHT EXCEPTION (Recovered):`, err?.stack || err?.message || err);
  });

  process.on('unhandledRejection', (reason: any) => {
    console.error(`[${new Date().toISOString()}] [${serviceLabel}] UNHANDLED REJECTION (Recovered):`, reason?.stack || reason?.message || reason);
  });
}

registerProcessSafetyHandlers('DropBot-Core');

export async function processIncomingDrop(item: RawRestockItem): Promise<void> {
  try {
    const result = evaluateItem(item);

    if (result.action === 'BUY' && result.rule) {
      const r: any = result.rule;
      console.log(`◈ [BUY ALERT] "${item.title}" ($${item.price?.toFixed(2)}) at ${item.retailer} -> [${result.alertType}] ${result.reason}`);

      const alertPromise = sendAlert({
        title: item.title,
        retailer: item.retailer,
        url: item.url,
        productUrl: item.productUrl,
        cart1xUrl: result.cart1xUrl || item.cart1xUrl,
        cart2xUrl: result.cart2xUrl !== undefined ? result.cart2xUrl : item.cart2xUrl,
        cart3xUrl: result.cart3xUrl !== undefined ? result.cart3xUrl : item.cart3xUrl,
        price: item.price !== undefined ? item.price.toFixed(2) : undefined,
        priceNum: item.price,
        itemPrice: result.itemPrice ?? item.itemPrice,
        shippingPrice: result.shippingPrice ?? item.shippingPrice,
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
        priorityFront: result.priorityFront,
        statusTier: result.statusTier,
        statusTag: result.statusTag,
        isCloseCall: result.isCloseCall,
        closeCallDelta: result.closeCallDelta,
        trendSignal: result.trendSignal,
        trendVerdictLabel: result.trendVerdictLabel,
        isElasticDip: result.isElasticDip
      });

      // Commit-After-Send dispatch: enqueue Discord/Telegram in 0ms without blocking poller loops,
      // and ONLY persist alertState.json cooldown lock once delivery is confirmed!
      const pendingCommit = result.pendingAlertCommit;
      void alertPromise
        .then((delivered) => {
          if (delivered) {
            commitAlertDelivery(pendingCommit);
          } else {
            releasePendingAlertLock(pendingCommit?.stateKey);
          }
        })
        .catch((err: any) => {
          releasePendingAlertLock(pendingCommit?.stateKey);
          console.error(`[Listener] Async alert dispatch error: ${err?.message || err}`);
        });
    }
  } catch (err: any) {
    console.error(`[Listener] Error in processIncomingDrop for "${item?.title || 'unknown'}":`, err?.message || err);
  }
}
