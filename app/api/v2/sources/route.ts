import { NextResponse } from 'next/server';
import fs from 'fs';
import { getSources } from '@/lib/sources';

export async function GET() {
  const sources = getSources().map(s => ({
    id: s.id,
    label: s.label,
    available: fs.existsSync(s.path),
  }));
  return NextResponse.json({ sources });
}
