import fs from 'fs';
import path from 'path';
import { loadPricebank, PRICEBANK_PATH, type ModelPricing } from '@/lib/pricing/pricebank';

const LITELLM_PRICING_URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const FETCH_TIMEOUT_MS = 10_000;

interface LiteLlmEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
}

// Only plain direct-Anthropic-API model ids (e.g. "claude-opus-4-1-20250805") —
// excludes Bedrock/Vertex/gateway-prefixed and region-suffixed variants, which
// carry different (marked-up) per-provider rates than what Claude Code itself reports.
function isDirectApiClaudeKey(key: string): boolean {
  return /^claude-/i.test(key) && !/anthropic\.|bedrock|vertex_ai|@|:/.test(key);
}

function toModelPricing(entry: LiteLlmEntry): ModelPricing | null {
  if (typeof entry.input_cost_per_token !== 'number' || typeof entry.output_cost_per_token !== 'number') {
    return null;
  }
  const input = entry.input_cost_per_token * 1_000_000;
  const output = entry.output_cost_per_token * 1_000_000;
  return {
    input,
    output,
    // Anthropic's docs put 5-minute cache writes at 1.25x input and cache reads at 0.1x
    // input when a model's exact rate isn't listed — used as a fallback only.
    cacheWrite: (entry.cache_creation_input_token_cost ?? entry.input_cost_per_token * 1.25) * 1_000_000,
    cacheRead: (entry.cache_read_input_token_cost ?? entry.input_cost_per_token * 0.1) * 1_000_000,
  };
}

export interface PricingSyncResult {
  ok: boolean;
  updatedAt?: string;
  modelCount?: number;
  error?: string;
}

/**
 * Fetches current Claude model pricing from LiteLLM's community-maintained pricing
 * database and refreshes the `auto` (exact-model-id) layer of the local pricebank,
 * leaving the hand-curated fallback patterns and default rate untouched.
 */
export async function syncModelPricing(): Promise<PricingSyncResult> {
  try {
    const res = await fetch(LITELLM_PRICING_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} fetching pricing data` };

    const data = await res.json() as Record<string, LiteLlmEntry>;
    const auto: Array<[string, ModelPricing]> = [];
    for (const [key, entry] of Object.entries(data)) {
      if (!isDirectApiClaudeKey(key)) continue;
      const pricing = toModelPricing(entry);
      if (pricing) auto.push([key, pricing]);
    }

    if (auto.length === 0) {
      return { ok: false, error: 'No Claude model entries found in fetched pricing data' };
    }

    // Preserve the existing curated fallback + default — sync only ever replaces `auto`.
    const existing = loadPricebank();
    const updatedAt = new Date().toISOString();
    const bank = { updatedAt, source: 'litellm', auto, curated: existing.curated, default: existing.default };

    fs.mkdirSync(path.dirname(PRICEBANK_PATH), { recursive: true });
    fs.writeFileSync(PRICEBANK_PATH, JSON.stringify(bank, null, 2));

    return { ok: true, updatedAt, modelCount: auto.length };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
