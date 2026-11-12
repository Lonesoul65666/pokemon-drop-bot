import fs from 'fs';
import path from 'path';
import { PolicyRule, atomicWriteJson, computeRipMetrics } from '../../policies';

const CONQUERED_VAULT_PATH = path.resolve(process.cwd(), 'conqueredVault.json');
const PURCHASE_LEDGER_PATH = path.resolve(process.cwd(), 'data', 'purchaseLedger.json');

export interface PurchaseRecord {
  id: string;
  skuId: string;
  productName: string;
  formFactor: string;
  store: string;
  landedPrice: number;
  purchasedAt?: string;
  orderRef?: string;
}

export interface PurchaseComparisonResult {
  record: PurchaseRecord;
  lastPaid: number;
  deltaDollars: number;
  beatsPriorBuy: boolean;
  formattedComparison: string;
}

let cachedVaultMtime = 0;
let cachedLedgerMtime = 0;
let cachedRecords: PurchaseRecord[] = [];

function normalizeFormatKey(formFactor?: string, skuId?: string, productName?: string): string {
  const combined = `${formFactor || ''} ${skuId || ''} ${productName || ''}`.toLowerCase();
  if (/\betb[-\s_]*case\b|\b10[-\s]*etb/i.test(combined) || ((combined.includes('etb') || combined.includes('elite trainer')) && combined.includes('case'))) {
    return 'etb-case';
  }
  if (/\bmaster[-\s_]*case\b|\bbooster[-\s_]*case\b|\b6[-\s]*box|\b216[-\s]*pack/i.test(combined) || (combined.includes('booster') && combined.includes('case'))) {
    return 'booster-case';
  }
  if (/\bbooster[-\s_]*box\b|\b36[-\s]*pack/i.test(combined)) return 'booster-box';
  if (/\bbooster[-\s_]*bundle\b|\bbundle\b|\b6[-\s]*pack/i.test(combined)) return 'booster-bundle';
  if (/\bultra[-\s]*premium|\bsuper[-\s]*premium|\bupc\b|\bspc\b/i.test(combined)) return 'upc';
  if (/\bpc[-\s_]*etb\b|pok[eé]mon\s*center.*(?:etb|elite\s*trainer)/i.test(combined)) return 'pc_etb';
  if (/\betb\b|elite\s*trainer\s*box/i.test(combined) && !/\bcase\b/i.test(combined)) return 'etb';
  return 'pack-format';
}

export function isSingleEtbFormat(formFactor?: string, skuId?: string, productName?: string): boolean {
  const key = normalizeFormatKey(formFactor, skuId, productName);
  return key === 'etb' || key === 'pc_etb';
}

function formatDollarCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 25 || Math.abs(abs - Math.round(abs)) < 0.05) return `$${Math.round(abs).toLocaleString('en-US')}`;
  return `$${abs.toFixed(2)}`;
}

function ingestList(list: any[], fallbackStore: string, out: Map<string, PurchaseRecord>): void {
  for (const t of list) {
    const lp = Number(t?.landedPrice || t?.price || 0);
    if (!t?.skuId || !Number.isFinite(lp) || lp <= 0) continue;
    const rec: PurchaseRecord = {
      id: String(t.id || `${t.skuId}_${lp}`),
      skuId: String(t.skuId),
      productName: String(t.productName || t.skuId),
      formFactor: normalizeFormatKey(t.formFactor, t.skuId, t.productName),
      store: String(t.store || fallbackStore),
      landedPrice: lp,
      purchasedAt: t.purchasedAt || t.conqueredAt,
      orderRef: t.orderRef
    };
    out.set(rec.id, rec);
  }
}

export function loadPurchaseRecords(): PurchaseRecord[] {
  const vStat = fs.existsSync(CONQUERED_VAULT_PATH) ? fs.statSync(CONQUERED_VAULT_PATH).mtimeMs : 0;
  const lStat = fs.existsSync(PURCHASE_LEDGER_PATH) ? fs.statSync(PURCHASE_LEDGER_PATH).mtimeMs : 0;
  if (cachedRecords.length > 0 && vStat === cachedVaultMtime && lStat === cachedLedgerMtime) return cachedRecords;

  const byKey = new Map<string, PurchaseRecord>();
  try {
    if (fs.existsSync(CONQUERED_VAULT_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONQUERED_VAULT_PATH, 'utf-8'));
      const list = Array.isArray(raw) ? raw : (raw?.trophies || raw?.plaques || []);
      ingestList(Array.isArray(list) ? list : [], 'Vault Purchase', byKey);
    }
  } catch {}

  let ledgerExists = false;
  try {
    if (fs.existsSync(PURCHASE_LEDGER_PATH)) {
      ledgerExists = true;
      const raw = JSON.parse(fs.readFileSync(PURCHASE_LEDGER_PATH, 'utf-8'));
      const list = Array.isArray(raw) ? raw : (raw?.purchases || []);
      ingestList(Array.isArray(list) ? list : [], 'Purchase Ledger', byKey);
    }
  } catch {}

  const merged = Array.from(byKey.values());
  if (!ledgerExists && merged.length > 0) {
    try {
      const dir = path.dirname(PURCHASE_LEDGER_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      atomicWriteJson(PURCHASE_LEDGER_PATH, { updatedAt: new Date().toISOString(), purchases: merged });
    } catch {}
  }

  cachedVaultMtime = vStat;
  cachedLedgerMtime = fs.existsSync(PURCHASE_LEDGER_PATH) ? fs.statSync(PURCHASE_LEDGER_PATH).mtimeMs : 0;
  cachedRecords = merged;
  return merged;
}

