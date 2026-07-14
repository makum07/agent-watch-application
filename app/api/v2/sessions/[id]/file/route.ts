import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { resolveSessionSource } from '@/lib/api/resolve-source';
import path from 'path';
import fs from 'fs';

function resolveProjectCwd(sessionId: string, sourceId?: string): string {
  const db = getDatabase(sourceId);
  try {
    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
    if (conv?.file_path && fs.existsSync(conv.file_path)) {
      const fd = fs.openSync(conv.file_path, 'r');
      const buf = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      const chunk = buf.toString('utf8', 0, bytesRead);
      const match = chunk.match(/"cwd"\s*:\s*"([^"]+)"/);
      if (match) return match[1].replace(/\\\\/g, '\\');
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
    const projectCwd = resolveProjectCwd(sessionId, sourceId);
    const abs = path.isAbsolute(filePath) ? filePath : path.join(projectCwd, filePath);

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
