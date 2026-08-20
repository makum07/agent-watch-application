// Server-only: reads from disk. Do not import this from client components —
// use `@/lib/pricing/pricing-core`'s `estimateAgentCost` there instead.
import fs from 'fs';
import path from 'path';
import { calculateCost, DEFAULT_PRICEBANK, type Pricebank, type ModelPricing } from './pricing-core';

export type { ModelPricing, Pricebank };

export const PRICEBANK_PATH = path.join(process.cwd(), 'data', 'model-pricing.json');

let cache: { mtimeMs: number; bank: Pricebank } | null = null;

function readBankFile(filePath: string): Pricebank | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Pricebank;
  } catch {
    return null;
  }
}

/** Loads the live-synced pricebank if present, falling back to the committed baseline. Cached in-memory, invalidated only when the file on disk changes. */
export function loadPricebank(): Pricebank {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(PRICEBANK_PATH).mtimeMs;
  } catch {
    // no live-synced pricebank yet — fall through to the committed baseline
  }

  if (cache && cache.mtimeMs === mtimeMs) return cache.bank;

  const bank = (mtimeMs > 0 && readBankFile(PRICEBANK_PATH)) || DEFAULT_PRICEBANK;
  cache = { mtimeMs, bank };
  return bank;
}

export function estimateAgentCost(usage: {
  input: number; output: number; cacheCreation: number; cacheRead: number;
}, model: string): number {
  return calculateCost(loadPricebank(), usage, model);
}

export function getPricebankMeta(): { updatedAt: string; source: string; modelCount: number } {
  const bank = loadPricebank();
  return { updatedAt: bank.updatedAt, source: bank.source, modelCount: bank.auto.length };
}
