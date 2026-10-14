import axios from 'axios';
import { sendAlert } from './notifier';
const WATCHLIST = [
    {
        name: 'Nintendo Switch OLED (Stock Test)',
        tcin: '83887640',
    },
];
const alertedItems = new Set();
const client = axios.create({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Origin: 'https://www.target.com',
        Referer: 'https://www.target.com/',
    },
});
const API_KEY = '9f36aeafbe60771e321a7cc95a78140772ab3e96';
export async function checkItemStock(item) {
    const url = 'https://redsky.target.com/redsky_aggregations/v1/web/pdp_summary_v1';
    try {
        const res = await client.get(url, {
            params: {
                key: API_KEY,
                tcin: item.tcin,
                pricing_store_id: '3991',
                scheduled_delivery_store_id: '3991',
                has_pricing_store_id: 'true',
                is_order_pickup: 'true',
            },
        });
        const product = res.data?.data?.product;
        const fulfillment = product?.fulfillment;
        const shippingStatus = fulfillment?.shipping_options?.availability_status;
        const storeStatus = fulfillment?.store_options?.order_pickup?.availability_status;
        const price = product?.price?.formatted_current_price || product?.price?.current_retail;
        const title = product?.item?.product_description?.title || item.name;
        const isAvailable = shippingStatus === 'IN_STOCK' || storeStatus === 'IN_STOCK';
        console.log(`[${new Date().toLocaleTimeString()}] ${item.name} -> Shipping: ${shippingStatus || 'OOS'} | Store: ${storeStatus || 'OOS'}`);
        if (isAvailable) {
            if (!alertedItems.has(item.tcin)) {
                alertedItems.add(item.tcin);
                await sendAlert({
                    title,
                    retailer: 'Target',
                    url: `https://www.target.com/p/-/A-${item.tcin}`,
                    price: price ? String(price) : undefined,
                });
            }
        }
        else {
            alertedItems.delete(item.tcin);
        }
    }
    catch (err) {
        console.error(`Error checking ${item.name}: ${err.message}`);
    }
}
export async function runPollingCycle() {
    for (const item of WATCHLIST) {
        await checkItemStock(item);
        await new Promise((res) => setTimeout(res, 2000));
    }
}
//# sourceMappingURL=poller.js.map