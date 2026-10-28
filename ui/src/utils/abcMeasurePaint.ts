// abcMeasurePaint.ts — draw the deterministic bar audit on a rendered abcjs SVG.
//
// The audit itself is pure arithmetic (abcMeasureAudit.ts); this file only
// maps its bar numbers to the elements abcjs just drew. It adds a coloured
// underline below each flagged bar and a small note badge above it, both with
// a tooltip. Bars with no rendered notes (a chord-only bar) have nothing to
// underline and are left to the list panel.

import { beatCount, formatBeats, issuesByBar, measureIssueText, type MeasureAudit, type MeasureIssue, type MeasureIssueKind } from './abcMeasureAudit';

interface RenderedItem {
  startChar?: number;
  abselem?: { elemset?: Array<SVGElement | null> };
}
interface RenderedTune {
  lines?: Array<{ staff?: Array<{ voices?: RenderedItem[][] }> }>;
}

const TONE: Record<MeasureIssueKind, string> = {
  short: '#d97706',      // amber-600: timing short
  long: '#d97706',       // amber-600: timing over
  empty: '#7c3aed',      // violet-600: no notes
  unreadable: '#dc2626', // red-600: cannot measure
};
const SEVERITY: MeasureIssueKind[] = ['unreadable', 'short', 'long', 'empty'];
const worstKind = (issues: { kind: MeasureIssueKind }[]): MeasureIssueKind =>
  SEVERITY.find(kind => issues.some(issue => issue.kind === kind)) ?? 'short';

const NS = 'http://www.w3.org/2000/svg';
const known = (node: SVGElement | null): node is SVGElement => !!node;

interface Box { x: number; y: number; width: number; height: number }

/** One element's box in the SVG root's user coordinates. abcjs draws each
 *  system inside a translated `<g>`, so getBBox alone would put the overlay on
 *  the first system's origin. The screen matrices carry every ancestor
 *  transform, including the root's viewBox. */
