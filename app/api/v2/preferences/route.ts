import { NextResponse } from 'next/server';
import { getPreferences } from '@/lib/services/preferences';

export async function GET() {
  const prefs = getPreferences();
  return NextResponse.json(prefs);
}
