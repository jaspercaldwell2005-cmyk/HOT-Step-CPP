# TanStack Query — architecture, status, and worklist

`@tanstack/react-query` ^5.104.3, audited against `ui/` on 2026-10-27. This page
is the decision record: what shipped, what is open, and the rules the
implementation follows.

Companion documents (they own the detail this page does not repeat):

- [ui/src/queries/README.md](../../ui/src/queries/README.md) — layer map,
  per-area manifests, usage inventory.
- [ui-server-state.md](ui-server-state.md) — policy contract: server vs client
  state, key schema, consumer manifest.
- [architecture.md — UI server state](architecture.md#ui-server-state) — the
  short system-level summary and area map.

## Status

Each phase is the work that resolved one of the original audit findings (F1–F5,
last column). F4 keeps its numbered anti-pattern ledger: #1–#13 closed, #14–#17
in the sanctioned table below.

| Workstream | Scope | Findings | Outcome |
|---|---|---|---|
| **P1** — deprecation sweep | `fetchQuery` → `queryClient.query()`; ESLint guard | F1 | **Done.** Zero non-test `fetchQuery` |
| **P2** — transport + writes | One axios transport, one error notifier, `writeAndInvalidate` / `useUpload`, one invalidation owner | F2, F5 | **Done.** SSE stays on fetch; one interceptor with GET silent and status-mapped copy; `invalidateQueries` is ESLint-guarded |
| **P3** — component mutations | `useMutation` at named write sites; double-toast sweep | F2 | **Done.** Component writes converted; store writes on `writeAndInvalidate`; `runCommand` → `trainingWritePlan`. Long-lived job/stream flows stay imperative by design |
| **P3.1** — mutation consistency | Legacy studio CRUD handlers | F2 | **Done.** Lyric Studio CRUD, prompts, presets and song deletes converted |
| **P4** — reads and timers | Storm poll/control, disco wait, VST poll, scans | F3 | **Done.** Uploads on `useUpload`; polls on `refetchInterval`/`pollWhile`; disco on `waitForQuery`; scans/previews converted. No component-owned network interval remains outside the queue executor and health probe |
| **P5** — env form | `useEnvSettingsForm` over `useQuery` | — | **Done.** Draft/seed/save lifecycle + draft-safety tests |
| **P6** — composers and dedup | One factory per entity, duplicate factories removed | F4 | **Done.** F4 #1–#13 closed; #14–#17 sanctioned |
| **P7** — structural | Training SSE second owner, audio-queue executor state | F3 remainder | **Design recorded; code deferred** (see §7) |

**Verification (2026-10-27):** `tsc -b` clean; UI suite **452 pass / 0 fail /
1 skip**; whole-`src` ESLint **824 findings**, all pre-existing categories and
zero project-guard hits; `npm run build` ✓; `node tools/docs/check-docs.mjs` →
`ok`.

## Architecture

```
[ UI components ]      consume query state, trigger mutations
       ↕
[ TanStack Query ]     cache, dedup, retry, isPending/isError
       ↕                queryManager is the only invalidation owner
[ Axios transport ]    one instance; auth + global error interceptors
       ↕
[ REST API ]           SSE is a separate push channel into the cache
```

| Concern | Owner | Rule |
|---|---|---|
| HTTP config, auth, timeouts | Axios instance + interceptors | Bearer from the session accessor; slow routes use `SLOW_ROUTE_TIMEOUT_MS` |
| Cache, dedup, retry, status | `queries/contract.ts` + `client.ts` | staleTime 30 s, gcTime 5 min, focus refetch off, retry ≤ 2 for network/5xx |
| Errors | Axios response interceptor | The one notifier; GETs stay silent. A component that renders its own error line passes `silent: true` |
| Invalidation | `queries/invalidation.ts` | Only file that calls `invalidateQueries`; writes name events or exact keys |
| SSE | `queries/sseBridge.ts` | Streams never become a second fetch owner; writes patch or invalidate the same entries |
| Non-React waits | `queries/wait.ts` | One `QueryObserver` waiter with auth-epoch guard and duplicate suppression |
| Job follows | `queries/workflowFollow.ts` | One loop: abort plumbing, epoch guard, 50 ms coalesced invalidation |

## Keys

Every key is the five-slot tuple built by `serverKey()`:

```
['hs', resource, scope, id, filters]
```

`resource` is a shared name from `keys.ts` or `<area>/<name>`. `scope` carries
the API base and, only where the answer depends on them, `session` (opaque
epoch, never a token), `worker` (training target; `null` = this PC) and
`backend`. `normalizeFilters` sorts and drops empty values so equal requests
share an entry. A `queryFn` reads its target from its own key via `scopeOf()` /
`workerOf()`, never from a live selection.

## The pattern by entity type

The same shape is used for every resource class:

| Entity type | Pattern | Examples |
|---|---|---|
| Collection + detail | One factory each; detail key carries the id | `songsOptions`/`songOptions`, `trainingQueries.datasets`/`dataset`, `runQueries.mm3Runs` |
| Singleton / snapshot | One factory, no id | `envOptions`, `pluginsOptions`, `healthOptions`, `trainingQueries.capabilities` |
| Job / status | Factory + `pollWhile`, `staleTime: 0` | `trainingQueries.job`, `runQueries.workerUpdate`, `postProcessStatusOptions`, `sa3PreviewOptions` |
| Form-seeding read | `query()` with `staleTime: 0`, never observed | `readSong`, `readAudioQueue`, `trainingQueries.sampleYue2`, `readSnapshot` |
| Cross-area resource | `SHARED` name + `sharedKeys`; the owner exports the factory, other areas re-export or call it | `sharedKeys.songs`, `sharedKeys.workflowJob`, `gpusOptions`, `browseOptions` |
| Store / service read | Imperative `query()` through the area's `read*` helper | `shell-queue/queue.ts`, `preferences.ts`, `cover-lyrics/reads.ts` |
| Write in React | One `useMutation`; `onSuccess` invalidates via `queryManager` | Component writes, `useEnvSettingsForm`, `useReferenceTracks` |
| Write outside React | `writeAndInvalidate(client, fn, plan)` | `trainingStore`, queue/store commands |
| Stream-backed | `bridgeEvents` / `followWorkflowJob` map frames to the cache | downloads, workflows, training run events |

**Key naming.** `training-data` declares its names once in `TD` and
`training-runs` in `TR`; shell-queue, global-models and studios export one
named factory per resource; cover-lyrics uses `snapshotOptions(domain, path)`
for the generic wire-snapshot case, and sa3-previews keeps `sa3PreviewKeys`.
All of these produce the same five-slot key, and every factory returns
`queryOptions(...)` (a few compose one with a spread for a per-resource
override). `Worker` is defined once in `keys.ts` and shared by both training
areas.

## Conventions

### Reads

- Declare an options factory in the owning area; consume it with
  `useQuery(factory(...))`. Never build a key or `queryFn` in a component.
- Override `enabled`, `retry` or `refetchInterval` by spreading the factory;
  do not fork it.
- One-shot reads that seed a form or a wizard use `queryClient.query()` with
  `staleTime: 0` and are never observed.

### Writes

- A React write is one `useMutation`; pending/error derive from `isPending` /
  `error`.
- A non-React write is `writeAndInvalidate`; the plan argument is mandatory.
- Long-lived job/stream orchestration stays imperative with its own request
  and progress state.
- Optimistic writes need an `onError` restore (SongBuilder's section ops are
  the only current case).

### Invalidation

- `queryManager.events` for cross-cutting writes; `queryManager.invalidate`
  with captured keys for parameterized writes.
- `trainingWritePlan` covers training commands (worker scope + preparation
  pair).
- Deleting cancels old reads before the command and again after success, then
  removes the accepted rows.

### Polling

- `refetchInterval: pollWhile(predicate)` — terminal stop, error backoff to
  30 s. Fixed cadences are allowed only when a missed tick is worthless and
  must be recorded in the sanctioned table.
- Non-React code uses `waitForSnapshot` / `waitForQuery`, not its own timer.

### Errors

The axios interceptor is the only failure notifier: GETs never toast (reads
render `isError` / `QueryError`), aborts never surface, and a command passes
`silent: true` when it renders its own failure line. Status mapping: no
response → unreachable, one deduped warn on 401, translated `api.error.*` for
403/404/5xx, otherwise the server's `error` field. Uploads
stay on XHR for progress but route failures through the same handler; their
timeout is a silence watchdog, not `xhr.timeout`.

### Hooks

The default is factory-in-component. Named hooks exist when the query
lifecycle or derived state is shared (`useRunJob`, `useJobSelection`,
`useReferenceTracks`, `useVram`) or the hook owns non-query work
(`useDownloadStream`, `useCaptionFile`, `useEnvSettingsForm`). Single-consumer
wrappers may sit next to their component; move them into `queries/<area>/`
when a second consumer appears.

## Inventory (non-test, 2026-10-27)

| API | Count | Note |
|---|---|---|
| `useQuery` | 137 sites / 86 files | Declarative reads — the norm |
| `useQueries` | 3 / 3 | Worker dispatch, worker list, curated profile |
| `useMutation` | 116 / 45 | Named writes carry a pending/error lifecycle |
| `queryClient.query()` | 64 / 29 | One-shot reads; form/store/service seeding |
| `queryClient.fetchQuery` | 0 | Renamed by P1; guarded |
| `getQueryData` | 4 / 4 | SSE diff, optimistic restore, projections, peaks |
| `setQueryData` | 19 / 11 | SSE writes and deliberate in-place patches |
| `useQueryClient` | 50 / 48 | Mostly to call `queryManager` |
| `invalidateQueries` | 2 calls, 1 file | `queries/invalidation.ts` only |
| `cancelQueries` / `removeQueries` | 18 / 6 | Allowed anywhere; they drop work, they do not refetch |

## Sanctioned exceptions

| Exception | Why it stays |
|---|---|
| SSE streams (`sharedEventSource`, `useEventSource`, `bridgeEvents`) | Axios cannot stream response bodies; the bridge writes the same cache |
| Media/peaks (`StemMixer`, `useAbEngine`, `useStreamAudio`, `peaksClient`) | Binary playback, not JSON server state |
| `/api/health` probes (`App.tsx`) | Liveness transport; must not pollute the cache |
| Sidecar text reads (`lrcUtils`, `wordLrcUtils`, `shell-queue/lyrics.ts`) | Text payloads outside the JSON transport, keyed through `sharedKeys` |
| Queryable POST (`yue2CoverApi.ts`) | Read-only, idempotent, body in key; bounded key cardinality is a watch item |
| `useDownloadStream` disabled observer | Deliberate SSE cache slot (F4#14) |
| `waitForSnapshot` / `waitForQuery` | Services and stores cannot use hooks |
| Fixed cadence (Directed Drift 2 s, VST GUI 1.5 s) | A dropped tick is replaced by the next one |
| Queue server projection | Executor owns its cadence; every read still goes through the cache |
| `Sa3TrainCard` local status factory | F4#17 until SA3 moves into `training-data` |
| `Yue2CoverDrift`, `useCoverArtGeneration` follow-up | Result is module state / a `cover-art-updated` event |
| `BackendToggle`, `MonitorBar` observers | Side-effect-only: the store projection owns the visible state |
| `LyricsBar`, `SectionMarkers` | Sidecar text; absent and failed both mean "no lyrics" |
| `NoModelsBanner` | Derived banner; an error must not claim "no models" |
| `SettingsPanel` health/worker reads | Ancillary status; the env hook renders its own line |

## Open work

1. **Read failure states (§4.12) — closed.** `components/shared/QueryError.tsx`
   plus inline `isError` handling covers every consumer. The last real gaps
   (reference browser, Ollama model picker, PP-VAE/StableStep/adapter probes)
   were fixed 2026-10-27; the six remaining observers are sanctioned below.
2. **`compareStore` (§4.13).** Session list/detail/diff/analysis still live in
   a hand-rolled store instead of a `queries/compare/` slice. Largest remaining
   migration.
3. **P7** — the two structural migrations below.

## P7 — structural design (deferred)

Both sites keep a second copy of state the Query cache also owns. They are not
bugs today; they are the last structural drift. Implementing them touches
interactive job lifecycles, so each needs staged diffs plus a manual smoke
(start / cancel / terminal / engine park / reload).

### 7.1 Training SSE job frames

**Now:** `useTrainingStream` opens the job stream and writes `job`, `progress`
and `status` frames into `trainingStore.activeJob`; `training-runs/events.ts`
opens the same stream through `bridgeEvents` for invalidation, and `useRunJob`
observes `trainingQueries.job`. Two readers, two copies.

**Target:** Query owns the job. `bridgeRunEvents` becomes the only opener and
applies frames with `setQueryData` (merge, never blank a field); the store
keeps only `activeJobId` and `trainingWorker`; a `useActiveTrainingJob()` hook
reads the selected id through `useRunJob`. Delete the job/progress/status
branches and the second EventSource. Samples, logs, previews and metrics stay
store-owned until they get their own slices.

**Order:** (a) cache writes in `bridgeRunEvents`; (b) `useActiveTrainingJob`
and read-heavy cards; (c) delete the store's job writes; (d) remove the
duplicate opener.

**Watch:** 181 `activeJob` references; terminal frames race the stream close
(`refreshAfterJob` already dedupes); MM3/YuE2 status routes share the frame
vocabulary. **Exit:** one EventSource per job, no `TrainingJobSummary` in the
store.

### 7.2 Audio queue executor

**Now:** `stores/audioGenQueueStore.ts` runs its own projection timer, parks
items when the engine is unavailable, and copies `readAudioQueue` results into
`_state.items`. The reads already go through Query; the cadence is local.

**Target:** `audioQueueItemsOptions()` gets a dynamic `refetchInterval`
(`pollWhile(data => data.items.some(active), ACTIVE_POLL_MS)`), subscribed by
`useAudioQueueProjection()`. The projection timer is deleted. The executor
keeps submission scheduling, the engine-park rules and the 2.5 s
`_pollUntilDone` job read, and receives projected rows through one reducer.

**Watch:** browser→server owner migration, offline persistence, song-delivery
deduplication, `_pollUntilDone`. **Exit:** no `setInterval` for server queue
reads; one dynamic refetch policy.

## Verification

```bash
cd ui && npx tsc -b
cd ui && node --import ../server/node_modules/tsx/dist/loader.mjs --test "src/**/*.test.ts"
node tools/docs/check-docs.mjs
```

Exit-criteria greps (from `ui/`):

```bash
grep -rn "fetchQuery" src --include="*.ts" --include="*.tsx" | grep -v "\.test\."           # empty
grep -rn "\.invalidateQueries(" src --include="*.ts" --include="*.tsx" | grep -v "\.test\." # invalidation.ts only
grep -rn "new FormData(" src/services --include="*.ts"                                      # httpClient.upload only
grep -rn "queryKey:" src/components --include="*.tsx" | grep -v "Options()"                 # only F4#14's SSE slot
npx eslint src 2>&1 | grep -c "no-restricted-syntax"                                        # 0
```

Expected UI suite: **452 pass, 0 fail, 1 skip**.

## Phase history

- **2026-10-20** — audit written (F1–F5).
- **2026-10-21** — P1 (fetchQuery rename + guard) and P2 (axios transport,
  global interceptor, write helpers) shipped.
- **2026-10-22** — P3 (component mutations, double-toast sweep) and the
  post-P3 write-site audit shipped.
- **2026-10-23/24** — point-in-time read/write/imperative audits closed.
- **2026-10-25** — last P3 stragglers (extract-kick, quit/restart) moved onto
  the transport.
- **2026-10-27** — HeartMuLa re-audit (factory + invalidation + mutation
  fixes, ESLint invalidation guard); P5 (env hook) and P6 (`yue2CaptionSource`
  factory) closed; P7 design recorded. Entity-pattern audit: `Worker` unified
  in `keys.ts`, `training-runs` key names centralised in `TR`, all factories
  return `queryOptions`, and the last five direct `localOptions` component
  usages moved onto their area factories. Read-failure sweep closed §4.12
  (reference browser, Ollama picker, PP-VAE/StableStep probes).
