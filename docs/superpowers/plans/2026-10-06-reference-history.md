# Reference history implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. Windows-specific work remains owned by the agent on the Windows machine; do not duplicate it.

**Goal:** Recover session-wide references, explicit edit evidence and earlier mention sources outside the hot message window, with bounded memory and lazy older-history retrieval.

**Architecture:** Stream only the selected session's canonical rollout files through existing provider adapters. Keep reference metadata separately from the hot messages, incrementally read appended bytes, rebuild replaced files, and stop reads when visibility changes. Historical pagination must recover references and mention sources beyond the bounded hot index before this plan is complete.

**Tech stack:** TypeScript, Node 22.13+, existing JSONL tail reader and provider adapters; no runtime dependency or transcript mutation.

**Spec:** `docs/design/herdr-prism.md`, provider provenance, Refs, limits and selected-visible-session sections.

## Global constraints

- Reuse canonical provider/session identities; never guess a file from cwd.
- No network requests, automatic opens, hidden reasoning, or transcript writes.
- Heavy parsing/stat work runs only for the selected visible session.
- Keep hot messages at 200. Reference metadata and source histories must be bounded and explicitly label limited coverage.
- Preserve latest-mention grouping, successful explicit edit evidence and earlier source identities.

## Review focus

- More than 200 unrelated messages must not erase an earlier reference or edit.
- Duplicate mirrors, late tool results and replayed messages must not create duplicate sources or reorder newer mentions backward.
- Rotation, truncation and file loss must rebuild or label partial history rather than retain invented current facts.
- Visibility changes during a read must stop further reads and prevent publication to the wrong session.
- Limits on hot targets/sources must support lazy recovery of older data, not silently narrow the full requirement.

## Task 1: Streaming reference recovery

**Files:** `src/content/refs.ts`, new `src/providers/reference-history.ts`, `src/providers/index.ts`, `src/providers/tail.ts`, `src/runtime/collector.ts`, TUI types/screen, native count publication; content/provider/collector/cadence tests.

**Interfaces:** `ReferenceList.update(messages: Message[]): void`; `ReferenceHistory.read(files: string[], isCurrent: () => boolean): Promise<{refs: ContentRef[], limited: boolean} | undefined>`; `ProviderIndex.readReferences(provider, ref, isCurrent)` forwards only canonical files for the exact session. Cancellation is an optional fifth `JsonlTail.read` predicate checked outside record parsing.

- [x] Add failing tests for early reference/edit/source retention after 250 unrelated messages, subsequent latest mention, duplicate mirrors and incremental append.
- [x] Implement synchronous metadata reduction with bounded targets/sources; existence checks occur after parsing, with bounded concurrency and visibility checks.
- [x] Integrate incremental per-file tails, generation resets, source availability and collector visibility guards. Clear readers on provider-index close.
- [x] Prove rotation/truncation and cancellation, retained hot-message limit, latest grouping and no hidden-session reads.
- [x] Run typecheck/build, full platform-appropriate tests, and staged isolated Herdr acceptance; commit the component and evidence.

## Task 2: Older target and source pagination

**Files:** reference history reader, provider index, TUI state/actions/entrypoint, provider/TUI tests and acceptance documentation.

**Interfaces:** Add bounded on-demand reference pages and per-target mention-source pages, identified by immutable source/message cursors; the selected visible session remains the only permitted body reader.

- [x] Write failing tests with more than 2,000 distinct targets and more than 100 mentions of one target; older pages must recover first-source IDs and explicit edit evidence without unbounded hot memory.
- [x] Add lazy source/target pages and TUI navigation that restores the prior reader position and jumps to exact historical messages.
- [x] Prove mirror deduplication, file replacement, cancellation and bounded memory across paged histories.
- [x] Run full tests and exact staged live acceptance; update the audit only for behavior actually proved.

## Execution record

The existing goal already authorizes implementation of the reference requirements. Execute inline and preserve the full scope above. Native focus badges remain unimplemented until a public client navigation/endpoint-scope contract can prove the mapping; server snapshots alone cannot detect combined-machine navigation.

Task 1 evidence is recorded in `docs/implementation-progress.md`: 97 targeted
tests, combined strict macOS/Linux suites and staged live macOS/actual SSH
acceptance. The selected-visible source failure retry and standalone successful
patch regressions failed before their corrections. The current hot reference
limits were explicitly marked partial while Task 2 remained required.

Task 2 implements 50-item default pages (200 maximum), at most 201 candidate
entries per scan, and bounded UI caches of 500 targets/sources with 4 MiB per
reader. Two metadata scans verify latest occurrences and refill older candidate
windows without a lifetime set of IDs. Page cursors verify file versions and
target scope; exact source cursors include file identity, offset and visible-body
fingerprint. `b` loads older items, `B` reloads, and nested Escape returns to saved
source/target anchors. Claude unfinished visible assembly is separately bounded
to 16 heads / 1 MiB and diagnoses overflow. Tests cover 2,105 targets, 150 mirror
mentions, 405 targets in one message, same-ID completed revisions, replacement,
in-flight cancellation and unfinished Claude blocks. Actual macOS/Linux Herdr
`--references` acceptance exercises the corresponding keyboard/source return flow.
The broader product goal and its remaining performance/host/mixed-provider gates
are unchanged.
