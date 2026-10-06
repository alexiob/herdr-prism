# Non-Windows acceptance audit

Original read-only audit: 2026-10-06 at source `47e7a43`, against `docs/design/herdr-prism.md`. No product code changed in that audit, and Windows was deferred. Subsequent corrections are recorded separately below. Performance measurements belong to the separate performance investigation and are not assessed here.

Subsequent remote amendment: the user chose per-server Prism installation and
kept exact client visibility as an upstream Herdr API dependency. See
[remote support](remote.md) and [the host contract](remote-visibility-api.md).
Host-prefixed native ranks prevent cross-machine ordinal interleaving; they do
not resolve the per-server root-order finding below. Zoom-hidden panes now have
a targeted pause regression check. The findings below remain anchored to the
audited revision rather than certify later source changes.

## Evidence boundary

The latest completed [Unix CI run](https://github.com/alexiob/herdr-prism/actions/runs/37450329250) tested `376d3a6b1453275485c6f52f34111d791612b6e9`: all eight macOS/Linux architecture/Node-version jobs passed. This is actual platform evidence for that revision, not certification of every subsequent edit at the audited head. The workflow runs `scripts/live-features-test.mjs` and archives its results. The feature fixture uses two synthetic Pi-shaped sessions and idle harness-labelled processes in a real isolated Herdr server; it is not a live model interaction or a three-provider integration test.

Already demonstrated by that advanced gate: native metadata readback, right placement and cross-tab follow, pin retention, hidden body pause and visible resume, native metadata TTL expiration/resumption with foreign tokens preserved, stale occupant rejection before focus/publication, collector exit/restart, owner-qualified view cleanup, and uninstall conflict refusal followed by safe recovery. These must not remain listed as unperformed generic gates. Native client pixel rendering and compatibility with the actual Radar/Pi-tree plugins are distinct from the headless readback and synthetic foreign-owner checks.

## Specific remaining behavior gaps

The following are source-backed findings, not failures reproduced on a native client during this audit. Priority indicates acceptance impact rather than security severity.

### P2 — Native root ordering does not implement the specified host order

The design requires lineage roots ordered by existing workspace/tab/pane order (design line 137). `src/runtime/collector.ts:167` seeds `known` from provider inventory, then lines 170–184 update existing keys in snapshot order. Updating a `Map` entry does not move it. `src/model/graph.ts:35`–38 preserves that insertion order in roots and children; `src/native/publisher.ts:71` publishes sequential ranks from the resulting presentation. Consequently, already indexed roots follow provider discovery order, even when the native host order differs or is rearranged. This is not a claim that every scan randomly shuffles roots.

Acceptance proof needed: initialize provider inventory in B/A order and a native snapshot in A/B order, assert native ranks A/B; change only host workspace/tab/pane order, then confirm ranks reconcile without changing selection identity. The current native tests cover publication safety, TTL and counts, not this disagreement case.

### P2 — Native numerical badges are never implemented

`src/native/publisher.ts:71` always writes `hat_index: ''`. The safe omission for ambiguous multi-machine/competing projections is correct, but it also omits indices in the single-server configuration for which design lines 327–329 promise reconciled badges. Right-dashboard numeric navigation is implemented separately and does not satisfy this native badge requirement.

Acceptance proof needed: either explicitly narrow the approved native requirement to host-owned numbering, or implement and test the documented safe, readback-verified case. No speculative index should be published simply to fill the token.

### P2 — Older references disappear without a retained-window indication

`src/providers/index.ts:26` defaults to 200 retained messages; merged sessions are bounded at line 90. `src/runtime/collector.ts:252` rebuilds all references from that retained array on content change. Unlike To-do recovery immediately above it, there is no historical reference reducer/replay. A reference that falls outside the hot window therefore disappears even though its transcript/source remains available through message paging. Earlier edit/source evidence can disappear as well. `src/tui/screen.ts` renders the Refs list without identifying that coverage restriction; native `rN` also looks like a full count.

The design's latest-mention grouping and retained earlier provenance (line 155) are correctly implemented inside the supplied window, but session-wide coverage is not. Acceptance proof needed: a reference and explicit edit in the first messages followed by more than 200 unrelated messages; verify retained reference/source semantics, or an explicit limited-history label and recovery behavior. Existing extraction tests do not establish this case.

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
| Messages, Refs, To-do | `test/content.test.ts` and TUI tests: chronological visible messages, source reader, latest ref grouping, explicit edits, ACTION complete-list/clear, local checks, repeated requests, safe copy/open targets; Todo historical replay in collector | Refs retained-window gap above. Local checkboxes do not mutate transcripts; no provider instruction installation is needed or performed |
| Session resource ownership | `src/process/ownership.ts`, `test/process.test.ts`: PID birth identity, disjoint nearest-root ownership, reparenting, PID reuse, launch registration identity, unavailable vs zero, warmup, shared-root ambiguity; actual Unix sampler controlled-worker tests | Full real-Herdr registered detached-job + nested harness attribution scenario remains unproven. Unit and sampler tests are substantive evidence, not a substitute for that combined scenario |
| Scoped collection | Collector samples displayed scope, keeps other agent roots as exclusion proofs, and gates detailed body/Git work to visible selection; provider and collector tests exercise gating | Advanced live gate observes hidden freshness/body pause, but does not itself instrument every filesystem/Git/process call; avoid describing that observation as complete I/O measurement |
| Native overview and navigation | `test/native.test.ts`, advanced live gate: bounded tokens, exact occupant checks, foreign budget/owner protection, TTL/readback and preserved native focus | Host root order and native badges above. Arbitrary synthetic native rows are unsupported by Herdr and correctly supplied by the right dashboard instead |
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

The four concrete behavior cases above need dedicated assertions; existing green tests alone do not prove them. For completed live gates, use the archived Unix feature JSON from the linked run instead of repeating the old remaining-gates checklist. No Windows work or new runtime changes are requested by this audit.