function rootBox(node: SVGElement, svg: SVGSVGElement): Box | null {
  const element = node as SVGGraphicsElement;
  if (typeof element.getBBox !== 'function') return null;
  try {
    const b = element.getBBox();
    if (b.width <= 0 && b.height <= 0) return null;
    const root = svg.getScreenCTM?.();
    const own = element.getScreenCTM?.();
    const ctm = root && own ? root.inverse().multiply(own)
      : typeof element.getCTM === 'function' ? element.getCTM() : null;
    if (!ctm) return { x: b.x, y: b.y, width: b.width, height: b.height };
    const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
      .map(([x, y]) => new DOMPoint(x, y).matrixTransform(ctm));
    const xs = corners.map(point => point.x), ys = corners.map(point => point.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
  } catch { return null; }
}

/** Add the overlay to a score abcjs just rendered. `audit` must describe the
 *  same text that was rendered: its bar ranges are character offsets into it.
 *  Safe to call repeatedly: the caller clears the host before rendering. */
export function paintMeasureIssues(
  tune: unknown,
  host: HTMLElement | null,
  audit: MeasureAudit | null,
): void {
  if (!tune || !host || !audit || !audit.issues.length) return;
  const rendered = tune as RenderedTune;
  const { ranges } = audit;
  const svg = host.querySelector('svg');
  if (!ranges.length || !svg) return;

  const barOfChar = (char: number | undefined) => char === undefined ? null
    : ranges.find(range => char >= range.start && char <= range.end)?.bar ?? null;

  const nodesByBar = new Map<number, SVGElement[]>();
  for (const line of rendered.lines ?? [])
    for (const staff of line.staff ?? [])
      for (const voice of (staff.voices ?? []) as RenderedItem[][])
        for (const item of voice) {
          const bar = barOfChar(item.startChar);
          if (bar === null) continue;
          const nodes = (item.abselem?.elemset ?? []).filter(known);
          if (!nodes.length) continue;
          const list = nodesByBar.get(bar) ?? [];
          list.push(...nodes);
          nodesByBar.set(bar, list);
        }

  for (const [bar, issues] of issuesByBar(audit)) {
    const nodes = nodesByBar.get(bar);
    if (!nodes?.length) continue;
    const boxes = nodes.map(node => rootBox(node, svg)).filter((box): box is Box => box !== null);
    if (!boxes.length) continue;

    const kind = worstKind(issues);
    const tone = TONE[kind];
    const minX = Math.min(...boxes.map(box => box.x));
    const maxX = Math.max(...boxes.map(box => box.x + box.width));
    const minY = Math.min(...boxes.map(box => box.y));
    const maxY = Math.max(...boxes.map(box => box.y + box.height));

    const group = document.createElementNS(NS, 'g');
    group.setAttribute('class', `abcjs-measure-issue abcjs-measure-issue-${kind}`);
    group.setAttribute('data-abc-bar', String(bar));

    const primary = issues.find(issue => issue.kind === kind) ?? issues[0];
    const reason = issues.map(issue => measureIssueText(issue)).join(' · ');
    const title = document.createElementNS(NS, 'title');
    title.textContent = reason;
    group.append(title);
    group.setAttribute('role', 'img');
    group.setAttribute('aria-label', reason);

    const underline = document.createElementNS(NS, 'line');
    Object.entries({
      x1: minX - 1, x2: maxX + 1, y1: maxY + 3, y2: maxY + 3,
      stroke: tone, 'stroke-width': 2.5, 'stroke-linecap': 'round',
    }).forEach(([key, value]) => underline.setAttribute(key, String(value)));
    group.append(underline);

    const badgeY = Math.max(9, minY - 6);
    const badge = document.createElementNS(NS, 'g');
    badge.setAttribute('transform', `translate(${minX + 5} ${badgeY})`);
    const circle = document.createElementNS(NS, 'circle');
    Object.entries({ r: 6.5, fill: tone, stroke: '#ffffff', 'stroke-width': 1 }).forEach(([key, value]) =>
      circle.setAttribute(key, String(value)));
    const glyph = document.createElementNS(NS, 'text');
    Object.entries({
      x: 0, y: 0, fill: '#ffffff', 'font-size': 8.5, 'font-weight': 700,
      'text-anchor': 'middle', 'dominant-baseline': 'central',
    }).forEach(([key, value]) => glyph.setAttribute(key, String(value)));
    glyph.textContent = kind === 'unreadable' ? '!' : '♪';
    badge.append(circle, glyph);
    group.append(badge);

    // The short reason sits beside the badge, so the score itself says why the
    // bar is flagged without needing a hover.
    const label = document.createElementNS(NS, 'text');
    Object.entries({
      x: minX + 14, y: badgeY, fill: tone, 'font-size': 7.5, 'font-weight': 600,
      'dominant-baseline': 'central', 'paint-order': 'stroke', stroke: '#ffffff',
      'stroke-width': 2, 'stroke-linejoin': 'round',
    }).forEach(([key, value]) => label.setAttribute(key, String(value)));
    label.textContent = shortReason(primary);
    group.append(label);

    // A short bar stops before its meter does. Mark that point on the right,
    // where the missing timing would have continued.
    let gapLabel: SVGTextElement | null = null;
    if (primary.kind === 'short' && primary.gapBeat !== undefined) {
      const stop = document.createElementNS(NS, 'line');
      Object.entries({
        x1: maxX + 1, x2: maxX + 1, y1: minY, y2: maxY + 3,
        stroke: tone, 'stroke-width': 1.5, 'stroke-dasharray': '2 2',
      }).forEach(([key, value]) => stop.setAttribute(key, String(value)));
      group.append(stop);

      const where = document.createElementNS(NS, 'text');
      Object.entries({
        x: maxX - 1, y: badgeY, fill: tone, 'font-size': 7.5, 'font-weight': 600,
        'text-anchor': 'end', 'dominant-baseline': 'central',
        'paint-order': 'stroke', stroke: '#ffffff', 'stroke-width': 2, 'stroke-linejoin': 'round',
      }).forEach(([key, value]) => where.setAttribute(key, String(value)));
      where.textContent = `from beat ${formatBeats(primary.gapBeat)}`;
      group.append(where);
      gapLabel = where;
    }

    // Labels must never spill into the neighbouring bar or off the SVG. Drop
    // the words when the bar is too narrow; the badge and its tooltip remain.
    let gapWidth = gapLabel ? textWidth(gapLabel) : 0;
    if (gapLabel && gapWidth > 0 && maxX - 1 - gapWidth < minX + 2) {
      gapLabel.remove();
      gapLabel = null;
      gapWidth = 0;
    }
    const leftLimit = gapLabel ? maxX - 1 - gapWidth - 4 : maxX - 1;
    const labelWidth = textWidth(label);
    if (labelWidth > 0 && minX + 14 + labelWidth > leftLimit) label.remove();

    svg.append(group);
  }
}

/** Rendered text width, or 0 when the DOM cannot measure (tests, no layout). */
function textWidth(node: SVGTextElement): number {
  try { return node.getComputedTextLength(); } catch { return 0; }
}

/** The smallest true statement about a flag, for the on-score label. */
function shortReason(issue: MeasureIssue): string {
  const beats = formatBeats(beatCount(issue.missing, issue.meter));
  switch (issue.kind) {
    case 'short': return `missing ${beats}`;
    case 'long': return `over ${beats}`;
    case 'empty': return 'no notes';
    case 'unreadable': return 'unreadable';
  }
}
