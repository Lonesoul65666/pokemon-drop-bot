declare const require: any;
declare const __dirname: string;
declare const process: any;

const fs = require('fs');
const path = require('path');

export interface PolicyRule {
  id: string;
  name: string;
  era?: string;
  formFactor?: string;
  packCount?: number;
  image?: string;
  matchers: RegExp[];
  negativeMatchers?: RegExp[];
  minStock: number;
  msrpCeiling: number;
  maxMarketBuyPrice: number;
  estimatedMarketValue: number;
  priority: 'GRAIL' | 'BULK_DEAL' | 'STANDARD';
  cooldownMins: number;
  active?: boolean;
  owned?: boolean;
  inVault?: boolean;
  wallOwned?: boolean;
  dadRipOwned?: boolean;
  loganRipOwned?: boolean;
  completionCount?: number;
  fullyConquered?: boolean;
  autoPilotEnabled?: boolean;
  releaseDate?: string;
}

export function getPackCountForSku(skuId?: string, formFactor?: string, name?: string): number {
  const idLower = (skuId || '').toLowerCase();
  const ffLower = (formFactor || '').toLowerCase();
  const nameLower = (name || '').toLowerCase();
  const combined = `${idLower} ${ffLower} ${nameLower}`;

  if (
    ffLower === 'master case' ||
    ffLower === 'booster-case' ||
    ffLower === 'booster case' ||
    idLower.endsWith('-booster-case') ||
    /\b216\s*packs\b|\b6\s*boxes\b/i.test(combined) ||
    (combined.includes('booster') && combined.includes('case'))
  ) {
    return 216;
  }

  if (
    ffLower === 'etb case' ||
    ffLower === 'etb-case' ||
    idLower.endsWith('-etb-case') ||
    /\b10\s*etbs\b|\bcase\s*of\s*10\b/i.test(combined) ||
    ((combined.includes('etb') || combined.includes('elite trainer')) && combined.includes('case'))
  ) {
    return 90;
  }

  if (
    ffLower === 'booster box' ||
    ffLower === 'booster-box' ||
    idLower.endsWith('-booster-box') ||
    /\b36[- ]?pack\b|booster\s*(box|display)/i.test(combined)
  ) {
    return 36;
  }

  if (
    ffLower === 'booster bundle' ||
    ffLower === 'bundle' ||
    idLower.endsWith('-bundle') ||
    /\b6[- ]?pack\b|booster\s*bundle|\bbundle\b/i.test(combined)
  ) {
    return 6;
  }

  if (
    ffLower === 'etb' ||
    idLower.endsWith('-etb') ||
    /\b(etb|elite\s*trainer\s*box)\b/i.test(combined)
  ) {
    if (/pokemon\s*center|pokémon\s*center|pkmn\s*center|pc\s*exclusive|pc\s*etb/i.test(combined)) {
      return 11;
    }
    return 9;
  }

  return 36;
}

