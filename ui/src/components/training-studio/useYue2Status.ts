import { useQuery } from '@tanstack/react-query';
import { useRunEvents } from '../../queries/training-runs/hooks';
import { runQueries } from '../../queries/training-runs/queries';
import { useTrainingStore } from '../../stores/trainingStore';
import { useActiveTrainingJob } from '../../queries/training-runs/hooks';

export function useYue2Status(datasetId: string) {
  const worker = useTrainingStore(s => s.trainingWorker);
  const job = useActiveTrainingJob();
  useRunEvents(job?.id, worker);
  const query = useQuery({ ...runQueries.yue2Status(worker, datasetId), enabled: !!datasetId });
  return { status: query.data ?? null, error: query.error?.message ?? null,
    reload: () => { void query.refetch(); } };
}
