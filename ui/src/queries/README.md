# TanStack Query — layer map and remediation ledger

Current state of the server-state layer in `ui/src/queries/` (`@tanstack/react-query`
`^5.104.3`), re-measured **2026-10-28**. The original integration audit ran on
2026-10-23; every finding from it is now fixed, accepted, or recorded as a
sanctioned exception below.

This file owns the layer map, conventions and exception list. It complements:

- [`docs/dev/tanstack-query.md`](../../../docs/dev/tanstack-query.md) — phase
  history (P1–P7) and the migration worklist.
- [`docs/dev/ui-server-state.md`](../../../docs/dev/ui-server-state.md) — the
  policy contract for server vs client state and per-resource ownership.
- `queries/<area>/README.md` — per-area resource manifests.

---

## 1. Layer map

### Foundation

| File | Role |
|---|---|
| `client.ts` | One HMR-stable `QueryClient`: `staleTime` 30 s, `gcTime` 5 min, focus refetch off, reconnect refetch on, retry ≤ 2 for network/5xx, mutations never retried. Mounted once in `main.tsx`. |
| `contract.ts` | Retry predicate, abort detection, `pollWhile()` (1.5 s active, doubling to 30 s while failing). |
| `keys.ts` | Five-slot key schema `['hs', resource, scope, id, filters]`, `serverKey`/`resourceKey`/`scopeOf`, auth session epoch, shared keys. |
| `invalidation.ts` | The **only** file allowed to call `invalidateQueries`; exposes `queryManager` groups, the event map and `invalidateEvents`. |
| `writes.ts` | `writeAndInvalidate(client, fn, plan)` for non-React stores, plus `useUpload()`. |
| `sseBridge.ts` | SSE frames → coalesced invalidations, in-place `setQueryData` updates, `once` ledger, optional per-frame callbacks. |
| `wait.ts` | `waitForSnapshot` / `waitForQuery` — the non-React `QueryObserver` waiter: canonical keys, `pollWhile`, auth-epoch guard, duplicate suppression (`deliverRepeats` opts back in). |
| `workflowFollow.ts` | `followWorkflowJob` — the one job-follow implementation: abort plumbing, auth-epoch guard, 50 ms coalesced invalidation. |
| `client.ts` + `keys.ts` + `AuthContext.tsx` | A session-epoch change cancels and drops every auth-scoped query from the previous token. |

### Resource slices

| Area | Covers |
|---|---|
| `shell-queue/` | App shell, library, songs, queue, settings, lyrics sidecars, preferences, file browse |
| `global-models/` | Models, adapters, plugins, VRAM, backends, capabilities, presets |
| `studios/` | Extraction, separation, workflow, song-builder, inspire/assistant, MIDI |
| `cover-lyrics/` | Lyric Studio (lireek), cover workflows, sidecar snapshots |
| `training-data/` | Datasets, samples, preparation, training reads |
| `training-runs/` | Jobs, review, scores, ladder, workers, status polls, run SSE |
| `compare/` | Compare sessions, take analysis, diff trace, library search |

### Usage (non-test, re-measured 2026-10-28)

| API | Calls / files | Notes |
|---|---|---|
| `useQuery` | **143 / 89** | The established read mechanism; most use `{ ...factoryOptions(), enabled }`. |
| `useQueries` | **4 / 4** | `CuratedProfileModal`, `WorkersPanel`, `TrainingWorkerBar`, compare `SessionView`. |
| `useMutation` | **121 / 46** | Writes with a pending/error lifecycle. |
| `queryClient.query(...)` | **64 / 29** | One-shot reads, form seeding, store/service reads. No `fetchQuery` (ESLint-guarded). |
| `useQueryClient()` | **55 / 49** | Mostly for `queryManager` invalidation helpers. |
| `setQueryData` / `setQueriesData` | **35 / 8** | In-place patches and SSE updates; `setQueriesData` spans cached lists. |
| `getQueryData` | **6 / 6** | SSE diffing, optimistic restore, projections, peaks, compare rollback, training job kind. |
| `invalidateQueries` | **2 calls / 1 file** | `queries/invalidation.ts` only; anything else is an ESLint error. |
| `cancelQueries` / `removeQueries` | **19 / 7** | Allowed anywhere; they drop work, they do not refetch. |
| `queryOptions(...)` | **111 / 18** | Area slices plus the `localOptions` / `snapshotOptions` helpers. |
| Query-layer tests | **16 files** | Keys, contract, SSE bridge, each area, compare, training hooks. |

