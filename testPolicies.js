import { evaluateItem, RawRestockItem } from './evaluator';
import { sendEnhancedAlert } from './notifier';
const TEST_SCENARIOS = [
    // 1. 151 Bundle @ $89.99 (Market is $162 -> should alert as a 44% off deal)
    {
        title: 'Pokemon Scarlet & Violet 151 Booster Bundle',
        retailer: 'Walmart',
        url: 'https://www.walmart.com',
        price: 89.99,
        stock: 2,
    },
    // 2. 151 Bundle @ $145.00 (Market is $162, but exceeds $95 max buy price -> IGNORE)
    {
        title: 'Pokemon Scarlet & Violet 151 Booster Bundle',
        retailer: 'SecondaryShop',
        url: 'https://www.secondaryshop.com',
        price: 145.00,
        stock: 2,
    },
    // 3. 30th Anniversary ETB @ $49.99 with only 1 unit (Ghost restock -> IGNORE)
    {
        title: 'Pokemon 30th Anniversary Elite Trainer Box',
        retailer: 'Target',
        url: 'https://www.target.com',
        price: 49.99,
        stock: 1,
    },
    // 4. 30th Anniversary ETB @ $49.99 with 8 units (Valid bulk restock -> ALERT)
    {
        title: 'Pokemon 30th Anniversary Elite Trainer Box',
        retailer: 'Target',
        url: 'https://www.target.com',
        price: 49.99,
        stock: 8,
    },
];
async function runSuite() {
    console.log('Testing Market Value & Discount Spread Rules...\n');
    for (const item of TEST_SCENARIOS) {
        const result = evaluateItem(item);
        console.log(`Checking: "${item.title}" ($${item.price}, Stock: ${item.stock})`);
        console.log(`Action: [${result.action}] -> ${result.reason}`);
        if (result.action === 'ALERT' && result.matchedPolicy) {
            await sendEnhancedAlert(item, result.matchedPolicy, result);
        }
        console.log('----------------------------------------------------');
    }
}
runSuite();
//# sourceMappingURL=testPolicies.js.map