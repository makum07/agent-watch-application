import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { resolveSessionSource } from '@/lib/api/resolve-source';
import { readCwdFromJsonl } from '@/lib/parser/session-cwd';
import { toAccessiblePath } from '@/lib/sources';
import path from 'path';
import fs from 'fs';

function resolveProjectCwd(sessionId: string, sourceId?: string): string {
  const db = getDatabase(sourceId);
  try {
    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
    if (conv?.file_path && fs.existsSync(conv.file_path)) {
      const cwd = readCwdFromJsonl(conv.file_path);
      if (cwd) return cwd;
    }
  } catch { /* fall back to server cwd */ }
  return process.cwd();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const filePath = req.nextUrl.searchParams.get('path');
    if (!filePath) {
      return NextResponse.json({ error: 'Missing ?path= parameter' }, { status: 400 });
    }

    const sourceId = await resolveSessionSource(req, sessionId);
    const projectCwd = toAccessiblePath(resolveProjectCwd(sessionId, sourceId), sourceId);
    const accessibleFilePath = toAccessiblePath(filePath, sourceId);
    const abs = path.isAbsolute(accessibleFilePath) ? accessibleFilePath : path.join(projectCwd, accessibleFilePath);

    // Security: ensure the resolved path is within the project directory
    const resolved = path.resolve(abs);
    const resolvedCwd = path.resolve(projectCwd);
    if (!resolved.startsWith(resolvedCwd)) {
      return NextResponse.json({ error: 'Path outside project directory' }, { status: 403 });
    }

    if (!fs.existsSync(resolved)) {
      return NextResponse.json({ error: 'File not found', path: filePath }, { status: 404 });
    }

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return NextResponse.json({ error: 'Path is a directory' }, { status: 400 });
    }

    // Cap at 500KB to avoid huge payloads
    if (stat.size > 500_000) {
      return NextResponse.json({
        error: 'File too large to display',
        size: stat.size,
        path: filePath,
      }, { status: 413 });
    }

    const content = fs.readFileSync(resolved, 'utf8');
    const ext = path.extname(resolved).slice(1).toLowerCase();

    return NextResponse.json({ content, path: filePath, size: stat.size, ext });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
