"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WATCH_POLICIES = exports.GLOBAL_JUNK_EXCLUSIONS = void 0;
exports.loadPolicies = loadPolicies;
const fs = require('fs');
const path = require('path');
exports.GLOBAL_JUNK_EXCLUSIONS = [
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
