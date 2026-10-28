// abcMeasureAudit.ts — deterministic bar-length audit for a YuE2 ABC score.
//
// The planner and the transcriber write bars from note lengths, but nothing
// guarantees a bar adds up to its meter: a dropped note leaves a short bar, a
// doubled length overruns it, and abcjs then draws bar lines where the reader
// does not expect them. This module reads the ABC the same way abcjs does —
// header M:/L:, per-voice body M:/L:, `Z`/`Zn` whole-bar rests, quoted chord
// symbols, inline fields, ties — and reports each bar whose length differs
// from its meter, with the exact amount missing or over.
//
// Everything here is arithmetic on the text: no audio, no timing callbacks and
// no randomness. The same ABC always produces the same report. Tuplets
// (`(3`, `(3:2:3`), broken rhythm (`>`, `>>`, `<`, `<<`) and slurs are measured
// the way abcjs plays them. Notation this reader does not model (voice
// overlays) is reported as unreadable instead of guessed at, so a bar is never
// called short by mistake.

/** Why a bar is flagged. `short`/`long` are timing; `empty` is a bar with no
 *  note or rest at all (often a chord symbol with no duration); `unreadable`
 *  is notation this audit cannot measure. */
export type MeasureIssueKind = 'short' | 'long' | 'empty' | 'unreadable';

export interface MeasureIssue {
  /** 1-based bar number in this voice. Aligned voices share the number. */
  bar: number;
  /** The ABC voice id (`Vocal`, `Ins`, or '' for a single unvoiced tune). */
  voice: string;
  /** The meter in force in this bar, e.g. `4/4`. */
  meter: string;
  /** Whole notes the meter asks for (4/4 -> 1). */
  expected: number;
  /** Whole notes the bar actually holds. */
  actual: number;
  /** `expected - actual`; positive is short, negative is over. */
  missing: number;
  kind: MeasureIssueKind;
  /** The bar contains at least one sounding note (chord-of-notes included). */
  hasNotes: boolean;
  /** Timed note/chord events in the bar (a chord counts once). */
  notes: number;
  /** Timed events including rests (`z`/`x`). */
  events: number;
  /** The bar's ABC text, so the panel can show exactly what was measured. */
  barText: string;
  /** Beat (1-based) where a short bar stops, i.e. where timing is missing. */
  gapBeat?: number;
  /** The token this reader could not measure, for `unreadable`. */
  token?: string;
}

export interface MeasureVoice {
  voice: string;
  /** Bars written in this voice (a `Z4` counts as four). */
  bars: number;
  /** Bars carrying at least one sounding note. */
  soundingBars: number;
  /** The last meter in force in this voice. */
  meter: string;
}

export interface MeasureAudit {
  ok: boolean;
  /** Header meter, for the summary. */
  meter: string;
  /** Header L: as a fraction of a whole note (1/8 -> 0.125). */
  unit: number;
  /** Bars in the reference voice (Vocal when present, else the longest). */
  bars: number;
  voices: MeasureVoice[];
  issues: MeasureIssue[];
  /** Bars where the voices do not have the same number of bars. */
  alignment: Array<{ bar: number; detail: string }>;
  /** Every bar's span in `abc` (abcjs's startChar counts this same text), for
   *  mapping the rendered SVG back to bar numbers. One entry per voice. */
  ranges: Array<{ start: number; end: number; bar: number }>;
}

export type MeasureAuditResult = MeasureAudit | { error: string };

interface VoiceState {
  meter: string;
  /** Default note length in whole notes. */
  unit: number;
}

interface BarScan {
  /** Whole notes the bar holds. */
  duration: number;
  notes: number;
  events: number;
  token?: string;
  /** Meter set at the start of this bar; applies to it and the bars after. */
  meter?: string;
  /** `M:` seen after the bar began; applies to the next bar. */
  nextMeter?: string;
  /** `L:` changed inside the bar; the last value governs following bars. */
  nextUnit?: number;
}

/** `4/4`, `3/4`, `6/8`, `C`, `C|`. */
export function meterOf(text: string): string | null {
  const t = text.trim();
  if (t === 'C') return '4/4';
  if (t === 'C|') return '2/2';
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]), d = Number(m[2]);
  return n > 0 && d > 0 ? `${n}/${d}` : null;
}

/** Whole notes in one bar of `meter`. */
export function wholeNotesOf(meter: string): number {
  const [n, d] = meter.split('/').map(Number);
  return n / d;
}

