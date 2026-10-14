import { PolicyRule } from './policies';
export interface RawRestockItem {
    title: string;
    retailer: string;
    url: string;
    price: number;
    stock: number;
}
export type DealVerdict = 'MUST BUY' | 'GREAT DEAL' | 'GOOD DEAL' | 'FAIR / MSRP' | 'RUN AWAY';
export interface EvaluationResult {
    action: 'ALERT' | 'IGNORE';
    reason: string;
    matchedPolicy?: PolicyRule;
    discountVsMarket?: number;
    msrpDiffPct?: number;
    verdict: DealVerdict;
}
export declare function evaluateItem(item: RawRestockItem): EvaluationResult;
//# sourceMappingURL=evaluator.d.ts.map