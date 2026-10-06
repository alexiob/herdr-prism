# Herdr Prism implementation progress

Objective: fully implement and test `docs/design/herdr-prism.md`.
Plan: `docs/superpowers/plans/2026-10-06-herdr-prism.md`.
Updated: 2026-10-06. Work remains active; this is not a full release certification.

## Implemented

- Strict TypeScript, dependency-free compiled ESM, Herdr protocol-22 request schema,
  correlated RPC, snapshot subscriptions/reconnect, finite hooks and foreground
  collector ownership.
- Exact Codex/Claude/Pi session adapters, arbitrary-depth lineage, scoped discovery,
  incremental tails/rotation, visible messages/tools, explicit goals, usage epochs,
  refs and opt-in complete ACTION lists with private checkbox persistence.
- Linux procfs and original Rust macOS/Windows sampler, birth/boot identities,
  exclusive nearest-root attribution, disjoint subtree aggregation, launch ledger,
  CPU/RSS/working-set histories, coverage and honest unavailable/stale metrics.
- Canonical Git/worktree caches, NUL-safe status/numstat, colored native presets,
  reversible TOML ownership with atomic concurrent-edit detection.
- Six-view terminal inspector, Unicode/ASCII/monochrome, agent/process folding,
  full message detail with return anchors, historical message paging, refs/To-do
  actions, right docking/follow/pin, explicit focus revalidation, redacted export.
- Checked native distribution, platform release staging/checksums/notices, original
  optional Pi companion, ten actual-platform CI definitions, real PTY/ConPTY gates.
- User's live lifecycle amendment: managed release-copy installer and remover,
  authenticated readiness/completion acknowledgements, multi-server cooperative
  shutdown, own-pane cleanup, reversible config restore and marker-proven purge.

## Review corrections

Astra reproduced counter double-count on model switches, timing-only record
counter loss, active-session inventory starvation, TOML ancestor topology
corruption, deep graph stack overflow, collapsed untracked directory counts,
cleanup-after-RPC-close, stale metrics revived as known, arbitrary argv ownership,
unknown cwd Git/ref inference, unreachable older messages, disappearing detached
history, denied-memory zero display, reader-anchor loss and leaked/dead leases.
These have implementation fixes and targeted regression checks, or are being
integrated in the final runtime pass. No review finding is dismissed because the
previous unit suite passed.

## Selected visible session amendment

- Only the displayed session hydrates full transcript/tool/usage content, refs,
  ACTION state and Git. Its archive mirrors are the same logical session; related
  descendants remain metadata-only until selected.
- Hidden/closed panes and server disconnects pause heavy collection. Finite hooks
  reconcile Herdr inventory without filesystem discovery or OS sampling.
- Lightweight all-agent root proofs preserve exclusive process attribution even
  when another agent's metrics are paused. Proofs bind terminal/session, boot and
  PID birth; selected roots refresh immediately, other proofs expire in 30 seconds.
- Resource values remain stale after reopening until a fresh sample. The first
  sample warms CPU; context/model/current-turn timing stay selected-harness facts.
- Complete ACTION state is recovered on resume and hot-window discontinuity,
  preserving private checkbox state. Visibility generations prevent later heavy
  stages from starting after an awaited operation outlives the displayed session.
- Deeply frozen provider snapshots and bounded stat-keyed metadata caches avoid
  repeated body clones, header parsing and Pi companion-window reads.

## Rename and marketplace

- Project/package: `herdr-prism`; display name: Herdr Prism; plugin ID:
  `iob.herdr-prism`. Companion commands use `/prism-goal` and `/prism-parent`.
  `docs/design/herdr-agent-tree.md` redirects to the renamed complete specification
  so the original goal's acceptance scope is preserved.