### Health

| Area | Verdict | Summary |
|---|---|---|
| Client & policy | **Good** | One client; sensible retry/GC; mutations never retried. |
| Keys & auth | **Good** | Canonical five slots; session epoch prevents cross-login leakage. |
| Invalidation | **Good** | One `invalidateQueries` owner; `queryManager` groups + events. |
| Reads | **Good** | Factory-first and auth-aware; residual imperative reads are store/service reads. |
| Writes | **Good** | `useMutation` at component sites, `writeAndInvalidate` outside React. |
| Polling | **Good** | Query-owned `pollWhile` / `refetchInterval` or `waitFor*`; only the health probe is a raw interval. |
| Errors | **Good** | Transport notifies commands once; reads render their own inline failure state. |
| SSE | **Good** | Coalesced, replay-safe, scoped teardown; one opener per job. |
| Stores | **Good** | Every remaining store is client state; Compare was the last server-state island. |

---

## 2. Conventions for new work

1. **Reads:** declare an options factory in the owning area; consume it with
   `useQuery({ ...options, enabled })`. Never hand-build a key or `queryFn` in a
   component.
2. **Writes in React:** one `useMutation` per command, invalidating in
   `onSuccess` through `queryManager`. Use `silent: true` only when the
   component owns the error display.
3. **Writes outside React:** `writeAndInvalidate(client, fn, plan)`; the plan
   is mandatory.
4. **Invalidation:** never call `invalidateQueries` outside
   `queries/invalidation.ts`; add a `queryManager` group instead. Enforced by
   `ui/eslint.config.js` (tests exempt).
5. **Polling:** use `refetchInterval` / `pollWhile` or `waitFor*`. Do not add
   fetching `setInterval`s. A fixed cadence is acceptable only when a missed
   tick is worthless — record it below.
6. **Errors:** reads render an inline failure state; commands are notified by
   the transport exactly once.
7. **Keys:** to move an entry to a new id/scope, add a composer in `keys.ts`;
   never splice a tuple by index.
8. **Optimistic updates:** snapshot in `onMutate`, restore in `onError`.

### Sanctioned exceptions (change the doc before “fixing” one)

| Exception | Why it stays |
|---|---|
| SSE streams (`sharedEventSource.ts`, `useEventSource.ts`, `bridgeEvents`) | Axios cannot stream response bodies; the bridge fills the same cache entries. |
| Media blobs and peaks (`StemMixer`, `useAbEngine`, `useStreamAudio`, `audio/peaksClient`) | Binary playback, not JSON server state. |
| `/api/health` probes (`App.tsx`) | Liveness transport that may reload the page; it must not pollute the cache. |
| Sidecar text reads (`utils/lrcUtils.ts`, `utils/wordLrcUtils.ts`) | Text payloads outside the JSON transport, keyed through `sharedKeys`. |
| Queryable POST (`yue2CoverApi.ts`) | Read-only and idempotent; `filters` carry only answer-changing fields (`songId`/`sourceAudioUrl`, `abc`/`lyrics`). |
| `useDownloadStream` disabled observer | Deliberate SSE cache slot. |
| `waitForSnapshot` / `waitForQuery` | Services and stores cannot use hooks; the observer reuses the same cache and polling policy. |
| Fixed-cadence `refetchInterval` (Directed Drift 2 s, VST GUI 1.5 s) | A missed tick is replaced by the next one, so `pollWhile` backoff only adds latency. |

---

## 3. Remediation ledger

All original findings are closed. The implementation detail lives in the
relevant area README; this table is the index.

