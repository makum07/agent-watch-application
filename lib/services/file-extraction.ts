import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export const CONTEXT_FILE_MIME_TYPES: Record<string, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

export const MAX_CONTEXT_FILE_SIZE = 25 * 1024 * 1024;

export class FileExtractionError extends Error {}

function getExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('richText' in value) return (value.richText as Array<{ text: string }>).map(r => r.text).join('');
    if ('text' in value) return String((value as { text: unknown }).text);
    if ('result' in value) return String((value as { result: unknown }).result ?? '');
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value);
  }
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new FileExtractionError('Could not read this file as an Excel workbook — it may be corrupt or password-protected.');
  }

  const sections: string[] = [];
  workbook.eachSheet(sheet => {
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, row => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, cell => cells.push(cellText(cell.value)));
      rows.push(cells);
    });
    if (rows.length === 0) return;

    // A merged single-cell title banner above the real header (common in
    // report-style sheets) has a different column count than the actual
    // table — using row 1 as-is would make GFM tables silently drop every
    // cell beyond that banner's width. Use the most common row width as the
    // table's shape; narrower rows (banners/captions) render as plain text.
    const widthCounts = new Map<number, number>();
    for (const r of rows) widthCounts.set(r.length, (widthCounts.get(r.length) ?? 0) + 1);
    const tableWidth = [...widthCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const lines = [`### Sheet: ${sheet.name}`, ''];
    let header: string[] | null = null;
    for (const r of rows) {
      if (r.length !== tableWidth) {
        lines.push(r.join(' ').trim());
        continue;
      }
      if (!header) {
        header = r;
        lines.push('', `| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`);
      } else {
        lines.push(`| ${r.join(' | ')} |`);
      }
    }
    sections.push(lines.join('\n'));
  });

  if (sections.length === 0) {
    throw new FileExtractionError('This Excel file has no readable rows.');
  }
  return sections.join('\n\n');
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new FileExtractionError('Could not read this file as a PowerPoint document — it may be corrupt.');
  }

  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)![1]);
      const nb = Number(b.match(/slide(\d+)\.xml$/)![1]);
      return na - nb;
    });

  if (slideFiles.length === 0) {
    throw new FileExtractionError('This file is not a valid PowerPoint (.pptx) document.');
  }

  const sections: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string');
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decodeXmlEntities(m[1]));
    const slideText = texts.join(' ').replace(/\s+/g, ' ').trim();
    if (slideText) sections.push(`### Slide ${i + 1}\n\n${slideText}`);
  }

  if (sections.length === 0) {
    throw new FileExtractionError('No text could be found on any slide in this file.');
  }
  return sections.join('\n\n');
}

export async function extractContextFileText(
  filename: string,
  buffer: Buffer
): Promise<{ text: string; mimeType: string }> {
  const ext = getExtension(filename);
  const mimeType = CONTEXT_FILE_MIME_TYPES[ext];
  if (!mimeType) {
    throw new FileExtractionError('Only .xlsx, .pptx, .md, and .txt files are supported.');
  }

  if (ext === '.md' || ext === '.txt') {
    const text = buffer.toString('utf8').trim();
    if (!text) {
      throw new FileExtractionError('This file has no readable text.');
    }
    return { text, mimeType };
  }

  const isZip = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (!isZip) {
    throw new FileExtractionError('This file is not a valid Office Open XML document.');
  }

  const text = ext === '.xlsx' ? await extractXlsxText(buffer) : await extractPptxText(buffer);
  return { text, mimeType };
}
