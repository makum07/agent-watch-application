import { Suspense } from 'react';
import { CompareClient } from './compare-client';

export const dynamic = 'force-dynamic';

export default function ComparePage() {
  return (
    <Suspense>
      <CompareClient />
    </Suspense>
  );
}
