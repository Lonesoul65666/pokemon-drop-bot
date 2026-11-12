import fs from 'fs';
import path from 'path';
import { chromium, Browser, BrowserContext, Cookie } from 'playwright';
import { atomicWriteJson } from '../config/configManager';

export type WafDomain = 'pokemoncenter' | 'target' | 'walmart' | 'bestbuy' | 'costco' | 'samsclub' | 'gamestop' | 'barnesandnoble' | 'amazon';
export type WafBlockType = 'IMPERVA' | 'PX' | 'AKAMAI' | 'CF' | 'KASADA' | 'BOT_CHECK' | 'ROUTER_TLS_FILTER';

export interface CapturedJsonResponse {
  url: string; status: number; data: any; rawText: string;
}

export interface WafSessionEntry {
  domain: WafDomain; cookieHeader: string; cookies?: Cookie[]; userAgent: string;
  updatedAt: number; nextEligibleAt?: number; lastStatus: string;
  browserChannel?: string; queueActive?: boolean; queueRedirectUrl?: string;
}

export interface WafSweepOptions {
  force?: boolean; waitAfterLoadMs?: number; waitForSelector?: string;
  captureUrlPattern?: RegExp; timeoutMs?: number;
}

export interface WafSweepResult {
  ok: boolean; status: number; html: string; finalUrl: string; headers: Record<string, any>;
  capturedJson: CapturedJsonResponse[]; tlsIssuer?: string; tlsSubject?: string;
  isRouterTlsFilter?: boolean; isQueueActive: boolean; queueBadge?: string;
  isWafChallenged: boolean; wafType?: WafBlockType; cookieHeader: string;
  cookies?: Cookie[]; fromSessionCache: boolean; browserChannel?: string;
}

export const WAF_SESSION_COOKIES_PATH = path.resolve(process.cwd(), 'data', 'wafSessionCookies.json');
export const PC_QUEUE_BANNER = 'POKÉMON CENTER WAITING ROOM LIVE';

// Jittered per-retailer polite intervals (Residential IP Protection — Never burst)
export const DOMAIN_POLITE_INTERVALS_MS: Record<WafDomain, [number, number]> = {
  target: [75_000, 83_000],
  walmart: [92_000, 118_000],
  costco: [95_000, 120_000],
  bestbuy: [92_000, 116_000],
  samsclub: [98_000, 120_000],
  amazon: [95_000, 105_000],
  gamestop: [150_000, 162_000],
  barnesandnoble: [150_000, 162_000],
  pokemoncenter: [180_000, 195_000]
};

// Strict Zero-Window Law: Real System Chrome headless=new, never spawn a visible desktop window
export const INVISIBLE_HEADLESS_LAUNCH_OPTS = {
  headless: true as const,
  args: [
    '--headless=new', '--disable-blink-features=AutomationControlled', '--disable-gpu',
    '--no-startup-window', '--mute-audio', '--no-first-run', '--no-default-browser-check',
    '--window-position=-32000,-32000'
  ]
};

let resolvedStealthUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
let sessionStore: Record<string, WafSessionEntry> = {};
const lastSweepByDomain = new Map<WafDomain, { nextAt: number; result: WafSweepResult }>();
let sharedBrowser: Browser | null = null;
let activeBrowserChannel = 'chrome-headless-new';
let browserSweepCount = 0;
let sweepMutex: Promise<any> = Promise.resolve();

function computeJitteredCooldownMs(domain: WafDomain): number {
  const [minMs, maxMs] = DOMAIN_POLITE_INTERVALS_MS[domain] || [120_000, 140_000];
  return Math.floor(minMs + Math.random() * Math.max(1, maxMs - minMs));
}

export const getNativeChromeUserAgent = (): string => resolvedStealthUa;

export function loadWafSessionCookies(): Record<string, WafSessionEntry> {
  try {
    if (fs.existsSync(WAF_SESSION_COOKIES_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(WAF_SESSION_COOKIES_PATH, 'utf-8'));
      if (parsed && typeof parsed === 'object') { sessionStore = parsed; return sessionStore; }
    }
  } catch {}
  return sessionStore;
}

export function saveWafSessionCookie(domain: WafDomain, patch: Partial<WafSessionEntry>): WafSessionEntry {
  loadWafSessionCookies();
  const prev = sessionStore[domain] || { domain, cookieHeader: '', cookies: [], userAgent: resolvedStealthUa, updatedAt: 0, lastStatus: 'INIT' };
  const merged: WafSessionEntry = { ...prev, ...patch, domain, updatedAt: Date.now() };
  sessionStore[domain] = merged;
  atomicWriteJson(WAF_SESSION_COOKIES_PATH, sessionStore);
  return merged;
}

