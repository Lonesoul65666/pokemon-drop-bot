"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVISIBLE_HEADLESS_LAUNCH_OPTS = exports.PC_QUEUE_BANNER = exports.WAF_POLITE_INTERVAL_MS = exports.WAF_SESSION_COOKIES_PATH = void 0;
exports.loadWafSessionCookies = loadWafSessionCookies;
exports.saveWafSessionCookie = saveWafSessionCookie;
exports.closeWafBrowser = closeWafBrowser;
exports.detectPokemonCenterQueueIt = detectPokemonCenterQueueIt;
exports.sweepWafProtectedTarget = sweepWafProtectedTarget;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const playwright_1 = require("playwright");
const configManager_1 = require("../config/configManager");
exports.WAF_SESSION_COOKIES_PATH = path_1.default.resolve(process.cwd(), 'data', 'wafSessionCookies.json');
exports.WAF_POLITE_INTERVAL_MS = 160 * 1000; // Polite 150s-180s refresh window
exports.PC_QUEUE_BANNER = '◈ ⟦ POKÉMON CENTER WAITING ROOM LIVE — JOIN QUEUE NOW ⟧';
// Strict Zero-Window Law: Never spawn a visible window or steal desktop focus on Windows
exports.INVISIBLE_HEADLESS_LAUNCH_OPTS = {
    headless: true,
    args: [
        '--headless=new',
        '--disable-gpu',
        '--no-startup-window',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-blink-features=AutomationControlled',
        '--mute-audio',
        '--window-position=-32000,-32000'
    ]
};
let resolvedStealthUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const STEALTH_HEADERS = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1'
};
let sessionStore = {};
const lastSweepByTargetKey = new Map();
let sharedBrowser = null;
let activeBrowserChannel = 'chromium-headless';
let browserSweepCount = 0;
let sweepMutex = Promise.resolve();
function loadWafSessionCookies() {
    try {
        if (fs_1.default.existsSync(exports.WAF_SESSION_COOKIES_PATH)) {
            const parsed = JSON.parse(fs_1.default.readFileSync(exports.WAF_SESSION_COOKIES_PATH, 'utf-8'));
            if (parsed && typeof parsed === 'object') {
                sessionStore = parsed;
                return sessionStore;
            }
        }
    }
    catch { }
    return sessionStore;
}
function saveWafSessionCookie(domain, patch) {
    loadWafSessionCookies();
    const prev = sessionStore[domain] || {
        domain,
        cookieHeader: '',
        cookies: [],
        userAgent: resolvedStealthUa,
        updatedAt: 0,
        lastStatus: 'INIT'
    };
    const merged = {
        ...prev,
        ...patch,
        domain,
        updatedAt: Date.now()
    };
    sessionStore[domain] = merged;
    (0, configManager_1.atomicWriteJson)(exports.WAF_SESSION_COOKIES_PATH, sessionStore);
    return merged;
}
function parsePlaywrightProxyFromEnv() {
    const raw = String(process.env.WEBSHARE_PROXY_URL || '').trim();
    if (!raw)
        return undefined;
    try {
        const u = new URL(raw);
        return {
            server: `${u.protocol}//${u.hostname}:${u.port}`,
            username: u.username ? decodeURIComponent(u.username) : undefined,
            password: u.password ? decodeURIComponent(u.password) : undefined
        };
    }
    catch {
        return undefined;
    }
}
async function ensureInvisibleBrowser() {
    if (sharedBrowser && sharedBrowser.isConnected() && browserSweepCount < 25) {
        return sharedBrowser;
    }
    if (sharedBrowser) {
        try {
            await sharedBrowser.close();
        }
        catch { }
        sharedBrowser = null;
    }
    browserSweepCount = 0;
    for (const ch of ['chrome', 'msedge', undefined]) {
        try {
            const b = await playwright_1.chromium.launch({
                ...exports.INVISIBLE_HEADLESS_LAUNCH_OPTS,
                ...(ch ? { channel: ch } : {})
            });
            sharedBrowser = b;
            activeBrowserChannel = ch ? `${ch}-headless-new` : 'playwright-chromium-headless';
            try {
                const probeCtx = await b.newContext();
                const probePage = await probeCtx.newPage();
                const nativeUa = await probePage.evaluate(() => navigator.userAgent);
                if (nativeUa)
                    resolvedStealthUa = nativeUa.replace(/HeadlessChrome/gi, 'Chrome');
                await probePage.close();
                await probeCtx.close();
            }
            catch { }
            return b;
        }
        catch { }
    }
    throw new Error('Failed to launch invisible headless Playwright Chromium/Edge channel');
}
async function closeWafBrowser() {
    if (sharedBrowser) {
        try {
            await sharedBrowser.close();
        }
        catch { }
        sharedBrowser = null;
    }
}
function detectPokemonCenterQueueIt(html, headers, finalUrl = '') {
    const headerKeys = Object.keys(headers || {}).map((k) => k.toLowerCase());
    const redirectLoc = String(headers?.['x-queueit-redirect'] || headers?.['location'] || '');
    const hasQueueHeader = headerKeys.some((k) => k.startsWith('x-queueit-')) ||
        /queue-it\.net/i.test(redirectLoc);
    const hasQueueUrl = /queue-it\.net|waitingroom\.pokemoncenter/i.test(finalUrl);
    const hasQueueDom = /<title>[^<]*(queue-it|waiting\s+room|you\s+are\s+now\s+in\s+line)[^<]*<\/title>/i.test(html || '') ||
        /queue-it\.net\/|you\s+are\s+now\s+in\s+line|virtual\s+waiting\s+room\s+is\s+active/i.test(html || '');
    if (!hasQueueHeader && !hasQueueUrl && !hasQueueDom) {
        return { isQueueActive: false };
    }
    return {
        isQueueActive: true,
        queueBadge: exports.PC_QUEUE_BANNER,
        redirectUrl: 'https://www.pokemoncenter.com'
    };
}
function classifyWafChallenge(domain, status, html) {
    if (/px-captcha|Robot or human\?|PXGWPp4wUS/i.test(html) || status === 435)
        return 'PX';
    if (/_Incapsula_Resource|Pardon Our Interruption|Request unsuccessful\. Incapsula/i.test(html))
        return 'IMPERVA';
    if (/cf-chl|Just a moment\.\.\.|Attention Required! \| Cloudflare|Verify you are human|Access Denied/i.test(html)) {
        return domain === 'pokemoncenter' ? 'IMPERVA' : 'CF';
    }
    if (status === 403 || status === 429) {
        return domain === 'pokemoncenter' ? 'IMPERVA' : 'CF';
    }
    return undefined;
}
async function executeSinglePlaywrightSweep(domain, url, cached, useProxy) {
    const browser = await ensureInvisibleBrowser();
    browserSweepCount += 1;
    const proxyCfg = useProxy ? parsePlaywrightProxyFromEnv() : undefined;
    let context = null;
    try {
        context = await browser.newContext({
            userAgent: resolvedStealthUa,
            extraHTTPHeaders: STEALTH_HEADERS,
            viewport: { width: 1440, height: 900 },
            locale: 'en-US',
            timezoneId: 'America/Chicago',
            ...(proxyCfg ? { proxy: proxyCfg } : {})
        });
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            window.chrome = window.chrome || { runtime: {} };
        });
        if (Array.isArray(cached?.cookies) && cached.cookies.length > 0) {
            try {
                await context.addCookies(cached.cookies);
            }
            catch { }
        }
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.route('**/*', (route) => {
            const rt = route.request().resourceType();
            if (rt === 'image' || rt === 'media' || rt === 'font')
                return route.abort();
            return route.continue();
        });
        try {
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            const status = response ? response.status() : 200;
            if (domain === 'barnesandnoble' && status >= 200 && status < 400) {
                await page.waitForTimeout(1500);
            }
            const headers = response ? response.headers() : {};
            const finalUrl = page.url();
            const html = await page.content();
            const cookies = await context.cookies();
            const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
            const queueCheck = domain === 'pokemoncenter'
                ? detectPokemonCenterQueueIt(html, headers, finalUrl)
                : { isQueueActive: false, queueBadge: undefined, redirectUrl: undefined };
            const wafType = queueCheck.isQueueActive ? undefined : classifyWafChallenge(domain, status, html);
            const isWafChallenged = Boolean(wafType);
            return {
                ok: status >= 200 && status < 400 && !isWafChallenged,
                status,
                html: isWafChallenged ? '' : html,
                finalUrl,
                headers,
                isQueueActive: queueCheck.isQueueActive,
                queueBadge: queueCheck.queueBadge,
                isWafChallenged,
                wafType,
                cookieHeader,
                cookies,
                fromSessionCache: false,
                browserChannel: activeBrowserChannel
            };
        }
        finally {
            try {
                await page.close();
            }
            catch { }
        }
    }
    finally {
        if (context) {
            try {
                await context.close();
            }
            catch { }
        }
    }
}
async function sweepWafProtectedTarget(domain, url, force = false) {
    loadWafSessionCookies();
    const now = Date.now();
    const cacheKey = `${domain}::${url}`;
    const prevRun = lastSweepByTargetKey.get(cacheKey);
    const cached = sessionStore[domain];
    if (!force && prevRun && now - prevRun.ts < exports.WAF_POLITE_INTERVAL_MS) {
        return { ...prevRun.result, fromSessionCache: true };
    }
    const runTask = async () => {
        try {
            let res = await executeSinglePlaywrightSweep(domain, url, cached, false);
            if (res.isWafChallenged && parsePlaywrightProxyFromEnv()) {
                try {
                    const proxied = await executeSinglePlaywrightSweep(domain, url, cached, true);
                    if (proxied.ok || proxied.isQueueActive)
                        res = proxied;
                }
                catch { }
            }
            const statusTag = res.isQueueActive
                ? 'QUEUE_ACTIVE'
                : (res.isWafChallenged ? `WAF_CHALLENGE_${res.wafType}` : `${res.status}_OK`);
            saveWafSessionCookie(domain, {
                cookieHeader: res.cookieHeader || cached?.cookieHeader || '',
                cookies: res.cookies || cached?.cookies || [],
                userAgent: resolvedStealthUa,
                lastStatus: statusTag,
                browserChannel: res.browserChannel,
                queueActive: res.isQueueActive,
                queueRedirectUrl: res.isQueueActive ? 'https://www.pokemoncenter.com' : undefined
            });
            lastSweepByTargetKey.set(cacheKey, { ts: Date.now(), result: res });
            return res;
        }
        catch {
            const fallbackWaf = domain === 'pokemoncenter' ? 'IMPERVA' : 'CF';
            saveWafSessionCookie(domain, { lastStatus: `WAF_CHALLENGE_${fallbackWaf}`, queueActive: false });
            const failRes = {
                ok: false,
                status: 403,
                html: '',
                finalUrl: url,
                headers: {},
                isQueueActive: false,
                isWafChallenged: true,
                wafType: fallbackWaf,
                cookieHeader: cached?.cookieHeader || '',
                fromSessionCache: false,
                browserChannel: activeBrowserChannel
            };
            lastSweepByTargetKey.set(cacheKey, { ts: Date.now(), result: failRes });
            return failRes;
        }
    };
    const next = sweepMutex.then(runTask, runTask);
    sweepMutex = next.then(() => undefined, () => undefined);
    return next;
}
