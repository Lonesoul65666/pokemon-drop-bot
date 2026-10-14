import { WATCH_POLICIES, PolicyRule } from './policies';
import { recordObservation } from './marketTelemetry';

export interface SellerProfile {
  name: string;
  salesCount: number;
  positiveRating: number;
  accountAgeDays: number;
}

export interface RawRestockItem {
  title: string;
  retailer: string;
  url: string;
  price: number;
  stock: number;
  seller?: SellerProfile;
}

export type DealVerdict =
  | 'MUST BUY'
  | 'GREAT DEAL'
  | 'GOOD DEAL'
  | 'FAIR / MSRP'
  | 'COMMUNITY SELLER (VERIFY)'
  | 'RUN AWAY'
  | 'SUSPICIOUS / SCAM';

export interface EvaluationResult {
  action: 'ALERT' | 'IGNORE';
  reason: string;
  matchedPolicy?: PolicyRule;
  discountVsMarket?: number;
  msrpDiffPct?: number;
  verdict: DealVerdict;
}

const lastAlertedTimes = new Map<string, number>();

export function evaluateItem(item: RawRestockItem): EvaluationResult {
  const matchedPolicy = WATCH_POLICIES.find((policy) => {
    if (policy.active === false) return false;
    const matchesPositive = policy.matchers.some((regex) => regex.test(item.title));
    if (!matchesPositive) return false;

    if (policy.negativeMatchers) {
      const matchesNegative = policy.negativeMatchers.some((regex) => regex.test(item.title));
      if (matchesNegative) return false;
    }
    return true;
  });

  if (!matchedPolicy) {
    return {
      action: 'IGNORE',
      reason: 'No matching policy rule found.',
      verdict: 'RUN AWAY',
    };
  }

  // --- TELEMETRY HARVESTING ---
  // Record every matched observation into the real-world market cache
  recordObservation(
    matchedPolicy.id,
    item.price,
    item.retailer,
    item.url,
    matchedPolicy.msrpCeiling
  );

  // --- SELLER TRUST REPUTATION CHECK ---
  let isCommunitySeller = false;
  if (item.seller) {
    if (item.seller.salesCount < 50) {
      return {
        action: 'IGNORE',
        reason: `Seller Trust: Sales volume (${item.seller.salesCount}) below safety threshold (50).`,
        verdict: 'SUSPICIOUS / SCAM',
      };
    }

    if (item.seller.positiveRating < 96.0) {
      return {
        action: 'IGNORE',
        reason: `Seller Trust: Positive feedback (${item.seller.positiveRating}%) below 96.0% safety floor.`,
        verdict: 'SUSPICIOUS / SCAM',
      };
    }

    if (item.seller.accountAgeDays < 180) {
      return {
        action: 'IGNORE',
        reason: `Seller Trust: Account age (${item.seller.accountAgeDays} days) under 6-month probationary threshold.`,
        verdict: 'SUSPICIOUS / SCAM',
      };
    }

    if (item.seller.salesCount >= 50 && item.seller.salesCount < 100) {
      isCommunitySeller = true;
    }
  }

  // --- ANTI-SCAM PRICE FLOOR CHECK ---
  const scamFloor = matchedPolicy.msrpCeiling * 0.40;
  if (item.price < scamFloor && matchedPolicy.formFactor !== 'Booster Bundle') {
    return {
      action: 'IGNORE',
      reason: `Anti-Scam Trigger: Price ($${item.price.toFixed(2)}) is below safety floor ($${scamFloor.toFixed(2)}).`,
      verdict: 'SUSPICIOUS / SCAM',
    };
  }

  // Stock check
  if (item.stock < matchedPolicy.minStock) {
    return {
      action: 'IGNORE',
      reason: `Stock count (${item.stock}) below minimum required (${matchedPolicy.minStock}).`,
      verdict: 'RUN AWAY',
    };
  }

  // Calculate spreads using dynamic or baseline estimated market value
  const marketVal = matchedPolicy.estimatedMarketValue;
  const discountVsMarket = Math.round(((marketVal - item.price) / marketVal) * 100);
  const msrpDiffPct = Math.round(((item.price - matchedPolicy.msrpCeiling) / matchedPolicy.msrpCeiling) * 100);

  // Compute Deal Verdict
  let verdict: DealVerdict = 'FAIR / MSRP';
  if (item.price > marketVal) {
    verdict = 'RUN AWAY';
  } else if (isCommunitySeller) {
    verdict = 'COMMUNITY SELLER (VERIFY)';
  } else if (item.price <= matchedPolicy.msrpCeiling && marketVal > matchedPolicy.msrpCeiling * 1.3) {
    verdict = 'MUST BUY';
  } else if (discountVsMarket >= 30) {
    verdict = 'MUST BUY';
  } else if (discountVsMarket >= 18) {
    verdict = 'GREAT DEAL';
  } else if (discountVsMarket >= 8) {
    verdict = 'GOOD DEAL';
  } else if (item.price <= matchedPolicy.msrpCeiling) {
    verdict = 'FAIR / MSRP';
  } else {
    verdict = 'RUN AWAY';
  }

  // Price gate check
  const isRetailMSRP = item.price <= matchedPolicy.msrpCeiling;
  const isUnderMarketCeiling = item.price <= matchedPolicy.maxMarketBuyPrice;

  if (!isRetailMSRP && !isUnderMarketCeiling) {
    return {
      action: 'IGNORE',
      reason: `Price ($${item.price.toFixed(2)}) exceeds allowable buy threshold ($${matchedPolicy.maxMarketBuyPrice.toFixed(2)}).`,
      verdict,
      discountVsMarket,
      msrpDiffPct,
    };
  }

  // Cooldown check
  const cooldownKey = `${item.retailer}:${matchedPolicy.id}`;
  const now = Date.now();
  const lastAlert = lastAlertedTimes.get(cooldownKey) || 0;
  const cooldownMs = matchedPolicy.cooldownMins * 60 * 1000;

  if (now - lastAlert < cooldownMs) {
    const remainingMins = Math.ceil((cooldownMs - (now - lastAlert)) / 60000);
    return {
      action: 'IGNORE',
      reason: `Item on cooldown for ${remainingMins} more minutes.`,
      verdict,
      discountVsMarket,
      msrpDiffPct,
    };
  }

  lastAlertedTimes.set(cooldownKey, now);

  return {
    action: 'ALERT',
    reason: isRetailMSRP
      ? `Retail MSRP drop detected (${discountVsMarket}% under secondary).`
      : `Secondary deal qualified ($${item.price.toFixed(2)} vs $${marketVal.toFixed(2)} market).`,
    matchedPolicy,
    discountVsMarket,
    msrpDiffPct,
    verdict,
  };
}