# TanStack Query — architecture, status, and worklist

`@tanstack/react-query` ^5.104.3, audited against `ui/` on 2026-10-27. This page
is the decision record: what shipped, what is open, and the rules the
implementation follows.

Companion documents (they own the detail this page does not repeat):

- [ui/src/queries/README.md](../../ui/src/queries/README.md) — owner of the
  layer map, conventions, sanctioned exceptions, usage counts and audit method.
  This page links there instead of copying those tables.
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
| **P4** — reads and timers | Storm poll/control, disco wait, VST poll, scans | F3 | **Done.** Uploads on `useUpload`; polls on `refetchInterval`/`pollWhile`; disco on `waitForQuery`; scans/previews converted. No component-owned network interval remains outside the health probe |
| **P5** — env form | `useEnvSettingsForm` over `useQuery` | — | **Done.** Draft/seed/save lifecycle + draft-safety tests |
| **P6** — composers and dedup | One factory per entity, duplicate factories removed | F4 | **Done.** F4 #1–#13 closed; #14–#17 sanctioned |
| **P7** — structural | Training SSE second owner, audio-queue executor state | F3 remainder | **Done.** 7.2 (queue projection) and 7.1(a–d) (one job cache, one stream opener, store keeps only the selected id) shipped |

**Verification (2026-10-28):** `tsc -b` clean; UI suite **462 pass / 0 fail /
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

