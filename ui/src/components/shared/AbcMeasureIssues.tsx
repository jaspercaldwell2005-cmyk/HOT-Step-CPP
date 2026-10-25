// AbcMeasureIssues.tsx — the deterministic bar audit as a readable panel.
//
// The arithmetic lives in utils/abcMeasureAudit.ts and the SVG overlay in
// utils/abcMeasurePaint.ts. This file only lists the same findings with icons:
// timing (short/over), notes (a bar with no note or rest) and notation the
// audit cannot measure.

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertTriangle, CheckCircle2, Music2, Timer } from 'lucide-react';
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
  if (!audit) return null;
  if (audit.ok) {
    return (
      <p className={`flex items-start gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 ${className ?? ''}`}>
        <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
        <span>{t('abc.measures.ok', 'Every bar fills its {{meter}} meter ({{bars}} bars checked).',
          { meter: audit.meter, bars: audit.bars })}</span>
      </p>
    );
  }

  const total = audit.issues.length;
  const shown = audit.issues.slice(0, 12);
  const hidden = total - shown.length;
  return (
    <div className={`rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-800 dark:text-amber-300 space-y-1 ${className ?? ''}`}>
      <p className="flex items-start gap-1.5 font-semibold">
        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
        <span>{t('abc.measures.bad', '{{count}} measure issue(s) found', { count: total })}</span>
      </p>
      <ul className="space-y-0.5">
        {shown.map((issue, index) => (
          <li key={`${issue.voice}-${issue.bar}-${index}`} className="flex items-start gap-1.5">
            <IssueIcon kind={issue.kind} />
            <span className="break-words">
              <span className="font-mono">{[issue.voice, `bar ${issue.bar}`].filter(Boolean).join(' ')}</span>
              {' · '}
              {describe(issue, t)}
            </span>
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="pl-[18px] text-amber-700/80 dark:text-amber-400/80">
        {t('abc.measures.more', '+{{count}} more', { count: hidden })}
      </p>}
      {audit.alignment.map(item => (
        <p key={item.bar} className="flex items-start gap-1.5 pl-[18px] text-amber-700/90 dark:text-amber-400/90">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>{t('abc.measures.alignment', 'Voices do not line up: {{detail}}.', { detail: item.detail })}</span>
        </p>
      ))}
    </div>
  );
};

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
