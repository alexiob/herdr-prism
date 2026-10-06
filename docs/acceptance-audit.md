# Non-Windows acceptance audit

Original read-only audit: 2026-10-06 at source `47e7a43`, against `docs/design/herdr-prism.md`. No product code changed in that audit, and Windows was deferred. Subsequent corrections are recorded separately below. Performance measurements belong to the separate performance investigation and are not assessed here.

Subsequent remote amendment: the user chose per-server Prism installation and
kept exact client visibility as an upstream Herdr API dependency. See
[remote support](remote.md) and [the host contract](remote-visibility-api.md).
Host-prefixed native ranks prevent cross-machine ordinal interleaving. The
per-server root-order correction is recorded below. Zoom-hidden panes now have
a targeted pause regression check. The findings below remain anchored to the
audited revision rather than certify later source changes.

## Evidence boundary

The latest completed [Unix CI run](https://github.com/alexiob/herdr-prism/actions/runs/37450329250) tested `376d3a6b1453275485c6f52f34111d791612b6e9`: all eight macOS/Linux architecture/Node-version jobs passed. This is actual platform evidence for that revision, not certification of every subsequent edit at the audited head. The workflow runs `scripts/live-features-test.mjs` and archives its results. The feature fixture uses two synthetic Pi-shaped sessions and idle harness-labelled processes in a real isolated Herdr server; it is not a live model interaction or a three-provider integration test.

Already demonstrated by that advanced gate: native metadata readback, right placement and cross-tab follow, pin retention, hidden body pause and visible resume, native metadata TTL expiration/resumption with foreign tokens preserved, stale occupant rejection before focus/publication, collector exit/restart, owner-qualified view cleanup, and uninstall conflict refusal followed by safe recovery. These must not remain listed as unperformed generic gates. Native client pixel rendering and compatibility with the actual Radar/Pi-tree plugins are distinct from the headless readback and synthetic foreign-owner checks.

## Specific remaining behavior gaps

The following are source-backed findings, not failures reproduced on a native client during this audit. Priority indicates acceptance impact rather than security severity.

### P2 — Native numerical badges are never implemented

`src/native/publisher.ts:71` always writes `hat_index: ''`. The safe omission for ambiguous multi-machine/competing projections is correct, but it also omits indices in the single-server configuration for which design lines 327–329 promise reconciled badges. Right-dashboard numeric navigation is implemented separately and does not satisfy this native badge requirement.

Acceptance proof needed: either explicitly narrow the approved native requirement to host-owned numbering, or implement and test the documented safe, readback-verified case. No speculative index should be published simply to fill the token.

## Resolved reference retention and pagination finding — 2026-10-06

The original audit found that rebuilding references from 200 retained messages
discarded earlier targets, edits and sources without a coverage label. That case
now has a streaming correction: `src/providers/reference-history.ts` reads only
the selected visible session, keeps metadata apart from the hot messages,
incrementally follows appends, and rebuilds after truncation or replacement.
Explicit successful tool/patch edits retain their recorded checkout context.
Refs now show history coverage and existence-evidence age; native `rN+` denotes
partial coverage and `r—` unavailable sources.

The regressions recover an early reference and edit after 250 unrelated messages,
retain the first and latest mention, deduplicate mirrors, follow append/rotation,
stop on cancellation, and retry transient source failure only on a five-second
visible-session cadence. The hot index caps targets at
2,000, edit paths at 2,000, mention sources at 100 per target, and open transcript
readers at eight files. Bounded on-demand pages now recover older targets and
mention sources from all known canonical files for the selected session.
Candidate scans verify latest mentions before returning a page; message-offset
ties include a target/source key so one message's many targets remain pageable.
Page cursors verify transcript versions and target scope. Exact source cursors
verify session, file identity, byte offset and visible message fingerprint;
reused paths and later same-ID message revisions cannot silently substitute.

Provider tests recover all 2,105 targets beyond the hot cap, all 150 mirrored
mentions, and 405 targets sharing one source offset. Collector regressions
reject hidden/wrong-session reads and cancel in-flight requests. TUI tests bound
retained pages and restore source-list and target-list anchors. The live
`--references` gate recovered 106 older targets from a 2,106-target synthetic Pi
fixture, loaded 150 mentions, opened the first source and restored both reader
positions in actual isolated macOS and Linux Herdr. The historical Claude reader
also retains unfinished visible blocks across unrelated messages; its bounded
assembly overflow remains explicitly partial. These close the source-backed
reference retention/pagination finding, without certifying provider formats
beyond the documented adapters or the overall performance budget. See the
[reference history plan](superpowers/plans/2026-10-06-reference-history.md).

## Resolved native root ordering finding — 2026-10-06

The collector records canonical native attachment order separately from provider
discovery. Herdr 0.9.3's
[agent snapshot implementation](https://github.com/herdrdev/herdr/blob/v0.9.3/src/app/agents.rs)
enumerates workspaces, tabs and layout panes in that order. `buildForest` now
orders whole root subtrees by the root's first attachment, keeping explicit
parent edges and descendant discovery order intact. A root without its own pane
uses its earliest attached descendant; trees with no live attachments remain
stable after the live trees.

The collector regression supplies B/A provider inventory and A/B host order,
asserts A/B production-publisher ranks through controlled RPC, then reverses
only the native order. Ranks change to B/A while the selected session, terminal
identity and explicit local goal remain unchanged. Graph regressions cover
cross-order descendants, transcript-only/historical roots, and a 10,000-node
chain with and without native ordering. These tests reproduced the former B/A
misordering before the correction. Native client rendering and real host
rearrangement remain part of the broader live acceptance scenario.

## Resolved mouse disclosure finding — 2026-10-06

The fixed columns 1–3 shortcut reproduced an incorrect focus action when the
depth-two disclosure glyph was clicked at column 5. Agent and process renderers
now include the disclosure's actual terminal column in each row. The inspector
routes body clicks through `handleRowClick`, which uses that rendered coordinate,
accounts for scroll position and rejects header/footer clicks. A pending keyboard
number cannot redirect a row click to a previously captured agent target.

`test/tui.test.ts` exercises root, depth-one, depth-two and deeply indented rows,
including capped/clipped indentation, a 26-column scrolled viewport, ASCII agent
glyphs, leaf rows, label activation and pending numeric input. Fold/unfold is
asserted through the rendered descendant rows. These regressions passed after
failing against the old fixed-column behavior. This closes the source-backed
mouse hit-testing finding; actual native client mouse transport/rendering remains
part of the broader live acceptance scenario.

## Requirement and evidence checklist

| Area | Implemented and directly tested evidence | Remaining acceptance or scope boundary |
| --- | --- | --- |
| Six-view dashboard | `src/tui/screen.ts`, `test/tui.test.ts`: Overview, Agents, Processes, Messages, Refs, To-do; narrow widths, keyboard folds, disclosure-coordinate mouse regressions, stable numeric target capture, per-reader history/anchor, tool and goal details | Actual native mouse transport and theme/client screenshots remain separate |
| Token accounting and provenance | `src/metrics/usage-reducer.ts` and `test/metrics.test.ts`: cumulative/delta epochs, request identity, cache semantics, model changes, context/rate evidence, partial priced cost, subtree deduplication, current/last turn baselines | Do not treat unsupported provider counters or unavailable generation timing as a missing fabricated metric. Exact real-provider breadth is documented in `docs/provider-compatibility.md` |
| Provider messages, goals and lineage | `test/providers.test.ts`: exact identities, deep Codex children, paired spawn evidence, Claude child records/streaming, Pi fork distinction, rotation and partial records, metadata-only scoping; current Codex plaintext/goal/turn-accounting shapes | Existing real transcripts were read-only audited; actual Pi companion goal/parent evidence remains fixture-only. A combined real Codex/Claude/Pi scenario has not passed |
| Messages, Refs, To-do | Content/provider/collector/TUI tests and live `--references` gate: historical target/source paging, exact revision jumps, nested reader anchors, edit evidence and visible-session cancellation; ACTION replay and local checks | Adapter/record/assembly limits remain labeled partial. Local checkboxes do not mutate transcripts; no provider instruction installation is needed or performed |
| Session resource ownership | `src/process/ownership.ts`, `test/process.test.ts`: PID birth identity, disjoint nearest-root ownership, reparenting, PID reuse, launch registration identity, unavailable vs zero, warmup, shared-root ambiguity; actual Unix sampler controlled-worker tests | Full real-Herdr registered detached-job + nested harness attribution scenario remains unproven. Unit and sampler tests are substantive evidence, not a substitute for that combined scenario |
| Scoped collection | Collector samples displayed scope, keeps other agent roots as exclusion proofs, and gates detailed body/Git work to visible selection; provider and collector tests exercise gating | Advanced live gate observes hidden freshness/body pause, but does not itself instrument every filesystem/Git/process call; avoid describing that observation as complete I/O measurement |
| Native overview and navigation | `test/native.test.ts`, advanced live gate: bounded tokens, exact occupant checks, foreign budget/owner protection, TTL/readback and preserved native focus | Native badges remain above. Arbitrary synthetic native rows are unsupported by Herdr and correctly supplied by the right dashboard instead |
| Follow, pin and lifecycle | Actual advanced gate passes right follow/pin, hidden resume, exit/restart and conflict-safe unconfigure on all eight Unix jobs | A simultaneous multi-client renderer exercise and actual reference-plugin coexistence are not implied by synthetic foreign-owner tests |
| Git/worktree display | Git fixtures and TUI tests cover branch state, statistics/conflicts, family/checkout grouping and cross-checkout badges; metadata-only nodes intentionally wait for selection | Combined deep-child/different-worktree live scenario remains unproven; this is not a request to restore eager background Git work |

## Remaining real acceptance scenario

The design's strongest end-to-end scenario is still broader than `live-features-test.mjs`: exact Codex, Claude and Pi sessions together; explicit nested lineage across several levels; a child in a different worktree; an owned long-lived job that detaches/reparents; session-exclusive versus subtree resources; representative provider usage, messages, refs and ACTION items; selecting/focusing nodes while identities change. Individual pieces have extensive fixtures and some real-transcript/sampler evidence. The combined scenario should be recorded as **not yet demonstrated**, not as proof those individual features are absent.

There is also a small interaction-contract ambiguity to settle in acceptance: design line 7 describes inspecting a child without native focus, while agent rows currently emit `focus` actions (`src/tui/screen.ts:74`) and live attachments are explicitly focused by the inspector. Enter-to-focus elsewhere in the design is intentional. Acceptance should distinguish a preview-selection action from explicit Enter activation before treating either behavior as complete.

Useful focused regression commands (not rerun or claimed passing by this audit):

```sh
node --experimental-strip-types --test test/native.test.ts test/tui.test.ts test/content.test.ts
node --experimental-strip-types --test test/providers.test.ts test/metrics.test.ts test/process.test.ts test/launch-bridge.test.ts
```

The remaining native badge mapping needs dedicated acceptance;
existing green tests alone do not prove them. For completed live gates, use the
archived Unix feature JSON from the linked run and the subsequent evidence in
`docs/implementation-progress.md`. Windows work remains owned by the other machine.
