import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import path from 'path';
import fs from 'fs';

function encodePathToSlug(p: string): string {
  return p.replace(/^([A-Za-z]):\\/, '$1--').replace(/[\\/ ]/g, '-');
}

function findProjectDirBySlug(slug: string): string | null {
  const m = slug.match(/^([A-Za-z])--Users-([^-]+)-/);
  if (!m) return null;
  const drive = m[1].toUpperCase();
  const username = m[2];
  const startDir = path.join(`${drive}:`, 'Users', username);

  function search(dir: string, depth: number): string | null {
    if (depth <= 0) return null;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return null; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      const encoded = encodePathToSlug(full);
      if (encoded === slug) return full;
      if (slug.startsWith(encoded + '-')) {
        const hit = search(full, depth - 1);
        if (hit) return hit;
      }
    }
    return null;
  }

  return search(startDir, 6);
}

function resolveProjectCwd(sessionId: string): string {
  const db = getDatabase();
  let projectCwd = process.cwd();
  try {
    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
    if (conv?.file_path) {
      const slug = path.basename(path.dirname(conv.file_path));
      const found = findProjectDirBySlug(slug);
      if (found) projectCwd = found;
    }
  } catch { /* fall back to server cwd */ }
  return projectCwd;
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

    const projectCwd = resolveProjectCwd(sessionId);
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
