// Export the agent/session hierarchy exactly as rendered in the sidebar
// (respecting order + expand/collapse state). Pure, framework-agnostic helpers —
// the caller builds the ExportNode tree from whatever it currently shows.

export interface ExportNode {
  id: string;
  label: string;            // what the UI displays for this node
  meta?: string;            // secondary data (model · tokens · duration · status)
  color?: string;           // accent color (hex) used in the PNG
  collapsed?: boolean;      // had children but is collapsed in the UI
  hiddenChildCount?: number;// descendants hidden because of the collapse
  children: ExportNode[];   // empty when collapsed
}

interface ExportLine {
  prefix: string;           // box-drawing indentation, e.g. "│   ├── "
  label: string;
  meta?: string;
  suffix: string;           // collapse marker, e.g. " (+4)"
  color?: string;
}

function collapseSuffix(n: ExportNode): string {
  return n.collapsed && n.hiddenChildCount ? ` (+${n.hiddenChildCount})` : '';
}

const META_SEP = '  —  ';

/** Flatten the tree into rendered lines with ├──/└──/│ prefixes (root has none). */
function flattenLines(root: ExportNode): ExportLine[] {
  const lines: ExportLine[] = [
    { prefix: '', label: root.label, meta: root.meta, suffix: collapseSuffix(root), color: root.color },
  ];
  const walk = (node: ExportNode, prefix: string) => {
    node.children.forEach((child, i) => {
      const last = i === node.children.length - 1;
      lines.push({
        prefix: prefix + (last ? '└── ' : '├── '),
        label: child.label,
        meta: child.meta,
        suffix: collapseSuffix(child),
        color: child.color,
      });
      walk(child, prefix + (last ? '    ' : '│   '));
    });
  };
  walk(root, '');
  return lines;
}

function lineText(l: ExportLine): string {
  return l.prefix + l.label + (l.meta ? META_SEP + l.meta : '') + l.suffix;
}

