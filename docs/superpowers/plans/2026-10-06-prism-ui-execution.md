# SDD ledger — plan: docs/superpowers/plans/2026-10-06-prism-ui.md

Task 1: complete in prior commits e57f330..cf1ce9a; approved by user 2026-10-06.
Pre-flight: Task 2 renderer/actions and Task 4 editor share UiState; Notes is appended after Git, existing first six tab IDs preserved. Task 3 native publication and config migration share owned backup manifests; edit only values that still match Prism ownership.
Ruling: use a physical isolated worktree under /private/tmp under existing autonomous implementation authorization; leave the live preview/main checkout intact.
Ruling: preserve pulled 6e7b387 shared collector/per-tab model. Notes persist in collecting server state shared across panels, with concurrent revision checks. No new sampling belongs in a view.
Task 2: complete (commits 6e7b387..bed73f2, tests: node --experimental-strip-types --test test/tui.test.ts test/tui-redesign.test.ts test/ui-preview.test.ts test/follow.test.ts test/input.test.ts → ℹ duration_ms 2900.243792)
Task 3: complete (commits bed73f2..ad18561, tests: node --experimental-strip-types --test test/config.test.ts test/native.test.ts test/collector-service.test.ts test/lifecycle.test.ts → ℹ duration_ms 1962.746917)
Task 4: complete (commits ad18561..b33a7a6, tests: node --experimental-strip-types --test test/notes.test.ts test/notes-editor.test.ts test/input.test.ts test/tui.test.ts test/tui-redesign.test.ts test/server.test.ts → ℹ duration_ms 751.595792)

Task 2: Ruling: Full messages now use the same in-panel detail reader instead of an automatic popup; references offer a detail action list while exact source cursors remain unchanged. Cost if wrong: restore the popup action.
Task 3: Ruling: Retain all 14 bounded native ownership tokens for compatibility while displaying four rows; authoritative native indices remain empty. Cost if wrong: legacy readback must be updated.
Task 4: Ruling: Notes use collecting-server files shared across panels, with serialized revision checks; demo notes use disposable files. Cost if wrong: storage migration.
Task 4: Ruling: Tab flushes and leaves the editor; printable navigation keys are literal text. Cost if wrong: remap the leave-editor key.
Task 5: Ruling: Extend the exact disappeared-admission-lease retry to Unix after the initial macOS baseline reproduced that race; missing state directories still fail without recreation. Windows behavior is unchanged. Cost if wrong: bounded extra admission retry.

Final: fixed Notes reader initialization, mixed reference fact/action scrolling and invisible short-pane edits — three new regressions RED→GREEN; affected suite 50/50, final status cleanup 46/46; actual resize PTY passed.
Final: Ruling: Actual Windows console/ACL acceptance stays with the owning Windows machine, as explicitly instructed; portable assumptions are reviewed and Linux/macOS exercise shared behavior. Cost if wrong: Windows acceptance must correct an uncovered platform issue.
Final: Ruling: Native pixel rendering and missing upstream visibility/focus APIs remain existing gates, as agreed; no host fork or invented indices. Cost if wrong: native visual/remote acceptance needs another pass.
Final: no deferred minor findings. Full reviewed profiles macOS342/320/22 and Linux342/319/23 (total/pass/skip), zero failures; actual isolated Herdr reference/Notes/shared-collector/lifecycle pipelines passed on both.
Task 5: complete (commits b33a7a6..96deef9, tests: node --experimental-strip-types --test test/config.test.ts test/native.test.ts test/lifecycle-races.test.ts test/tui-redesign.test.ts test/notes-editor.test.ts test/notes.test.ts test/tui.test.ts test/ui-preview.test.ts → ℹ duration_ms 1252.537125)

Post-push CI: fixed stale narrow-tab smoke expectation and a fixed-delay autosave assertion; each was reproduced RED→GREEN locally. Shared Notes/real-PTY suites macOS10/10 and Linux10/10. Windows runtime unchanged; original failed run remains recorded.

Final post-push acceptance: CI run37515181628 at d6653f1 passed all10 platform/Node22/24 jobs, including both Windows majors. This evidence-only follow-up changes no source or runtime artifact.