export function lookupPurchaseMemory(params: {
  skuId?: string; landedPrice: number; formFactor?: string; productName?: string;
}): PurchaseComparisonResult | null {
  const { skuId, landedPrice, formFactor, productName } = params;
  if (!skuId || !Number.isFinite(landedPrice) || landedPrice <= 0) return null;

  const targetFormat = normalizeFormatKey(formFactor, skuId, productName);
  const matches = loadPurchaseRecords().filter(
    (r) => r.skuId === skuId || (r.skuId.toLowerCase() === skuId.toLowerCase() && r.formFactor === targetFormat)
  );
  if (matches.length === 0) return null;

  matches.sort((a, b) => Date.parse(b.purchasedAt || '') - Date.parse(a.purchasedAt || ''));
  const record = matches[0];
  const lastPaid = record.landedPrice;
  const paidStr = formatDollarCompact(lastPaid);
  const rawDelta = Math.round(((lastPaid >= 25 ? Math.round(landedPrice) : landedPrice) - (lastPaid >= 25 ? Math.round(lastPaid) : lastPaid)) * 100) / 100;

  const formattedComparison = (rawDelta <= -1 || (lastPaid < 25 && rawDelta <= -0.50))
    ? `Last Paid: ${paidStr} (-${formatDollarCompact(Math.abs(rawDelta))} vs. your buy)`
    : (rawDelta >= 1 || (lastPaid < 25 && rawDelta >= 0.50))
      ? `Last Paid: ${paidStr} (+${formatDollarCompact(rawDelta)} above your buy)`
      : `Last Paid: ${paidStr} (Matches your buy)`;

  return { record, lastPaid, deltaDollars: rawDelta, beatsPriorBuy: rawDelta < 0, formattedComparison };
}

export function formatCollectionAndCostLine(params: {
  skuId?: string; formFactor?: string; productName?: string; landedPrice: number;
  packCount?: number; pricePerPack?: number; rule?: PolicyRule | null; ownedFallback?: boolean;
}): string {
  const { skuId, formFactor, productName, landedPrice, rule, ownedFallback = false } = params;
  const fmtKey = normalizeFormatKey(formFactor || rule?.formFactor, skuId || rule?.id, productName || rule?.name);

  let formatStatus: string;
  if (fmtKey === 'etb' || fmtKey === 'pc_etb') {
    const wallDone = Boolean(rule ? (rule.wallOwned ?? rule.inVault ?? rule.owned) : ownedFallback);
    const explicit = typeof rule?.completionCount === 'number'
      ? rule.completionCount
      : (wallDone ? 1 : 0) + (rule?.loganRipOwned ? 1 : 0) + (rule?.dadRipOwned ? 1 : 0);
    const count = rule?.fullyConquered ? 3 : Math.min(3, Math.max(wallDone ? 1 : 0, explicit));
    formatStatus = count >= 3
      ? '3/3 Stacked'
      : count === 2
        ? '2/3 Walls Done — Bonus Dad Rip'
        : count === 1
          ? "1/3 Logan's Wall Done — Need Office Sealed"
          : "0/3 Needed: Logan's Rip + Office Sealed";
  } else if (fmtKey === 'etb-case' || fmtKey === 'booster-case') {
    const perBox = landedPrice > 0 ? landedPrice / (fmtKey === 'etb-case' ? 10 : 6) : 0;
    formatStatus = `Sealed Case ($${perBox.toFixed(2)} / box)`;
  } else {
    const rip = computeRipMetrics(landedPrice, skuId || rule?.id, formFactor || rule?.formFactor, productName || rule?.name, params.packCount || rule?.packCount);
    const ppp = params.pricePerPack && params.pricePerPack > 0 ? params.pricePerPack : rip.pricePerPack;
    formatStatus = `Rip / Pack Format ($${ppp.toFixed(2)} / pack)`;
  }

  const memory = lookupPurchaseMemory({
    skuId: skuId || rule?.id, landedPrice, formFactor: formFactor || rule?.formFactor, productName: productName || rule?.name
  });
  return memory ? `${formatStatus} • ${memory.formattedComparison}` : formatStatus;
}
