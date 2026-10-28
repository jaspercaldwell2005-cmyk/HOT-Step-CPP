import type { QueryClient } from '@tanstack/react-query';
import * as api from '../../services/trainingApi';
import { bridgeEvents, type BridgeOptions } from '../sseBridge';
import { resourceKey, scopeOf, SHARED } from '../keys';
import type { Worker } from './queries';
import { trainingQueries } from '../training-data/queries';
import { jobFrameUpdate } from './jobFrame';
import { queryManager } from '../invalidation';

export function invalidateRunReads(client: QueryClient, worker: Worker) {
  return queryManager.filter(client, { queryKey: ['hs'], predicate: q =>
    (q.queryKey[1] === SHARED.preparation || q.queryKey[1] === SHARED.preparationJob ||
      String(q.queryKey[1]).startsWith('training-runs/') || String(q.queryKey[1]).startsWith('training-data/')) &&
    (scopeOf(q.queryKey)?.worker === undefined || scopeOf(q.queryKey)?.worker === worker) });
}

const TERMINAL_STATUS = new Set(['done', 'failed', 'cancelled']);

/** Metrics and logs keep their existing reducers and shared connection.
 * This bridge refreshes snapshots and updates the job cache; it cannot submit
 * a job or audition. */
export function bridgeRunEvents(client: QueryClient, jobId: string, worker: Worker,
  subscribe?: BridgeOptions<api.TrainingStreamEvent>['subscribe']) {
  const jobKey = trainingQueries.job(worker, jobId).queryKey;
  return bridgeEvents<api.TrainingStreamEvent>(client, {
    url: api.jobStreamUrl(jobId, { worker }),
    subscribe,
    reconnectInvalidate: [
      resourceKey(SHARED.preparation), resourceKey(SHARED.preparationJob),
      resourceKey('training-data/job', { worker }, jobId),
      ...['mm3-status', 'yue2-status', 'ar-status', 'optimise', 'prepare', 'sources', 'source', 'jobs']
        .map(name => resourceKey(`training-runs/${name}`, { worker })),
      ...['joint-runs', 'mm3-runs', 'nar-runs', 'ar-runs', 'previews', 'review', 'ladder', 'scores', 'album']
        .map(name => resourceKey(`training-runs/${name}`)),
    ],
    map: event => {
      if (!event) return undefined;
      const update = jobFrameUpdate(event);
      const terminal = event.type === 'status' && TERMINAL_STATUS.has(event.status);
      if (!update && !terminal) return undefined;
      return {
        ...(update ? { update: [{ key: jobKey, apply: update }] } : {}),
        ...(terminal ? { once: { id: `training-runs:${worker ?? 'local'}:${jobId}:terminal`,
          run: () => { void invalidateRunReads(client, worker); } } } : {}),
      };
    },
  });
}
