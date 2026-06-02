import { NextRequest, NextResponse } from 'next/server';
import { setPreference } from '@/lib/services/preferences';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const { value } = await req.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setPreference(key as any, value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
