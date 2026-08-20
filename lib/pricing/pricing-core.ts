// Pure, environment-agnostic pricing logic — no `fs`/`path`, safe to bundle for
// the browser. Server code should prefer `@/lib/pricing/pricebank`, which layers
// the live-synced pricebank on top of this same baseline; this module exists so
// client components that recompute cost in the browser (comparison views, export
// menus, etc.) have something to import that doesn't drag `fs` into the client bundle.
import defaultBank from './default-pricing.json';

export interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface Pricebank {
  updatedAt: string;
  source: string;
  auto: Array<[string, ModelPricing]>;
  curated: Array<[string, ModelPricing]>;
  default: ModelPricing;
}

export const DEFAULT_PRICEBANK: Pricebank = defaultBank as unknown as Pricebank;

export function resolvePricing(bank: Pricebank, model: string): ModelPricing {
  const m = model.toLowerCase();
  for (const [pattern, pricing] of bank.auto) {
    if (m.includes(pattern.toLowerCase())) return pricing;
  }
  for (const [pattern, pricing] of bank.curated) {
    if (m.includes(pattern.toLowerCase())) return pricing;
  }
  return bank.default;
}

export function calculateCost(bank: Pricebank, usage: {
  input: number; output: number; cacheCreation: number; cacheRead: number;
}, model: string): number {
  const p = resolvePricing(bank, model);
  return (
    usage.input         * p.input      / 1_000_000 +
    usage.output        * p.output     / 1_000_000 +
    usage.cacheCreation * p.cacheWrite / 1_000_000 +
    usage.cacheRead     * p.cacheRead  / 1_000_000
  );
}

/**
 * Client-safe cost estimate using the pricebank that was bundled at build time
 * (no live-synced `auto` layer — see `estimateAgentCost` in `@/lib/pricing/pricebank`
 * for the server-side version that includes it). Good enough for interactive
 * client-side views; ingestion and analytics always go through the server version.
 */
export function estimateAgentCost(usage: {
  input: number; output: number; cacheCreation: number; cacheRead: number;
}, model: string): number {
  return calculateCost(DEFAULT_PRICEBANK, usage, model);
}
