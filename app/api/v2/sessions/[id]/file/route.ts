import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db/database';
import { resolveSessionSource } from '@/lib/api/resolve-source';
import { readCwdFromJsonl } from '@/lib/parser/session-cwd';
import { toAccessiblePath } from '@/lib/sources';
import { findExternalSkillDirsFromSession } from '@/lib/services/external-dirs';
import path from 'path';
import fs from 'fs';

function resolveSessionPaths(sessionId: string, sourceId?: string): { projectCwd: string; externalDirs: string[] } {
  const db = getDatabase(sourceId);
  try {
    const conv = db.prepare('SELECT file_path FROM conversations WHERE id = ?').get(sessionId) as { file_path: string } | undefined;
    if (conv?.file_path && fs.existsSync(conv.file_path)) {
      const cwd = readCwdFromJsonl(conv.file_path) ?? process.cwd();
      // Cross-project improvement cycles are legitimately granted --add-dir
      // access to skill/agent directories outside the project cwd (see
      // findExternalSkillDirsFromSession) — the file viewer needs the same
      // allowlist, or clicking a touched file outside the project 403s even
      // though the cycle itself was allowed to read and edit it.
      const externalDirs = findExternalSkillDirsFromSession(conv.file_path, cwd);
      return { projectCwd: cwd, externalDirs };
    }
  } catch { /* fall back to server cwd */ }
  return { projectCwd: process.cwd(), externalDirs: [] };
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
    const { projectCwd: rawProjectCwd, externalDirs: rawExternalDirs } = resolveSessionPaths(sessionId, sourceId);
    const projectCwd = toAccessiblePath(rawProjectCwd, sourceId);
    const externalDirs = rawExternalDirs.map(d => toAccessiblePath(d, sourceId));
    const accessibleFilePath = toAccessiblePath(filePath, sourceId);
    const abs = path.isAbsolute(accessibleFilePath) ? accessibleFilePath : path.join(projectCwd, accessibleFilePath);

    // Security: ensure the resolved path is within the project directory, or
    // one of the external skill/agent directories this session was granted
    // access to (cross-project improvement cycles legitimately read/edit
    // those — see findExternalSkillDirsFromSession).
    const resolved = path.resolve(abs);
    const resolvedCwd = path.resolve(projectCwd);
    const allowedRoots = [resolvedCwd, ...externalDirs.map(d => path.resolve(d))];
    if (!allowedRoots.some(root => resolved.startsWith(root))) {
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
