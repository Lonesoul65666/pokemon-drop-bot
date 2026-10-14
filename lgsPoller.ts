import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dns from 'dns';
import { processIncomingDrop } from './listener';

dns.setDefaultResultOrder('ipv4first');

// ==========================================
// 1. PROXY ROTATOR PIPELINE
// 10 Dedicated Webshare Proxies
// ==========================================
const USE_PROXIES = true; 
const PROXY_LIST: string[] = [
  'http://uowcnblq:a5qiuyuv2hfk@45.38.107.97:6014',
  'http://uowcnblq:a5qiuyuv2hfk@64.137.96.74:6641',
  'http://uowcnblq:a5qiuyuv2hfk@198.23.243.226:6361',
  'http://uowcnblq:a5qiuyuv2hfk@38.154.185.97:6370',
  'http://uowcnblq:a5qiuyuv2hfk@84.247.60.125:6095',
  'http://uowcnblq:a5qiuyuv2hfk@191.96.254.138:6185',
  'http://uowcnblq:a5qiuyuv2hfk@198.46.161.42:5092',
  'http://uowcnblq:a5qiuyuv2hfk@64.137.10.153:5803',
  'http://uowcnblq:a5qiuyuv2hfk@104.164.49.38:7693',
  'http://uowcnblq:a5qiuyuv2hfk@23.26.71.145:5628'
];

let proxyIndex = 0;
function getNextProxy(): HttpsProxyAgent<string> | undefined {
  if (!USE_PROXIES || PROXY_LIST.length === 0) return undefined;
  const proxyUrl = PROXY_LIST[proxyIndex];
  proxyIndex = (proxyIndex + 1) % PROXY_LIST.length;
  return new HttpsProxyAgent(proxyUrl);
}

// ==========================================
// 2. THE 20-STORE DRAGNET (MAXIMUM 250 LIMIT)
// ==========================================
interface MonitoredStore {
  name: string;
  baseUrl: string;
  collectionPath: string;
}

const MONITORED_STORES: MonitoredStore[] = [
  // Core 10
  { name: 'MinMaxGames', baseUrl: 'https://minmaxgames.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Safari Zone', baseUrl: 'https://safari-zone.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Smoke & Mirrors', baseUrl: 'https://smokeandmirrorshobby.com', collectionPath: '/collections/pokemon-sealed-products/products.json?limit=250' },
  { name: 'TCG Stadium', baseUrl: 'https://tcg-stadium.com', collectionPath: '/collections/english-sealed-products/products.json?limit=250' },
  { name: 'Forge & Fire', baseUrl: 'https://forgeandfiregaming.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Rip N Ship Arena', baseUrl: 'https://www.ripnshiparena.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Zulu\'s Games', baseUrl: 'https://zulusgames.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Josh\'s Cards', baseUrl: 'https://joshscards.com', collectionPath: '/collections/pokemon-tcg/products.json?limit=250' },
  { name: 'Gamers Guild AZ', baseUrl: 'https://gamersguildaz.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Card Shop Live', baseUrl: 'https://cardshoplive.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  
  // The Expansion 10
  { name: 'Football Pete', baseUrl: 'https://footballpete.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Prodigy Games', baseUrl: 'https://prodigygames.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Gamers Nerd Deck', baseUrl: 'https://gamersnerddeck.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Double Sleeved', baseUrl: 'https://doublesleeved.co.uk', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Spooky Ninja', baseUrl: 'https://spookyninja.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Collector Store', baseUrl: 'https://collectorstore.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'CoreTCG', baseUrl: 'https://coretcg.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Silver Moon', baseUrl: 'https://silvermooncards.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'The Lotusbox', baseUrl: 'https://thelotusbox.com', collectionPath: '/collections/pokemon/products.json?limit=250' },
  { name: 'Rare Candy', baseUrl: 'https://rarecandy.com', collectionPath: '/collections/pokemon/products.json?limit=250' }
];

const seenVariantMap = new Map<number, string>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRandomJitter(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

export async function pollShopifyStores(): Promise<void> {
  console.log(`\n[${new Date().toLocaleTimeString()}] Executing Staggered LGS Sweep (${MONITORED_STORES.length} endpoints, 250 items deep)...`);

  for (const store of MONITORED_STORES) {
    try {
      const endpoint = `${store.baseUrl}${store.collectionPath}`;
      
      const currentProxy = getNextProxy();
      const res = await axios.get(endpoint, {
        timeout: 8000,
        httpsAgent: currentProxy,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Accept: 'application/json',
        }
      });

      const products = res.data?.products || [];

      for (const prod of products) {
        const updatedTime = prod.updated_at;

        for (const variant of prod.variants || []) {
          // NOTE: We only ingest ACTIVE, IN-STOCK items. Sold out items are ignored.
          if (variant.available) {
            const cachedUpdate = seenVariantMap.get(variant.id);

            if (!cachedUpdate || cachedUpdate !== updatedTime) {
              seenVariantMap.set(variant.id, updatedTime);

              const priceNum = parseFloat(variant.price);
              const fullTitle = `${prod.title} ${variant.title !== 'Default Title' ? variant.title : ''}`.trim();
              const fastCheckoutUrl = `${store.baseUrl}/cart/${variant.id}:1`;

              await processIncomingDrop({
                title: fullTitle,
                retailer: store.name,
                url: fastCheckoutUrl,
                price: priceNum,
                stock: variant.inventory_quantity || 1,
                itemId: String(variant.id),
              });
            }
          } else {
            seenVariantMap.delete(variant.id);
          }
        }
      }
    } catch (err: any) {
      if (err.response?.status !== 404 && err.response?.status !== 430) {
        // Suppress general errors so it doesn't flood the console if a proxy hangs
      }
    }

    await sleep(getRandomJitter(500, 1500));
  }

  const restTime = getRandomJitter(15000, 25000);
  console.log(`[${new Date().toLocaleTimeString()}] Sweep complete. Resting ${(restTime / 1000).toFixed(1)}s...`);
  setTimeout(pollShopifyStores, restTime);
}