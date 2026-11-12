"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNativeChromeUserAgent = exports.INVISIBLE_HEADLESS_LAUNCH_OPTS = exports.DOMAIN_POLITE_INTERVALS_MS = exports.HOME_IP_SHIELD_DOMAINS = exports.HOME_IP_SHIELD_COOLDOWN_MS = exports.PC_QUEUE_BANNER = exports.WAF_SESSION_COOKIES_PATH = void 0;
exports.loadWafSessionCookies = loadWafSessionCookies;
exports.saveWafSessionCookie = saveWafSessionCookie;
exports.isDomainIpShielded = isDomainIpShielded;
exports.recordBigBoxDirectIpOutcome = recordBigBoxDirectIpOutcome;
exports.closeWafBrowser = closeWafBrowser;
exports.detectRouterTlsFilter = detectRouterTlsFilter;
exports.detectPokemonCenterQueueIt = detectPokemonCenterQueueIt;
exports.classifyWafChallenge = classifyWafChallenge;
exports.sweepWafProtectedTarget = sweepWafProtectedTarget;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const playwright_1 = require("playwright");
const configManager_1 = require("../config/configManager");
exports.WAF_SESSION_COOKIES_PATH = path_1.default.resolve(process.cwd(), 'data', 'wafSessionCookies.json');
exports.PC_QUEUE_BANNER = 'POKÉMON CENTER WAITING ROOM LIVE';
exports.HOME_IP_SHIELD_COOLDOWN_MS = 6 * 60 * 60 * 1000;
exports.HOME_IP_SHIELD_DOMAINS = new Set(['pokemoncenter', 'target', 'walmart', 'costco', 'samsclub']);
exports.DOMAIN_POLITE_INTERVALS_MS = {
    target: [75_000, 83_000], walmart: [92_000, 118_000], costco: [95_000, 120_000],
    bestbuy: [92_000, 116_000], samsclub: [98_000, 120_000], amazon: [95_000, 105_000],
    gamestop: [150_000, 162_000], barnesandnoble: [150_000, 162_000], pokemoncenter: [180_000, 195_000]
};
exports.INVISIBLE_HEADLESS_LAUNCH_OPTS = {
    headless: true,
    args: [
        '--headless=new', '--disable-blink-features=AutomationControlled', '--disable-gpu',
        '--no-startup-window', '--mute-audio', '--no-first-run', '--no-default-browser-check',
        '--window-position=-32000,-32000'
    ]
};
let resolvedStealthUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
let sessionStore = {};
const lastSweepByDomain = new Map();
let sharedBrowser = null;
let activeBrowserChannel = 'chrome-headless-new';
let browserSweepCount = 0;
let sweepMutex = Promise.resolve();
function computeJitteredCooldownMs(domain) {
    const [minMs, maxMs] = exports.DOMAIN_POLITE_INTERVALS_MS[domain] || [120_000, 140_000];
    return Math.floor(minMs + Math.random() * Math.max(1, maxMs - minMs));
}
const getNativeChromeUserAgent = () => resolvedStealthUa;
exports.getNativeChromeUserAgent = getNativeChromeUserAgent;
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
    const prev = sessionStore[domain] || { domain, cookieHeader: '', cookies: [], userAgent: resolvedStealthUa, updatedAt: 0, lastStatus: 'INIT' };
    const merged = { ...prev, ...patch, domain, updatedAt: Date.now() };
    sessionStore[domain] = merged;
    (0, configManager_1.atomicWriteJson)(exports.WAF_SESSION_COOKIES_PATH, sessionStore);
    return merged;
}
function isDomainIpShielded(domain, now = Date.now()) {
    if (!exports.HOME_IP_SHIELD_DOMAINS.has(domain))
        return { shielded: false, ipShieldUntil: 0, strikes: 0 };
    loadWafSessionCookies();
    const entry = sessionStore[domain];
    const until = Number(entry?.ipShieldUntil || 0);
    return { shielded: until > now, ipShieldUntil: until, strikes: Number(entry?.consecutiveShieldStrikes || 0) };
}
function recordBigBoxDirectIpOutcome(domain, isBlockedOrZeroNodes, statusTag) {
    if (!exports.HOME_IP_SHIELD_DOMAINS.has(domain))
        return { shielded: false, strikes: 0, ipShieldUntil: 0 };
    loadWafSessionCookies();
    const prev = sessionStore[domain];
    if (!isBlockedOrZeroNodes) {
        if ((prev?.consecutiveShieldStrikes || 0) > 0 || (prev?.ipShieldUntil || 0) > 0) {
            saveWafSessionCookie(domain, { consecutiveShieldStrikes: 0, ipShieldUntil: 0, lastStatus: statusTag });
        }
        return { shielded: false, strikes: 0, ipShieldUntil: 0 };
    }
    const strikes = Number(prev?.consecutiveShieldStrikes || 0) + 1;
    if (strikes >= 2) {
        const ipShieldUntil = Date.now() + exports.HOME_IP_SHIELD_COOLDOWN_MS;
        saveWafSessionCookie(domain, { consecutiveShieldStrikes: strikes, ipShieldUntil, nextEligibleAt: ipShieldUntil, lastStatus: 'WIRE_ARMED_IP_SHIELD' });
        lastSweepByDomain.delete(domain);
        console.log(`[Home-IP Shield] ${domain} hit ${strikes} consecutive Direct-IP strikes (${statusTag}) -> 6h WIRE_ARMED_IP_SHIELD engaged.`);
        return { shielded: true, strikes, ipShieldUntil };
    }
    saveWafSessionCookie(domain, { consecutiveShieldStrikes: strikes, lastStatus: statusTag });
    return { shielded: false, strikes, ipShieldUntil: 0 };
}
async function ensureInvisibleBrowser() {
    if (sharedBrowser && sharedBrowser.isConnected() && browserSweepCount < 30)
        return sharedBrowser;
    if (sharedBrowser) {
        try {
            await sharedBrowser.close();
        }
        catch { }
        sharedBrowser = null;
    }
    browserSweepCount = 0;
    for (const ch of ['chrome', 'msedge']) {
        try {
            const b = await playwright_1.chromium.launch({ ...exports.INVISIBLE_HEADLESS_LAUNCH_OPTS, channel: ch });
            sharedBrowser = b;
            activeBrowserChannel = `${ch}-headless-new`;
            const pCtx = await b.newContext({ ignoreHTTPSErrors: true }).catch(() => null);
            if (pCtx) {
                const pPage = await pCtx.newPage().catch(() => null);
                try {
                    const ua = pPage ? await pPage.evaluate(() => navigator.userAgent) : '';
                    if (ua)
                        resolvedStealthUa = ua.replace(/HeadlessChrome/gi, 'Chrome');
                }
                finally {
                    await pPage?.close().catch(() => { });
                    await pCtx.close().catch(() => { });
                }
            }
            return b;
        }
        catch { }
    }
    throw new Error('Failed to launch invisible System Chrome/Edge headless channel');
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
function detectRouterTlsFilter(finalUrl, html, tlsIssuer = '', tlsSubject = '') {
    if (/tplinkwifi|homeshield|routerlogin|192\.168\.|10\.0\.0\.|blockpage|cyberprotection|safebrowsing/i.test(finalUrl))
        return true;
    if (/TP-Link|Deco|HomeShield|Trend\s*Micro|Fortinet|FortiGuard|Netgear|ASUS|Cisco\s*Umbrella|OpenDNS/i.test(`${tlsIssuer} ${tlsSubject}`))
        return true;
    return /blocked\s+by\s+(?:your\s+)?(?:router|homeshield|network|administrator)|tp-link\s+homeshield|malicious\s+(?:website|content)\s+blocked/i.test(html);
}
function detectPokemonCenterQueueIt(html, headers, finalUrl = '') {
    const redirectLoc = String(headers?.['x-queueit-redirect'] || headers?.['location'] || '');
    const hasQueueHeader = Object.keys(headers || {}).some((k) => k.toLowerCase().startsWith('x-queueit-')) || /queue-it\.net/i.test(redirectLoc);
    const hasQueueUrl = /queue-it\.net|waitingroom\.pokemoncenter/i.test(finalUrl);
    const hasQueueDom = /<title>[^<]*(queue-it|waiting\s+room|you\s+are\s+now\s+in\s+line)[^<]*<\/title>|queue-it\.net\/|you\s+are\s+now\s+in\s+line|virtual\s+waiting\s+room\s+is\s+active/i.test(html || '');
    return (hasQueueHeader || hasQueueUrl || hasQueueDom)
        ? { isQueueActive: true, queueBadge: exports.PC_QUEUE_BANNER, redirectUrl: 'https://www.pokemoncenter.com' }
        : { isQueueActive: false };
}
function classifyWafChallenge(domain, status, html, finalUrl, headers, xhrWafHint) {
    if (status === 412 || status === 435 || /\/blocked\b|\/are-you-human\b/i.test(finalUrl) ||
        /px-captcha|Robot or human\?|Let us know you['’]re (?:not a robot|human)|PXGWPp4wUS|PXu6b0qd2S|PXsLC3j22K/i.test(html))
        return 'PX';
    if (/_Incapsula_Resource|Pardon Our Interruption|Request unsuccessful\. Incapsula|window\.reeseSkipExpirationCheck/i.test(html) ||
        (domain === 'pokemoncenter' && headers?.['x-iinfo'] && !/\/product\//i.test(html)))
        return 'IMPERVA';
    if (/validateCaptcha|api-services-support@amazon\.com|Enter the characters you see below/i.test(html) || (domain === 'amazon' && status === 503))
        return 'BOT_CHECK';
    if (domain === 'bestbuy' && (status === 403 || status === 429 || /Access Denied|Reference #18\./i.test(html)))
        return 'AKAMAI';
    if (/cf-chl|Just a moment\.\.\.|Attention Required! \| Cloudflare|Verify you are human/i.test(html))
        return 'CF';
    if (status === 403 || status === 429) {
        if (domain === 'pokemoncenter')
            return 'IMPERVA';
        if (domain === 'target' || domain === 'walmart' || domain === 'samsclub')
            return 'PX';
        if (domain === 'bestbuy')
            return 'AKAMAI';
        return domain === 'costco' ? 'KASADA' : 'CF';
    }
    return xhrWafHint;
}
async function executePassiveChromeSweep(domain, url, cached, opts) {
    const browser = await ensureInvisibleBrowser();
    browserSweepCount += 1;
    const timeoutMs = Math.min(Math.max(opts.timeoutMs || 16000, 6000), 22000);
    let context = null;
    try {
        context = await browser.newContext({
            userAgent: resolvedStealthUa, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/Chicago'
        });
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = window.chrome || { runtime: {} };
        });
        if (Array.isArray(cached?.cookies) && cached.cookies.length > 0 && !/WAF_CHALLENGE_(?:PX|KASADA)|WIRE_ARMED_IP_SHIELD/i.test(cached.lastStatus || '')) {
            try {
                await context.addCookies(cached.cookies);
            }
            catch { }
        }
        const page = await context.newPage();
        page.setDefaultTimeout(timeoutMs);
        const capturedJson = [];
        let xhrWafHint;
        page.on('response', async (res) => {
            try {
                const rUrl = res.url(), rStatus = res.status();
                if (rStatus === 435 || (rStatus === 412 && /walmart|samsclub|px/i.test(rUrl)))
                    xhrWafHint = 'PX';
                else if (rStatus === 429 && /gdx-api\.costco\.com\/catalog\/search/i.test(rUrl))
                    xhrWafHint = 'KASADA';
                const ct = String(res.headers()['content-type'] || '').toLowerCase();
                if ((opts.captureUrlPattern && opts.captureUrlPattern.test(rUrl)) || (ct.includes('json') && /plp_search_v2|cdui_orchestrations|gdx-api\.costco\.com\/catalog\/search/i.test(rUrl))) {
                    const rawText = await res.text();
                    if (/PXGWPp4wUS|PXu6b0qd2S|PXsLC3j22K|"blockScript"/i.test(rawText))
                        xhrWafHint = 'PX';
                    const data = (() => { try {
                        return JSON.parse(rawText);
                    }
                    catch {
                        return null;
                    } })();
                    if (data && rStatus >= 200 && rStatus < 300)
                        capturedJson.push({ url: rUrl, status: rStatus, data, rawText: rawText.slice(0, 2000) });
                }
            }
            catch { }
        });
        try {
            const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
            const status = response ? response.status() : 200;
            const headers = response ? response.headers() : {};
            const sec = response ? await response.securityDetails().catch(() => null) : null;
            const tlsIssuer = sec?.issuer || '', tlsSubject = sec?.subjectName || '';
            if (opts.waitForSelector && status < 400) {
                await page.waitForSelector(opts.waitForSelector, { timeout: Math.min(5000, Math.floor(timeoutMs / 2)) }).catch(() => { });
            }
            if (opts.waitAfterLoadMs && opts.waitAfterLoadMs > 0 && status < 400)
                await page.waitForTimeout(opts.waitAfterLoadMs);
            const finalUrl = page.url(), html = await page.content();
            const cookies = await context.cookies();
            const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
            if (domain === 'pokemoncenter' && detectRouterTlsFilter(finalUrl, html, tlsIssuer, tlsSubject)) {
                return {
                    ok: false, status, html: '', finalUrl, headers, capturedJson, tlsIssuer, tlsSubject, isRouterTlsFilter: true,
                    isQueueActive: false, isWafChallenged: true, wafType: 'ROUTER_TLS_FILTER', cookieHeader, cookies, fromSessionCache: false, browserChannel: activeBrowserChannel
                };
            }
            const queueCheck = domain === 'pokemoncenter' ? detectPokemonCenterQueueIt(html, headers, finalUrl) : { isQueueActive: false, queueBadge: undefined };
            const hasUsablePayload = capturedJson.length > 0 || (domain === 'walmart' && html.includes('__NEXT_DATA__'));
            const wafType = queueCheck.isQueueActive ? undefined : classifyWafChallenge(domain, status, html, finalUrl, headers, hasUsablePayload ? undefined : xhrWafHint);
            return {
                ok: status >= 200 && status < 400 && !wafType, status, html: wafType ? '' : html, finalUrl, headers, capturedJson, tlsIssuer, tlsSubject,
                isQueueActive: queueCheck.isQueueActive, queueBadge: queueCheck.queueBadge, isWafChallenged: Boolean(wafType), wafType,
                cookieHeader, cookies, fromSessionCache: false, browserChannel: activeBrowserChannel
            };
        }
        finally {
            await page.close().catch(() => { });
        }
    }
    finally {
        if (context)
            await context.close().catch(() => { });
    }
}
async function sweepWafProtectedTarget(domain, url, optionsOrForce = false) {
    const opts = typeof optionsOrForce === 'boolean' ? { force: optionsOrForce } : (optionsOrForce || {});
    loadWafSessionCookies();
    const now = Date.now(), cached = sessionStore[domain], shield = isDomainIpShielded(domain, now);
    if (!opts.bypassIpShield && shield.shielded) {
        return {
            ok: false, status: 0, html: '', finalUrl: url, headers: {}, capturedJson: [], isQueueActive: false, isWafChallenged: false,
            isIpShielded: true, ipShieldUntil: shield.ipShieldUntil, shieldStrikes: shield.strikes,
            cookieHeader: cached?.cookieHeader || '', cookies: cached?.cookies || [], fromSessionCache: true, browserChannel: cached?.browserChannel || activeBrowserChannel
        };
    }
    const prev = lastSweepByDomain.get(domain);
    if (!opts.force && prev && now < prev.nextAt)
        return { ...prev.result, fromSessionCache: true };
    if (!opts.force && cached?.nextEligibleAt && now < cached.nextEligibleAt) {
        const isWaf = /WAF_CHALLENGE_|ROUTER_TLS_FILTER/i.test(cached.lastStatus || '');
        return {
            ok: !isWaf, status: isWaf ? 403 : 200, html: '', finalUrl: url, headers: {}, capturedJson: [], isQueueActive: Boolean(cached.queueActive),
            isWafChallenged: isWaf, cookieHeader: cached.cookieHeader || '', cookies: cached.cookies || [], fromSessionCache: true, browserChannel: cached.browserChannel
        };
    }
    const runSerial = async () => {
        const cooldownMs = computeJitteredCooldownMs(domain);
        try {
            const res = await executePassiveChromeSweep(domain, url, cached, opts);
            const statusTag = res.isQueueActive ? exports.PC_QUEUE_BANNER
                : (res.isWafChallenged ? (res.wafType === 'ROUTER_TLS_FILTER' ? 'ROUTER_TLS_FILTER' : `WAF_CHALLENGE_${res.wafType}`) : `${res.status}_OK`);
            const keepCookies = !(res.isWafChallenged && (res.wafType === 'PX' || res.wafType === 'KASADA'));
            saveWafSessionCookie(domain, {
                cookieHeader: keepCookies ? (res.cookieHeader || cached?.cookieHeader || '') : '',
                cookies: keepCookies ? (res.cookies?.length ? res.cookies : (cached?.cookies || [])) : [],
                userAgent: resolvedStealthUa, nextEligibleAt: Date.now() + cooldownMs, lastStatus: statusTag,
                browserChannel: res.browserChannel, queueActive: res.isQueueActive, queueRedirectUrl: res.isQueueActive ? 'https://www.pokemoncenter.com' : undefined
            });
            if (res.isWafChallenged) {
                const out = recordBigBoxDirectIpOutcome(domain, true, statusTag);
                res.isIpShielded = out.shielded;
                res.ipShieldUntil = out.ipShieldUntil;
                res.shieldStrikes = out.strikes;
            }
            else if (res.isQueueActive)
                recordBigBoxDirectIpOutcome(domain, false, exports.PC_QUEUE_BANNER);
            if (!res.isIpShielded)
                lastSweepByDomain.set(domain, { nextAt: Date.now() + cooldownMs, result: res });
            return res;
        }
        catch (err) {
            const fallbackWaf = domain === 'pokemoncenter'
                ? (/CERT|SSL|TLS/i.test(String(err?.message || '')) ? 'ROUTER_TLS_FILTER' : 'IMPERVA')
                : (domain === 'bestbuy' ? 'AKAMAI' : (domain === 'target' || domain === 'walmart' || domain === 'samsclub' ? 'PX' : 'CF'));
            const statusTag = fallbackWaf === 'ROUTER_TLS_FILTER' ? 'ROUTER_TLS_FILTER' : `WAF_CHALLENGE_${fallbackWaf}`;
            saveWafSessionCookie(domain, { lastStatus: statusTag, nextEligibleAt: Date.now() + cooldownMs, queueActive: false });
            const out = recordBigBoxDirectIpOutcome(domain, true, statusTag);
            const failRes = {
                ok: false, status: 0, html: '', finalUrl: url, headers: {}, capturedJson: [], isRouterTlsFilter: fallbackWaf === 'ROUTER_TLS_FILTER',
                isQueueActive: false, isWafChallenged: true, wafType: fallbackWaf, isIpShielded: out.shielded, ipShieldUntil: out.ipShieldUntil,
                shieldStrikes: out.strikes, cookieHeader: cached?.cookieHeader || '', fromSessionCache: false, browserChannel: activeBrowserChannel
            };
            if (!out.shielded)
                lastSweepByDomain.set(domain, { nextAt: Date.now() + cooldownMs, result: failRes });
            return failRes;
        }
    };
    const next = sweepMutex.then(runSerial, runSerial);
    sweepMutex = next.then(() => undefined, () => undefined);
    return next;
}