/** An ABC length token as a multiplier of the default note length. */
function lengthMultiplier(text: string): number | null {
  const m = /^(\d*)(\/*)(\d*)$/.exec(text);
  if (!m) return null;
  const slashes = m[2].length;
  const den = !slashes ? (m[3] ? NaN : 1) : m[3] ? (slashes === 1 ? Number(m[3]) : NaN) : 2 ** slashes;
  const num = Number(m[1] || 1);
  return num > 0 && den > 0 && Number.isInteger(Math.log2(den)) ? num / den : null;
}

/** An `L:` value as a fraction of a whole note. */
function unitOf(text: string): number | null {
  return lengthMultiplier(text.trim().replace(/^1(?=\/)/, ''));
}

/** A length written after a note, chord or rest; absent means one unit. */
function readLength(text: string, at: number): { mult: number; next: number } | null {
  let i = at;
  let digits = '';
  while (i < text.length && /\d/.test(text[i])) digits += text[i++];
  let slashes = 0;
  while (text[i] === '/') { slashes++; i++; }
  let den = '';
  while (i < text.length && /\d/.test(text[i])) den += text[i++];
  if (!digits && !slashes && !den) return { mult: 1, next: at };
  const mult = lengthMultiplier(digits + '/'.repeat(slashes) + den);
  return mult === null ? null : { mult, next: i };
}

/** A bar with no notes or rests at all, e.g. a stray chord symbol. */
function isWholeBarRest(text: string): number | null {
  const bare = text.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').trim();
  const m = /^Z(\d*)$/.exec(bare);
  if (!m) return null;
  return Math.max(1, Number(m[1] || 1));
}

/** abcjs's default "p notes in the time of q" table (`src/parse/abc_parse_music.js`). */
const TUPLET_Q: Record<number, number> = { 2: 3, 3: 2, 4: 3, 5: 2, 6: 2, 7: 2, 8: 3, 9: 2 };

interface Tuplet { factor: number; notes: number; next: number }

/** `(p`, `(p:q`, `(p::r` or `(p:q:r` starting at `at`, read the way abcjs does.
 *  Returns null for a plain slur `(`. */
function readTuplet(text: string, at: number): Tuplet | null {
  const p = Number(text[at + 1]);
  if (!(p >= 2 && p <= 9)) return null;
  let i = at + 2;
  let q = TUPLET_Q[p], r = p;
  if (text[i] === ':') {
    i++;
    if (/[1-9]/.test(text[i] ?? '')) q = Number(text[i++]);
    if (text[i] === ':') {
      i++;
      if (/[1-9]/.test(text[i] ?? '')) r = Number(text[i++]);
    }
  }
  return { factor: q / p, notes: r, next: i };
}

/** Broken rhythm: `>` makes the note before long and the note after short,
 *  `<` the reverse; repeated arrows use 1.75/0.25, 1.875/0.125. */
function readBroken(text: string, at: number): { before: number; after: number; next: number } {
  const mark = text[at];
  let count = 1;
  while (count < 3 && text[at + count] === mark) count++;
  const power = 2 ** count;
  const long = (power * 2 - 1) / power, short = 1 / power;
  return mark === '>'
    ? { before: long, after: short, next: at + count }
    : { before: short, after: long, next: at + count };
}

/** One bar's length and contents, or the token that stopped the reader. */
function scanBar(text: string, unit: number): BarScan {
  let i = 0, duration = 0, notes = 0, events = 0;
  let unitNow = unit, meter: string | undefined, nextMeter: string | undefined, nextUnit: number | undefined;
  let last = 0;          // whole notes in the previous timed event
  let nextFactor = 1;    // broken-rhythm factor owed to the next timed event
  let tupletLeft = 0;    // timed events still inside the current tuplet
  let tupletFactor = 1;  // q / p
  const bad = (token: string): BarScan => ({ duration, notes, events, token });

  /** Count one note/chord or rest, applying the tuplet and broken rhythm. */
  const timed = (mult: number, note: boolean) => {
    let length = mult * unitNow;
    if (tupletLeft > 0) length *= tupletFactor;
    length *= nextFactor;
    nextFactor = 1;
    duration += length;
    last = length;
    events++;
    if (note) notes++;
    if (tupletLeft > 0) tupletLeft--;
  };
  /** Dots and `~` are decorations in abcjs (they do not lengthen a note), and
   *  a `-` is a tie: consume them without changing the bar's total. */
  const decorations = (at: number): number => {
    while (text[at] === '.' || text[at] === '~') at++;
    if (text[at] === '-') at++;
    return at;
  };
  /** Consume decorations and broken rhythm after an event. */
  const afterEvent = (at: number): number => {
    for (;;) {
      at = decorations(at);
      if (text[at] !== '>' && text[at] !== '<') return at;
      if (last === 0) { at++; continue; } // a leading arrow is an accent
      const broken = readBroken(text, at);
      duration += last * (broken.before - 1);
      last *= broken.before;
      nextFactor = broken.after;
      at = broken.next;
    }
  };

  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') break;
    if (c === '"') {
      const close = text.indexOf('"', i + 1);
      if (close < 0) return bad(text.slice(i));
      i = close + 1;
      continue;
    }
    if (c === '[') {
      const close = text.indexOf(']', i + 1);
      if (close < 0) return bad(text.slice(i));
      const inner = text.slice(i + 1, close).trim();
      const field = /^([A-Za-z]):(.*)$/.exec(inner);
      if (field) {
        const key = field[1].toUpperCase(), value = field[2].trim();
        if (key === 'M') {
          const next = meterOf(value);
          if (!next) return bad(`[${inner}]`);
          // Before the bar's first event it governs this bar; after one it
          // waits for the next bar line, as ABC time signatures do.
          if (events === 0 && notes === 0) meter = next; else nextMeter = next;
        } else if (key === 'L') {
          const next = unitOf(value);
          if (next === null) return bad(`[${inner}]`);
          unitNow = next;
          nextUnit = next;
        }
        i = close + 1;
        continue;
      }
      // `[CEG]` is a chord of notes: one event, length written after `]`.
      const len = readLength(text, close + 1);
      if (!len) return bad(text.slice(i, close + 1));
      timed(len.mult, true);
      i = afterEvent(len.next);
      continue;
    }
    if (c === '!' || c === '+') {
      const close = text.indexOf(c, i + 1);
      i = close < 0 ? text.length : close + 1;
      continue;
    }
    if (c === '{') {
      const close = text.indexOf('}', i + 1);
      i = close < 0 ? text.length : close + 1;
      continue;
    }
    // A `(` with a number is a tuplet; without one it is a slur. `&` merges
    // two independent timelines and cannot be measured as one total.
    if (c === '(') {
      const tuplet = readTuplet(text, i);
      if (tuplet) {
        if (tupletLeft === 0) { tupletFactor = tuplet.factor; tupletLeft = tuplet.notes; }
        i = tuplet.next;
      } else i++;
      continue;
    }
    if (c === ')') { i++; continue; }
    if (c === '&') return bad(text.slice(i));
    if (c === '>' || c === '<') { i = afterEvent(i); continue; }
    if (c === '^' || c === '_' || c === '=') {
      while (text[i] === c) i++;
      continue;
    }
    if (/[A-Ga-g]/.test(c)) {
      i++;
      while (text[i] === ',' || text[i] === "'") i++;
      const len = readLength(text, i);
      if (!len) return bad(text.slice(i - 1));
      timed(len.mult, true);
      i = afterEvent(len.next);
      continue;
    }
    if (c === 'z' || c === 'x') {
      i++;
      const len = readLength(text, i);
      if (!len) return bad(c);
      timed(len.mult, false);
      i = afterEvent(len.next);
      continue;
    }
    if (c === 'y') { i++; continue; }
    if (c === '.' || c === '~') { i++; continue; }
    if (/[|:\][0-9]/.test(c)) { i++; continue; }
    return bad(text.slice(i));
  }
  return { duration, notes, events, meter, nextMeter, nextUnit };
}

function voiceOf(line: string): { id: string; name: string } {
  const text = line.trim().slice(2).trim();
  const id = text.split(/\s+/)[0] ?? '';
  const name = /name="([^"]*)"/.exec(text)?.[1] ?? id;
  return { id, name };
}