async function ensureInvisibleBrowser(): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.isConnected() && browserSweepCount < 30) return sharedBrowser;
  if (sharedBrowser) { try { await sharedBrowser.close(); } catch {} sharedBrowser = null; }
  browserSweepCount = 0;

  for (const ch of ['chrome', 'msedge'] as Array<'chrome' | 'msedge'>) {
    try {
      const b = await chromium.launch({ ...INVISIBLE_HEADLESS_LAUNCH_OPTS, channel: ch });
      sharedBrowser = b;
      activeBrowserChannel = `${ch}-headless-new`;
      try {
        const pCtx = await b.newContext({ ignoreHTTPSErrors: true });
        const pPage = await pCtx.newPage();
        try {
          const ua = await pPage.evaluate(() => navigator.userAgent);
          if (ua) resolvedStealthUa = ua.replace(/HeadlessChrome/gi, 'Chrome');
        } finally {
          await pPage.close().catch(() => {});
          await pCtx.close().catch(() => {});
        }
      } catch {}
      return b;
    } catch {}
  }
  throw new Error('Failed to launch invisible System Chrome/Edge headless channel');
}

export async function closeWafBrowser(): Promise<void> {
  if (sharedBrowser) { try { await sharedBrowser.close(); } catch {} sharedBrowser = null; }
}

export function detectRouterTlsFilter(finalUrl: string, html: string, tlsIssuer = '', tlsSubject = ''): boolean {
  if (/tplinkwifi|homeshield|routerlogin|192\.168\.|10\.0\.0\.|blockpage|cyberprotection|safebrowsing/i.test(finalUrl)) return true;
  if (/TP-Link|Deco|HomeShield|Trend\s*Micro|Fortinet|FortiGuard|Netgear|ASUS|Cisco\s*Umbrella|OpenDNS/i.test(`${tlsIssuer} ${tlsSubject}`)) return true;
  return /blocked\s+by\s+(?:your\s+)?(?:router|homeshield|network|administrator)|tp-link\s+homeshield|malicious\s+(?:website|content)\s+blocked/i.test(html);
}

export function detectPokemonCenterQueueIt(
  html: string, headers: Record<string, any>, finalUrl = ''
): { isQueueActive: boolean; queueBadge?: string; redirectUrl?: string } {
  const headerKeys = Object.keys(headers || {}).map((k) => k.toLowerCase());
  const redirectLoc = String(headers?.['x-queueit-redirect'] || headers?.['location'] || '');
  const hasQueueHeader = headerKeys.some((k) => k.startsWith('x-queueit-')) || /queue-it\.net/i.test(redirectLoc);
  const hasQueueUrl = /queue-it\.net|waitingroom\.pokemoncenter/i.test(finalUrl);
  const hasQueueDom =
    /<title>[^<]*(queue-it|waiting\s+room|you\s+are\s+now\s+in\s+line)[^<]*<\/title>/i.test(html || '') ||
    /queue-it\.net\/|you\s+are\s+now\s+in\s+line|virtual\s+waiting\s+room\s+is\s+active/i.test(html || '');
  if (!hasQueueHeader && !hasQueueUrl && !hasQueueDom) return { isQueueActive: false };
  return { isQueueActive: true, queueBadge: PC_QUEUE_BANNER, redirectUrl: 'https://www.pokemoncenter.com' };
}

