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

## Evidence and remaining gates

- Bundled Herdr 0.9.3 schema exported read-only to
  `/private/tmp/herdr-prism-herdr-0.9.3-schema.json`.
- Latest recorded strict broad macOS suite: 236 tests, 235 passed, zero failed,
  one Linux-only skip (`/private/tmp/prism-current-strict-suite.log`). Later edits still
  require a fresh final suite; the recorded count is not a certification of every
  subsequent source change.
- Real local macOS PTY smoke passed keyboard, 80→26→80 column resizing, terminal
  restoration, clean process exit and master EOF. The Windows ConPTY source
  compiles; actual Windows execution remains required.
- macOS arm64: actual host process enumeration, controlled single/multicore CPU,
  memory, exact-session collector and helper EOF/teardown passed. The six strict
  native tests passed with the explicitly ad-hoc-signed helper; evidence is
  `artifacts/macos-proof/final-signed-native.log`. Thin arm64/x64 helpers were
  built, checksummed and checked for system-only dependencies. Developer ID
  signing and notarization are not established by ad-hoc signing.
- macOS x64: official x64 Node and the x64 helper ran under Rosetta. The recorded
  suite passed 214 of 216 tests with zero failures and two skips
  (`artifacts/macos-x64-proof/tests.log`). This is translated x64 userspace
  evidence, not a physical Intel-host run. Latest signed-helper and live x64
  lifecycle reruns remain pending.
- Real Herdr 0.9.3/protocol-22 ordinary RPC uses one request per connection;
  subscriptions use separate streams. The client and contract tests now follow
  that observed behavior. Actual socket tests passed.
- Isolated macOS live install/right split/restart/uninstall passed, including
  exact config restoration and owned collector/pane/directory cleanup:
  `artifacts/live-herdr-macos-arm64/lifecycle.json`.
- In the user's current macOS Herdr session, live installation activated an
  authenticated collector and right inspector without changing focus. Removal
  restored configuration byte-for-byte, removed the plugin's owned state and
  managed installation, stopped collection, and preserved all seven existing
  panes and the other installed plugin:
  `artifacts/current-herdr-proof/lifecycle.json`. The test left this plugin
  uninstalled. This proves lifecycle, not every dashboard field or interaction.
- Actual Linux arm64 Podman testing passed 221 of 223 tests, zero failures and
  two macOS/Windows-only skips, plus real PTY keyboard/resize/exit, release staging,
  distribution/preflight and actual Herdr install/right split/restart/uninstall
  with exact configuration restoration (`artifacts/linux-final-arm64-proof/`).
  Later renamed/provider/performance changes require a fresh container or CI run.
- The Linux x64 QEMU build failed when the emulated Rust compiler crashed. It
  does not establish an application failure or successful x64 validation. Actual
  Linux x64 and Windows x64 runs remain required. Windows testing will use GitHub
  Actions once the repository is on GitHub, as requested by the user.
- Performance fixture with real provider/Git files, 50 sessions, 500 synthetic
  processes and 105 MB history: initial all-session idle Node CPU was 14.4% (fail).
  The final selected-session 20-second measurement was 0.463%, heap increase
  2.33 MiB, keyboard/render p95 0.250 ms (startup 91 ms). It excludes helper/Git-child CPU and real terminal
  latency. Profile evidence: `/private/tmp/hat-profile-selected-final.json`; full live-host
  performance and soak certification remain required.
- Remaining end-to-end acceptance: real provider-version compatibility; the
  mixed Codex/Claude/Pi scenario with deep children, another worktree, compiler
  and registered detached job; selected-session visibility behavior measured in
  live Herdr; follow/pin and focus replacement; native colors/TTL/readback;
  multi-client rendering and ownership-conflict coexistence; upgrade/reconnect
  and long-running recovery. Fixture tests cover many of these behaviors but do
  not replace actual live acceptance.
- Final release work: rerun the final source on all supported targets, record
  signing/dependency checks and stage/install/remove those exact artifacts,
  finish the capability matrix and requirement-by-requirement evidence audit.
  Public release signing/notarization remains separate from the working
  development packages.
- Local Git metadata and the user-provided remote now exist; no remote CI run has
  yet completed in this evidence snapshot.
  Full-access local testing works. No sandbox restriction remains a claimed
  blocker. The goal remains active because the outstanding acceptance gates
  have not been satisfied.

## Rename, marketplace and new acceptance evidence

- The project/package is now `herdr-prism`, display name Herdr Prism and plugin
  ID `iob.herdr-prism`. The original goal specification path redirects to
  `docs/design/herdr-prism.md` without changing the acceptance scope.
- The public remote is `https://github.com/alexiob/herdr-prism`; its
  `herdr-plugin` topic is configured. Root manifest plus committed compiled
  JavaScript/native artifacts provide the standard GitHub install path without
  installer toolchains. The Windows helper must be supplied by actual Windows
  CI before that platform's repository install is advertised as working.
- Actual installed Herdr 0.9.3 has no `plugin update` or `plugin state-dir` CLI.
  Safe repository upgrades use successful deactivation, reinstall and activation.
  Its ordinary uninstall removes its GitHub checkout but retains configuration
  and state. Newer master documentation describes different retention/update
  behavior; that is not substituted for tested 0.9.3 behavior.
- `scripts/github-herdr-test.mjs` is prepared for exact-commit actual GitHub
  install/reinstall/activation/enable/disable/uninstall acceptance. No remote
  execution success is claimed until the code is pushed and the test runs.
- Actual isolated advanced macOS acceptance passed all ten stages on the prior
  plugin-ID release: exact synthetic sessions, native metadata readback/TTL,
  follow/right movement/pin, hidden pause/resume, stale occupant guards, collector
  shutdown, projection ownership and configuration-conflict recovery. Proof is
  `/private/tmp/prism-features-proof-20261006-r7/features.json`; renamed-release
  rerun and native client pixels remain pending.
- A read-only current-provider audit found newer Codex goal, inter-agent and
  explicit turn-counter shapes; source-verified adapters and regressions now
  cover them. Encrypted bodies remain unavailable. See
  `docs/provider-compatibility.md` for precise versions, source evidence and limits.
- Actual-host profiling now uses 50 declared fixture sessions, 500 real kernel
  processes, 100 MiB history, actual collector/helper/Git CPU accounting and a
  real PTY. Initial idle/active CPU failed at 1.76%/6.05%, while memory and latency
  passed (`artifacts/macos-performance/`). Bounded rendering and documented idle
  cadences reduced an intermediate run to 0.89%/3.18%, but its final outstanding
  frame acknowledgement failed; it is not a complete passing profile. Further
  optimization and a strict complete rerun remain required. Controlled RPC is
  still distinct from full live Herdr transport/soak certification.
