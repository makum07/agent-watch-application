import { syncModelPricing } from '../lib/services/pricing-sync';

syncModelPricing().then((result) => {
  if (result.ok) {
    console.log(`✓ Synced pricing for ${result.modelCount} Claude model(s) at ${result.updatedAt}`);
    process.exit(0);
  } else {
    console.error(`✖ Pricing sync failed: ${result.error}`);
    process.exit(1);
  }
});