export function computeRipMetrics(
  landedPrice: number,
  skuId?: string,
  formFactor?: string,
  name?: string,
  explicitPackCount?: number
): { packCount: number; pricePerPack: number; isRipValueLeader: boolean } {
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

export const GLOBAL_JUNK_EXCLUSIONS = [
  /empty/i,
  /no packs/i,
  /box only/i,
  /case only/i,
  /open case/i,
  /open box/i,
  /opened case/i,
  /unsealed case/i,
  /loose boxes/i,
  /ripped\s*live|rip\s*(&|and|n)\s*ship|live\s*break|box\s*break|pack\s*break|personal\s*break/i,
  /2-pack/i,
  /2 pack/i,
  /acrylic/i,
  /protector/i,
  /\bcode\b/i,
  /code card/i,
  /sleeves/i,
  /deck box/i,
  /playmat/i,
  /\bdice\b/i,
  /opened/i,
  /damaged/i,
  /weighed/i,
  /pack only/i,
  /single pack/i,
  /\b1\s*pack\b/i,
  /loose pack/i,
  /sample pack/i,
  /fun pack/i,
  /1x\s*booster\s*pack/i,
  /sleeved\s*booster/i,
  /empty\s*box/i,
  /empty\s*etb/i,
  /one\s*booster\s*pack/i,
  /single\s*booster/i,
  /art set/i,
  /3-pack/i,
  /3 pack/i,
  /three pack/i,
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
  /\bcombo\b/i,
  /\bsingle(s)?\b/i,
  /single card/i,
  /\bholo\b/i,
  /reverse holo/i,
  /\bfoil\b/i,
  /full art/i,
  /alt art/i,
  /alternate art/i,
  /illustration rare/i,
  /\bsir\b/i,
  /\bir\b/i,
  /hyper rare/i,
  /secret rare/i,
  /ultra rare/i,
  /double rare/i,
  /rainbow rare/i,
  /gold star/i,
  /near mint/i,
  /\bnm\b/i,
  /lightly played/i,
  /\blp\b/i,
  /moderately played/i,
  /\bmp\b/i,
  /heavily played/i,
  /\bhp\b/i,
  /\bungraded\b/i,
  /raw card/i,
  /card only/i,
  /\bpromo\b/i,
  /black star/i,
  /\bpsa\b/i,
  /\bcgc\b/i,
  /\bbgs\b/i,
  /\bbeckett\b/i,
  /\bsgc\b/i,
  /gem mint/i,
  /mint\s*10\b/i,
  /mint\s*9\b/i,
  /pristine\s*10\b/i,
  /\bslab(s)?\b/i,
  /\bgraded\b/i,
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

const SHOPIFY_BLOCKED_META_REGEX = /\b(single|singles|pokemon\s+singles|single\s+cards?|graded|slabs?|psa|cgc|bgs|loose\s+packs?|code\s+cards?|accessories)\b/i;

export function isSingleOrNonSealedShopifyProduct(prod?: {
  product_type?: string | null;
  tags?: string | string[] | null;
  title?: string | null;
  handle?: string | null;
}): boolean {
  if (!prod) return false;
  const prodType = String(prod.product_type || '').trim();
  const tagsStr = Array.isArray(prod.tags) ? prod.tags.join(' ') : String(prod.tags || '');
  if (SHOPIFY_BLOCKED_META_REGEX.test(prodType) || SHOPIFY_BLOCKED_META_REGEX.test(tagsStr)) {
    return true;
  }
  return false;
}

const SINGLE_CARD_OR_NON_SEALED_PATTERNS: RegExp[] = [
  // Card Number / Set Number Patterns (excludes 3-part MM/DD/YYYY dates)
  /\b\d{1,3}\s*\/\s*\d{1,3}\b(?!\s*\/\s*\d{2,4})/i,
  /#[0-9]{1,4}\b/i,
  /\b(tg|gg|svp)[0-9]{1,3}\b/i,
  /\b(sv|swsh|sm|xy)[0-9]{3}\b/i,
  /\b(sv|swsh|sm|xy)(1[3-9]|[2-9][0-9])\b/i,
  // Single Card Rarity & Condition Terms
  /\bsingle(s)?\b/i,
  /single\s+cards?\b/i,
  /\bholo\b/i,
  /reverse\s+holo/i,
  /\bfoil\b/i,
  /full\s+art/i,
  /alt\s+art/i,
  /alternate\s+art/i,
  /illustration\s+rare/i,
  /\bsir\b/i,
  /\bir\b/i,
  /hyper\s+rare/i,
  /secret\s+rare/i,
  /ultra\s+rare/i,
  /double\s+rare/i,
  /rainbow\s+rare/i,
  /gold\s+star/i,
  /near\s+mint/i,
  /\bnm\b/i,
  /lightly\s+played/i,
  /\blp\b/i,
  /moderately\s+played/i,
  /\bmp\b/i,
  /heavily\s+played/i,
  /\bhp\b/i,
  /\bdamaged\b/i,
  /\bungraded\b/i,
  /raw\s+card/i,
  /card\s+only/i,
  /\bpromo\b/i,
  /black\s+star/i,
  // Graded Slabs
  /\bpsa\b/i,
  /\bcgc\b/i,
  /\bbgs\b/i,
  /\bbeckett\b/i,
  /\bsgc\b/i,
  /gem\s+mint/i,
  /mint\s*10\b/i,
  /mint\s*9\b/i,
  /pristine\s*10\b/i,
  /\bslab(s)?\b/i,
  /\bgraded\b/i,
  // Loose Packs, Blisters & Empty/Accessory Junk
  /single\s+pack/i,
  /\b1\s*pack\b/i,
  /loose\s+pack/i,
  /sleeved\s+booster/i,
  /\bblister\b/i,
  /\bchecklane\b/i,
  /\b3-pack\b/i,
  /three\s+pack/i,
  /art\s+set/i,
  /sample\s+pack/i,
  /fun\s+pack/i,
  /empty\s+box/i,
  /empty\s+etb/i,
  /box\s+only/i,
  /no\s+packs/i,
  /code\s+card/i,
  /\bsleeves\b/i,
  /deck\s+box/i,
  /\bbinder\b/i,
  /\bplaymat\b/i,
  /acrylic\s+case/i,
  /\bprotector\b/i
];

const POSITIVE_SEALED_CONTAINER_ANY_REGEX = /\b(elite\s*trainer\s*box|etb|booster\s*(box|display|bundle)|ultra\s*premium\s*collection|super\s*premium\s*collection|upc|spc|booster\s*case|etb\s*case)\b/i;

const NON_CARD_JUNK_OR_PACK_REGEX = /\b(single\s*pack|1\s*pack|loose\s*packs?|sleeved|blister|checklane|3-pack|three\s*pack|sample\s*pack|fun\s*pack|empty\s*box|empty\s*etb|box\s*only|case\s*only|no\s*packs|code\s*cards?|sleeves|deck\s*box|binder|portfolio|playmat|acrylic\s*case|protector|dice|plush|figure|apparel)\b/i;

const SINGLE_CARD_OR_SLAB_POSITIVE_REGEX = /\b(\d{1,3}\s*\/\s*\d{1,3}|#[0-9]{1,4}|(sv|tg|gg|swsh|sm|xy|svp)[0-9]{1,3}|single(s)?|single\s+card|holo|reverse\s+holo|foil|full\s+art|alt\s+art|alternate\s+art|illustration\s+rare|sir|ir|hyper\s+rare|secret\s+rare|ultra\s+rare|double\s+rare|rainbow\s+rare|gold\s+star|near\s+mint|nm|lightly\s+played|lp|moderately\s+played|mp|heavily\s+played|hp|ungraded|raw\s+card|card\s+only|promo|psa|cgc|bgs|beckett|sgc|gem\s+mint|mint\s*10|mint\s*9|pristine\s*10|slab(s)?|graded|ex|gx|vmax|vstar)\b/i;

export function isSingleCardOrNonSealed(
  title?: string,
  productType?: string,
  tags?: string | string[]
): boolean {
  const clean = String(title || '').trim();
  if (!clean) return true;

  const prodTypeStr = String(productType || '').trim();
  const tagsStr = Array.isArray(tags) ? tags.join(' ') : String(tags || '').trim();
  const metaCombined = `${prodTypeStr} ${tagsStr}`.trim();

  if (metaCombined && SHOPIFY_BLOCKED_META_REGEX.test(metaCombined)) {
    return true;
  }

  for (const rx of SINGLE_CARD_OR_NON_SEALED_PATTERNS) {
    if (rx.test(clean)) return true;
  }

  if (/\b(sv|tg|gg|swsh|sm|xy)[0-9]{1,3}\b/i.test(clean) && !POSITIVE_SEALED_CONTAINER_ANY_REGEX.test(clean)) {
    return true;
  }

  for (const junkRegex of GLOBAL_JUNK_EXCLUSIONS) {
    if (junkRegex.test(clean)) return true;
  }

  if (metaCombined && /\b(psa-[0-9]|cgc-[0-9]|bgs-[0-9]|single-card|pokemon-singles|loose-pack|graded-card)\b/i.test(metaCombined)) {
    return true;
  }

  return false;
}

export function isCollectibleSingleCardOrSlab(
  title?: string,
  productType?: string,
  tags?: string | string[]
): boolean {
  const clean = String(title || '').trim();
  if (!clean) return false;
  const prodTypeStr = String(productType || '').trim();
  const tagsStr = Array.isArray(tags) ? tags.join(' ') : String(tags || '').trim();
  const combined = `${clean} ${prodTypeStr} ${tagsStr}`;

  if (POSITIVE_SEALED_CONTAINER_ANY_REGEX.test(clean)) return false;
  if (NON_CARD_JUNK_OR_PACK_REGEX.test(combined)) return false;
  if (!isSingleCardOrNonSealed(clean, prodTypeStr, tags)) return false;

  return (
    SINGLE_CARD_OR_SLAB_POSITIVE_REGEX.test(combined) ||
    /\b(single|singles|pokemon\s+singles|single\s+cards?|graded|slabs?|psa|cgc|bgs)\b/i.test(`${prodTypeStr} ${tagsStr}`)
  );
}

export function hasMandatorySealedContainerKeyword(title?: string, formFactor?: string): boolean {
  const clean = String(title || '').trim();
  if (!clean) return false;
  const ff = String(formFactor || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

  if (!ff) {
    return POSITIVE_SEALED_CONTAINER_ANY_REGEX.test(clean);
  }

  if (ff === 'etb' || ff === 'pc_etb') {
    if (/\b(booster\s*bundle|booster\s*box|\bcombo\b)\b/i.test(clean)) return false;
    return /\b(elite\s*trainer\s*box|etb)\b/i.test(clean);
  }

  if (ff === 'booster_box') {
    return /\bbooster\s*(box|display)\b/i.test(clean);
  }

  if (ff === 'booster_bundle' || ff === 'bundle') {
    return /\bbooster\s*bundle\b/i.test(clean);
  }

  if (ff === 'upc' || ff === 'spc') {
    return /\b(ultra\s*premium\s*collection|super\s*premium\s*collection|upc|spc)\b/i.test(clean);
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

export const BOOSTER_BOX_EXCLUSION_TERMS = [
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

export const PC_EXCLUSIVE_EXCLUSION_TERMS = [
  'pokemon center',
  'pokémon center',
  'pkmn center',
  'pc exclusive',
  'pc etb',
  'center exclusive',
  'stamped'
];

export const BIG_BOX_RETAILER_PATTERNS = [
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

export function detectBigBoxRetailer(retailer?: string, url?: string): string | null {
  const combined = `${retailer || ''} ${url || ''}`;
  for (const pat of BIG_BOX_RETAILER_PATTERNS) {
    if (pat.regex.test(combined)) {
      return pat.name;
    }
  }
  return null;
}

export function isPokemonCenterSource(retailer?: string, url?: string): boolean {
  return /pokemon\s*center|pokémon\s*center|pokemoncenter\.com/i.test(`${retailer || ''} ${url || ''}`);
}

export function hasPcExclusiveTerms(title?: string, handle?: string): boolean {
  const combinedLower = ` ${title || ''} ${handle || ''} `.toLowerCase();
  return PC_EXCLUSIVE_EXCLUSION_TERMS.some(term => combinedLower.includes(term));
}

export const MIN_PLAUSIBLE_PRICE_FLOORS: Record<string, number> = {
  'Booster Box': 95,
  'ETB': 32,
  'Booster Bundle': 18,
  'ETB Case': 450,
  'Master Case': 550
};

export function getMinPlausiblePriceFloor(formFactor?: string): number {
  if (!formFactor) return 18;
  return MIN_PLAUSIBLE_PRICE_FLOORS[formFactor] ?? 18;
}

export function getMaxPlausiblePriceCeiling(
  formFactor?: string,
  ruleId?: string,
  targetName?: string,
  policyOverride?: Partial<PolicyRule>
): number {
  const key = `${ruleId || ''} ${targetName || ''}`.toLowerCase();
  const isSpecialSet = /\b151\b|paldean[- ]fates|prismatic|crown[- ]zenith/i.test(key);
  const isSwsh = (
    /^swsh-|sword\s*&\s*shield|battle[- ]styles|chilling[- ]reign|evolving[- ]skies|celebrations|fusion[- ]strike|brilliant[- ]stars|astral[- ]radiance|pokemon[- ]go|lost[- ]origin|silver[- ]tempest|vivid[- ]voltage|darkness[- ]ablaze|rebel[- ]clash|shining[- ]fates|champions[- ]path|hidden[- ]fates/i.test(key)
  ) && !/crown[- ]zenith/i.test(key);

  const policy =
    policyOverride ||
    (Array.isArray(WATCH_POLICIES)
      ? WATCH_POLICIES.find(p => (ruleId && p.id === ruleId) || (targetName && p.name === targetName))
      : undefined);

  const dynamicCeiling = policy
    ? Math.max(
        (Number(policy.estimatedMarketValue) || 0) * 1.65,
        (Number(policy.maxMarketBuyPrice) || 0) * 1.65,
        (Number(policy.msrpCeiling) || 0) * 3.5
      )
    : 0;

  let baseCeiling = 2600;
  if (formFactor === 'ETB') {
    if (isSpecialSet) baseCeiling = 285;
    else if (isSwsh) baseCeiling = 450;
    else baseCeiling = 285;
  } else if (formFactor === 'Booster Box') {
    if (/evolving[- ]skies/i.test(key)) baseCeiling = 3200;
    else if (isSwsh) baseCeiling = 1600;
    else baseCeiling = 565;
  } else if (formFactor === 'Booster Bundle') {
    baseCeiling = 98;
  } else if (formFactor === 'ETB Case') {
    baseCeiling = 2500;
  } else if (formFactor === 'Master Case') {
    if (/evolving[- ]skies/i.test(key)) baseCeiling = 18000;
    else baseCeiling = 3500;
  }

  return Math.round(Math.max(baseCeiling, dynamicCeiling) * 100) / 100;
}

export function isValidSkuForFormFactor(
  title: string,
  formFactor?: string,
  price?: number,
  options?: {
    ruleId?: string;
    targetName?: string;
    handle?: string;
    retailer?: string;
    sourceUrl?: string;
    allowPcRetailUnlock?: boolean;
  }
): boolean {
  const combinedLower = ` ${title} ${options?.handle || ''} `.toLowerCase();
  const targetLower = `${options?.targetName || ''} ${options?.ruleId || ''}`.toLowerCase();

  // Layer 2: Single-Card / Slab / Loose-Pack / Accessory Hard Blacklist
  if (isSingleCardOrNonSealed(title, options?.handle || options?.sourceUrl)) {
    return false;
  }

  // Layer 3: Mandatory Positive Sealed Container Keyword
  if (!hasMandatorySealedContainerKeyword(title, formFactor)) {
    return false;
  }

  for (const junkRegex of GLOBAL_JUNK_EXCLUSIONS) {
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
    const isTargetExplicitPc = PC_EXCLUSIVE_EXCLUSION_TERMS.some(term => targetLower.includes(term));
    const hasPcTerm = PC_EXCLUSIVE_EXCLUSION_TERMS.some(term => combinedLower.includes(term));
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
    for (const term of BOOSTER_BOX_EXCLUSION_TERMS) {
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

import {
  atomicWriteJson as cmAtomicWriteJson,
  loadMergedPoliciesRaw,
  watchConfigFiles
} from './src/config/configManager';

export function atomicWriteJson(filePath: string, data: any): void {
  cmAtomicWriteJson(filePath, data);
}

function normalizePolicyMatcher(m: string): string {
  if (!m) return m;
  return m
    .replace(/(?<!\()mega evolution /gi, '(mega evolution )?')
    .replace(/scarlet\s+violet/gi, 'scarlet.*violet')
    .replace(/booster(\.\*|\s+)box/gi, 'booster.*(box|display)');
}

export function loadPolicies(): PolicyRule[] {
  try {
    const parsed = loadMergedPoliciesRaw();
    if (!Array.isArray(parsed) || parsed.length === 0) {
      console.error('[POLICIES] Zero merged policies returned from configManager.');
      return [];
    }

    return parsed.map((item: any) => ({
      ...item,
      packCount: item.packCount || getPackCountForSku(item.id, item.formFactor, item.name),
      matchers: (item.matchers || []).map((m: string) => new RegExp(normalizePolicyMatcher(m), 'i')),
      negativeMatchers: GLOBAL_JUNK_EXCLUSIONS,
    }));
  } catch (err: any) {
    console.error(`Error loading merged policies: ${err.message}`);
    return [];
  }
}

export let WATCH_POLICIES: PolicyRule[] = loadPolicies();

export function reloadWatchPolicies(): PolicyRule[] {
  WATCH_POLICIES = loadPolicies();
  return WATCH_POLICIES;
}

export function matchProductToSku(
  title: string,
  price?: number,
  options?: {
    handle?: string;
    retailer?: string;
    sourceUrl?: string;
    allowPcRetailUnlock?: boolean;
    includeInactive?: boolean;
  }
): PolicyRule | null {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return null;

  // Layer 2: Reject single cards, graded slabs, loose packs, blisters, and accessories immediately
  if (isSingleCardOrNonSealed(cleanTitle, options?.handle || options?.sourceUrl)) {
    return null;
  }

  // Layer 3 (Any Sealed Container pre-check): Must contain a positive sealed container phrase
  if (!hasMandatorySealedContainerKeyword(cleanTitle)) {
    return null;
  }

  for (const rule of WATCH_POLICIES) {
    if (!options?.includeInactive && (rule as any).active === false) continue;
    const isMatched = rule.matchers.some((regex) => regex.test(cleanTitle));
    if (!isMatched) continue;

    // Layer 3 (Form-Factor-Specific Sealed Container Check):
    if (!hasMandatorySealedContainerKeyword(cleanTitle, rule.formFactor)) {
      continue;
    }

    if (
      !isValidSkuForFormFactor(cleanTitle, rule.formFactor, price, {
        ruleId: rule.id,
        targetName: rule.name,
        handle: options?.handle,
        retailer: options?.retailer,
        sourceUrl: options?.sourceUrl,
        allowPcRetailUnlock: options?.allowPcRetailUnlock ?? false
      })
    ) {
      continue;
    }

    return rule;
  }

  return null;
}

watchConfigFiles(() => {
  console.log('[WATCHER] Config/userPreferences changed on disk. Hot-reloading active rules...');
  WATCH_POLICIES = loadPolicies();
});
