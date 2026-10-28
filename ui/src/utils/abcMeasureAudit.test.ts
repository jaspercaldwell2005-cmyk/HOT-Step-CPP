import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditAbcMeasures, beatCount, formatBeats, issuesByBar, measureIssueText, type MeasureAudit,
} from './abcMeasureAudit';

const HEADER = ['X:1', 'T:', 'M:4/4', 'L:1/8', 'V: Vocal name="Vocal"', 'V: Ins name="Ins"', 'K:C'];
const score = (...body: string[]) => [...HEADER, ...body].join('\n');
const audit = (abc: string): MeasureAudit => {
  const result = auditAbcMeasures(abc);
  if ('error' in result) assert.fail(result.error);
  return result;
};

test('a bar that fills 4/4 is not flagged', () => {
  const result = audit(score('V: Vocal', '"C"C2 E2 G2 c2 | "G"B4 G4 |', 'V: Ins', 'Z2 |'));
  assert.equal(result.ok, true);
  assert.equal(result.bars, 2);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.voices.map(v => [v.voice, v.bars, v.soundingBars]),
    [['Vocal', 2, 2], ['Ins', 2, 0]]);
});

test('a short bar reports the missing beats and where they start', () => {
  const result = audit(score('V: Vocal', '"C"C2 E2 G2 |', 'V: Ins', 'C8 |'));
  assert.equal(result.ok, false);
  const [issue] = result.issues;
  assert.equal(issue.voice, 'Vocal');
  assert.equal(issue.bar, 1);
  assert.equal(issue.kind, 'short');
  assert.equal(issue.actual, 0.75);
  assert.equal(issue.gapBeat, 4);
  assert.match(measureIssueText(issue), /missing 1 beat of timing after beat 3/);
});

test('a long bar reports how far over the meter it is', () => {
  const result = audit(score('V: Vocal', '"C"C8 D8 |', 'V: Ins', 'C8 D8 |'));
  const [issue] = result.issues;
  assert.equal(issue.kind, 'long');
  assert.equal(issue.missing, -1);
  assert.match(measureIssueText(issue), /over by 4 beats/);
});

test('a meter change applies to that voice from the next bar', () => {
  const result = audit(score('V: Vocal', 'M:3/4', 'C6 |', 'M:4/4', 'C8 |'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('Z counts its bars and a chord-only bar is reported as no notes', () => {
  const result = audit(score('V: Vocal', 'Z2 | "C"| C8 |'));
  assert.equal(result.bars, 4);
  assert.equal(result.issues.length, 1);
  const [issue] = result.issues;
  assert.equal(issue.bar, 3);
  assert.equal(issue.kind, 'empty');
  assert.match(measureIssueText(issue), /no notes/);
});

test('notation the reader cannot model is unreadable, not short', () => {
  const result = audit(score('V: Vocal', 'C2 & E2 G2 |'));
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].kind, 'unreadable');
  assert.match(measureIssueText(result.issues[0]), /cannot check/);
});

test('tuplets are measured with abcjs\'s own ratios', () => {
  const full = audit(score('V: Vocal', '(3C2D2E2 C2 D2 |', 'V: Ins', 'C8 |'));
  assert.equal(full.ok, true);
  const explicit = audit(score('V: Vocal', '(3:2:3C2D2E2 C2 D2 |', 'V: Ins', 'C8 |'));
  assert.equal(explicit.ok, true);
  const long = audit(score('V: Vocal', '(3C2D2E2 F2 G2 A2 |', 'V: Ins', 'C8 |'));
  assert.equal(long.issues[0].kind, 'long');
  assert.equal(long.issues[0].actual, 1.25);
});

test('broken rhythm moves length between neighbours without changing the bar', () => {
  for (const body of ['C2>D2 E2 F2 |', 'C2>>D2 E2 F2 |', 'C2<D2 E2 F2 |', 'C2<<D2 E2 F2 |']) {
    const result = audit(score('V: Vocal', body, 'V: Ins', 'C8 |'));
    assert.equal(result.ok, true, body);
  }
});

test('slurs are not tuplets and do not stop the reader', () => {
  const result = audit(score('V: Vocal', '(C2 E2) G2 c2 |', 'V: Ins', 'C8 |'));
  assert.equal(result.ok, true);
});

test('an issue carries the evidence used to flag it', () => {
  const result = audit(score('V: Vocal', '"C"C2 E2 G2 |', 'V: Ins', 'C8 |'));
  const [issue] = result.issues;
  assert.equal(issue.barText, '"C"C2 E2 G2');
  assert.equal(issue.notes, 3);
  assert.equal(issue.events, 3);
  assert.equal(issue.expected, 1);
  assert.equal(issue.actual, 0.75);
  assert.match(measureIssueText(issue), /wrote 3 of 4 beats/);
});

test('a voice that runs short of bars is reported once as alignment', () => {
  const result = audit(score('V: Vocal', 'C8 | C8 |', 'V: Ins', 'C8 |'));
  assert.equal(result.ok, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.alignment.length, 1);
  assert.equal(result.alignment[0].bar, 2);
  assert.match(result.alignment[0].detail, /Vocal has 2 bars, Ins has 1 bar/);
});

test('only the offending voice is reported when the other fills its bar', () => {
  const result = audit(score('V: Vocal', 'C8 |', 'V: Ins', 'C4 |'));
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].voice, 'Ins');
  assert.equal(result.issues[0].kind, 'short');
});

