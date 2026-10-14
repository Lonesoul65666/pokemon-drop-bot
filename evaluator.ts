import { WATCH_POLICIES, PolicyRule, GLOBAL_JUNK_EXCLUSIONS } from './policies';
import { recordObservation, getTelemetry } from './marketTelemetry';

export interface RawRestockItem {
  title: string;
  retailer: string;
  url: string;
  price?: number;
  stock?: number;
  itemId?: string;
}

export interface EvaluationResult {
  action: 'BUY' | 'IGNORE';
  reason: string;
  rule?: PolicyRule;
  discountPct?: number;
  savingsDollars?: number;
  isPriceDropOverride?: boolean;
}

const cooldownMap = new Map<string, { timestamp: number; lastPrice: number }>();

export function evaluateItem(item: RawRestockItem): EvaluationResult {
  const cleanTitle = item.title.trim();

  for (const junkRegex of GLOBAL_JUNK_EXCLUSIONS) {
    if (junkRegex.test(cleanTitle)) {
      return { action: 'IGNORE', reason: `Filtered out by global exclusion (${junkRegex})` };
    }
  }

  for (const rule of WATCH_POLICIES) {
    const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
    if (!isMatched) continue;

    // Prevent single ETB or Booster Box rules from matching "Case" listings
    if ((rule.formFactor === 'ETB' || rule.formFactor === 'Booster Box' || rule.formFactor === 'Booster Bundle') && /\bcase\b/i.test(cleanTitle)) {
      continue;
    }

    if (item.price && item.price > 0) {
      recordObservation(rule.id, item.price, item.retailer, item.url, rule.msrpCeiling);
    }

    if ((rule as any).active === false) {
      return { action: 'IGNORE', reason: `Rule "${rule.name}" is toggled OFF on dashboard.`, rule };
    }

    if (item.stock !== undefined && item.stock < rule.minStock) {
      return { action: 'IGNORE', reason: `Stock (${item.stock}) below minStock (${rule.minStock}).`, rule };
    }

    const effectiveCeiling = Math.max(rule.msrpCeiling, rule.maxMarketBuyPrice);
    if (item.price !== undefined && item.price > effectiveCeiling) {
      return {
        action: 'IGNORE',
        reason: `Price ($${item.price.toFixed(2)}) exceeds allowable buy threshold ($${effectiveCeiling.toFixed(2)}).`,
        rule
      };
    }

    const cooldownKey = `${rule.id}_${item.retailer}`;
    const prevAlert = cooldownMap.get(cooldownKey);
    const now = Date.now();
    let isPriceDropOverride = false;

    if (prevAlert) {
      const elapsedMins = (now - prevAlert.timestamp) / (1000 * 60);
      const currentPrice = item.price ?? effectiveCeiling;
      // Allow immediate re-alert if price dropped by at least $4 since last alert!
      if (elapsedMins < rule.cooldownMins && currentPrice >= prevAlert.lastPrice - 4) {
        return {
          action: 'IGNORE',
          reason: `Cooldown active for ${rule.name} at ${item.retailer} (${Math.round(rule.cooldownMins - elapsedMins)}m left).`,
          rule
        };
      }
      if (elapsedMins < rule.cooldownMins && currentPrice < prevAlert.lastPrice - 4) {
        isPriceDropOverride = true;
      }
    }

    const currentPrice = item.price ?? effectiveCeiling;
    cooldownMap.set(cooldownKey, { timestamp: now, lastPrice: currentPrice });

    const liveTel = getTelemetry()[rule.id];
    const marketVal = (liveTel && liveTel.rollingAverage > 0) ? liveTel.rollingAverage : (rule.estimatedMarketValue || effectiveCeiling);
    const savingsDollars = Math.max(0, marketVal - currentPrice);
    const discountPct = marketVal > 0 ? Math.round(((marketVal - currentPrice) / marketVal) * 100) : 0;

    return {
      action: 'BUY',
      reason: `Matched policy "${rule.name}" at $${currentPrice.toFixed(2)} (${discountPct}% under market)`,
      rule,
      discountPct,
      savingsDollars,
      isPriceDropOverride
    };
  }

  return { action: 'IGNORE', reason: 'No matching policy rule found.' };
}
