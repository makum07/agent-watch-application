import { NextResponse } from 'next/server';
import fs from 'fs';
import { removeCustomSource, isRemovableSource } from '@/lib/sources';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!isRemovableSource(id)) {
      return NextResponse.json({ error: 'This source is not removable' }, { status: 400 });
    }
    const updated = removeCustomSource(id);
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