const isVocal = (v: { id: string; name: string }) => /vocal/i.test(v.id) || /vocal/i.test(v.name);

/** One bar's text and where it sits in the whole score. */
interface Piece { text: string; start: number; end: number }

/** A music line cut at its bar lines, treating repeat/double bar lines as
 *  plain boundaries. `[CEG]` note chords and inline fields stay intact.
 *  `offset` is the line's first character in the score. */
function linePieces(line: string, offset: number): { pieces: Piece[]; closed: boolean } {
  const barline = /\[\||\|\]|\|\||\|:|:\||\|/g;
  const pieces: Piece[] = [];
  const push = (text: string, at: number) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const lead = text.length - text.trimStart().length;
    pieces.push({ text: trimmed, start: offset + at + lead, end: offset + at + text.trimEnd().length });
  };
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = barline.exec(line))) {
    push(line.slice(cursor, match.index), cursor);
    cursor = match.index + match[0].length;
  }
  const tail = line.slice(cursor);
  push(tail, cursor);
  // A line ends closed when its last bar line is followed by nothing but
  // spaces; otherwise its last bar continues on the next line.
  return { pieces, closed: cursor > 0 && tail.trim() === '' };
}

/** Audit every bar of `abc` against the meter in force. */
export function auditAbcMeasures(abc: string): MeasureAuditResult {
  const lines = abc.replace(/\r\n?/g, '\n').split('\n');
  const keyLine = lines.findIndex(line => /^K:/.test(line.trim()));
  if (keyLine < 0) return { error: 'The score has no K: line.' };

  let headerMeter = '4/4', headerUnit = 1 / 8;
  for (const raw of lines.slice(0, keyLine)) {
    const line = raw.trim();
    if (/^M:/.test(line)) {
      const meter = meterOf(line.slice(2));
      if (!meter) return { error: `Unsupported meter "${line}".` };
      headerMeter = meter;
    } else if (/^L:/.test(line)) {
      const unit = unitOf(line.slice(2));
      if (unit === null) return { error: `Unsupported note length "${line}".` };
      headerUnit = unit;
    }
  }

  const states = new Map<string, VoiceState>();
  const stateFor = (voice: string) => {
    let state = states.get(voice);
    if (!state) { state = { meter: headerMeter, unit: headerUnit }; states.set(voice, state); }
    return state;
  };
  const counts = new Map<string, { bars: number; sounding: number }>();
  const voices = new Map<string, { id: string; name: string }>();
  const issues: MeasureIssue[] = [];
  const ranges: MeasureAudit['ranges'] = [];
  let current = '';
  // A bar can wrap across lines in ABC (a newline is whitespace). Text after
  // the last `|` waits for the next line in the same voice.
  let pending: Piece | null = null;

  const processBar = (piece: Piece, voice: string) => {
    const text = piece.text;
    if (!text.trim()) return;
    const state = stateFor(voice);
    if (!voices.has(voice)) voices.set(voice, { id: voice, name: voice });
    const count = counts.get(voice) ?? { bars: 0, sounding: 0 };
    counts.set(voice, count);

    const restBars = isWholeBarRest(text);
    const bar = ++count.bars;
    ranges.push({ start: piece.start, end: piece.end, bar });
    if (restBars !== null) {
      for (let extra = 1; extra < restBars; extra++) count.bars++;
      return;
    }

    const scan = scanBar(text, state.unit);
    const meter = scan.meter ?? state.meter;
    const expected = wholeNotesOf(meter);
    const actual = scan.duration;
    if (scan.notes > 0) count.sounding++;
    const base = {
      bar, voice, meter, expected, actual,
      missing: expected - actual, hasNotes: scan.notes > 0,
      notes: scan.notes, events: scan.events, barText: text,
    };
    const tolerance = 1e-9;
    if (scan.token !== undefined) {
      issues.push({ ...base, kind: 'unreadable', token: scan.token });
    } else if (scan.events === 0) {
      issues.push({ ...base, kind: 'empty' });
    } else if (actual > expected + tolerance) {
      issues.push({ ...base, kind: 'long' });
    } else if (actual < expected - tolerance) {
      const beats = Number(meter.split('/')[1]) || 4;
      issues.push({ ...base, kind: 'short', gapBeat: Math.round(actual * beats * 1e6) / 1e6 + 1 });
    }
    state.meter = scan.nextMeter ?? meter;
    if (scan.nextUnit !== undefined) state.unit = scan.nextUnit;
  };
  const flushPending = () => { const piece = pending; pending = null; if (piece) processBar(piece, current); };

  // Character offsets of each line, since the SVG maps back by startChar.
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) { offsets.push(at); at += line.length + 1; }

  for (let index = keyLine + 1; index < lines.length; index++) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line || line.startsWith('%')) continue;
    if (/^V:/.test(line)) {
      flushPending();
      const voice = voiceOf(line);
      current = voice.id;
      voices.set(voice.id, voice);
      stateFor(current);
      continue;
    }
    if (/^[A-Za-z]:/.test(line)) {
      flushPending();
      const state = stateFor(current);
      if (/^M:/.test(line)) {
        const meter = meterOf(line.slice(2));
        if (!meter) return { error: `Unsupported meter "${line}".` };
        state.meter = meter;
      } else if (/^L:/.test(line)) {
        const unit = unitOf(line.slice(2));
        if (unit === null) return { error: `Unsupported note length "${line}".` };
        state.unit = unit;
      }
      continue;
    }

    const lineOffset = offsets[index] + (raw.length - raw.trimStart().length);
    const { pieces, closed } = linePieces(line, lineOffset);
    const parts = [...pieces];
    let tail: Piece | null = null;
    if (pending !== null) {
      const carried: Piece = pending;
      if (parts.length) parts[0] = { text: `${carried.text} ${parts[0].text}`, start: carried.start, end: parts[0].end };
      else if (closed) parts.push(carried);
      else tail = carried;
      pending = null;
    }
    if (!closed) {
      const last = parts.pop() ?? null;
      if (last) tail = tail ? { text: `${tail.text} ${last.text}`, start: tail.start, end: last.end } : last;
    }
    for (const part of parts) processBar(part, current);
    if (tail) pending = tail;
  }
  flushPending();

  const voiceList: MeasureVoice[] = [...voices.keys()].map(id => {
    const state = states.get(id)!;
    const count = counts.get(id) ?? { bars: 0, sounding: 0 };
    return { voice: id, bars: count.bars, soundingBars: count.sounding, meter: state.meter };
  });
  if (!voiceList.length) voiceList.push({ voice: '', bars: 0, soundingBars: 0, meter: headerMeter });

  const vocal = voiceList.filter(v => isVocal(voices.get(v.voice) ?? { id: v.voice, name: v.voice }));
  const reference = vocal.length ? vocal : voiceList;
  const bars = Math.max(...reference.map(v => v.bars));

  const alignment: MeasureAudit['alignment'] = [];
  const distinct = new Set(voiceList.map(v => v.bars));
  if (distinct.size > 1) {
    const least = Math.min(...voiceList.map(v => v.bars));
    alignment.push({
      bar: least + 1,
      detail: voiceList.map(v => `${v.voice || 'score'} has ${v.bars} bar${v.bars === 1 ? '' : 's'}`).join(', '),
    });
  }

  issues.sort((a, b) => a.bar - b.bar || a.voice.localeCompare(b.voice));
  ranges.sort((a, b) => a.start - b.start);
  return {
    ok: issues.length === 0 && alignment.length === 0,
    meter: headerMeter,
    unit: headerUnit,
    bars,
    voices: voiceList,
    issues,
    alignment,
    ranges,
  };
}

