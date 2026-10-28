import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const { useTrainingStore } = await import('./trainingStore');
const { queryClient } = await import('../queries/client');
const { trainingQueries: tq } = await import('../queries/training-data/queries');

test('a labelled sample from the job stream also lands in the cached dataset detail', () => {
  const key = tq.dataset(null, 'd1').queryKey;
  const before = { sampleId: 's1', labelStatus: 'pending' } as never;
  const after = { sampleId: 's1', labelStatus: 'done', caption: 'new' } as never;
  queryClient.setQueryData(key, { id: 'd1', samples: [before] } as never);
  useTrainingStore.setState({ trainingWorker: null, selectedDatasetId: 'd1', samplesById: {}, sampleOrder: [], pendingEdits: {} });

  useTrainingStore.getState().applyStreamEvent({ type: 'sample', sampleId: 's1', status: 'done', sample: after } as never);

  // A reopen within staleTime reads this entry, so it must not hold the pre-label row.
  assert.deepEqual((queryClient.getQueryData(key) as { samples: unknown[] }).samples, [after]);
  queryClient.clear();
});

test('job and progress frames also mirror the active job into the query cache', () => {
  const job = {
    id: 'j1', datasetId: 'd1', kind: 'preprocess', status: 'queued',
    total: 4, done: 0, failed: 0, currentSampleId: null, phase: '',
    engineQueueDepth: 0, error: null, createdAt: 0, startedAt: null, finishedAt: null,
  };
  const key = tq.job(null, job.id).queryKey;
  useTrainingStore.setState({ trainingWorker: null, activeJob: null });
  try {
    useTrainingStore.getState().applyStreamEvent({ type: 'job', job } as never);
    assert.equal((queryClient.getQueryData(key) as { status: string }).status, 'queued');

    useTrainingStore.getState().applyStreamEvent({
      type: 'progress', done: 2, total: 4, failed: 0,
      phase: 'preprocess', currentSampleId: 's2', engineQueueDepth: 1,
    } as never);
    const mirrored = queryClient.getQueryData(key) as Record<string, unknown>;
    assert.equal(mirrored.status, 'running', 'progress implies running');
    assert.equal(mirrored.done, 2);
    assert.equal(mirrored.phase, 'preprocess');
    assert.equal((useTrainingStore.getState().activeJob as { done: number }).done, 2,
      'the store copy stays identical until stage (c)');
  } finally {
    useTrainingStore.setState({ activeJob: null });
    queryClient.clear();
  }
});
