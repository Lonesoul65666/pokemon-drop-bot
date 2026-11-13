export interface StoreCurrencyResolution {
  detectedCurrency: string;
  fxMultiplier: number;
  isCrossBorderStore: boolean;
  crossBorderCountry: string;
  quarantineNonUsd: boolean;
  checkedAt: number;
}

export interface StoreLikeConfig {
  id?: string;
  name: string;
  baseUrl: string;
  currency?: string;
  flatShipping?: number;
  freeShipThreshold?: number;
}

export const SHOPIFY_USD_HEADERS: Record<string, string> = {
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'cart_currency=USD; localization=US; _shopify_country=US'
};

const FX_TO_USD: Record<string, number> = {
  USD: 1.0,
  CAD: 0.73,
  GBP: 1.29,
  EUR: 1.09,
  AUD: 0.66
};

const CURRENCY_CACHE_TTL_MS = 60 * 60 * 1000;
const storeCurrencyCache = new Map<string, StoreCurrencyResolution>();

const KNOWN_CROSS_BORDER_HOST_RE =
  /\.ca(?:\/|$)|\.co\.uk(?:\/|$)|\.eu(?:\/|$)|\.com\.au(?:\/|$)|kanzengames\.com|hobbiesville\.com|401games\.ca|facetofacegames\.com|mirajtrading\.com|untouchables\.ca|acgamesonline\.com|tistaminis\.com|tapsgames\.com|sportscardjunction\.com|silvergoblin\.cards/i;

export function isKnownCrossBorderStore(store: StoreLikeConfig, metaCountry?: string): boolean {
  const ctry = String(metaCountry || '').trim().toUpperCase();
  if (ctry && ctry !== 'US' && ctry !== 'USA') return true;
  if (String(store.currency || 'USD').trim().toUpperCase() !== 'USD') return true;
  return KNOWN_CROSS_BORDER_HOST_RE.test(String(store.baseUrl || ''));
}

export function appendShopifyUsCountryParam(rawUrl: string): string {
  const u = String(rawUrl || '').trim();
  if (!u || !/\.json(?:\?|$)/i.test(u)) return u;
  if (/[?&]country=/i.test(u)) return u;
  return u.includes('?') ? `${u}&country=US` : `${u}?country=US`;
}

export function isVariantStrictlyAvailable(variant: any): boolean {
  if (!variant || variant.available !== true) return false;
  if (typeof variant.inventory_quantity === 'number') {
    const policy = String(variant.inventory_policy || 'deny').toLowerCase();
    if (variant.inventory_quantity <= 0 && policy !== 'continue') {
      return false;
    }
  }
  return true;
}

export function computeVerifiedStoreShippingUsd(
  store: StoreLikeConfig,
  shelfUsd: number,
  resolution: StoreCurrencyResolution
): { shippingUsd: number; shippingNote?: string } {
  if (resolution.isCrossBorderStore) {
    const intlShip = Math.max(18.0, Number(store.flatShipping || 18.0));
    const rounded = Math.round(intlShip * 100) / 100;
    return {
      shippingUsd: rounded,
      shippingNote: `+$${rounded.toFixed(2)} Intl Ship (${resolution.crossBorderCountry}->US)`
    };
  }
  const freeThresh = Number(store.freeShipThreshold ?? 150);
  const flatShip = Number(store.flatShipping ?? 6.99);
  if (freeThresh > 0 && shelfUsd >= freeThresh) {
    return { shippingUsd: 0, shippingNote: '+FREE Shipping' };
  }
  const rounded = Math.round(Math.max(0, flatShip) * 100) / 100;
  return {
    shippingUsd: rounded,
    shippingNote: rounded > 0 ? `+$${rounded.toFixed(2)} Ship` : '+FREE Shipping'
  };
}

export async function resolveVerifiedStoreCurrency(
  store: StoreLikeConfig,
  laneKey: string,
  probeJsonFn: (probeUrl: string) => Promise<{ status: number; data: any }>
): Promise<StoreCurrencyResolution> {
  const baseKey = `${String(store.baseUrl || '').toLowerCase()}__${laneKey}`;
  const now = Date.now();
  const cached = storeCurrencyCache.get(baseKey);
  if (cached && now - cached.checkedAt < CURRENCY_CACHE_TTL_MS) {
    return cached;
  }

  let detectedCurrency = '';
  let metaCountry = '';

  try {
    const cartUrl = `${store.baseUrl.replace(/\/$/, '')}/cart.js?country=US`;
    const cartRes = await probeJsonFn(cartUrl);
    if (cartRes.status === 200 && cartRes.data && typeof cartRes.data === 'object') {
      detectedCurrency = String(cartRes.data.currency || '').trim().toUpperCase();
    }
  } catch {}

  if (!metaCountry && (String(store.currency || '').toUpperCase() === 'CAD' || KNOWN_CROSS_BORDER_HOST_RE.test(store.baseUrl))) {
    metaCountry = 'CA';
  } else {
    try {
      const metaUrl = `${store.baseUrl.replace(/\/$/, '')}/meta.json`;
      const metaRes = await probeJsonFn(metaUrl);
      if (metaRes.status === 200 && metaRes.data && typeof metaRes.data === 'object') {
        metaCountry = String(metaRes.data.country || '').trim().toUpperCase();
        if (!detectedCurrency && metaRes.data.currency) {
          detectedCurrency = String(metaRes.data.currency).trim().toUpperCase();
        }
      }
    } catch {}
  }

  const crossBorder = isKnownCrossBorderStore(store, metaCountry);
  const countryCode = metaCountry || (crossBorder ? String(store.currency || 'CA').slice(0, 2).toUpperCase() : 'US');

  if (!detectedCurrency) {
    // If a cross-border store failed /cart.js currency verification, quarantine rather than guessing FX!
    const fallbackCurr = String(store.currency || 'USD').trim().toUpperCase();
    const res: StoreCurrencyResolution = {
      detectedCurrency: fallbackCurr,
      fxMultiplier: FX_TO_USD[fallbackCurr] || 1.0,
      isCrossBorderStore: crossBorder,
      crossBorderCountry: countryCode,
      quarantineNonUsd: crossBorder || laneKey === 'PROXY',
      checkedAt: now
    };
    storeCurrencyCache.set(baseKey, res);
    return res;
  }

  // Domestic US store returning GBP/EUR/CAD over rotating proxy -> quarantine so proxy FX distortion never leaks!
  const proxyDistortedUsStore = !crossBorder && detectedCurrency !== 'USD';
  const knownFx = FX_TO_USD[detectedCurrency];
  const quarantineNonUsd = Boolean(proxyDistortedUsStore || !knownFx);

  const resolved: StoreCurrencyResolution = {
    detectedCurrency,
    fxMultiplier: knownFx || 1.0,
    isCrossBorderStore: crossBorder,
    crossBorderCountry: countryCode,
    quarantineNonUsd,
    checkedAt: now
  };
  storeCurrencyCache.set(baseKey, resolved);
  return resolved;
}

export function clearStoreCurrencyCache(): void {
  storeCurrencyCache.clear();
}
