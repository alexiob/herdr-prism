# Herdr Prism Implementation Plan

> **For agentic workers:** Use test-driven development and the parallel-agents workflow for the independent modules below. The root implements and integrates the runtime and UI; a fresh reviewer checks the complete result.

**Goal:** Fully implement and test the macOS/Linux/Windows Herdr plugin described in the specification.

**Architecture:** Typed evidence adapters and OS samplers feed a reconciled session graph. A foreground-owned collector publishes native sidebar metadata and drives a six-view right-side terminal dashboard. Configuration changes are explicit, reversible, and isolated from collection.

**Tech Stack:** TypeScript strict mode, Node 22+, Node test runner, Rust standard-library native helper, Herdr protocol 22.

**Spec:** `docs/design/herdr-prism.md`

## Global Constraints

- macOS, Linux, and Windows are first-release targets; platform execution evidence is required before claiming full cross-platform validation.
- Node 22+; compiled ESM release files, no runtime dependency installation or downloads.
- Plugin ID `iob.herdr-prism`, metadata prefix `hat_`, source `plugin:iob.herdr-prism`.
- Never manufacture goals, token counters, synthetic native agent rows, detached-process ownership, or resource measurements.
- Native metadata: 16 keys per report, 32 retained per pane, TTL refresh; configuration: 16 rows/16 tokens per row.
- Collect visible user/assistant messages, omit hidden reasoning and system/developer content.
- Startup and event hooks are finite; the foreground inspector owns continuous work and its helper.
- User configuration, provider instructions and live agent sessions are not modified by tests.
- CPU 100% = one logical core; resident memory is RSS sum on Unix and working-set sum on Windows.
- Goals/tasks/user To-do are separate; explicit complete ACTION lists and local checkbox overlays.
- Terminal text is untrusted; sanitize controls, explicit argv, bounded data, no eval.

## Review Focus

1. A pane or PID reused while a user acts must not inherit the previous occupant's data or ownership.
2. Provider records may rotate, arrive partially, repeat cumulative values, or have incompatible cache semantics.
3. Paths can contain Unicode, spaces, newlines, drive letters, UNC roots and symlink aliases.
4. Multiple Herdr clients/plugins may change focus, native projection or config concurrently.
5. The collector can disconnect, be disabled or lose its helper; stale data must remain labeled and all owned children must stop.

## Shared Interfaces

`src/model/types.ts` is root-owned and defines `Message`, `ToolCall`, `UsageRecord`, `GoalRecord`, `SessionEvidence`, `ProcessSample`, `SampleBatch`, `HerdrAgent`, `HerdrSnapshot`, `DashboardSession`.

- Provider adapters export `ProviderIndex` with `refresh(): Promise<SessionEvidence[]>`, `resolve(provider, ref): Promise<SessionEvidence | undefined>`, `close(): void` from `src/providers/index.ts`. Content exports `extractRefs(messages, cwd)`, `TodoList.update(messages)`, `toggle(id)`, `toJSON()/restore()`.
- Process exports `createSampler(options): ProcessSampler`, `sample(): Promise<SampleBatch>`, `close(): Promise<void>` from `src/process/sampler.ts`; `ProcessTracker.update(batch, roots)` and `view(sessionKey, includeDescendants?, descendants?)` from `src/process/ownership.ts`. Metrics export `reduceUsage(records)`, `summarizeMessages(messages)`, `SampleHistory`.
- Git exports `GitCache.get(cwd): Promise<GitSummary>`, `invalidate(cwd?)`, `close()` from `src/git/cache.ts`.
- Config exports `loadSettings(configDir): Promise<Settings>`, `configure(configPath, stateDir, options)`, `unconfigure(configPath,stateDir)` and `nativeRows()` from `src/config/index.ts`. Settings include native mode, provider homes, ACTION parser enabled, sample interval, follow, ASCII, monochrome, optional cost rates.
- Root owns all other modules and integrates these APIs. Workers own their modules' additional exported types; no worker edits shared types without a root request.

## Task 1: Contracts, build and runtime protocol

**Files:** `package.json`, lockfile, `tsconfig.json`, `scripts/build.mjs`, `src/model/*`, `src/herdr/*`, `test/herdr.test.ts`, schema fixture.

- [ ] Write tests for unique provider/session identities, cycles/conflicting/missing parents and pane replacement; RPC framing, out-of-order replies, errors, disconnect, oversized input, lost events and subscribe-before-snapshot reconciliation.
- [ ] Run tests and record the missing-feature failure.
- [ ] Implement types, graph/reconciliation, strict schema validation, bounded newline RPC client, reconnecting subscriptions and capabilities.
- [ ] Verify with `npm run check`, `npm test`; build dependency-free ESM with `npm run build`.

