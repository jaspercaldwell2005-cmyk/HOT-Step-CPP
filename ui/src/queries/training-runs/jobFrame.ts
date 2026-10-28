// jobFrame.ts — the one merge rule for job/progress/status stream frames.
//
// The SSE bridge and the store both apply these frames while stage (b) of the
// training migration keeps the store's copy alive. Sharing the rule keeps the
// cache and the store byte-identical until the store copy is deleted.

import type { TrainingJobSummary, TrainingStreamEvent } from '../../services/trainingApi';

type ProgressFrame = Extract<TrainingStreamEvent, { type: 'progress' }>;
type StatusFrame = Extract<TrainingStreamEvent, { type: 'status' }>;

/** Progress implies running, whatever the last status we were told was.
 *  adoptJob reads the status once, at start, and a job that was still queued
 *  at that instant stays labelled "Queued..." for its whole life if the 'job'
 *  event that would have corrected it was missed — which is how a separation
 *  sat there saying Queued at 7 of 12 tracks. */
function applyProgress(job: TrainingJobSummary, event: ProgressFrame): TrainingJobSummary {
  return {
    ...job,
    status: job.status === 'queued' ? 'running' : job.status,
    done: event.done, total: event.total, failed: event.failed,
    phase: event.phase, currentSampleId: event.currentSampleId,
    engineQueueDepth: event.engineQueueDepth,
  };
}

function applyStatus(job: TrainingJobSummary, event: StatusFrame): TrainingJobSummary {
  return { ...job, status: event.status, error: event.error ?? job.error };
}

/** Merge one job-frame field set into a cached summary. A frame never blanks
 *  a field it does not carry; progress implies the job is running, matching
 *  the store rule this replaces. */
export function jobFrameUpdate(
  event: TrainingStreamEvent,
): ((old: unknown) => unknown) | undefined {
  if (event.type === 'job') {
    const frame = event.job;
    return old => ({ ...(old as TrainingJobSummary), ...frame });
  }
  if (event.type === 'progress') {
    return old => applyProgress(old as TrainingJobSummary, event);
  }
  if (event.type === 'status') {
    return old => applyStatus(old as TrainingJobSummary, event);
  }
  return undefined;
}

/** The full next job summary for a frame, given the current one. `job` frames
 *  replace (the store's existing rule); progress/status merge. Returns
 *  undefined when the frame has no job effect (other types, or a merge frame
 *  with no current summary). */
export function nextJobSummary(
  event: TrainingStreamEvent,
  current: TrainingJobSummary | null,
): TrainingJobSummary | undefined {
  if (event.type === 'job') return event.job;
  if (!current) return undefined;
  if (event.type === 'progress') return applyProgress(current, event);
  if (event.type === 'status') return applyStatus(current, event);
  return undefined;
}
