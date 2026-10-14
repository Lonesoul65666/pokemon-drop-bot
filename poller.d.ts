interface TargetItem {
    name: string;
    tcin: string;
}
export declare function checkItemStock(item: TargetItem): Promise<void>;
export declare function runPollingCycle(): Promise<void>;
export {};
//# sourceMappingURL=poller.d.ts.map