/** Tree-structured plain text, ready to paste into prompts / docs / emails. */
export function hierarchyToText(root: ExportNode): string {
  return flattenLines(root).map(lineText).join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SvgResult { svg: string; width: number; height: number; }

/** Render the same hierarchy as a self-contained SVG (dark theme to match the app). */
export function hierarchyToSvg(root: ExportNode, title?: string): SvgResult {
  const lines = flattenLines(root);

  const PAD = 24;
  const FONT = 14;
  const CHAR_W = FONT * 0.6;     // monospace advance width
  const ROW_H = 24;
  const TITLE_H = title ? 34 : 0;

  const lineLen = (l: ExportLine) =>
    l.prefix.length + l.label.length + (l.meta ? META_SEP.length + l.meta.length : 0) + l.suffix.length;
  const maxChars = lines.reduce((m, l) => Math.max(m, lineLen(l)), 0);
  const width = Math.ceil(PAD * 2 + Math.max(maxChars * CHAR_W, title ? title.length * 8 : 0));
  const height = Math.ceil(PAD * 2 + TITLE_H + lines.length * ROW_H);

  const rows = lines.map((l, i) => {
    const y = PAD + TITLE_H + i * ROW_H + FONT;
    const prefix = escapeXml(l.prefix);
    const label = escapeXml(l.label);
    const labelColor = l.color || '#e6edf3';
    const metaSpan = l.meta
      ? `<tspan fill="#6e7681">${escapeXml(META_SEP + l.meta)}</tspan>`
      : '';
    const suffixSpan = l.suffix ? `<tspan fill="#6e7681">${escapeXml(l.suffix)}</tspan>` : '';
    return (
      `<text x="${PAD}" y="${y}" xml:space="preserve" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${FONT}">` +
      `<tspan fill="#586069">${prefix}</tspan>` +
      `<tspan fill="${labelColor}" font-weight="600">${label}</tspan>` +
      metaSpan +
      suffixSpan +
      `</text>`
    );
  }).join('');

  const titleEl = title
    ? `<text x="${PAD}" y="${PAD + 18}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="16" font-weight="700" fill="#e6edf3">${escapeXml(title)}</text>`
    : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>` +
    titleEl +
    rows +
    `</svg>`;

  return { svg, width, height };
}

// ─── Flow Diagram Export ────────────────────────────────────────────────────

export interface FlowDiagramNode {
  x: number;
  y: number;
  label: string;
  initials: string;
  meta: string;
  colorBg: string;
  colorText: string;
  colorBorder: string;
  statusHex: string;
  childCount: number;
  isRoot: boolean;
}

export interface FlowDiagramEdge {
  x1: number; y1: number;
  x2: number; y2: number;
}

export interface FlowDiagramTheme {
  canvasBg: string;
  nodeBg: string;
  textPrimary: string;
  textMuted: string;
  edgeColor: string;
  dotColor: string;
}

const FD_NODE_W = 148;
const FD_NODE_H = 44;
const FD_PAD = 32;

export function flowDiagramToSvg(
  nodes: FlowDiagramNode[],
  edges: FlowDiagramEdge[],
  theme: FlowDiagramTheme,
  title?: string,
): SvgResult {
  const TITLE_H = title ? 40 : 0;
  const maxX = nodes.length ? Math.max(...nodes.map(n => n.x + FD_NODE_W)) : 400;
  const maxY = nodes.length ? Math.max(...nodes.map(n => n.y + FD_NODE_H)) : 200;
  const width = Math.ceil(maxX + FD_PAD * 2);
  const height = Math.ceil(maxY + FD_PAD * 2 + TITLE_H + 16);

  const font = 'ui-sans-serif, system-ui, -apple-system, sans-serif';
  const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  svg += `<rect width="${width}" height="${height}" rx="10" fill="${theme.canvasBg}"/>`;

  svg += `<defs><pattern id="fd-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.6" fill="${theme.dotColor}"/></pattern></defs>`;
  svg += `<rect width="${width}" height="${height}" fill="url(#fd-dots)"/>`;

  if (title) {
    svg += `<text x="${FD_PAD}" y="${FD_PAD + 20}" font-family="${font}" font-size="16" font-weight="700" fill="${theme.textPrimary}">${escapeXml(title)}</text>`;
  }

  const ox = FD_PAD;
  const oy = FD_PAD + TITLE_H;

  for (const e of edges) {
    const x1 = ox + e.x1, y1 = oy + e.y1, x2 = ox + e.x2, y2 = oy + e.y2;
    const midY = (y1 + y2) / 2;
    svg += `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" fill="none" stroke="${theme.edgeColor}" stroke-width="1" opacity="0.6"/>`;
  }

  for (const n of nodes) {
    const nx = ox + n.x, ny = oy + n.y;

    if (n.isRoot) {
      svg += `<rect x="${nx - 2}" y="${ny - 2}" width="${FD_NODE_W + 4}" height="${FD_NODE_H + 4}" rx="10" fill="none" stroke="${n.colorText}" stroke-width="0.5" opacity="0.3"/>`;
    }

    svg += `<rect x="${nx}" y="${ny}" width="${FD_NODE_W}" height="${FD_NODE_H}" rx="8" fill="${theme.nodeBg}" stroke="${n.colorBorder}" stroke-width="1"/>`;

    const ax = nx + 10, ay = ny + 10;
    svg += `<rect x="${ax}" y="${ay}" width="24" height="24" rx="5" fill="${n.colorBg}" stroke="${n.colorBorder}" stroke-width="0.5"/>`;
    svg += `<text x="${ax + 12}" y="${ay + 16}" text-anchor="middle" font-family="${font}" font-size="9" font-weight="700" fill="${n.colorText}">${escapeXml(n.initials)}</text>`;

    const lx = nx + 40;
    const truncLabel = n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label;
    svg += `<text x="${lx}" y="${ny + 19}" font-family="${font}" font-size="11" font-weight="600" fill="${theme.textPrimary}">${escapeXml(truncLabel)}</text>`;
    svg += `<text x="${lx}" y="${ny + 32}" font-family="${mono}" font-size="9" fill="${theme.textMuted}">${escapeXml(n.meta)}</text>`;

    svg += `<circle cx="${nx + FD_NODE_W - 10}" cy="${ny + FD_NODE_H / 2}" r="3" fill="${n.statusHex}"/>`;

    if (n.childCount > 0) {
      const bcx = nx + FD_NODE_W / 2, bcy = ny + FD_NODE_H + 4;
      svg += `<rect x="${bcx - 10}" y="${bcy - 6}" width="20" height="12" rx="6" fill="${n.colorBg}" stroke="${n.colorBorder}" stroke-width="0.5"/>`;
      svg += `<text x="${bcx}" y="${bcy + 3}" text-anchor="middle" font-family="${font}" font-size="8" font-weight="700" fill="${n.colorText}">${n.childCount}</text>`;
    }
  }

  svg += '</svg>';
  return { svg, width, height };
}

/** Resolve any CSS color (var(), oklch, etc.) to a hex string via the browser. */
export function resolveColor(cssValue: string): string {
  if (typeof document === 'undefined') return cssValue;
  const el = document.createElement('span');
  document.body.appendChild(el);
  el.style.color = cssValue;
  const computed = getComputedStyle(el).color;
  el.remove();
  const match = computed.match(/rgba?\((\d+),?\s*(\d+),?\s*(\d+)/);
  if (match) {
    return '#' + [match[1], match[2], match[3]]
      .map(n => parseInt(n).toString(16).padStart(2, '0'))
      .join('');
  }
  return computed || cssValue;
}

/** Rasterize an SVG string to a PNG Blob at the given pixel scale (for crispness). */
export function svgToPngBlob(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(width * scale);
        canvas.height = Math.ceil(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) { URL.revokeObjectURL(url); reject(new Error('no 2d context')); return; }
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('svg load failed')); };
    img.src = url;
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