## Task 2: Provider evidence and content

**Files:** `src/providers/*`, `src/content/*`, provider/content fixtures and tests.

- [ ] Write tests for exact Codex/Claude/Pi resolution, four-level lineage, same-cwd isolation, hidden-content omission, tools/edits, token/cache/model/turn records, partial writes, rotation/truncate, deduplication and unavailable files.
- [ ] Observe RED, implement incremental bounded index/adapters and normalization.
- [ ] Write RED tests for reference provenance/deduplication and ACTION complete-list semantics, fenced examples, streaming blocks, first-seen age and persisted local checkboxes.
- [ ] Implement refs, To-do and goal/task separation; verify all owned tests and typecheck.

## Task 3: Telemetry and metrics

**Files:** `src/process/*`, `src/metrics/*`, `native/sampler/*`, metric/native tests and fixtures.

- [ ] Write RED tests for CPU counter warmup/delta/reset, exact wide identities, exclusive nearest-root ownership, reparenting/PID reuse/shared children, subtree union, partial reads and explicit launch ledger.
- [ ] Implement Linux procfs sampler and Rust macOS/Windows helpers with versioned JSONL stdin-owned lifetime; verify local native helper and teardown.
- [ ] Write RED tests for usage cumulative/delta/cache/subtree semantics, model/counter epochs, unknown context/timing, bounded history/gaps/observed peaks and cost evidence.
- [ ] Implement reducers and history; run Node and Rust suites plus compiler checks available locally.

## Task 4: Git and reversible configuration

**Files:** `src/git/*`, `src/config/*`, tests with disposable Git repositories/config files.

- [ ] Write RED tests for branch/worktree canonical identity, staged/unstaged net changes, untracked/binary/rename/conflict/unborn/detached/upstream and timeout stale state.
- [ ] Implement bounded shared cache and explicit-argv read-only Git operations.
- [ ] Write RED tests for syntax-preserving TOML configure/unconfigure, no duplicate tables, conflicting foreign ownership, concurrent hash changes, fallback rows, backup and user-modified preservation.
- [ ] Implement settings and safe atomic updates, Unix permissions/Windows ACL policy; verify owned tests.

## Task 5: Foreground collector and actions

**Files:** `src/runtime/*`, `src/state/*`, `src/native/*`, `src/entrypoints/*`, `herdr-plugin.toml`, integration tests.

- [ ] Write RED integration tests using a real fake-socket server and fixture provider homes: reconcile complete dashboard, metadata TTL/chunking/readback, owned view, no write loops, failure freshness and shutdown.
- [ ] Implement collector schedules, source joins, local state/lock, explicit goal/launch actions, finite startup/events, right pane open/move/resize/follow/pin and owner-safe cleanup.
- [ ] Verify manifest commands and every RPC request against bundled schema; test native-only/inspector-only modes and competing view owner.

## Task 6: Six-view terminal dashboard

**Files:** `src/tui/*`, UI tests and rendered artifacts.

- [ ] Write RED tests for 26/42/80-column layouts, Unicode/wide characters/control stripping, keyboard/mouse/folding/filter/pagination, history/tab selection, focus-generation safety and new-message reader anchors.
- [ ] Implement Overview sparklines, Agents arbitrary-depth lineage/worktrees, Processes, Messages inline/full popup, grouped Refs open/copy/source jump, To-do toggle/copy/source jump; metric definitions/provenance, help, settings, accessible export.
- [ ] Verify with deterministic inputs and PTY interaction/capture; isolated Herdr session confirms right placement, focus, metadata and teardown.

## Task 7: Distribution and full acceptance

**Files:** `README.md`, `docs/install.md`, `docs/compatibility.md`, `docs/privacy.md`, `.github/workflows/*`, release tools/notices, requirement evidence ledger.

- [ ] Build compiled release tree and native artifact checksums; installation check has no runtime toolchain/downloads.
- [ ] Add macOS/Linux/Windows CI for typecheck/tests, native sampler, release artifact selection, named pipes/sockets, path/config/Git and PTY/ConPTY tests.
- [ ] Run local full test/build/native/integration/soak/performance checks and independent review; fix findings with reproducing tests.
- [ ] Execute full acceptance scenario and verify unconfigure restores prior settings and terminates only owned processes.
- [ ] Audit each spec requirement against current files and actual outputs. Keep goal active for any missing platform execution or release evidence; do not call cross-compilation a platform runtime test.

## Progress and execution notes

The user explicitly instructed full implementation/testing, so execution follows this plan without another permission handoff. The workspace has no Git repository; sandbox denied `.git` creation. Work remains in the user-provided project directory, with durable progress/evidence in `docs/implementation-progress.md`; no worktree or commits can be created under current permissions.