/** The issues of each bar, for painting a rendered score. */
export function issuesByBar(audit: MeasureAudit): Map<number, MeasureIssue[]> {
  const out = new Map<number, MeasureIssue[]>();
  for (const issue of audit.issues) {
    const list = out.get(issue.bar) ?? [];
    list.push(issue);
    out.set(issue.bar, list);
  }
  return out;
}

/** A duration in whole notes as a count of the meter's beats. */
export function beatCount(whole: number, meter: string): number {
  const denominator = Number(meter.split('/')[1]) || 4;
  return Math.abs(whole) * denominator;
}

/** Beats as a compact fraction: `½`, `1½`, `2`, `⅓`-free decimals for odd values. */
export function formatBeats(beats: number): string {
  const rounded = Math.round(beats * 1e6) / 1e6;
  if (Number.isInteger(rounded)) return String(rounded);
  const whole = Math.floor(rounded), frac = Math.round((rounded - whole) * 1e6) / 1e6;
  const glyph = frac === 0.5 ? '½' : frac === 0.25 ? '¼' : frac === 0.75 ? '¾'
    : frac === 0.125 ? '⅛' : frac === 0.375 ? '⅜' : frac === 0.625 ? '⅝' : frac === 0.875 ? '⅞' : null;
  return glyph ? `${whole || ''}${glyph}` : String(rounded);
}

