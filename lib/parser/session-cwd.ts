import fs from 'fs';

// Session JSONL transcripts can lead with several metadata lines
// (last-prompt, mode, permission-mode, hook attachments) before the first
// turn that carries a "cwd" field — 64KB comfortably covers that preamble.
const CWD_SCAN_BYTES = 65536;

export function readCwdFromJsonl(filePath: string): string | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(CWD_SCAN_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, CWD_SCAN_BYTES, 0);
    fs.closeSync(fd);
    const chunk = buf.toString('utf8', 0, bytesRead);
    const match = chunk.match(/"cwd"\s*:\s*"([^"]+)"/);
    if (match) return match[1].replace(/\\\\/g, '\\');
  } catch { /* non-fatal */ }
  return null;
}
