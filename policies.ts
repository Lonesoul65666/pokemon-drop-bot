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
  /3-pack/i,
  /blister/i,
  /checklane/i,
  /sleeved booster/i,
  /\bbooster pack\b/i,
  /\bpack\b(?!\s*box)/i,
  /\btin\b/i,
  /binder/i,
  /portfolio/i,
  /poster/i,
  /illustration collection/i,
  /collection box/i,
  /acrylic/i,
  /empty/i,
  /near mint/i,
  /lightly played/i,
  /japanese/i,
];

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