"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WATCH_POLICIES = exports.MIN_PLAUSIBLE_PRICE_FLOORS = exports.BIG_BOX_RETAILER_PATTERNS = exports.PC_EXCLUSIVE_EXCLUSION_TERMS = exports.BOOSTER_BOX_EXCLUSION_TERMS = exports.GLOBAL_JUNK_EXCLUSIONS = void 0;
exports.getPackCountForSku = getPackCountForSku;
exports.computeRipMetrics = computeRipMetrics;
exports.isPoisonedVariantOrAccessory = isPoisonedVariantOrAccessory;
exports.isSingleOrNonSealedShopifyProduct = isSingleOrNonSealedShopifyProduct;
exports.isSingleCardOrNonSealed = isSingleCardOrNonSealed;
exports.isCollectibleSingleCardOrSlab = isCollectibleSingleCardOrSlab;
exports.hasMandatorySealedContainerKeyword = hasMandatorySealedContainerKeyword;
exports.detectBigBoxRetailer = detectBigBoxRetailer;
exports.isPokemonCenterSource = isPokemonCenterSource;
exports.hasPcExclusiveTerms = hasPcExclusiveTerms;
exports.getMinPlausiblePriceFloor = getMinPlausiblePriceFloor;
exports.computeSanityPriceFloor = computeSanityPriceFloor;
exports.getMaxPlausiblePriceCeiling = getMaxPlausiblePriceCeiling;
exports.isValidSkuForFormFactor = isValidSkuForFormFactor;
exports.atomicWriteJson = atomicWriteJson;
exports.loadPolicies = loadPolicies;
exports.reloadWatchPolicies = reloadWatchPolicies;
exports.matchProductToSku = matchProductToSku;
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
        /\b36[- ]?pack\b|booster\s*(box|display)/i.test(combined)) {
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
// Unconditional non-sealed / junk exclusions (always block even if a sealed container word appears)
exports.GLOBAL_JUNK_EXCLUSIONS = [
    /empty/i,
    /no\s*packs/i,
    /\bbox\s*only\b/i,
    /\bcase\s*only\b/i,
    /\bcard\s*only\b/i,
    /\bpacks?\s*only\b/i,
    /\bpromos?\s*(cards?\s*)?only\b/i,
    /open\s*(case|box)/i,
    /opened/i,
    /unsealed/i,
    /loose\s*boxes/i,
    /ripped\s*live|rip\s*(&|and|n)\s*ship|live\s*break|box\s*break|pack\s*break|personal\s*break/i,
    /\b2[- ]?pack\b/i,
    /\b3[- ]?pack\b/i,
    /\bthree\s*pack\b/i,
    /acrylic/i,
    /\bprotector\b/i,
    /display\s*case/i,
    /damaged/i,
    /weighed/i,
    /resealed/i,
    /single\s*pack/i,
    /\b1\s*pack\b/i,
    /loose\s*pack/i,
    /sample\s*pack/i,
    /fun\s*pack/i,
    /1x\s*booster\s*pack/i,
    /one\s*booster\s*pack/i,
    /single\s*booster/i,
    /sleeved\s*booster/i,
    /\bsleeved\b/i,
    /art\s*set/i,
    /\bblister\b/i,
    /\bchecklane\b/i,
    /\btin\b/i,
    /\bbinder\b/i,
    /\bportfolio\b/i,
    /\bposter\b/i,
    /illustration\s*collection/i,
    /(?<!ultra[- ]premium\s+|super[- ]premium\s+)collection\s+box/i,
    /build\s*(&|and)\s*battle/i,
    /\bcombo\b/i,
    /\bsingles\b/i,
    /single\s*cards?\b/i,
    /\b\d{1,3}\s*\/\s*\d{1,3}\b(?!\s*\/\s*\d{2,4})/i,
    /\(\d{1,3}\/\d{1,3}\)/i,
    /\[[a-z]{2,4}\d*:/i,
    /pokeball\s*holo/i,
    /masterball\s*holo/i,
    /reverse\s*holo(foil)?/i,
    /near\s*mint/i,
    /\bnm\b/i,
    /lightly\s*played/i,
    /\blp\b/i,
    /moderately\s*played/i,
    /\bmp\b/i,
    /heavily\s*played/i,
    /\bhp\b/i,
    /\bungraded\b/i,
    /raw\s*card/i,
    /\bpsa\b/i,
    /\bcgc\b/i,
    /\bbgs\b/i,
    /\bbeckett\b/i,
    /\bsgc\b/i,
    /gem\s*mint/i,
    /mint\s*10\b/i,
    /mint\s*9\b/i,
    /pristine\s*10\b/i,
    /\bslab(s|bed)?\b/i,
    /\bgraded\b/i,
    /japanese/i,
    /\bjp\b/i,
    /\bjpn\b/i,
    /korean/i,
    /chinese/i,
    /s-chinese/i,
    /t-chinese/i,
    /spanish/i,
    /french/i,
    /german/i,
    /\bacrylic\b/i,
    /\bprotector\b/i,
    /\bcase\s*only\b/i,
    /\bdamaged\b/i,
    /\bart\s*set\b/i,
    // Partial-ETB / promo-from-ETB / accessory-for-ETB / plush-bundle traps even when container word appears:
    /\bsquishmallows?\b|\bplush(?:ie|ies)?\b/i,
    /\b(etb|elite\s*trainer\s*box|upc|spc|booster\s*box|booster\s*bundle)\s+(sealed\s+|foil\s+|holo\s+|stamped\s+)*(promo|sleeves|playmat|deck\s*box|dice|dividers?|code\s*cards?|booster\s*pack)\b/i,
    /\b(promo|sleeves|playmat|deck\s*box|dice|booster\s*pack)\s+from\s+(an?\s+)?(etb|elite\s*trainer|upc|spc|booster\s*box)\b/i,
];
const CHILD_VARIANT_POISON_REGEX = /\b(acrylic|protector|display\s*case|case\s*only|box\s*only|empty|no\s*packs|damaged|dented|heavily\s*played|korean|japanese|jp|jpn|chinese|s-chinese|t-chinese|spanish|french|german|single\s*pack|1\s*pack|loose\s*packs?|booster\s*pack(?!s)|sleeved|art\s*set|code|code\s*cards?|sleeves|dice|dividers?|playmat|promo\s*only|card\s*only)\b/i;
function isPoisonedVariantOrAccessory(variantTitle, productTitle, price, formFactor) {
    const vClean = String(variantTitle || '').trim();
    const pClean = String(productTitle || '').trim();
    const combined = `${pClean} ${vClean !== 'Default Title' ? vClean : ''}`.trim();
    if (vClean && !/^default\s*title$/i.test(vClean) && CHILD_VARIANT_POISON_REGEX.test(vClean)) {
        return true;
    }
    if (/\b(acrylic|protector|case\s*only|box\s*only|empty\s*(box|etb|case)|damaged|korean|japanese|\bjp\b|jpn|chinese|s-chinese|t-chinese|spanish|single\s*pack|1\s*pack|sleeved\s*booster|art\s*set)\b/i.test(combined)) {
        return true;
    }
    if (price !== undefined && Number.isFinite(price) && price > 0) {
        // Distinguish cheap < $65 "acrylic display case" accessories from real $450+ sealed booster/ETB cases
        if (price < 65 && /\b(case|display\s*case|acrylic|protector)\b/i.test(combined)) {
            return true;
        }
        if (formFactor === 'ETB Case' && price < 450)
            return true;
        if (formFactor === 'Master Case' && price < 550)
            return true;
    }
    return false;
}
// Context-sensitive descriptors: block unconditionally when NO valid sealed container is in title,
// but allow on genuine sealed containers (e.g. "6-Pack Booster Bundle", "ETB (Includes Full-Art Foil Promo Card)", "Battle Styles Single Strike ETB", "Booster Box - Single Box")
const CONTEXT_SENSITIVE_NON_SEALED_PATTERNS = [
    /\bbooster\s*pack\b/i,
    /\bpack\b(?!\s*box)/i,
    /\bpromo\b/i,
    /black\s*star/i,
    /\bfoil\b/i,
    /full\s*art/i,
    /alt\s*art/i,
    /alternate\s*art/i,
    /\bholo(foil)?\b/i,
    /illustration\s*rare/i,
    /\bsir\b/i,
    /\bir\b/i,
    /hyper\s*rare/i,
    /secret\s*rare/i,
    /ultra\s*rare/i,
    /double\s*rare/i,
    /rainbow\s*rare/i,
    /gold\s*star/i,
    /#[0-9]{1,4}\b/i,
    /\b(tg|gg|svp|swshp)[0-9]{1,3}\b/i,
    /\b(sv|swsh|sm|xy)[0-9]{3}\b/i,
    /\b(sv|swsh|sm|xy)(1[3-9]|[2-9][0-9])\b/i,
    /\bsingle\b(?!\s*(strike|box|bundle|etb|elite\s*trainer|display|collection|upc|spc))/i,
];
// Accessory words that must be blocked unless explicitly inside an "includes/with" contents clause of a sealed container
const ACCESSORY_CONTENT_PATTERNS = [
    /\bcode\s*cards?\b/i,
    /\bcode\b/i,
    /\bsleeves\b/i,
    /\bdeck\s*box\b/i,
    /\bplaymat\b/i,
    /\bdice\b/i,
];
const SHOPIFY_HARD_META_BLOCK_REGEX = /\b(singles|pokemon\s+singles|single\s+cards?|graded|slabs?|psa|cgc|bgs|loose\s+packs?|code\s+cards?|accessories)\b/i;
const SHOPIFY_LOOSE_SINGLE_META_REGEX = /\bsingle\b(?!\s*(strike|box|bundle|etb|display))/i;
function isSingleOrNonSealedShopifyProduct(prod) {
    if (!prod)
        return false;
    const titleStr = String(prod.title || '').trim();
    const hasSealedTitle = POSITIVE_SEALED_CONTAINER_ANY_REGEX.test(titleStr);
    const prodType = String(prod.product_type || '').trim();
    const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
    if (SHOPIFY_HARD_META_BLOCK_REGEX.test(prodType) || SHOPIFY_HARD_META_BLOCK_REGEX.test(tagsStr)) {
        return true;
    }
    if (!hasSealedTitle && (SHOPIFY_LOOSE_SINGLE_META_REGEX.test(prodType) || SHOPIFY_LOOSE_SINGLE_META_REGEX.test(tagsStr))) {
        return true;
    }
    const handleWords = String(prod.handle || '').replace(/-/g, ' ').trim();
    if (handleWords && isSingleCardOrNonSealed(titleStr ? `${titleStr} ${handleWords}` : handleWords, prodType, tagsStr)) {
        return true;
    }
    return false;
}
const SINGLE_CARD_OR_NON_SEALED_PATTERNS = exports.GLOBAL_JUNK_EXCLUSIONS;
const POSITIVE_SEALED_CONTAINER_ANY_REGEX = /\b(elite\s*trainer\s*box|etb|booster\s*(box|display|bundle)|ultra[- ]*premium\s*collection|super[- ]*premium\s*collection|upc|spc|booster\s*case|etb\s*case)\b/i;
const NON_CARD_JUNK_OR_PACK_REGEX = /\b(single\s*pack|1\s*pack|loose\s*packs?|sleeved|blister|checklane|3-pack|three\s*pack|sample\s*pack|fun\s*pack|empty\s*box|empty\s*etb|box\s*only|case\s*only|no\s*packs|code\s*cards?|sleeves|deck\s*box|binder|portfolio|playmat|acrylic\s*case|protector|dice|plush|figure|apparel)\b/i;
const SINGLE_CARD_OR_SLAB_POSITIVE_REGEX = /\b(\d{1,3}\s*\/\s*\d{1,3}|#[0-9]{1,4}|(sv|tg|gg|swsh|sm|xy|svp)[0-9]{1,3}|single(s)?|single\s+card|holo|reverse\s+holo|foil|full\s+art|alt\s+art|alternate\s+art|illustration\s+rare|sir|ir|hyper\s+rare|secret\s+rare|ultra\s+rare|double\s+rare|rainbow\s+rare|gold\s+star|near\s+mint|nm|lightly\s+played|lp|moderately\s+played|mp|heavily\s+played|hp|ungraded|raw\s+card|card\s+only|promo|psa|cgc|bgs|beckett|sgc|gem\s+mint|mint\s*10|mint\s*9|pristine\s*10|slab(s)?|graded|ex|gx|vmax|vstar)\b/i;
function isSingleCardOrNonSealed(title, productType, tags) {
    const clean = String(title || '').trim();
    if (!clean)
        return true;
    const hasSealedContainer = POSITIVE_SEALED_CONTAINER_ANY_REGEX.test(clean);
    const prodTypeStr = String(productType || '').trim();
    const tagsStr = Array.isArray(tags) ? tags.join(' ') : String(tags || '').trim();
    const nonUrlMeta = `${prodTypeStr} ${tagsStr}`.replace(/https?:\/\/\S+/gi, ' ').trim();
    if (nonUrlMeta) {
        if (SHOPIFY_HARD_META_BLOCK_REGEX.test(nonUrlMeta))
            return true;
        if (!hasSealedContainer && SHOPIFY_LOOSE_SINGLE_META_REGEX.test(nonUrlMeta))
            return true;
        if (/\b(psa-[0-9]|cgc-[0-9]|bgs-[0-9]|single-card|pokemon-singles|loose-pack|graded-card|holofoil)\b/i.test(nonUrlMeta)) {
            return true;
        }
    }
    // 1. Always enforce unconditional hard exclusions (empty, box only, slabs, graded, NM/LP, blisters, loose packs, ETB promo/sleeves)
    for (const junkRegex of exports.GLOBAL_JUNK_EXCLUSIONS) {
        if (junkRegex.test(clean))
            return true;
    }
    // 2. Accessory words (sleeves, playmat, deck box, dice, code card) block unless inside an explicit "includes/with" contents list on a sealed box
    const hasIncludesClause = hasSealedContainer && /\b(includes?|included|with|featuring|contains?)\b/i.test(clean);
    if (!hasIncludesClause) {
        for (const accRx of ACCESSORY_CONTENT_PATTERNS) {
            if (accRx.test(clean))
                return true;
        }
    }
    // 3. Context-sensitive card/pack words (pack, promo, foil, full art, holo, #123, single) ONLY block when NO valid sealed container is present,
    // OR when a standalone loose booster pack phrase ("Booster Pack" singular without plural/bundle/box/includes) is being sold.
    if (!hasSealedContainer) {
        for (const ctxRx of CONTEXT_SENSITIVE_NON_SEALED_PATTERNS) {
            if (ctxRx.test(clean))
                return true;
        }
    }
    else if (/\bbooster\s+pack\b(?!s)/i.test(clean) && !/\b(\d+[- ]*booster\s+pack|includes?|with|contains?)\b/i.test(clean)) {
        return true;
    }
    const urlSlugMatch = `${clean} ${prodTypeStr} ${tagsStr}`.match(/\/products\/([a-z0-9-_]+)/i);
    if (urlSlugMatch && urlSlugMatch[1]) {
        const slugText = urlSlugMatch[1].replace(/-/g, ' ');
        for (const hardRx of exports.GLOBAL_JUNK_EXCLUSIONS) {
            if (hardRx.test(slugText))
                return true;
        }
        if (!hasSealedContainer && !POSITIVE_SEALED_CONTAINER_ANY_REGEX.test(slugText)) {
            for (const ctxRx of CONTEXT_SENSITIVE_NON_SEALED_PATTERNS) {
                if (ctxRx.test(slugText))
                    return true;
            }
        }
    }
    return false;
}
function isCollectibleSingleCardOrSlab(title, productType, tags) {
    const clean = String(title || '').trim();
    if (!clean)
        return false;
    const prodTypeStr = String(productType || '').trim();
    const tagsStr = Array.isArray(tags) ? tags.join(' ') : String(tags || '').trim();
    const combined = `${clean} ${prodTypeStr} ${tagsStr}`;
    if (POSITIVE_SEALED_CONTAINER_ANY_REGEX.test(clean))
        return false;
    if (NON_CARD_JUNK_OR_PACK_REGEX.test(combined))
        return false;
    if (!isSingleCardOrNonSealed(clean, prodTypeStr, tags))
        return false;
    return (SINGLE_CARD_OR_SLAB_POSITIVE_REGEX.test(combined) ||
        /\b(single|singles|pokemon\s+singles|single\s+cards?|graded|slabs?|psa|cgc|bgs)\b/i.test(`${prodTypeStr} ${tagsStr}`));
}
function hasMandatorySealedContainerKeyword(title, formFactor) {
    const clean = String(title || '').trim();
    if (!clean)
        return false;
    const ff = String(formFactor || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!ff) {
        return POSITIVE_SEALED_CONTAINER_ANY_REGEX.test(clean);
    }
    if (ff === 'etb' || ff === 'pc_etb') {
        if (/\b(booster\s*bundle|booster\s*box|\bcombo\b)\b/i.test(clean))
            return false;
        return /\b(elite\s*trainer\s*box|etb)\b/i.test(clean);
    }
    if (ff === 'booster_box') {
        return /\bbooster\s*(box|display)\b/i.test(clean);
    }
    if (ff === 'booster_bundle' || ff === 'bundle') {
        return /\bbooster\s*bundle\b/i.test(clean);
    }
    if (ff === 'upc' || ff === 'spc') {
        return /\b(ultra[- ]*premium\s*collection|super[- ]*premium\s*collection|upc|spc)\b/i.test(clean);
    }
    if (ff === 'etb_case') {
        return /\bcase\b/i.test(clean) && /\b(etb|elite\s*trainer)\b/i.test(clean);
    }
    if (ff === 'master_case' || ff === 'booster_case') {
        return /\bcase\b/i.test(clean) && /\b(booster|display)\b/i.test(clean);
    }
    if (ff.includes('case')) {
        return /\bcase\b/i.test(clean) && /\b(booster|etb|elite\s*trainer)\b/i.test(clean);
    }
    return POSITIVE_SEALED_CONTAINER_ANY_REGEX.test(clean);
}
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
    'pokemon-center',
    'pokémon center',
    'pkmn center',
    'pkmn-center',
    'pc exclusive',
    'pc-exclusive',
    'pc etb',
    'pc-etb',
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
function computeSanityPriceFloor(params) {
    const base = getMinPlausiblePriceFloor(params.formFactor);
    const titleStr = String(params.title || '');
    let caseFloor = 0;
    if (params.formFactor === 'ETB Case' || /\b(etb\s*case|10[- ]*etb|case\s*of\s*10)\b/i.test(titleStr)) {
        caseFloor = 450;
    }
    else if (params.formFactor === 'Master Case' || /\b(master\s*case|booster\s*(box\s*)?case|case\s*of\s*6)\b/i.test(titleStr)) {
        caseFloor = 550;
    }
    else if (/\bcase\b/i.test(titleStr)) {
        caseFloor = 65;
    }
    const msrp = Number(params.msrp || 0);
    const mkt = Number(params.verifiedMarket || 0);
    if (params.is1PBigBox) {
        const retailFloor = msrp > 0 ? Math.round(msrp * 0.45 * 100) / 100 : 0;
        return Math.max(base, caseFloor, retailFloor);
    }
    // Hard Sanity Price Floor (Non-1P LGS): >= msrp * 0.62 AND >= verifiedMarket * 0.38 when verifiedMarket >= 90
    const msrpFloor = msrp > 0 ? Math.round(msrp * 0.62 * 100) / 100 : 0;
    const marketFloor = mkt >= 90 ? Math.round(mkt * 0.38 * 100) / 100 : 0;
    return Math.max(base, caseFloor, msrpFloor, marketFloor);
}
function getMaxPlausiblePriceCeiling(formFactor, ruleId, targetName, policyOverride) {
    const key = `${ruleId || ''} ${targetName || ''}`.toLowerCase();
    const isSpecialSet = /\b151\b|paldean[- ]fates|prismatic|crown[- ]zenith/i.test(key);
    const isSwsh = (/^swsh-|sword\s*&\s*shield|battle[- ]styles|chilling[- ]reign|evolving[- ]skies|celebrations|fusion[- ]strike|brilliant[- ]stars|astral[- ]radiance|pokemon[- ]go|lost[- ]origin|silver[- ]tempest|vivid[- ]voltage|darkness[- ]ablaze|rebel[- ]clash|shining[- ]fates|champions[- ]path|hidden[- ]fates/i.test(key)) && !/crown[- ]zenith/i.test(key);
    const policy = policyOverride ||
        (Array.isArray(exports.WATCH_POLICIES)
            ? exports.WATCH_POLICIES.find(p => (ruleId && p.id === ruleId) || (targetName && p.name === targetName))
            : undefined);
    const dynamicCeiling = policy
        ? Math.max((Number(policy.estimatedMarketValue) || 0) * 1.65, (Number(policy.maxMarketBuyPrice) || 0) * 1.65, (Number(policy.msrpCeiling) || 0) * 3.5)
        : 0;
    let baseCeiling = 2600;
    if (formFactor === 'ETB') {
        if (isSpecialSet)
            baseCeiling = 285;
        else if (isSwsh)
            baseCeiling = 450;
        else
            baseCeiling = 285;
    }
    else if (formFactor === 'Booster Box') {
        if (/evolving[- ]skies/i.test(key))
            baseCeiling = 3200;
        else if (isSwsh)
            baseCeiling = 1600;
        else
            baseCeiling = 565;
    }
    else if (formFactor === 'Booster Bundle') {
        baseCeiling = 98;
    }
    else if (formFactor === 'ETB Case') {
        baseCeiling = 2500;
    }
    else if (formFactor === 'Master Case') {
        if (/evolving[- ]skies/i.test(key))
            baseCeiling = 18000;
        else
            baseCeiling = 3500;
    }
    return Math.round(Math.max(baseCeiling, dynamicCeiling) * 100) / 100;
}
function isValidSkuForFormFactor(title, formFactor, price, options) {
    const combinedLower = ` ${title} ${options?.handle || ''} `.toLowerCase();
    const targetLower = `${options?.targetName || ''} ${options?.ruleId || ''}`.toLowerCase();
    if (isPoisonedVariantOrAccessory(options?.variantTitle, title, price, formFactor)) {
        return false;
    }
    // Layer 2: Single-Card / Slab / Loose-Pack / Accessory Hard Blacklist
    if (isSingleCardOrNonSealed(title, undefined, options?.handle || options?.sourceUrl)) {
        return false;
    }
    // Layer 3: Mandatory Positive Sealed Container Keyword
    if (!hasMandatorySealedContainerKeyword(title, formFactor)) {
        return false;
    }
    for (const junkRegex of exports.GLOBAL_JUNK_EXCLUSIONS) {
        if (junkRegex.test(title)) {
            return false;
        }
    }
    // Never allow a "30th Celebration(s)" title to fall through into the 25th Anniversary SWSH Celebrations rule
    if ((targetLower.includes('swsh-celebrations') || targetLower.includes('25th anniversary')) && /\b30th\b/i.test(combinedLower)) {
        return false;
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
    if ((formFactor === 'ETB' || formFactor === 'Booster Box' || formFactor === 'Booster Bundle') && /\b(case|cases|master case|sealed case|set of [2-9]|pair of|both styles|x2|2x|x4|4x|x6|6x|x10|10x)\b/i.test(title)) {
        return false;
    }
    if (formFactor === 'Master Case' && /\b(bundle|etb|elite trainer|blister|tin|collection|figure)\b/i.test(title)) {
        return false;
    }
    if (formFactor === 'ETB Case' && !/\b(etb|elite trainer)\b/i.test(title)) {
        return false;
    }
    if (price !== undefined && Number.isFinite(price)) {
        const matchedPolicy = Array.isArray(exports.WATCH_POLICIES)
            ? exports.WATCH_POLICIES.find(p => (options?.ruleId && p.id === options.ruleId) || (options?.targetName && p.name === options.targetName))
            : undefined;
        const inferred1P = Boolean(options?.is1PBigBox) || (/\b(target|walmart|best\s*buy|pokemon\s*center|pokemoncenter|costco|sam'?s\s*club|barnes|gamestop|amazon)\b/i.test(`${options?.retailer || ''} ${options?.sourceUrl || ''} ${options?.handle || ''}`) && !/\b3p|marketplace\b/i.test(`${options?.retailer || ''}`));
        const minFloor = computeSanityPriceFloor({
            formFactor,
            msrp: matchedPolicy?.msrpCeiling,
            verifiedMarket: Math.max(Number(matchedPolicy?.estimatedMarketValue || 0), Number(options?.verifiedMarket || 0)),
            is1PBigBox: inferred1P,
            title
        });
        if (price < minFloor) {
            return false;
        }
        if (formFactor) {
            const maxCeiling = getMaxPlausiblePriceCeiling(formFactor, options?.ruleId, options?.targetName || title, matchedPolicy);
            if (price > maxCeiling) {
                return false;
            }
        }
    }
    return true;
}
const configManager_1 = require("./src/config/configManager");
function atomicWriteJson(filePath, data) {
    (0, configManager_1.atomicWriteJson)(filePath, data);
}
function normalizePolicyMatcher(m) {
    if (!m)
        return m;
    return m
        .replace(/(?<!\()mega evolution /gi, '(mega evolution )?')
        .replace(/scarlet\s+violet/gi, 'scarlet.*violet')
        .replace(/booster(\.\*|\s+)box/gi, 'booster.*(box|display)');
}
function loadPolicies() {
    try {
        const parsed = (0, configManager_1.loadMergedPoliciesRaw)();
        if (!Array.isArray(parsed) || parsed.length === 0) {
            console.error('[POLICIES] Zero merged policies returned from configManager.');
            return [];
        }
        return parsed.map((item) => ({
            ...item,
            packCount: item.packCount || getPackCountForSku(item.id, item.formFactor, item.name),
            matchers: (item.matchers || []).map((m) => new RegExp(normalizePolicyMatcher(m), 'i')),
            negativeMatchers: exports.GLOBAL_JUNK_EXCLUSIONS,
        }));
    }
    catch (err) {
        console.error(`Error loading merged policies: ${err.message}`);
        return [];
    }
}
exports.WATCH_POLICIES = loadPolicies();
function reloadWatchPolicies() {
    exports.WATCH_POLICIES = loadPolicies();
    return exports.WATCH_POLICIES;
}
function matchProductToSku(title, price, options) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle)
        return null;
    if (isPoisonedVariantOrAccessory(options?.variantTitle, cleanTitle, price)) {
        return null;
    }
    // Layer 2: Reject single cards, graded slabs, loose packs, blisters, and accessories immediately
    if (isSingleCardOrNonSealed(cleanTitle, undefined, options?.handle || options?.sourceUrl)) {
        return null;
    }
    // Layer 3 (Any Sealed Container pre-check): Must contain a positive sealed container phrase
    if (!hasMandatorySealedContainerKeyword(cleanTitle)) {
        return null;
    }
    for (const rule of exports.WATCH_POLICIES) {
        if (!options?.includeInactive && rule.active === false)
            continue;
        const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
        if (!isMatched)
            continue;
        // Layer 3 (Form-Factor-Specific Sealed Container Check):
        if (!hasMandatorySealedContainerKeyword(cleanTitle, rule.formFactor)) {
            continue;
        }
        if (!isValidSkuForFormFactor(cleanTitle, rule.formFactor, price, {
            ruleId: rule.id,
            targetName: rule.name,
            handle: options?.handle,
            retailer: options?.retailer,
            sourceUrl: options?.sourceUrl,
            variantTitle: options?.variantTitle,
            verifiedMarket: options?.verifiedMarket,
            is1PBigBox: options?.is1PBigBox,
            allowPcRetailUnlock: options?.allowPcRetailUnlock ?? false
        })) {
            continue;
        }
        return rule;
    }
    return null;
}
(0, configManager_1.watchConfigFiles)(() => {
    console.log('[WATCHER] Config/userPreferences changed on disk. Hot-reloading active rules...');
    exports.WATCH_POLICIES = loadPolicies();
});
