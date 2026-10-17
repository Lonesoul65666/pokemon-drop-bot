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
}

export const GLOBAL_JUNK_EXCLUSIONS = [
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

export function isValidSkuForFormFactor(title: string, formFactor?: string, price?: number): boolean {
  const lower = ` ${title.toLowerCase()} `;

  for (const junkRegex of GLOBAL_JUNK_EXCLUSIONS) {
    if (junkRegex.test(title)) {
      return false;
    }
  }

  if (formFactor === 'Booster Box' || formFactor === 'Master Case') {
    for (const term of BOOSTER_BOX_EXCLUSION_TERMS) {
      if (lower.includes(term)) {
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
  }

  return true;
}

// Check root directory first, then fallback to one level up from dist/
function resolvePoliciesPath(): string {
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

export function atomicWriteJson(filePath: string, data: any): void {
  try {
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err: any) {
    try {
      const fallbackTmp = `${filePath}.tmp`;
      fs.writeFileSync(fallbackTmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(fallbackTmp, filePath);
    } catch (e) {}
  }
}

const POLICIES_PATH = resolvePoliciesPath();

export function loadPolicies(): PolicyRule[] {
  try {
    if (!fs.existsSync(POLICIES_PATH)) {
      console.error(`[POLICIES] policies.json not found at: ${POLICIES_PATH}`);
      return [];
    }
    const raw = fs.readFileSync(POLICIES_PATH, 'utf-8');
    const parsed = JSON.parse(raw);

    return parsed.map((item: any) => ({
      ...item,
      matchers: item.matchers.map((m: string) => new RegExp(m, 'i')),
      negativeMatchers: GLOBAL_JUNK_EXCLUSIONS,
    }));
  } catch (err: any) {
    console.error(`Error reading policies.json: ${err.message}`);
    return [];
  }
}

export let WATCH_POLICIES: PolicyRule[] = loadPolicies();

if (fs.existsSync(POLICIES_PATH)) {
  fs.watch(POLICIES_PATH, () => {
    console.log('[WATCHER] policies.json changed on disk. Hot-reloading active rules...');
    WATCH_POLICIES = loadPolicies();
  });
}