/** One issue as a deterministic English sentence (used in SVG tooltips). */
export function measureIssueText(issue: MeasureIssue): string {
  const missing = formatBeats(beatCount(issue.missing, issue.meter));
  const actual = formatBeats(beatCount(issue.actual, issue.meter));
  const expected = formatBeats(beatCount(issue.expected, issue.meter));
  const plural = (beats: string) => `beat${beats === '1' ? '' : 's'}`;
  const where = `${issue.voice ? `${issue.voice} ` : ''}bar ${issue.bar}`;
  switch (issue.kind) {
    case 'short':
      return `${where} (${issue.meter}): missing ${missing} ${plural(missing)} of timing`
        + (issue.gapBeat !== undefined ? ` after beat ${formatBeats(issue.gapBeat - 1)}` : '')
        + ` — wrote ${actual} of ${expected} beats`;
    case 'long':
      return `${where} (${issue.meter}): over by ${missing} ${plural(missing)} of timing`
        + ` — wrote ${actual} of ${expected} beats`;
    case 'empty':
      return `${where} (${issue.meter}): no notes — the bar has no note or rest length (0 of ${expected} beats)`;
    case 'unreadable':
      return `${where} (${issue.meter}): cannot check "${issue.token ?? ''}" — expected ${expected} ${plural(expected)}`;
  }
}
