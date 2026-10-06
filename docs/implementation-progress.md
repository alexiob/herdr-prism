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
- Remote amendment: per-server collection, persisted endpoint UUIDs, collecting
  hostname/session header, host-prefixed native ranks and client-owned machine
  row labels. Explicit Herdr-pane copy uses foreground-client OSC 52 forwarding.
  Closed native path references retain their source and normalize the selected
  key on hydration without choosing another attachment or dropping local goals.

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
- Closed panes, a server's hidden workspace/tab, panes hidden by zoom, and a
  collector's own RPC disconnect pause heavy collection. Last-viewer/SSH-client
  disconnect and machine switching are different: Herdr 0.9.3 exposes no public
  client visibility query, so those conditions remain an outstanding gate.
  Finite hooks reconcile inventory without filesystem discovery or OS sampling.
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

## Remote server evidence — 2026-10-06

The remote amendment passed actual macOS-to-Linux arm64 SSH acceptance with
Herdr 0.9.3 on both ends, macOS Node 26.10.0 and Linux Node 24.21.0. Local proof:
`artifacts/remote-herdr-proof-accepted/remote.json` (`ok: true`). This is a real
SSH connection/terminal and Linux procfs/Git readback with explicitly synthetic
Pi-shaped records and an idle harness fixture, not a paid provider invocation.

- Verified remote activation action completion, owned inspector PID/cwd, server
  hostname/session and UUID-prefixed native rank, remote messages/refs/ACTION
  source and pending To-do, measured zero CPU with 1/1 coverage, positive RSS and
  remote Git branch/+1/-1. The reference file does not exist on the viewing host.
- The probe starts closed, selects the exact native path attachment and opens
  only that source. The regression fix preserves path identity, canonical
  selection and explicit goals; two-session unit coverage keeps the other body
  unloaded and prevents duplicate historical placeholder rows.
- Explicit remote `y` copy delivered the exact reference in an OSC 52 sequence
  captured by the host fixture PTY. The accepted run forces terminal forwarding,
  bypassing the macOS clipboard. Earlier failed diagnostic probes used an
  incorrect isolation flag and may have written fixture text to the native
  clipboard; no personal clipboard contents were read or restored.
- A controlled local client/SSH transport SIGTERM was reaped while the remote
  inspector and synthetic job retained their PIDs, heartbeat and server UUID.
  A transcript append made during disconnection survived a real SSH reconnect.
  This does not certify Herdr's keyboard detach shortcut or WAN behavior.
- Complete remote uninstall restored configuration bytes, removed registration
  and owned files, stopped the collector and preserved the original remote job.
  The disposable container and generated local SSH files were removed.

Final shared source passed strict macOS tests: 256 total, 251 passed, five expected
platform skips, zero failures. Typecheck/build and the staged macOS live lifecycle
and all ten advanced checks passed after the path-reopen fix. Proof directories:
`artifacts/prism-remote-final-live-macos/` and
`artifacts/prism-remote-final-features-macos/`.

The subsequently added strict host-keyboard stage remains failing in
`artifacts/remote-herdr-proof-native-input/remote.json`: an actual controlling
foreground PTY had canonical input disabled, and Ctrl+B/l/Tab bytes were written
in full with 150 ms separation, but the expected Agents view was not acknowledged.
Client focus/routing remains unverified; no plugin defect is asserted from this
failure. The current harness keeps this strict gate. The earlier accepted core
proof does not certify this added interaction.

The manual Linux-only [remote workflow](../.github/workflows/remote.yml) was added
but not executed. The user requested an immediate commit/push to coordinate with
a separate Windows agent, so this pass stops further edits and testing. Windows
was not resumed. Machine-background/last-viewer pause stays an upstream API
dependency, as the user explicitly chose.

## SSH keyboard fixture correction — 2026-10-06

After integrating the separate Windows agent's commits, local `main` matched
`origin/main` at `9c100f6`. Windows implementation and validation remain with
that agent; this correction changes only the Unix SSH fixture and its evidence.

The Linux-only SSH run
[37458599060](https://github.com/alexiob/herdr-prism/actions/runs/37458599060)
failed at host keyboard navigation after passing attachment, activation and
remote data checks. A fresh macOS reproduction in
`artifacts/remote-onboarding-red/remote.json` captured Herdr's first-run onboarding
overlay while the strict keyboard assertion failed. Pinned Herdr 0.9.3 source
loads that overlay from the client's fresh configuration and consumes pane keys
while it is present.

Setting `onboarding = false` only in the fixture's disposable client config
resolved the failure. `artifacts/remote-onboarding-green/remote.json` passed all
SSH gates with a macOS arm64 Node 26.10.0 client and Linux arm64 Node 24.21.0
server, both using Herdr 0.9.3. Actual host Ctrl+B/l/Tab changed the remote Prism
view to Agents, with raw foreground PTY input and no onboarding overlay. Copy,
disconnect preservation, reconnect, uninstall, container removal and generated
SSH-file cleanup also passed. The real user's Herdr and SSH configuration were
not changed. Linux x64 validation of this correction is pending.

The merged checkout's `npm test` also completed with 260 tests: 249 passed,
11 platform/opt-in skips, zero failures. This is not a strict native/PTY rerun;
the full SSH fixture above provides the actual remote interaction evidence.

The merged platform run
[37458785002](https://github.com/alexiob/herdr-prism/actions/runs/37458785002)
finished with seven Unix jobs passing, one macOS x64 Node 24 lifecycle failure
(`Dashboard did not become ready`), and both Windows jobs failing strict tests.
The macOS failure's archived snapshot/log is retained under
`artifacts/ci-9c100f6-darwin-x64-node24/`; it is unresolved. Windows failures are
left to the Windows agent and were not retried here. These results do not replace
the remaining full acceptance and upstream visibility gates.

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

- Complete the new remote-server acceptance, especially client-visible pause on
  machine switching/last-client disconnect and multiple viewers. Those cases
  require the [host visibility API](remote-visibility-api.md) absent from Herdr
  0.9.3. Remote collection must stay on each agent's server.
  The user explicitly chose to keep that API as an upstream dependency.

- Resume Windows only on a Windows machine as requested, using the handoff.
  Resolve its remaining tests and validate/include the Windows helper with exact
  checksums and matching notices. Keep the eight passing Unix jobs intact.
  Then exercise ordinary GitHub installation on every packaged platform.
- The renamed advanced acceptance gate passed on all eight Unix CI jobs for
  `376d3a6`; subsequent source changes need their own evidence. Add actual Windows
  TTL coverage after user resumption, native client/theme pixels and multiple clients.
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
