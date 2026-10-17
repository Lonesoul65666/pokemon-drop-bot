"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WATCH_POLICIES = exports.MIN_PLAUSIBLE_PRICE_FLOORS = exports.PC_EXCLUSIVE_EXCLUSION_TERMS = exports.BOOSTER_BOX_EXCLUSION_TERMS = exports.GLOBAL_JUNK_EXCLUSIONS = void 0;
exports.getMinPlausiblePriceFloor = getMinPlausiblePriceFloor;
exports.getMaxPlausiblePriceCeiling = getMaxPlausiblePriceCeiling;
exports.isValidSkuForFormFactor = isValidSkuForFormFactor;
exports.atomicWriteJson = atomicWriteJson;
exports.loadPolicies = loadPolicies;
const fs = require('fs');
const path = require('path');
exports.GLOBAL_JUNK_EXCLUSIONS = [
    /empty/i,
    /no packs/i,
    /box only/i,
    /case only/i,
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
    // Strict Standard vs. Pokemon Center Exclusive Firewall for all non-PC ETB targets
    const isEtbContext = formFactor === 'ETB' || formFactor === 'ETB Case' || /\b(etb|elite trainer)\b/i.test(combinedLower);
    if (isEtbContext) {
        const isTargetExplicitPc = exports.PC_EXCLUSIVE_EXCLUSION_TERMS.some(term => targetLower.includes(term));
        if (!isTargetExplicitPc && exports.PC_EXCLUSIVE_EXCLUSION_TERMS.some(term => combinedLower.includes(term))) {
            return false;
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
