import { sendAlert } from './notifier';
async function runTest() {
    console.log('Sending test alert to Discord...');
    await sendAlert({
        title: 'Pokemon Booster Box Test Drop',
        retailer: 'Target',
        url: 'https://www.target.com',
        price: '161.64',
    });
    console.log('Test complete.');
}
runTest();
//# sourceMappingURL=testAlert.js.map