- Public source: [alexiob/herdr-prism](https://github.com/alexiob/herdr-prism).
  The default branch contains the root manifest, compiled dependency-free
  JavaScript and checked macOS native artifacts. Install hooks validate those
  committed files without npm, Cargo, compilers or helper downloads.
- The live [marketplace index](https://assets.herdr.dev/plugins/index.json) was
  read on 2026-10-06. It contains this repository and manifest, plugin ID, name,
  version 0.1.0, minimum Herdr 0.9.3 and source commit
  `2655fa4f3000e623e31a044e6f1149b54185e982`. Listing is discovery, not review.
- Standard install is `herdr plugin install alexiob/herdr-prism`, followed by an
  explicit activation action in an existing session. Tested Herdr 0.9.3 has no
  `plugin update` or `plugin state-dir` CLI. Safe upgrades deactivate, reinstall,
  then activate. Ordinary uninstall removes its GitHub checkout and retains
  configuration/state. The managed release wrapper provides authenticated
  immediate activation and complete owned-file removal. See [installation](install.md).

## Recorded execution evidence

Evidence below applies to the identified source/artifact, rather than promising
that every later edit has been executed on every platform.

- Source commit `2655fa4f3000e623e31a044e6f1149b54185e982` is published on `main`.
  Its local strict macOS suite had 237 tests: 236 passed, zero failed and one
  Linux-only skip (`/private/tmp/prism-pre-push-strict-suite.log`).
- The last-pass candidate's fresh strict macOS suite passed 245 of 251 tests,
  zero failed, with four Windows-only, one Linux-only and one opt-in PTY skip
  (`/private/tmp/prism-last-pass-strict-suite.log`). Explicit macOS PTY smoke also
  passed. Typecheck, compiled build and repository install preflight passed.
  Astra's narrow ACL review findings have regression fixes and were re-reviewed.
- Actual ten-job GitHub [run 37445486188](https://github.com/alexiob/herdr-prism/actions/runs/37445486188)
  completed: both Linux architectures on Node 22/24, physical Intel macOS on
  Node 22/24 and arm64 macOS on Node 24 passed all required steps. These steps
  include strict tests, real PTY, distribution/preflight and isolated live
  Herdr install/right split/restart/complete removal. Linux Node 24 also passed
  exact-commit ordinary GitHub install/reinstall/enable/disable/uninstall.
- The same run failed on Windows Node 22/24 and arm64 macOS Node 22. Windows
  exposed inherited ACL/default-owner handling, redirected ConPTY standard
  handles and nonportable fixture paths/stat timestamps. macOS exposed an old
  pane exiting between snapshot and close during restart. Targeted corrections
  and local regressions are implemented; an actual-platform rerun is required.
- Actual [run 37448167784](https://github.com/alexiob/herdr-prism/actions/runs/37448167784)
  passed all four macOS jobs and both Linux Node 22 jobs, including the new
  advanced live gate. Linux Node 24 failed synthetic process detection; Node 24
  names its main thread `MainThread`. Explicitly naming only the synthetic fixture
  `pi` passed all ten stages in actual Linux arm64 Node 24 Podman acceptance:
  `artifacts/linux-node24-fixture-proof/advanced/features.json`.
- Windows Node 22/24 in that run still failed private ACL verification and a
  ConPTY passthrough assertion. Focused actual [diagnostics 37449369685](https://github.com/alexiob/herdr-prism/actions/runs/37449369685)
  showed explicit SYSTEM/Administrators grants surviving inheritance removal.
  The candidate removes validated foreign grant SIDs only on authorized fresh
  paths/exact namespaces. Actual console diagnostics passed real TTY/raw mode,
  keyboard/resize/restoration/EOF/reaping with initialized standard slots.
  ConPTY can consume alternate-buffer escape bytes; the smoke candidate now
  checks real saved-screen restoration and measured raw-mode cleanup instead.
  Final [run 37450329250](https://github.com/alexiob/herdr-prism/actions/runs/37450329250)
  passed all eight Unix jobs. Windows Node 22 passed 240 tests and failed eight;
  Node 24 passed 241 and failed seven (three platform skips each). Further Windows
  changes/testing stopped as requested. [Windows handoff](windows-handoff.md)
  records exact failures and reproduction/delivery steps for a Windows machine.
- The ordinary default-branch macOS GitHub installation passed against exact
  commit `2655fa4f3000e623e31a044e6f1149b54185e982` using Herdr 0.9.3:
  `artifacts/prism-github-install-macos/github.json`. It verified build-hook
  preflight, authenticated activation, right split, preserved native focus,
  config restoration, safe reinstall, restart, enable/disable, stopped collectors
  and ordinary uninstall. Herdr's retained configuration/state were observed
  and the harness removed only its own disposable server/root afterward.
- In the user's original macOS Herdr session, the managed lifecycle test passed:
  `artifacts/current-herdr-proof/lifecycle.json`. Removal restored config bytes,
  stopped owned collection and removed owned directories while preserving all
  seven original panes and the other installed plugin. It left Prism uninstalled.
- The renamed staged macOS release passed live install/restart/complete removal
  and all ten advanced acceptance stages: exact synthetic Pi sessions, metadata TTL/readback, follow/right
  movement/pin, hidden pause/resume, stale occupant guards, collector shutdown,
  projection ownership and configuration-conflict recovery. Proof:
  `artifacts/prism-corrected-live-macos/lifecycle.json` and
  `artifacts/prism-corrected-features-macos/features.json`. Headless readback does
  not certify native client pixels. Unix CI now requires these advanced stages;
  Windows needs its separate portable TTL fixture before the same gate applies.
- Both thin macOS helpers were built, ad-hoc signed, checksummed and checked
  for system-only dependencies. Actual CPU/memory/process identity and shutdown
  checks passed. This is development signing, not Apple Developer ID/notarization.
  The Windows helper must pass actual Windows acceptance before inclusion in
  repository installation or a supported-platform claim.
- Earlier actual Linux arm64 Podman and translated macOS x64 runs also passed;
  the new actual-platform CI above supersedes those older source snapshots.
  The failed Linux x64 QEMU compiler probe does not invalidate actual x64 CI.
- Read-only current-provider inspection and source-verified fixtures cover new
  Codex explicit goals, inter-agent messages and turn-counter records. Encrypted
  message bodies remain unavailable. [Provider compatibility](provider-compatibility.md)
  records exact inspected versions and format limits; synthetic fixtures do not
  certify every current/future provider schema.

## Performance evidence

`scripts/profile-host.mjs` now profiles 50 declared fixture sessions, 500 real
kernel processes and 100 MiB of history through the real collector, helper, Git
children and PTY. Its RPC layer is controlled; this is not a full live Herdr
transport or soak certification. Measurements include helper/Git CPU and drain
all outstanding frame acknowledgements without dropping observations.

| Complete macOS profile | Idle CPU | Active CPU | Incremental memory | Event p95 | Keyboard p95 |
| --- | --- | --- | --- | --- | --- |
| Initial `artifacts/macos-performance/` | 1.76% fail | 6.05% fail | 133.97 MiB pass | 102.05 ms pass | 77.52 ms pass |
| Bounded render/cadence `artifacts/macos-performance-final/` | 0.88% pass | 3.02% fail | 114.07 MiB pass | 88.55 ms pass | 70.23 ms pass |
| Cached number format `artifacts/macos-performance-number-cached/` | 0.80% pass | 3.03% fail | 116.86 MiB pass | 101.71 ms pass | 90.22 ms pass |

The intermediate optimized run had an incomplete terminal acknowledgement and
is not a passing complete profile. Narrow formatter/ref microbenchmarks do not
replace the aggregate budgets. Active CPU remains above the strict 3% target.

## Remaining completion gates

- Resume Windows only on a Windows machine as requested, using the handoff.
  Resolve its remaining tests and validate/include the Windows helper with exact
  checksums and matching notices. Keep the eight passing Unix jobs intact.
  Then exercise ordinary GitHub installation on every packaged platform.
- Run the renamed advanced acceptance gate on all Unix CI targets; add actual
  Windows TTL coverage, native client/theme pixels and multiple clients.
- Exercise the full mixed-provider/deep-child/second-worktree/registered-detached
  scenario, launch ownership, selected-session visibility and reconnect/upgrade
  recovery in live Herdr. Complete provider audit limitations remain explicit.
- Meet active CPU and full live-host performance budgets; run long recovery/soak
  acceptance. Unit fixtures and controlled transport profiles are not substitutes.
- Finish a requirement-by-requirement evidence audit and stage/install/remove
  the exact final artifacts. Release signing/notarization and public tagged
  release publication are separate from working development packages.

Full-access local testing and remote CI are available. No sandbox restriction is
an outstanding blocker. The original implementation goal remains active for
remaining acceptance; Windows work is explicitly deferred until user-requested
resumption on a Windows machine.
