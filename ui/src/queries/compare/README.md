# Compare server state

Compare Studio owns the A/B session list, session detail, per-take analysis
and the diff trace. It uses the client, keys and policy in `../client.ts`,
`../keys.ts` and `../contract.ts`. Playback, the A/B pair, loop points, the
new-session form and the picker's selection stay client state.

## Reads

`queries.ts` exports one factory per resource. All keys are local (no auth,
worker or backend scope) under `compare/{sessions,session,songs,analysis,diff}`.
A read passes Query's AbortSignal into `compareApi`.

| Factory | Cache shape | Notes |
| --- | --- | --- |
| `sessions({ archived?, group? })` | `{ sessions }` | The picker filters server-side; the archived toggle changes the key |
| `session(id)` | `CompareSession` | Takes, criteria and scores |
| `songSearch(q, limit, offset)` | `{ total, songs }` | Keeps the previous page while the next loads |
| `analysis(songId)` | `CompareAnalysis` | Five-minute freshness: analysis is expensive and cached server-side |
| `diff(a, b)` | `CompareDiff` | Five-minute freshness, same reason |

The session view mounts one `analysis(songId)` entry per take and only the
active pair's `diff`. A failed analysis renders a compact `QueryError` in its
take row; a failed list/detail/search/diff renders the same component inline.

## Writes

`writes.ts` owns the commands. Scoring is optimistic on the session entry and
every cached session list; a failed PUT restores both snapshots and the
server result wins for status, archive and counts. Add/remove take replaces
the returned session and its list row. Archive merges the returned summary.
Create and delete are the only commands that refetch the list, because
membership changed.

Pure helpers (`localStatus`, `applyScores`, `reconcileScoreResult`,
`summaryOf`) and the cache transitions (`beginOptimisticScores`,
`commitScoreResult`, `rollbackScores`, `patchSession`, `patchSessionSummary`)
are exported for tests.
