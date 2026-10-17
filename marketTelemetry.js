"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordObservation = recordObservation;
exports.getTelemetry = getTelemetry;
const policies_1 = require("./policies");
const fs = require('fs');
const path = require('path');
const CACHE_PATH = path.resolve(process.cwd(), 'marketCache.json');
let telemetryMap = {};
let saveTimeout = null;
// Load existing cache on boot if available
try {
    if (fs.existsSync(CACHE_PATH)) {
        telemetryMap = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
}
catch (e) {
    telemetryMap = {};
}
function computeTrimmedAverage(samples) {
    if (samples.length === 0)
        return 0;
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
function recordObservation(policyId, price, store, url, msrp) {
    if (price <= 0)
        return;
    const pol = policies_1.WATCH_POLICIES.find(p => p.id === policyId);
    const minFloor = (0, policies_1.getMinPlausiblePriceFloor)(pol?.formFactor);
    const maxCeiling = (0, policies_1.getMaxPlausiblePriceCeiling)(pol?.formFactor, policyId, pol?.name);
    if (price < minFloor || price > maxCeiling)
        return;
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
            (0, policies_1.atomicWriteJson)(CACHE_PATH, telemetryMap);
            saveTimeout = null;
        }, 3000);
    }
}
function getTelemetry() {
    return telemetryMap;
}
