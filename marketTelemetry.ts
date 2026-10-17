import { atomicWriteJson, WATCH_POLICIES, getMinPlausiblePriceFloor, getMaxPlausiblePriceCeiling } from './policies';

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

  const pol = WATCH_POLICIES.find(p => p.id === policyId);
  const minFloor = getMinPlausiblePriceFloor(pol?.formFactor);
  const maxCeiling = getMaxPlausiblePriceCeiling(pol?.formFactor, policyId, pol?.name);
  if (price < minFloor || price > maxCeiling) return;

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

  // 1. Update lowest observed valid price within strict floor/ceiling bounds
  const isStale = now - current.lastSeen > 12 * 60 * 60 * 1000;
  if (price <= current.lowestPrice || isStale) {
    current.lowestPrice = price;
    current.lowestStore = store;
    current.lowestUrl = url;
    current.lastSeen = now;
  }

  if (!Array.isArray(current.samples)) {
    current.samples = [];
  }

  // 2. Add to rolling average within era/packaging ceiling
  if (price <= maxCeiling && price >= minFloor) {
    current.samples.push(price);
    if (current.samples.length > 40) {
      current.samples.shift();
    }
    current.observationsCount = (current.observationsCount || 0) + 1;
    current.rollingAverage = Math.min(maxCeiling, computeTrimmedAverage(current.samples));
  }

  telemetryMap[policyId] = current;

  // Debounced atomic write to disk every 3 seconds
  if (!saveTimeout) {
    saveTimeout = setTimeout(() => {
      atomicWriteJson(CACHE_PATH, telemetryMap);
      saveTimeout = null;
    }, 3000);
  }
}

export function getTelemetry(): Record<string, ProductTelemetry> {
  return telemetryMap;
}