The module-by-module map and the client policy live in
[queries/README §1](../../ui/src/queries/README.md#1-layer-map). The key schema,
key rules and shared-key table live in [ui-server-state.md#keys](ui-server-state.md#keys).
The table below is the part that changes when a new resource class appears.

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

The read, write, invalidation, polling, delete and hook-placement rules are
owned by [queries/README §2](../../ui/src/queries/README.md#2-conventions-for-new-work).
This page adds the transport-level detail those rules assume, and a new
sanctioned exception changes that table first.

### Errors

The axios interceptor is the only failure notifier: GETs never toast (reads
render `isError` / `QueryError`), aborts never surface, and a command passes
`silent: true` when it renders its own failure line. Status mapping: no
response → unreachable, one deduped warn on 401, translated `api.error.*` for
403/404/5xx, otherwise the server's `error` field. Uploads
stay on XHR for progress but route failures through the same handler; their
timeout is a silence watchdog, not `xhr.timeout`.

## Open work

P1–P7 are closed. §4.12 read failure states closed on 2026-10-27, the
`compareStore` migration (§4.13) closed the same day, the audio-queue projection
timer (P7.2) closed the same day, and P7.1(a–d) closed on 2026-10-28.

The remaining work is P8, the `queryClient.query()` cleanup. It is proposed, not
started: a sanity check on 2026-10-28 confirmed two duplicate fetch owners, found
one dead read, and rejected four candidates that must stay. The roadmap, the
phase order, and the per-site verdicts are in
[the P8 appendix](#appendix-p8-reactive-read-migration).

Compare has its own `queries/compare/` slice: read factories for
sessions/detail/search/analysis/diff, mutation hooks for every command, and an
optimistic score cache with a snapshot rollback. The hand-rolled store was
deleted.

## P7 notes

The status table and history above record that P7 is closed. The lasting
invariants: `bridgeRunEvents` merges `job`/`progress`/`status` frames into
`trainingQueries.job`, `useTrainingJobProjection()` is the single stream opener
in `TrainingStudio`, and `trainingStore` keeps only `activeJobId`, the worker,
and the sample/log/preview/metric reducers. `useAudioQueueProjection()` owns the
queue read with `ACTIVE_POLL_MS` while active and the idle cadence otherwise;
the executor keeps submission scheduling, engine-park rules and its 2.5 s job
read.

**Watch:** MM3 and YuE2 status routes share the frame vocabulary, and a job
stream that 404s after a server restart is synthesized as failed by the bridge's
error probe.

## Verification

The commands, guard greps and current totals are owned by
[queries/README §4](../../ui/src/queries/README.md#4-audit-method). Run them
there rather than copying an expected number into this page.

## Phase history

The outcome index is the status table above; this is the dated log.

| Date | Milestone |
|---|---|
| 2026-10-20 | Audit written (F1–F5). |
| 2026-10-21 | P1 and P2 shipped. |
| 2026-10-22 | P3 and the post-P3 write-site audit shipped. |
| 2026-10-23/24 | Point-in-time read, write and imperative audits closed. |
| 2026-10-25 | Last P3 stragglers (extract-kick, quit/restart) moved onto the transport. |
| 2026-10-27 | HeartMuLa re-audit and ESLint invalidation guard; P5 and P6 closed; P7 design recorded. Entity-pattern audit (`Worker` unified in `keys.ts`, `TR` names centralised, factories return `queryOptions`, last five `localOptions` usages moved), §4.12 read-failure sweep, §4.13 compare migration, P7.2, and P7.1(a–b). |
| 2026-10-28 | P7.1(c–d) closed; P8 measured and sanity-checked. |

## Appendix: P8 reactive read migration

**Status:** Proposed, measured 2026-10-28. Medium priority: duplicated requests
and store copies that drift from the cache.

`queryClient.query()` appears 45 times in non-test code in 20 files. Most of
those calls are correct: services and stores cannot use hooks. The problem is a
subset that duplicates a read the UI already observes through `useQuery`, so the
same key is fetched twice and the store's copy can disagree with the cache.

The 45 call sites split five ways: 3 component reads to observe (P8.2), 3
deferred (P8.4), 4 duplicate or dead (P8.1), 7 Training Studio store snapshots
(P8.3), and 28 sanctioned non-React flows (listed at the end).
`InstaGenPanel.tsx:157` is a fourth component read, but it enters through
`instaWorkflowApi.getDocument`, so it is not in the count. Each phase's table is
the site list; this appendix does not repeat it.

Each phase updates the counts in `ui/src/queries/README.md` and the phase note
here, uses `queryManager` for every invalidation, and takes its reads from the
owning factory. A phase is one commit so it can be reverted alone.

### Verified duplicates

Suspected duplicates were sanity-checked on 2026-10-28 before any removal. Same
key, same data, store readers, and side effects were checked per candidate.

| Resource | Imperative read | Reactive owner | Verdict |
|---|---|---|---|
| pipelines | `trainingStore.loadPipelines` (`stores/trainingStore.ts:1087`) | `MonitorPanel.tsx:247` | Duplicate. The store field has no reader. |
| YuE2 batches | `trainingStore.loadYue2Batches` (`:1117`) | `Yue2BatchPanel.tsx:43`, `useHeartmulaController.ts:36` | Duplicate. One store reader remains, the batch wizard. |
| train-lm / train-dit status | `loadTrainLmStatus` / `loadTrainDitStatus` (`:862`, `:987`) | `plugins/ace.tsx:130-132` | Not a duplicate. Different keys and different answers. See P8.1. |
| backend model catalogue | `backendStore.fetchModels` (`:304`) | `backendStore` projection | Not a duplicate. Callers read the projection right after `await`. |
| backend capabilities / list | `fetchCapabilities` (`:294`), `fetchBackends` (`:273`) | projections | Not duplicates. Warm-up plus `loading`/`error`. |
| VST chain | `vstChainStore.loadChain` (`:179`) | `vst-chain` projection | Not a duplicate. Only trigger of the initial fetch. |
| training job probe | `trainingStore.ts:633` | job query | Keep. Removal can flash a synthesized failure. |

### P8.0 Baseline

Record the checks and totals in
[queries/README §4](../../ui/src/queries/README.md#4-audit-method) before
editing, plus the current `queryClient.query()` call and file counts. Expected
today: the 462 pass / 0 fail / 1 skip suite, a clean `tsc -b`, zero
project-guard findings, docs `ok`, and 45 call sites in 20 files.

### P8.1 Delete the confirmed duplicates

1. `loadPipelines` (`:1087`) plus the `pipelines` and `pipelinesLoading` fields.
   No component, test, or store action reads either field.
   `MonitorPanel.tsx:247` owns `trainingQueries.pipelines(worker)` with its own
   poll. The dataset invalidation at `:1091` only ran after a pipeline command,
   never during that poll, and `refreshAfterJob` plus
   `MonitorPanel.tsx:260-266` already cover the dataset list. Drop the check,
   then confirm by hand that datasets refresh after a stage finishes.
2. `loadYue2Batches` (`:1117`) plus the `yue2Batches` field, after
   `Yue2AitkBatchWizard.tsx:20` moves to
   `useQuery({ ...trainingQueries.yue2Batches(worker), enabled: open })`. Drop
   the explicit re-reads in `startYue2Batch`, `addToYue2Batch`,
   `setTrainingWorker` and `workerCommand`; keep their invalidates.
3. `vstChainStore.pollMonitorStatus` (`:337`). No caller; `MonitorBar.tsx:29`
   owns the query and the store projection mirrors it.

`vstChainStore.scanPlugins` (`:170`) also drops its own read, because
`VstChainDropdown.tsx:42` observes `vstScanOptions`. It must still await the
refetch to clear `scanning`, so it becomes a manager-owned `refetchQueries`, not
a plain delete.

Why the rejected candidates stay:

- `loadTrainLmStatus` / `loadTrainDitStatus` are a latent bug, not a duplicate.
  No caller passes the optional query, so `lastTrainLmQuery` and
  `lastTrainDitQuery` stay undefined and the store always reads empty filters
  (server default size and dataset slug). `plugins/ace.tsx:130-132` reads the
  same factory with the form's `lmSize` and `adapterName`, a different key and
  answer, while `AuditionCard` depends on the store copy for `adapterExists`,
  `adapterDir`, `variantKey` and `lmSize`. Fix it by giving both consumers one
  shared key or by passing the panel's parameters into the loader, and delete
  the dead `lastTrain*Query` state in the same change.
- `backendStore.fetchModels` is load-bearing:
  `PresetSettingsModal.tsx:129-131` reads `models[YUE2]` right after
  `selectModels` resolves, and `audioGenQueueStore.ts:1015-1017` fetches when
  the catalogue is absent before `yue2PickAtEnqueue`. An invalidate does not
  refetch an inactive query, so those reads would go stale.
- `fetchCapabilities` is warm-up after a backend switch and
  `backendStore.query.test.ts` pins its semantics. `fetchBackends` is awaited at
  boot and is the error surface for an advisory read.
- `loadChain` is the only trigger of the initial `vst-chain` fetch; the
  projection never fetches. Rename it to `prefetchChain` if the intent needs to
  be clearer.

Exit: the deleted symbols do not appear in `rg`; the batch wizard fetches
batches itself; Monitor, a "Train on" switch, the YuE2 batch panel and the
monitor bar each produce one request per key.

### P8.2 Component one-shots become `useQuery`

| File | Change |
|---|---|
| `PipelineStageProgress.tsx:66` | Observe `trainingQueries.job(worker, jobId)` with `enabled: !!jobId`, then adopt on `data`. It currently races `useActiveTrainingJob()`. |
| `SendToLyricStudio.tsx:54` | `useQuery({ ...tq.lyricStudioPreview(worker, datasetId), enabled: open })`; seed the form once from `data`. |
| `BatchImportWizard.tsx:166` | `useQuery(tq.browse(dir, 'trainingAudio'))`, `enabled: open && !!dir`. Rows stay client state. |
| `InstaGenPanel.tsx:157` | Replace the `instaWorkflowApi.getDocument` recovery read with `documentOptions(id)`. |

`BatchImportWizard.tsx:134` stays sequential on purpose: 20 folders must not open
20 concurrent recursive reads. Revisit with `useQueries` only.

### P8.3 Training Studio read migration

The largest phase; removes the store's remaining server snapshots.

1. Add `useTrainingCapabilities()` over `trainingQueries.capabilities(worker)`
   (it cannot reuse the backend-scoped `useCapabilities`), move the training
   components off `store.capabilities` (`:571`), then delete the field and
   loader.
2. `PreprocessPanel` observes `preprocessStatus(worker, id)` (`:822`) with
   `pollWhile`; delete the loader and field; the two effects at `:73-84` become
   one terminal invalidate.
3. `AuditionCard` observes `trainingQueries.auditions(worker, id)` (`:1011`);
   delete `loadAuditions` and the field.
4. Move `datasets` (`:585`) and `detail` (`:603`) to their factories, leaving
   the store with `selectedDatasetId` and `trainingWorker`, as P7.1 did for jobs.
   This touches `DatasetList`, `BatchImportWizard`, `Yue2AitkBatchWizard`,
   `Yue2AitkTrainCard`, `TrainPanel`, `PreprocessPanel`, `RefinePanel`,
   `BuildPanel`, `SendToLyricStudio`, `DatasetDetail`, `SampleRow`,
   `TrainingStudio` and `plugins/ace.tsx`. Ship item 4 as its own commit.
5. Move `trainLmStatus` (`:862`) and `trainDitStatus` (`:987`) last. Fix the key
   first: no caller passes the filters, so both still read the server default.

Exit: no store snapshot is also observed by `useQuery`, and one key has one
owner.

### P8.4 Remaining reads and contract reconciliation

1. Add `audioGenerationsOptions(genId, lyricsSetId)` and use `useQueries` in
   `RecordingsTab.tsx:122` for the fallback statuses.
2. Convert `ProviderSelector.getCachedProviders` to `getQueryData` plus an
   `ensureQueryData`-style refresh inside the handler, or list it in the
   exception table.
3. Regenerate the counts in `ui/src/queries/README.md`, and fold the final keep
   list into its sanctioned table.
4. Add an ESLint rule beside the `fetchQuery` ban: `queryClient.query()` is
   disallowed under `src/components/`, with an explicit exemption list. Without
   the guard this drifts back.

Exit: the inventory matches `rg`, the exception table lists every remaining call
site, and `npx eslint src` reports zero project-guard hits.

### Sanctioned flows (28)

These keep their imperative read. The final exception table gets this list.

- Binary and text payloads: `audio/peaksClient.ts:52`,
  `utils/yue2CaptionSource.ts:214`.
- Service or executor reads: `services/yue2CoverApi.ts:210`,
  `services/supersepApi.ts:122`, `services/stemStudioApi.ts:181`,
  `queries/shell-queue/queue.ts:125-146` (six executor reads),
  `queries/shell-queue/preferences.ts:44,58`,
  `queries/global-models/presets.ts:23`, `queries/cover-lyrics/reads.ts:28`,
  `queries/cover-lyrics/workflows.ts:27,28`, `queries/studios/workflows.ts:13,14`.
- Store flows: `trainingStore.ts:633`, `:1624`, `:1675`, `:1679`;
  `backendStore.ts:273`, `:294`, `:304`; `vstChainStore.ts:179`.
- Pure handler: `components/training-studio/sendAuditionToCustomGen.ts:14`.

### Definition of done

1. No `queryClient.query()` in component render paths; the handler-only
   `ProviderSelector.getCachedProviders` is converted or listed.
2. Every remaining store read is non-React by necessity and named in the
   sanctioned table.
3. No key has two fetch owners. Verify through Monitor, a "Train on" switch, a
   backend switch, and opening the VST chain.
4. `tsc -b` clean, UI suite green, `npm run build` succeeds, the guard count is
   zero, `check-docs` prints `ok`, and the inventory numbers are regenerated.
