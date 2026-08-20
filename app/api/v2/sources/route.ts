import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { getSources, addCustomSource, isRemovableSource } from '@/lib/sources';

export async function GET() {
  const sources = getSources().map(s => ({
    id: s.id,
    label: s.label,
    path: s.path,
    available: fs.existsSync(s.path),
    removable: isRemovableSource(s.id),
  }));
  return NextResponse.json({ sources });
}

export async function POST(req: NextRequest) {
  try {
    const { label, path } = await req.json();
    if (typeof label !== 'string' || typeof path !== 'string') {
      return NextResponse.json({ error: 'label and path are required' }, { status: 400 });
    }
    const updated = addCustomSource(label, path);
    const sources = updated.map(s => ({
      id: s.id,
      label: s.label,
      path: s.path,
      available: fs.existsSync(s.path),
      removable: isRemovableSource(s.id),
    }));
    return NextResponse.json({ sources });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
