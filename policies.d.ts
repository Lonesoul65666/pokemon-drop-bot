export interface PolicyRule {
    id: string;
    name: string;
    matchers: RegExp[];
    negativeMatchers?: RegExp[];
    minStock: number;
    msrpCeiling: number;
    maxMarketBuyPrice: number;
    estimatedMarketValue: number;
    priority: 'GRAIL' | 'BULK_DEAL' | 'STANDARD';
    cooldownMins: number;
}
export declare const WATCH_POLICIES: PolicyRule[];
//# sourceMappingURL=policies.d.ts.map