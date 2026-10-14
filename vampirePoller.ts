import axios from 'axios';
import { getNextProxy } from './lgsPoller';
import { processIncomingDrop } from './listener';
import { WATCH_POLICIES } from './policies';

const seenRedditIds = new Set<string>();
const seenTcgPrices = new Map<string, number>();

// A. Vampiric Reddit Deal Monitor (Catches Target, Best Buy, Walmart, Costco, Pokemon Center & LGS drops posted to r/PKMNTCGDeals)
export async function pollRedditDeals(): Promise<void> {
  try {
    const proxy = getNextProxy();
    const res = await axios.get('https://www.reddit.com/r/PKMNTCGDeals/new.json?limit=15', {
      timeout: 8000,
      httpsAgent: proxy,
      headers: {
        'User-Agent': 'Windows:DropBotCommander:v2.1 (by /u/Lonesoul65666)',
        Accept: 'application/json'
      }
    });

    const posts = res.data?.data?.children || [];
    for (const child of posts) {
      const post = child.data;
      if (!post || seenRedditIds.has(post.id)) continue;
      seenRedditIds.add(post.id);

      // Only evaluate fresh posts from the last 2 hours
      const ageSeconds = (Date.now() / 1000) - (post.created_utc || 0);
      if (ageSeconds > 7200) continue;

      const title: string = post.title || '';
      const priceMatch = title.match(/\$([0-9]+(?:\.[0-9]{1,2})?)/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[1]);
      const dealUrl = post.url_overridden_by_dest || `https://www.reddit.com${post.permalink}`;

      // Extract retailer tag like [Target] or [Best Buy] if present
      const storeMatch = title.match(/^\[([^\]]+)\]/);
      const retailer = storeMatch ? `${storeMatch[1]} (via PKMNTCGDeals)` : 'r/PKMNTCGDeals Alert';

      await processIncomingDrop({
        title,
        retailer,
        url: dealUrl,
        price,
        stock: 1,
        itemId: `reddit_${post.id}`
      });
    }
  } catch (e) {
    // Ignore transient Reddit rate limits
  }

  setTimeout(pollRedditDeals, 60000); // Check every 60 seconds
}

// B. TCGPlayer Lowest-Listing Undercut Sniper (Catches individual sellers listing below your Max Buy Trigger)
let tcgCursor = 0;
export async function pollTcgPlayerUndercuts(): Promise<void> {
  const activePolicies = WATCH_POLICIES.filter((p: any) => p.active !== false);
  if (activePolicies.length === 0) {
    setTimeout(pollTcgPlayerUndercuts, 30000);
    return;
  }

  // Check 4 items per cycle so we sweep the catalog smoothly without rate-limiting
  for (let i = 0; i < 4; i++) {
    const policy = activePolicies[tcgCursor % activePolicies.length];
    tcgCursor = (tcgCursor + 1) % activePolicies.length;

    try {
      const cleanQ = policy.name
        .replace(/\(36-Pack\)/gi, '')
        .replace(/\(6 Boxes \/ 216 Packs\)/gi, '')
        .replace(/\(10 ETBs\)/gi, '')
        .replace(/6-Pack /gi, '')
        .replace(/Sealed /gi, '')
        .trim();

      const url = `https://mp-search-api.tcgplayer.com/v1/search/request?q=${encodeURIComponent(cleanQ)}&isList=false`;
      const body = {
        algorithm: "sales_synonym_v2",
        from: 0,
        size: 6,
        filters: { term: { productLineName: ["pokemon"] }, range: {}, match: {} },
        listingSearch: { context: { cart: {} }, filters: { term: { sellerStatus: "Live", channelId: 0 }, range: { quantity: { gte: 1 } }, exclude: { channelExclusion: 0 } } },
        context: { cart: {}, shippingCountry: "US" },
        settings: { useFuzzySearch: false, didYouMean: {} },
        sort: {}
      };

      const res = await axios.post(url, body, {
        timeout: 6000,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      });

      const results = res.data?.results?.[0]?.results || [];
      for (const item of results) {
        if (item.customAttributes?.number) continue;
        const prodTitle = `${item.productName || ''} ${item.setName || ''}`;
        const lowestPrice = parseFloat(item.lowestPriceWithShipping || item.lowestPrice || 0);
        if (!lowestPrice || lowestPrice <= 0) continue;

        // Only process if the price changed or hasn't been seen at this level
        const prevPrice = seenTcgPrices.get(policy.id);
        if (prevPrice !== lowestPrice) {
          seenTcgPrices.set(policy.id, lowestPrice);
          const prodId = Math.floor(Number(item.productId));
          await processIncomingDrop({
            title: prodTitle,
            retailer: 'TCGPlayer Verified Seller',
            url: `https://www.tcgplayer.com/product/${prodId}`,
            price: lowestPrice,
            stock: 1,
            itemId: `tcg_${prodId}_${lowestPrice}`
          });
        }
        break;
      }
    } catch (e) {}
  }

  setTimeout(pollTcgPlayerUndercuts, 15000);
}
