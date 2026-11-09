"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVISIBLE_HEADLESS_LAUNCH_OPTS = exports.WAF_POLITE_INTERVAL_MS = exports.WAF_SESSION_COOKIES_PATH = void 0;
exports.loadWafSessionCookies = loadWafSessionCookies;
exports.saveWafSessionCookie = saveWafSessionCookie;
exports.detectPokemonCenterQueueIt = detectPokemonCenterQueueIt;
exports.sweepWafProtectedTarget = sweepWafProtectedTarget;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const lgsPoller_1 = require("../../lgsPoller");
const configManager_1 = require("../config/configManager");
exports.WAF_SESSION_COOKIES_PATH = path_1.default.resolve(process.cwd(), 'data', 'wafSessionCookies.json');
exports.WAF_POLITE_INTERVAL_MS = 150 * 1000;
exports.INVISIBLE_HEADLESS_LAUNCH_OPTS = {
    headless: true,
    windowsHide: true,
    args: [
        '--headless=new',
        '--disable-gpu',
        '--no-startup-window',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--mute-audio'
    ]
};
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
let sessionStore = {};
let lastSweepByDomain = {};
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
        userAgent: DEFAULT_UA,
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
function mergeSetCookies(existingHeader, setCookieHeaders) {
    const map = new Map();
    for (const part of String(existingHeader || '').split(';')) {
        const trimmed = part.trim();
        const eq = trimmed.indexOf('=');
        if (eq > 0)
            map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
    }
    const incoming = Array.isArray(setCookieHeaders) ? setCookieHeaders : (setCookieHeaders ? [setCookieHeaders] : []);
    for (const raw of incoming) {
        const pair = String(raw || '').split(';')[0].trim();
        const eq = pair.indexOf('=');
        if (eq > 0)
            map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}
function detectPokemonCenterQueueIt(html, headers) {
    const headerKeys = Object.keys(headers || {}).map(k => k.toLowerCase());
    const headerDump = JSON.stringify(headers || {});
    const hasQueueHeader = headerKeys.some(k => k.startsWith('x-queueit-') || k.includes('queueit')) ||
        /x-queueit-|queue-it\.net|incap_wr|waiting-room/i.test(headerDump);
    const hasQueueBody = /virtual\s+waiting\s+room|you\s+are\s+now\s+in\s+line|queue-it\.net|incap_wr|waiting[-_]room/i.test(html || '');
    const isQueueActive = Boolean(hasQueueHeader || hasQueueBody);
    if (!isQueueActive)
        return { isQueueActive: false };
    const loc = String(headers?.['x-queueit-redirect'] || headers?.['location'] || 'https://www.pokemoncenter.com/en-us/category/elite-trainer-box');
    return {
        isQueueActive: true,
        queueBadge: '◈ ⟦ POKÉMON CENTER QUEUE ACTIVE — ENTER LINE NOW ⟧',
        redirectUrl: loc
    };
}
async function sweepWafProtectedTarget(domain, url, force = false) {
    loadWafSessionCookies();
    const now = Date.now();
    const cached = sessionStore[domain];
    const lastSweep = lastSweepByDomain[domain] || 0;
    if (!force && now - lastSweep < exports.WAF_POLITE_INTERVAL_MS && cached) {
        return {
            ok: cached.lastStatus.startsWith('200'),
            status: cached.lastStatus.startsWith('200') ? 200 : 403,
            html: '',
            headers: {},
            isQueueActive: Boolean(cached.queueActive),
            queueBadge: cached.queueActive ? '◈ ⟦ POKÉMON CENTER QUEUE ACTIVE — ENTER LINE NOW ⟧' : undefined,
            isWafChallenged: cached.lastStatus.includes('WAF_CHALLENGE'),
            wafType: domain === 'pokemoncenter' ? 'IMPERVA' : 'CF',
            cookieHeader: cached.cookieHeader || '',
            fromSessionCache: true
        };
    }
    lastSweepByDomain[domain] = now;
    const reqHeaders = {
        'User-Agent': cached?.userAgent || DEFAULT_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
    };
    if (cached?.cookieHeader)
        reqHeaders['Cookie'] = cached.cookieHeader;
    const doFetch = async (httpsAgent) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7500);
        try {
            return await axios_1.default.get(url, {
                timeout: 7500,
                signal: controller.signal,
                httpsAgent,
                headers: reqHeaders,
                maxRedirects: 3,
                validateStatus: (s) => s >= 200 && s < 500
            });
        }
        finally {
            clearTimeout(timer);
        }
    };
    try {
        let res = await doFetch();
        if (res.status === 403 || res.status === 429) {
            try {
                res = await doFetch((0, lgsPoller_1.getNextProxy)());
            }
            catch { }
        }
        const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '');
        const headers = (res.headers || {});
        const updatedCookie = mergeSetCookies(cached?.cookieHeader || '', headers['set-cookie']);
        const queueCheck = domain === 'pokemoncenter'
            ? detectPokemonCenterQueueIt(html, headers)
            : { isQueueActive: false, queueBadge: undefined, redirectUrl: undefined };
        const isImperva = domain === 'pokemoncenter' && (res.status === 403 || /_Incapsula_Resource|Pardon Our Interruption|incapsula|Request unsuccessful/i.test(html));
        const isCf = domain === 'gamestop' && (res.status === 403 || /cf-chl|Just a moment\.\.\.|Attention Required! \| Cloudflare|sec-if-cpt-container|Access Denied/i.test(html));
        const isWafChallenged = Boolean((isImperva || isCf) && !queueCheck.isQueueActive);
        const wafType = isImperva ? 'IMPERVA' : (isCf ? 'CF' : undefined);
        const statusTag = queueCheck.isQueueActive
            ? 'QUEUE_ACTIVE'
            : (isWafChallenged ? `WAF_CHALLENGE_${wafType}` : `${res.status}_OK`);
        saveWafSessionCookie(domain, {
            cookieHeader: updatedCookie,
            userAgent: reqHeaders['User-Agent'],
            lastStatus: statusTag,
            queueActive: queueCheck.isQueueActive,
            queueRedirectUrl: queueCheck.redirectUrl
        });
        return {
            ok: res.status === 200 && !isWafChallenged,
            status: res.status,
            html: isWafChallenged ? '' : html,
            headers,
            isQueueActive: queueCheck.isQueueActive,
            queueBadge: queueCheck.queueBadge,
            isWafChallenged,
            wafType,
            cookieHeader: updatedCookie,
            fromSessionCache: false
        };
    }
    catch {
        const fallbackType = domain === 'pokemoncenter' ? 'IMPERVA' : 'CF';
        saveWafSessionCookie(domain, { lastStatus: `WAF_CHALLENGE_${fallbackType}`, queueActive: false });
        return {
            ok: false,
            status: 403,
            html: '',
            headers: {},
            isQueueActive: false,
            isWafChallenged: true,
            wafType: fallbackType,
            cookieHeader: cached?.cookieHeader || '',
            fromSessionCache: false
        };
    }
}
