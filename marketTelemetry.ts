declare const require: any;
declare const process: any;

const fs = require('fs');
const path = require('path');

export interface ProductTelemetry {
  lowestPrice: number;
  lowestStore: string;
  lowestUrl: string;
  lastSeen: number;
  rollingAverage: number;
  observationsCount: number;
  samples: number[];
}

const CACHE_PATH = path.resolve(process.cwd(), 'marketCache.json');
let telemetryMap: Record<string, ProductTelemetry> = {};
let saveTimeout: any = null;

// Load existing cache on boot if available
try {
  if (fs.existsSync(CACHE_PATH)) {
    telemetryMap = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  }
} catch (e) {
  telemetryMap = {};
}

function computeTrimmedAverage(samples: number[]): number {
  if (samples.length === 0) return 0;
  if (samples.length <= 2) {
    return Math.round((samples.reduce((a, b) => a + b, 0) / samples.length) * 100) / 100;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  // Drop highest and lowest 10% to eliminate gouges and rogue listings
  const trimCount = Math.floor(sorted.length * 0.1);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
  const sum = trimmed.reduce((acc, val) => acc + val, 0);
  return Math.round((sum / trimmed.length) * 100) / 100;
}

export function recordObservation(
  policyId: string,
  price: number,
  store: string,
  url: string,
  msrp: number
) {
  if (price <= 0) return;

  const now = Date.now();
  const current = telemetryMap[policyId] || {
    lowestPrice: price,
    lowestStore: store,
    lowestUrl: url,
    lastSeen: 0,
    rollingAverage: price,
    observationsCount: 0,
    samples: [],
  };

  // 1. ALWAYS update the dashboard display so you can see the baseline reality, even if it's a gouge
  const isStale = now - current.lastSeen > 12 * 60 * 60 * 1000;
  if (price <= current.lowestPrice || isStale) {
    current.lowestPrice = price;
    current.lowestStore = store;
    current.lowestUrl = url;
    current.lastSeen = now;
  }

  // 2. ONLY add to the rolling average math if it isn't an extreme scam or 400% markup gouge
  if (price <= msrp * 4.5 && price >= msrp * 0.35) {
    current.samples.push(price);
    if (current.samples.length > 40) {
      current.samples.shift();
    }
    current.observationsCount += 1;
    current.rollingAverage = computeTrimmedAverage(current.samples);
  }

  telemetryMap[policyId] = current;

  // Debounced atomic write to disk every 3 seconds
  if (!saveTimeout) {
    saveTimeout = setTimeout(() => {
      try {
        const tmp = CACHE_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(telemetryMap, null, 2), 'utf-8');
        fs.renameSync(tmp, CACHE_PATH);
      } catch (err: any) {
        // Suppress ephemeral lock warnings
      }
      saveTimeout = null;
    }, 3000);
  }
}

export function getTelemetry(): Record<string, ProductTelemetry> {
  return telemetryMap;
}