test('a score without a K: line is refused', () => {
  const result = auditAbcMeasures('X:1\nM:4/4\nC8 |');
  assert.ok('error' in result);
});

test('beat helpers are deterministic fractions', () => {
  assert.equal(beatCount(0.25, '4/4'), 1);
  assert.equal(beatCount(0.25, '6/8'), 2);
  assert.equal(formatBeats(0.5), '½');
  assert.equal(formatBeats(1.5), '1½');
  assert.equal(formatBeats(0.125), '⅛');
  assert.equal(formatBeats(2), '2');
});

test('issues are grouped by bar for the rendered overlay', () => {
  const result = audit(score('V: Vocal', 'C2 | C8 |', 'V: Ins', 'C4 | C8 |'));
  const byBar = issuesByBar(result);
  assert.deepEqual([...byBar.keys()], [1]);
  assert.equal(byBar.get(1)!.length, 2);
});

test('a bar wrapped across two lines is measured once, not twice', () => {
  const result = audit(score('V: Vocal', 'C2 E2', 'G2 c2 | C8 |', 'V: Ins', 'Z2 |'));
  assert.equal(result.bars, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(result.voices.map(v => [v.voice, v.bars]), [['Vocal', 2], ['Ins', 2]]);
});

test('a wrapped continuation that ends in a bar line still closes the bar', () => {
  const result = audit(score('V: Vocal', 'C2 E2', 'G2 c2 |', 'V: Ins', 'Z |'));
  assert.equal(result.bars, 1);
  assert.equal(result.ok, true);
});

test('repeat and double bar lines are plain bar boundaries', () => {
  const result = audit(score('V: Vocal', '|: C8 :| C8 || C8 |]', 'V: Ins', 'Z3 |'));
  assert.equal(result.bars, 3);
  assert.equal(result.ok, true);
});

test('each bar range points at its own text, wrapped bars included', () => {
  const abc = score('V: Vocal', 'C2 E2', 'G2 c2 | C8 |', 'V: Ins', 'Z2 |');
  const result = audit(abc);
  const vocal = result.ranges.filter((_, i) => i < 2);
  assert.equal(abc.slice(vocal[0].start, vocal[0].end), 'C2 E2\nG2 c2');
  assert.equal(abc.slice(vocal[1].start, vocal[1].end), 'C8');
  assert.deepEqual(result.ranges.map(range => range.bar), [1, 2, 1]);
});
