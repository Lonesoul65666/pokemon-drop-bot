"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const notifier_1 = require("./notifier");
async function run() {
    const dummyItem = {
        title: 'Pokemon 151 Elite Trainer Box',
        price: 49.99,
        retailer: 'PokemonCenter',
        url: 'https://www.pokemoncenter.com',
        stock: 10
    };
    await (0, notifier_1.sendEnhancedAlert)(dummyItem, {
        action: 'BUY',
        targetMatched: '151-etb',
        msrp: 49.99,
        discountPct: 0,
        confidence: 1.0,
        notes: 'Smoke test verification alert'
    });
}
run().catch(console.error);
