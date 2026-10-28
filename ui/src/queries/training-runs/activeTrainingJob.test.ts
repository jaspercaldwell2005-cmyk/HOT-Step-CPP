// activeTrainingJob.test.ts — stage (b): components read the job from the one
// Query cache entry, and the store's mirror is only a transition fallback.

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '../client';
import { trainingQueries } from '../training-data/queries';
import { useTrainingStore } from '../../stores/trainingStore';
import { useActiveTrainingJob } from './hooks';

// The store module reads localStorage at import time in the browser; the Node
// test runner has none.
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });

const Probe = () => createElement('span', null, useActiveTrainingJob()?.status ?? 'none');

// SSR reads Zustand's getInitialState snapshot, so seed that object the same
// way the component tests do and restore it after each case.
function withStoredJob(job: unknown, run: () => void) {
  const initial = useTrainingStore.getInitialState();
  const saved = { activeJob: initial.activeJob, trainingWorker: initial.trainingWorker };
  Object.assign(initial, { trainingWorker: null, activeJob: job });
  try { run(); } finally { Object.assign(initial, saved); }
}

afterEach(() => {
  useTrainingStore.setState({ trainingWorker: null, activeJob: null });
});

test('the hook prefers the cache entry over the store mirror', () => {
  const client = createQueryClient();
  client.setQueryData(trainingQueries.job(null, 'j1').queryKey, { id: 'j1', status: 'running' } as never);
  let html = '';
  withStoredJob({ id: 'j1', status: 'queued' }, () => {
    html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    );
  });
  assert.match(html, /running/, 'cache is the read owner once it has the job');
  client.clear();
});

test('the hook falls back to the store while the cache has no entry', () => {
  const client = createQueryClient();
  let html = '';
  withStoredJob({ id: 'j2', status: 'queued' }, () => {
    html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    );
  });
  assert.match(html, /queued/, 'a freshly adopted job is readable before its frame lands');
  client.clear();
});
