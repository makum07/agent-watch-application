import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { getSources } from '@/lib/sources';
import { getDatabase } from '@/lib/db/database';

/**
 * Resolve the active source for a request with no session to scan by
 * (session-less catalogs like skills). Priority: ?source= param → aw-source
 * cookie. Unlike resolveSessionSource, there's nothing to fall back to
 * scanning — callers get whichever source is active, same as the home page.
 */
export async function resolveSourceFromRequest(req: NextRequest): Promise<string | undefined> {
  const paramSource = req.nextUrl.searchParams.get('source') ?? undefined;
  if (paramSource) return paramSource;
  const cookieStore = await cookies();
  return cookieStore.get('aw-source')?.value ?? undefined;
}

/**
 * Resolve which source a session belongs to.
 * Priority: ?source= param → aw-source cookie → scan all source DBs.
 */
export async function resolveSessionSource(req: NextRequest, sessionId: string): Promise<string | undefined> {
  const paramSource = req.nextUrl.searchParams.get('source') ?? undefined;
  const cookieStore = await cookies();
  const cookieSource = cookieStore.get('aw-source')?.value ?? undefined;

  const candidate = paramSource ?? cookieSource;

  // Fast path: session exists in candidate source DB
  try {
    const db = getDatabase(candidate);
    const row = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(sessionId);
    if (row) return candidate;
  } catch {}

  // Scan all sources
  for (const src of getSources()) {
    if (src.id === candidate) continue;
    try {
      const db = getDatabase(src.id);
      const row = db.prepare('SELECT 1 FROM conversations WHERE id = ?').get(sessionId);
      if (row) return src.id;
    } catch {}
  }

  return candidate;
}
