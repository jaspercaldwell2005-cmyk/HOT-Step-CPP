// AbcMeasureIssues.tsx — the deterministic bar audit as a readable panel.
//
// The arithmetic lives in utils/abcMeasureAudit.ts and the SVG overlay in
// utils/abcMeasurePaint.ts. This file only lists the same findings with icons:
// timing (short/over), notes (a bar with no note or rest) and notation the
// audit cannot measure. Every row expands to the evidence the audit used:
// expected beats, written beats, the missing/extra amount, the event count and
// the bar's own ABC text.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, CheckCircle2, ChevronDown, Music2, Timer } from 'lucide-react';
import { beatCount, formatBeats, type MeasureAudit, type MeasureIssue, type MeasureIssueKind } from '../../utils/abcMeasureAudit';

function IssueIcon({ kind }: { kind: MeasureIssueKind }) {
  if (kind === 'unreadable') return <AlertTriangle size={12} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />;
  if (kind === 'empty') return <Music2 size={12} className="mt-0.5 shrink-0 text-violet-600 dark:text-violet-400" />;
  return <Timer size={12} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />;
}

/** The audit as a panel: a clean line when every bar fills its meter, or the
 *  findings in bar order. Pass null/undefined while there is no score. */
export const AbcMeasureAuditPanel: React.FC<{ audit: MeasureAudit | null | undefined; className?: string }> = ({
  audit, className,
}) => {
  const { t } = useTranslation();
  // Which rows the reader opened to see the arithmetic behind the flag.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  if (!audit) return null;
  if (audit.ok) {
    return (
      <p className={`flex min-w-0 max-w-full items-start gap-1.5 overflow-hidden text-[11px] text-emerald-600 dark:text-emerald-400 ${className ?? ''}`}>
        <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">{t('abc.measures.ok', 'Every bar fills its {{meter}} meter ({{bars}} bars checked).',
          { meter: audit.meter, bars: audit.bars })}</span>
      </p>
    );
  }

  const toggle = (key: string) => setOpen(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const total = audit.issues.length;
  const shown = audit.issues.slice(0, 12);
  const hidden = total - shown.length;
  return (
    <div className={`min-w-0 max-w-full overflow-hidden rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-300 space-y-1 ${className ?? ''}`}>
      <p className="flex items-start gap-1.5 font-semibold">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">{t('abc.measures.bad', '{{count}} measure issue(s) found', { count: total })}</span>
      </p>
      <ul className="min-w-0 space-y-1">
        {shown.map(issue => {
          const key = `${issue.voice}-${issue.bar}-${issue.kind}`;
          const expanded = open.has(key);
          return (
            <li key={key} className="min-w-0">
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={expanded}
                title={t('abc.measures.whyTitle', 'Show why this bar was flagged')}
                className="flex w-full min-w-0 items-start gap-1.5 rounded text-left hover:bg-amber-500/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/60"
              >
                <IssueIcon kind={issue.kind} />
                <span className="min-w-0 flex-1 break-words">
                  <span className="font-mono">{[issue.voice, `bar ${issue.bar}`].filter(Boolean).join(' ')}</span>
                  {' · '}
                  {describe(issue, t)}
                </span>
                <ChevronDown size={12} className={`mt-0.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
              {expanded && <IssueEvidence issue={issue} t={t} />}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <p className="break-words pl-[18px] text-amber-700/80 dark:text-amber-400/80">
        {t('abc.measures.more', '+{{count}} more', { count: hidden })}
      </p>}
      {audit.alignment.map(item => (
        <p key={item.bar} className="flex items-start gap-1.5 break-words pl-[18px] text-amber-700/90 dark:text-amber-400/90">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{t('abc.measures.alignment', 'Voices do not line up: {{detail}}.', { detail: item.detail })}</span>
        </p>
      ))}
    </div>
  );
};

/** The deterministic facts behind one flag, so "why" is visible without
 *  hovering the score. Values are the audit's own numbers, not a re-count. */
function IssueEvidence({ issue, t }: { issue: MeasureIssue; t: TFunction }) {
  const expected = formatBeats(beatCount(issue.expected, issue.meter));
  const actual = formatBeats(beatCount(issue.actual, issue.meter));
  const missing = formatBeats(beatCount(issue.missing, issue.meter));
  return (
    <div className="ml-[18px] mt-1 min-w-0 space-y-0.5 overflow-hidden rounded border border-amber-500/20 bg-white/60 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-amber-900 dark:bg-black/20 dark:text-amber-200">
      <p className="break-words">{t('abc.measures.why.expected', 'Needs {{beats}} beat(s) in {{meter}}.', {
        beats: expected, meter: issue.meter,
      })}</p>
      <p className="break-words">{t('abc.measures.why.written', 'The ABC writes {{beats}} beat(s) of timing here.', { beats: actual })}</p>
      {issue.kind === 'short' && (
        <p className="break-words">{t('abc.measures.why.short', 'Timing stops after beat {{beat}}; {{beats}} beat(s) are missing.', {
          beat: formatBeats((issue.gapBeat ?? 1) - 1), beats: missing,
        })}</p>
      )}
      {issue.kind === 'long' && (
        <p className="break-words">{t('abc.measures.why.long', 'The bar is {{beats}} beat(s) longer than the bar line allows.', { beats: missing })}</p>
      )}
      {issue.kind === 'empty' && (
        <p className="break-words">{t('abc.measures.why.empty', 'There is no note or rest to measure — only text such as a chord symbol.')}</p>
      )}
      {issue.kind === 'unreadable' && (
        <p className="break-words">{t('abc.measures.why.unreadable', 'The audit does not model this notation, so it will not call the bar short or long.')}</p>
      )}
      <p className="break-words">{t('abc.measures.why.events', '{{notes}} note/chord event(s), {{events}} timed event(s) including rests.', {
        notes: issue.notes, events: issue.events,
      })}</p>
      {issue.token !== undefined && (
        <p className="break-all">{t('abc.measures.why.token', 'Stopped at: {{token}}', { token: issue.token })}</p>
      )}
      <p className="min-w-0 break-words">
        {t('abc.measures.why.abc', 'Measured text:')}
        {' '}
        <code className="mt-0.5 block max-w-full whitespace-pre-wrap break-all">{issue.barText}</code>
      </p>
    </div>
  );
}

function describe(issue: MeasureIssue, t: TFunction): string {
  const beats = formatBeats(beatCount(issue.missing, issue.meter));
  switch (issue.kind) {
    case 'short':
      return t('abc.measures.short', 'Meter {{meter}}: missing {{beats}} beat(s) of timing.', {
        meter: issue.meter, beats,
      });
    case 'long':
      return t('abc.measures.long', 'Meter {{meter}}: over by {{beats}} beat(s) of timing.', {
        meter: issue.meter, beats,
      });
    case 'empty':
      return t('abc.measures.empty', 'Meter {{meter}}: no notes or rests in this bar.', { meter: issue.meter });
    case 'unreadable':
      return t('abc.measures.unreadable', 'Cannot check "{{token}}" in {{meter}}.', {
        token: issue.token ?? '', meter: issue.meter,
      });
  }
}
