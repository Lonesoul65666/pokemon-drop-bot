"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WATCH_POLICIES = exports.MIN_PLAUSIBLE_PRICE_FLOORS = exports.BIG_BOX_RETAILER_PATTERNS = exports.PC_EXCLUSIVE_EXCLUSION_TERMS = exports.BOOSTER_BOX_EXCLUSION_TERMS = exports.GLOBAL_JUNK_EXCLUSIONS = void 0;
exports.getPackCountForSku = getPackCountForSku;
exports.computeRipMetrics = computeRipMetrics;
exports.detectBigBoxRetailer = detectBigBoxRetailer;
exports.isPokemonCenterSource = isPokemonCenterSource;
exports.hasPcExclusiveTerms = hasPcExclusiveTerms;
exports.getMinPlausiblePriceFloor = getMinPlausiblePriceFloor;
exports.getMaxPlausiblePriceCeiling = getMaxPlausiblePriceCeiling;
exports.isValidSkuForFormFactor = isValidSkuForFormFactor;
exports.atomicWriteJson = atomicWriteJson;
exports.loadPolicies = loadPolicies;
const fs = require('fs');
const path = require('path');
function getPackCountForSku(skuId, formFactor, name) {
    const idLower = (skuId || '').toLowerCase();
    const ffLower = (formFactor || '').toLowerCase();
    const nameLower = (name || '').toLowerCase();
    const combined = `${idLower} ${ffLower} ${nameLower}`;
    if (ffLower === 'master case' ||
        ffLower === 'booster-case' ||
        ffLower === 'booster case' ||
        idLower.endsWith('-booster-case') ||
        /\b216\s*packs\b|\b6\s*boxes\b/i.test(combined) ||
        (combined.includes('booster') && combined.includes('case'))) {
        return 216;
    }
    if (ffLower === 'etb case' ||
        ffLower === 'etb-case' ||
        idLower.endsWith('-etb-case') ||
        /\b10\s*etbs\b|\bcase\s*of\s*10\b/i.test(combined) ||
        ((combined.includes('etb') || combined.includes('elite trainer')) && combined.includes('case'))) {
        return 90;
    }
    if (ffLower === 'booster box' ||
        ffLower === 'booster-box' ||
        idLower.endsWith('-booster-box') ||
        /\b36[- ]?pack\b|booster\s*box/i.test(combined)) {
        return 36;
    }
    if (ffLower === 'booster bundle' ||
        ffLower === 'bundle' ||
        idLower.endsWith('-bundle') ||
        /\b6[- ]?pack\b|booster\s*bundle|\bbundle\b/i.test(combined)) {
        return 6;
    }
    if (ffLower === 'etb' ||
        idLower.endsWith('-etb') ||
        /\b(etb|elite\s*trainer\s*box)\b/i.test(combined)) {
        if (/pokemon\s*center|pokémon\s*center|pkmn\s*center|pc\s*exclusive|pc\s*etb/i.test(combined)) {
            return 11;
        }
        return 9;
    }
    return 36;
}
function computeRipMetrics(landedPrice, skuId, formFactor, name, explicitPackCount) {
    const packCount = (explicitPackCount && explicitPackCount > 0)
        ? explicitPackCount
        : getPackCountForSku(skuId, formFactor, name);
    const safePrice = Number.isFinite(landedPrice) && landedPrice > 0 ? landedPrice : 0;
    const pricePerPack = packCount > 0 && safePrice > 0
        ? Number((safePrice / packCount).toFixed(2))
        : 0;
    const isRipValueLeader = pricePerPack > 0 && pricePerPack <= 4.25;
    return { packCount, pricePerPack, isRipValueLeader };
}
exports.GLOBAL_JUNK_EXCLUSIONS = [
    /empty/i,
    /no packs/i,
    /box only/i,
    /case only/i,
    /open case/i,
    /open box/i,
    /opened case/i,
    /unsealed case/i,
    /loose boxes/i,
    /acrylic/i,
    /protector/i,
    /\bcode\b/i,
    /code card/i,
    /sleeves/i,
    /\bdice\b/i,
    /opened/i,
    /damaged/i,
    /weighed/i,
    /pack only/i,
    /single pack/i,
    /art set/i,
    /3-pack/i,
    /3 pack/i,
    /blister/i,
    /checklane/i,
    /sleeved/i,
    /\bbooster pack\b/i,
    /\bpack\b(?!\s*box)/i,
    /\btin\b/i,
    /binder/i,
    /portfolio/i,
    /poster/i,
    /illustration collection/i,
    /collection box/i,
    /build & battle/i,
    /build and battle/i,
    /near mint/i,
    /lightly played/i,
    /japanese/i,
    /\bjp\s/i,
    /korean/i,
    /chinese/i,
    /s-chinese/i,
    /t-chinese/i,
    /spanish/i,
    /french/i,
    /german/i,
];
exports.BOOSTER_BOX_EXCLUSION_TERMS = [
    'half',
    '18 pack',
    '18-pack',
    '18 packs',
    '18pk',
    '18 ct',
    '18x',
    'bundle',
    '6 pack',
    '6-pack',
    'blister',
    'sleeved',
    '3 pack',
    'build & battle',
    'build and battle',
    'korean',
    'japanese',
    'jp ',
    'chinese',
    's-chinese',
    't-chinese',
    'spanish',
    'french',
    'german'
];
exports.PC_EXCLUSIVE_EXCLUSION_TERMS = [
    'pokemon center',
    'pokémon center',
    'pkmn center',
    'pc exclusive',
    'pc etb',
    'center exclusive',
    'stamped'
];
exports.BIG_BOX_RETAILER_PATTERNS = [
    { name: 'Pokemon Center', regex: /pokemon\s*center|pokémon\s*center|pokemoncenter\.com/i },
    { name: 'Target', regex: /\btarget\b|target\.com/i },
    { name: 'Best Buy', regex: /best\s*buy|bestbuy\.com/i },
    { name: 'Walmart', regex: /\bwalmart\b|walmart\.com/i },
    { name: 'Amazon', regex: /\bamazon\b|amazon\.com|\ba\.co\b/i },
    { name: 'GameStop', regex: /gamestop|gamestop\.com/i },
    { name: 'Costco', regex: /\bcostco\b|costco\.com/i },
    { name: "Sam's Club", regex: /sam'?s\s*club|samsclub\.com/i },
    { name: 'Barnes & Noble', regex: /barnes\s*(&|and)\s*noble|\bb&n\b|barnesandnoble\.com/i }
];
function detectBigBoxRetailer(retailer, url) {
    const combined = `${retailer || ''} ${url || ''}`;
    for (const pat of exports.BIG_BOX_RETAILER_PATTERNS) {
        if (pat.regex.test(combined)) {
            return pat.name;
        }
    }
    return null;
}
function isPokemonCenterSource(retailer, url) {
    return /pokemon\s*center|pokémon\s*center|pokemoncenter\.com/i.test(`${retailer || ''} ${url || ''}`);
}
function hasPcExclusiveTerms(title, handle) {
    const combinedLower = ` ${title || ''} ${handle || ''} `.toLowerCase();
    return exports.PC_EXCLUSIVE_EXCLUSION_TERMS.some(term => combinedLower.includes(term));
}
exports.MIN_PLAUSIBLE_PRICE_FLOORS = {
    'Booster Box': 95,
    'ETB': 32,
    'Booster Bundle': 18,
    'ETB Case': 450,
    'Master Case': 550
};
function getMinPlausiblePriceFloor(formFactor) {
    if (!formFactor)
        return 18;
    return exports.MIN_PLAUSIBLE_PRICE_FLOORS[formFactor] ?? 18;
}
function getMaxPlausiblePriceCeiling(formFactor, ruleId, targetName) {
    const key = `${ruleId || ''} ${targetName || ''}`.toLowerCase();
    const isSpecialSet = /\b151\b|paldean[- ]fates|prismatic|crown[- ]zenith/i.test(key);
    const isSwsh = (/^swsh-|sword\s*&\s*shield|battle[- ]styles|chilling[- ]reign|evolving[- ]skies|celebrations|fusion[- ]strike|brilliant[- ]stars|astral[- ]radiance|pokemon[- ]go|lost[- ]origin|silver[- ]tempest|vivid[- ]voltage|darkness[- ]ablaze|rebel[- ]clash|shining[- ]fates|champions[- ]path|hidden[- ]fates/i.test(key)) && !/crown[- ]zenith/i.test(key);
    if (formFactor === 'ETB') {
        if (isSpecialSet)
            return 210;
        if (isSwsh)
            return 450;
        return 115;
    }
    if (formFactor === 'Booster Box') {
        if (isSwsh)
            return 1600;
        return 275;
    }
    if (formFactor === 'Booster Bundle') {
        return 80;
    }
    if (formFactor === 'ETB Case') {
        return 2200;
    }
    if (formFactor === 'Master Case') {
        return 2600;
    }
    return 2600;
}
function isValidSkuForFormFactor(title, formFactor, price, options) {
    const combinedLower = ` ${title} ${options?.handle || ''} `.toLowerCase();
    const targetLower = `${options?.targetName || ''} ${options?.ruleId || ''}`.toLowerCase();
    for (const junkRegex of exports.GLOBAL_JUNK_EXCLUSIONS) {
        if (junkRegex.test(title)) {
            return false;
        }
    }
    // Strict Standard vs. Pokemon Center Exclusive Firewall for all non-PC ETB targets,
    // EXCEPT when allowPcRetailUnlock is enabled AND the drop originates from pokemoncenter.com (at retail <= $75) or is priced <= $69.99 at retail.
    const isEtbContext = formFactor === 'ETB' || formFactor === 'ETB Case' || /\b(etb|elite trainer)\b/i.test(combinedLower);
    if (isEtbContext) {
        const isTargetExplicitPc = exports.PC_EXCLUSIVE_EXCLUSION_TERMS.some(term => targetLower.includes(term));
        const hasPcTerm = exports.PC_EXCLUSIVE_EXCLUSION_TERMS.some(term => combinedLower.includes(term));
        if (!isTargetExplicitPc && hasPcTerm) {
            const fromPcCom = isPokemonCenterSource(options?.retailer, options?.sourceUrl || options?.handle);
            const isRetailPcPrice = price !== undefined && Number.isFinite(price) && price <= 69.99;
            const isPcComRetailDrop = fromPcCom && (price === undefined || price <= 75);
            if (!(options?.allowPcRetailUnlock && (isPcComRetailDrop || isRetailPcPrice))) {
                return false;
            }
        }
    }
    if (formFactor === 'Booster Box' || formFactor === 'Master Case') {
        for (const term of exports.BOOSTER_BOX_EXCLUSION_TERMS) {
            if (combinedLower.includes(term)) {
                return false;
            }
        }
    }
    if ((formFactor === 'ETB' || formFactor === 'Booster Box' || formFactor === 'Booster Bundle') && /\b(case|cases|master case|sealed case|x6|6x|x10|10x)\b/i.test(title)) {
        return false;
    }
    if (formFactor === 'Master Case' && /\b(bundle|etb|elite trainer|blister|tin|collection|figure)\b/i.test(title)) {
        return false;
    }
    if (formFactor === 'ETB Case' && !/\b(etb|elite trainer)\b/i.test(title)) {
        return false;
    }
    if (price !== undefined && Number.isFinite(price)) {
        const minFloor = getMinPlausiblePriceFloor(formFactor);
        if (price < minFloor) {
            return false;
        }
        if (formFactor) {
            const maxCeiling = getMaxPlausiblePriceCeiling(formFactor, options?.ruleId, options?.targetName || title);
            if (price > maxCeiling) {
                return false;
            }
        }
    }
    return true;
}
// Check root directory first, then fallback to one level up from dist/
function resolvePoliciesPath() {
    const rootPath = path.resolve(process.cwd(), 'policies.json');
    if (fs.existsSync(rootPath)) {
        return rootPath;
    }
    const parentPath = path.resolve(__dirname, '..', 'policies.json');
    if (fs.existsSync(parentPath)) {
        return parentPath;
    }
    return path.resolve(__dirname, 'policies.json');
}
function atomicWriteJson(filePath, data) {
    try {
        const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
    }
    catch (err) {
        try {
            const fallbackTmp = `${filePath}.tmp`;
            fs.writeFileSync(fallbackTmp, JSON.stringify(data, null, 2), 'utf-8');
            fs.renameSync(fallbackTmp, filePath);
        }
        catch (e) { }
    }
}
const POLICIES_PATH = resolvePoliciesPath();
function loadPolicies() {
    try {
        if (!fs.existsSync(POLICIES_PATH)) {
            console.error(`[POLICIES] policies.json not found at: ${POLICIES_PATH}`);
            return [];
        }
        const raw = fs.readFileSync(POLICIES_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return parsed.map((item) => ({
            ...item,
            packCount: item.packCount || getPackCountForSku(item.id, item.formFactor, item.name),
            matchers: item.matchers.map((m) => new RegExp(m, 'i')),
            negativeMatchers: exports.GLOBAL_JUNK_EXCLUSIONS,
        }));
    }
    catch (err) {
        console.error(`Error reading policies.json: ${err.message}`);
        return [];
    }
}
exports.WATCH_POLICIES = loadPolicies();
if (fs.existsSync(POLICIES_PATH)) {
    fs.watch(POLICIES_PATH, () => {
        console.log('[WATCHER] policies.json changed on disk. Hot-reloading active rules...');
        exports.WATCH_POLICIES = loadPolicies();
    });
}
