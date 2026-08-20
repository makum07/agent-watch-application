import { NextRequest, NextResponse } from 'next/server';
import { getProjectContextFile, deleteProjectContextFile } from '@/lib/services/project-context';
import { resolveSourceFromRequest } from '@/lib/api/resolve-source';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    const file = getProjectContextFile(fileId, sourceId);
    if (!file) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    return NextResponse.json({ filename: file.filename, extractedText: file.extractedText });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;
    const sourceId = await resolveSourceFromRequest(req);
    deleteProjectContextFile(fileId, sourceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
