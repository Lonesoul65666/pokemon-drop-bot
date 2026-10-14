export interface MarketPriceSnapshot {
  timestamp: string;
  marketPrice: number;
  source: 'pricecharting' | 'tcgplayer' | 'ebay';
}

export interface ProductAsset {
  format: 'etb' | 'booster_box' | 'sealed_case' | 'booster_bundle';
  setSlug: string;
  localPath: string;
  remoteUrl?: string;
}

export interface MarketMetrics {
  productId: string;
  msrp: number;
  currentMarket: number;
  deltaVsMsrpPct: number;
  lastSync: string;
  history: MarketPriceSnapshot[];
  asset: ProductAsset;
}