# Prism 0.5.0 preserving updates

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent implementation and acceptance tasks.

**Goal:** Rerunning each installer installs or updates Prism while retaining private state and the exact panel/focus intent.

**Architecture:** Prepare a checksummed release and same-filesystem code transaction before stopping Prism. A shared lifecycle engine snapshots all recorded live servers, flushes/stops old views, replaces code, restores activation mode, open/closed views and focus. Private Notes and preference directories never participate in code replacement. Failed replacements or activation restore old code and retain a private recovery journal when recovery cannot finish.

**Tech Stack:** Dependency-free Node ESM, Herdr 0.9.3 protocol 22, POSIX shell, Windows PowerShell.

**Spec:** User request: version 0.5.0; macOS/Linux/Windows installers also update; preserve Notes, widths, focus and all private state.

## Global constraints

- Node >=22.13.0; no npm/Cargo at installation time.
- Preserve managed receipt tokens and canonical installation path.
- Preserve GitHub source/revision through `plugin.link` source metadata.
- Never mutate a developer source link or purge state during updates.
- Do not print private Notes, configuration contents or mailbox tokens.
- No signals or input to native user agents. Exact prior focus restoration is authorized.

## Review focus

- Multiple servers and panels: stop all collectors, restore each target independently.
- Notes editor drafts: flush before replacement; never overwrite with a pre-stop backup.
- Failed activation or interrupted update: old code and recovery metadata remain available.
- Disabled installations and shortcut opt-out: remain disabled and retain the choice.
- Foreign paths, symlinks and developer links: fail before deactivation.

## Tasks

- [x] Shared lifecycle: `scripts/update.mjs`, `test/update.test.ts`. Test multi-server views, focus, settings and rollback with injected operations, then implement.
- [x] Prepared code transaction: `scripts/update-code.mjs`, `test/update-code.test.ts`. Test atomic swap, source/receipt preservation, rollback and unsafe paths, then implement.
- [x] Installers/version: Unix bootstrap, Windows bootstrap/PowerShell, release packaging and version manifests. Test rerun dispatch and absolute Windows runtime binding before implementation; update help/docs.
- [x] Actual isolated acceptance: `scripts/live-update-test.mjs` and platform CI. Exercise managed update, independent views, synthetic Notes, focus and recovery on all CI platforms.
- [x] Verify typecheck, full tests, build, macOS isolated installer/update and independent review.

Local verification: 630 tests, 603 passed, 27 platform skips, no failures. Actual eight-stage macOS two-server acceptance, including GitHub source metadata, and the Node-absent-from-server-PATH installer rerun both pass. Integration and platform CI are tracked by the resulting Git commit and Verify platform release workflow.