| # | Finding | Resolution |
|---|---|---|
| 4.1 | Invalidate-then-bypass cache in `getCachedProviders` | `providersOptions()`; refresh and observers share one entry. |
| 4.2 | Positional key surgery in `Yue2Build` | `withKeyId()` in `keys.ts`; no component indexes a key tuple. |
| 4.3 | Raw delete lifecycle in `RecentExtractions` | Delete is a `useMutation` with inline error; no `refreshTrigger`. |
| 4.4 | Mutations that dirty data but invalidate nothing | Adapter-reference and queue-migration writes invalidate; drift stays module state and cover-art emits `cover-art-updated` (both sanctioned). |
| 4.5 | Hand-rolled polling loops | Disco uses `waitForQuery`; storm drift uses `stormDriftOptions`; VST uses a `QueryObserver`; queue uses `useAudioQueueProjection`. Health probe stays sanctioned. |
| 4.6 | Two `waitForSnapshot` implementations | One owner in `queries/wait.ts`; area paths re-export it. |
| 4.7 | Refetch-via-prop-bump | Parents invalidate at the completion site; `refreshTrigger` props deleted. |
| 4.8 | `enabled: false` observer plus imperative scan | Adapter scan is a `useMutation`; pending/error come from it. |
| 4.9 | Inline key + `queryFn` duplicates | Every row moved onto the owning factory, including the two studio services and `yue2CaptionSource`. |
| 4.10 | `localOptions` used directly in components | All component declarations moved to area factories; `localOptions` is internal to `global-models/`. |
| 4.11 | Duplicate `adapterScanOptions` | One owner in `global-models/options.ts`; `shell-queue/settings.ts` re-exports it. |
| 4.12 | Reads with no failure state | `QueryError` plus inline `isError` handling; the remaining silent readers are listed below. |
| 4.13 | `compareStore` server-state island | Replaced by `queries/compare/` reads/writes with optimistic scoring; the store was deleted. |
| P2#1 | Raw command fetches bypass the transport | Storm control/stop and disco POSTs use `apiClient`; streaming/export/shutdown stay raw. |
| P2#2 | Queryable-POST key cardinality | Keys bounded to fields the answer depends on; hints such as `sourceLabel`/`force` no longer create entries. |
| P2#3 | Literal `refetchInterval` in `TrainingWorkerBar` | `pollWhile` with 3 s active / 15 s idle; failures now back off. |
| P2#4 | Common `staleTime: 0` | Accepted: job/status polls and form seeding need it; no blanket sweep. |
| P2#5 | Hook placement | Factory-in-component by default; named hooks only for shared lifecycles or non-query work. |
| P2#6 | No Query Devtools | Decided against; `getQueryCache()` and the network panel cover debugging. |
| P2#7 | `useQuery({ enabled: false })` as a cache slot | Documented exception (`useDownloadStream`, training job cache observer). |

**Silent read-error readers by design:** `BackendToggle` and `MonitorBar`
(side-effect observers), `LyricsBar` and `SectionMarkers` (absent and failed both
mean “no lyrics”), `NoModelsBanner` (an error must not claim “no models”), and
`SettingsPanel` (health/worker status is ancillary; the env hook renders it).

---

## 4. Audit method

Counts cover non-test files under `ui/src`:

```sh
rg -n "useQuery\("        ui/src --glob '!*.test.*' | wc -l
rg -n "useMutation\("     ui/src --glob '!*.test.*' | wc -l
rg -n "\.query\("         ui/src --glob '!*.test.*'
rg -n "useQueryClient\("  ui/src --glob '!*.test.*'
rg -n "invalidateQueries" ui/src --glob '!*.test.*'
rg -n "fetch\("           ui/src --glob '!*.test.*'
rg -n "setInterval"       ui/src --glob '!*.test.*'
rg -n "queryFn:"          ui/src --glob '!*.test.*'
```

Re-run these after structural changes and update §1 and the ledger rather than
treating the numbers as permanently true.

Current validation: `tsc -b` clean; UI suite **462 pass / 0 fail / 1 skip**;
`npm run build` ✓; whole-`src` ESLint **824 findings**, zero `no-restricted-syntax`
hits; `node tools/docs/check-docs.mjs` → `ok`.