export function classifyWafChallenge(
  domain: WafDomain, status: number, html: string, finalUrl: string, headers: Record<string, any>, xhrWafHint?: WafBlockType
): WafBlockType | undefined {
  if (status === 412 || status === 435 || /\/blocked\b|\/are-you-human\b/i.test(finalUrl) ||
      /px-captcha|Robot or human\?|Let us know you['’]re (?:not a robot|human)|PXGWPp4wUS|PXu6b0qd2S|PXsLC3j22K/i.test(html)) {
    return 'PX';
  }
  if (/_Incapsula_Resource|Pardon Our Interruption|Request unsuccessful\. Incapsula|window\.reeseSkipExpirationCheck/i.test(html) ||
      (domain === 'pokemoncenter' && headers?.['x-iinfo'] && !/\/product\//i.test(html))) {
    return 'IMPERVA';
  }
  if (/validateCaptcha|api-services-support@amazon\.com|Enter the characters you see below/i.test(html) || (domain === 'amazon' && status === 503)) {
    return 'BOT_CHECK';
  }
  if (domain === 'bestbuy' && (status === 403 || status === 429 || /Access Denied|Reference #18\./i.test(html))) return 'AKAMAI';
  if (/cf-chl|Just a moment\.\.\.|Attention Required! \| Cloudflare|Verify you are human/i.test(html)) return 'CF';
  if (status === 403 || status === 429) {
    if (domain === 'pokemoncenter') return 'IMPERVA';
    if (domain === 'target' || domain === 'walmart' || domain === 'samsclub') return 'PX';
    if (domain === 'bestbuy') return 'AKAMAI';
    if (domain === 'costco') return 'KASADA';
    return 'CF';
  }
  return xhrWafHint;
}

async function executePassiveChromeSweep(
  domain: WafDomain, url: string, cached: WafSessionEntry | undefined, opts: WafSweepOptions
): Promise<WafSweepResult> {
  const browser = await ensureInvisibleBrowser();
  browserSweepCount += 1;
  const timeoutMs = Math.min(Math.max(opts.timeoutMs || 16000, 6000), 22000);
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext({
      userAgent: resolvedStealthUa, ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/Chicago'
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      (window as any).chrome = (window as any).chrome || { runtime: {} };
    });
    if (Array.isArray(cached?.cookies) && cached.cookies.length > 0 && !/WAF_CHALLENGE_(?:PX|KASADA)/i.test(cached.lastStatus || '')) {
      try { await context.addCookies(cached.cookies); } catch {}
    }

    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    const capturedJson: CapturedJsonResponse[] = [];
    let xhrWafHint: WafBlockType | undefined;

    // Passive response wire-tap (zero page.evaluate fetch injection, zero page.route timing leaks)
    page.on('response', async (res) => {
      try {
        const rUrl = res.url();
        const rStatus = res.status();
        if (rStatus === 435 || (rStatus === 412 && /walmart|samsclub|px/i.test(rUrl))) xhrWafHint = 'PX';
        else if (rStatus === 429 && /gdx-api\.costco\.com\/catalog\/search/i.test(rUrl)) xhrWafHint = 'KASADA';
        const matchesHook = opts.captureUrlPattern ? opts.captureUrlPattern.test(rUrl) : false;
        const ct = String(res.headers()['content-type'] || '').toLowerCase();
        if (matchesHook || (ct.includes('json') && /plp_search_v2|cdui_orchestrations|gdx-api\.costco\.com\/catalog\/search/i.test(rUrl))) {
          const rawText = await res.text();
          if (/PXGWPp4wUS|PXu6b0qd2S|PXsLC3j22K|"blockScript"/i.test(rawText)) xhrWafHint = 'PX';
          let data: any = null;
          try { data = JSON.parse(rawText); } catch {}
          if (data && rStatus >= 200 && rStatus < 300) {
            capturedJson.push({ url: rUrl, status: rStatus, data, rawText: rawText.slice(0, 2000) });
          }
        }
      } catch {}
    });

    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      const status = response ? response.status() : 200;
      const headers = response ? response.headers() : {};
      const sec = response ? await response.securityDetails().catch(() => null) : null;
      const tlsIssuer = sec?.issuer || '', tlsSubject = sec?.subjectName || '';

      if (opts.waitForSelector && status < 400) {
        await page.waitForSelector(opts.waitForSelector, { timeout: Math.min(5000, Math.floor(timeoutMs / 2)) }).catch(() => {});
      }
      if (opts.waitAfterLoadMs && opts.waitAfterLoadMs > 0 && status < 400) {
        await page.waitForTimeout(opts.waitAfterLoadMs);
      }

      const finalUrl = page.url();
      const html = await page.content();
      const cookies = await context.cookies();
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

      if (domain === 'pokemoncenter' && detectRouterTlsFilter(finalUrl, html, tlsIssuer, tlsSubject)) {
        return {
          ok: false, status, html: '', finalUrl, headers, capturedJson, tlsIssuer, tlsSubject,
          isRouterTlsFilter: true, isQueueActive: false, isWafChallenged: true,
          wafType: 'ROUTER_TLS_FILTER', cookieHeader, cookies, fromSessionCache: false, browserChannel: activeBrowserChannel
        };
      }

      const queueCheck = domain === 'pokemoncenter' ? detectPokemonCenterQueueIt(html, headers, finalUrl) : { isQueueActive: false, queueBadge: undefined };
      const hasUsablePayload = capturedJson.length > 0 || (domain === 'walmart' && html.includes('__NEXT_DATA__'));
      const wafType = queueCheck.isQueueActive ? undefined : classifyWafChallenge(domain, status, html, finalUrl, headers, hasUsablePayload ? undefined : xhrWafHint);
      const isWafChallenged = Boolean(wafType);

      return {
        ok: status >= 200 && status < 400 && !isWafChallenged,
        status, html: isWafChallenged ? '' : html, finalUrl, headers, capturedJson, tlsIssuer, tlsSubject,
        isQueueActive: queueCheck.isQueueActive, queueBadge: queueCheck.queueBadge,
        isWafChallenged, wafType, cookieHeader, cookies, fromSessionCache: false, browserChannel: activeBrowserChannel
      };
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

export async function sweepWafProtectedTarget(
  domain: WafDomain, url: string, optionsOrForce: boolean | WafSweepOptions = false
): Promise<WafSweepResult> {
  const opts: WafSweepOptions = typeof optionsOrForce === 'boolean' ? { force: optionsOrForce } : (optionsOrForce || {});
  loadWafSessionCookies();
  const now = Date.now();
  const prev = lastSweepByDomain.get(domain);
  const cached = sessionStore[domain];
  if (!opts.force && prev && now < prev.nextAt) return { ...prev.result, fromSessionCache: true };
  if (!opts.force && cached?.nextEligibleAt && now < cached.nextEligibleAt) {
    const isWaf = /WAF_CHALLENGE_|ROUTER_TLS_FILTER/i.test(cached.lastStatus || '');
    return {
      ok: !isWaf, status: isWaf ? 403 : 200, html: '', finalUrl: url, headers: {}, capturedJson: [],
      isQueueActive: Boolean(cached.queueActive), isWafChallenged: isWaf,
      cookieHeader: cached.cookieHeader || '', cookies: cached.cookies || [], fromSessionCache: true, browserChannel: cached.browserChannel
    };
  }

  const runSerial = async (): Promise<WafSweepResult> => {
    const cooldownMs = computeJitteredCooldownMs(domain);
    try {
      const res = await executePassiveChromeSweep(domain, url, cached, opts);
      const statusTag = res.isQueueActive ? PC_QUEUE_BANNER
        : (res.isWafChallenged ? (res.wafType === 'ROUTER_TLS_FILTER' ? 'ROUTER_TLS_FILTER' : `WAF_CHALLENGE_${res.wafType}`) : `${res.status}_OK`);
      const keepCookies = !(res.isWafChallenged && (res.wafType === 'PX' || res.wafType === 'KASADA'));
      saveWafSessionCookie(domain, {
        cookieHeader: keepCookies ? (res.cookieHeader || cached?.cookieHeader || '') : '',
        cookies: keepCookies ? (res.cookies && res.cookies.length > 0 ? res.cookies : (cached?.cookies || [])) : [],
        userAgent: resolvedStealthUa, nextEligibleAt: Date.now() + cooldownMs, lastStatus: statusTag,
        browserChannel: res.browserChannel, queueActive: res.isQueueActive, queueRedirectUrl: res.isQueueActive ? 'https://www.pokemoncenter.com' : undefined
      });
      lastSweepByDomain.set(domain, { nextAt: Date.now() + cooldownMs, result: res });
      return res;
    } catch (err: any) {
      const fallbackWaf: WafBlockType = domain === 'pokemoncenter'
        ? (/CERT|SSL|TLS/i.test(String(err?.message || '')) ? 'ROUTER_TLS_FILTER' : 'IMPERVA')
        : (domain === 'bestbuy' ? 'AKAMAI' : (domain === 'target' || domain === 'walmart' || domain === 'samsclub' ? 'PX' : 'CF'));
      saveWafSessionCookie(domain, {
        lastStatus: fallbackWaf === 'ROUTER_TLS_FILTER' ? 'ROUTER_TLS_FILTER' : `WAF_CHALLENGE_${fallbackWaf}`,
        nextEligibleAt: Date.now() + cooldownMs, queueActive: false
      });
      const failRes: WafSweepResult = {
        ok: false, status: 0, html: '', finalUrl: url, headers: {}, capturedJson: [],
        isRouterTlsFilter: fallbackWaf === 'ROUTER_TLS_FILTER', isQueueActive: false, isWafChallenged: true,
        wafType: fallbackWaf, cookieHeader: cached?.cookieHeader || '', fromSessionCache: false, browserChannel: activeBrowserChannel
      };
      lastSweepByDomain.set(domain, { nextAt: Date.now() + cooldownMs, result: failRes });
      return failRes;
    }
  };

  const next = sweepMutex.then(runSerial, runSerial);
  sweepMutex = next.then(() => undefined, () => undefined);
  return next;
}
