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
not changed.

The Linux-only SSH run
[37459983924](https://github.com/alexiob/herdr-prism/actions/runs/37459983924)
then passed at `9b554ee`. Its downloaded artifact
`artifacts/remote-ci-9b554ee-linux-x64/remote.json` records `ok: true` for an
actual Linux x64 Node 24.21.0 client and Linux x64 Node 24.21.0 server. The same
strict keyboard, remote collection, OSC 52, disconnect/reconnect and complete
uninstall gates passed, including owned client/container/SSH-file cleanup.
This workflow contains no Windows jobs. Synthetic provider and loopback SSH
limits still apply, and the upstream client-visibility gate remains unproven.

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

## Nested mouse disclosure correction — 2026-10-06

The inspector's fixed left-column fold shortcut incorrectly activated a
depth-two agent instead of folding it. Screen rows now expose their actual
disclosure column, and a shared row-click controller selects the displayed row
before folding or activating it. It rejects header/footer coordinates and clears
pending keyboard numbers so a click cannot focus a different numbered agent.
Non-tree views retain their existing left-gutter shortcuts.

Regression tests cover root, nested and capped agent indentation in Unicode and
ASCII modes, clipped process indentation, scrolled 26-column views, fold/unfold,
leaf and label activation, invalid body coordinates and pending numeric input.
The old fixed-column behavior returned a focus action for the depth-two glyph;
the corrected handler hides/reveals the descendants without returning focus.

Typecheck/build and strict macOS tests passed: 262 tests, 254 passed, eight
platform skips, zero failures. The exact staged package at
`artifacts/release-prism-mouse-fix-macos/` passed all ten existing isolated live
Herdr interaction/ownership gates in
`artifacts/prism-mouse-fix-live-macos/features.json`. These live gates do not
exercise deep native mouse transport; the direct TUI regressions cover this
correction.

Strict Linux arm64 Node 24 container tests also passed: 262 tests, 253 passed,
nine platform skips, zero failures. The initial bind-mounted run accidentally
exposed the macOS `target/debug` helper to Linux and failed two helper shutdown
checks. The corrected run used the checksummed Linux arm64 helper from the
passing `9c100f6` CI artifact and Podman's `--init` child reaper. No test was
disabled; Linux production sampling still uses TypeScript procfs. Both disposable
test containers were removed. Logs:
`/private/tmp/prism-mouse-fix-strict-linux-arm64-corrected.log` and
`/private/tmp/prism-mouse-fix-strict-macos.log`. Generated `dist/` was rebuilt
without replacing the Windows agent's production changes.

Before pushing, this change was rebased onto `fd93b98`, which includes the
Windows agent's `492fd08` package/history-clock update. That update's Windows
files were retained. Post-rebase typecheck/build and the affected TUI/input/native
protocol tests passed on macOS: 30 tests, 29 passed, one Windows-only skip,
zero failures. The broader 262-test and staged live results above precede that
Windows update and do not certify its Windows behavior. One incoming Windows
documentation heading's legacy-encoded dash was normalized to UTF-8 with its
text preserved.

## Native root ordering correction — 2026-10-06

The collector previously let provider inventory insertion order determine root
presentation. It now records the native snapshot order independently, and the
forest moves entire root subtrees according to each root's first attachment.
The pinned Herdr 0.9.3 snapshot implementation supplies workspace/tab/pane order.
Descendant discovery order and explicit relationships are preserved. A root
without its own pane uses its earliest attached descendant; historical trees
without attachments remain stable after the live trees.

The regression reproduced B/A roots from B/A provider inventory despite an A/B
host snapshot. It now asserts A/B native publication ranks, changes only the
snapshot order to B/A, and verifies changed ranks with the same selected key,
terminal and explicit local goal. Publication uses the production publisher
against controlled RPC, rather than claiming native client pixels. Graph tests
also cover child order, roots represented only by an attached child, historical
roots and a 10,000-node chain under native ordering.

Typecheck/build passed. Strict macOS tests passed with 265 total, 256 passed,
nine platform skips and zero failures. Strict Linux arm64 Node 24 Podman tests
passed with 265 total, 255 passed, ten platform skips and zero failures, using
the checksummed Linux helper and `--init`. Logs:
`/private/tmp/prism-native-order-strict-macos.log` and
`/private/tmp/prism-native-order-strict-linux-arm64.log`.
The rebuilt macOS package at `artifacts/release-prism-native-order-macos/` passed
all ten existing live interaction and ownership gates. Its proof is
`artifacts/prism-native-order-live-macos/features.json`. Those gates use actual
isolated Herdr but do not exercise native host rearrangement or client pixels;
the direct collector/publisher regression establishes this ordering correction.
The disposable Linux test container was removed. Windows-specific implementation
and validation remain with the other agent.

## Selected-session reference history — 2026-10-06

The former 200-message reference loss case is corrected with a separate streaming
metadata reducer. Only the selected visible session's canonical transcript files
are read; appends are incremental and replacement/truncation rebuilds the affected
file. Cancellation stops record reads and discards the cancelled reader. Successful
tool and standalone patch events retain their original checkout context, while
failed patch events do not earn an edited marker. Immutable reference snapshots
reuse unchanged existence evidence for five seconds, with at most four concurrent
local stats. Temporary source failures retry on that same visible-session cadence.

Regressions recover an early reference and edit after 250 unrelated messages,
preserve first/latest sources, deduplicate mirror files, follow appends and
rotation, stop cancelled reads, and prove that hidden panes cannot retry reference
reads. Refs show coverage and existence-evidence age; native counts use `rN+`
for partial/retained history and `r—` for unavailable sources. The hot message
window remains 200. Current metadata bounds are 2,000 targets, 2,000 edited paths,
100 mention sources per target and eight transcript readers. Older target/source
pagination remains required in the
[reference history plan](superpowers/plans/2026-10-06-reference-history.md);
this component does not certify the complete reference feature or performance budget.

Windows commits through `5965de8` were fetched and pulled with rebase; this was a
fast-forward with no conflicts, and the uncommitted reference component was
restored intact. Typecheck/build and 97 targeted content/provider/collector/native/
TUI tests passed. The combined strict macOS suite passed with 275 total, 265 passed,
ten platform skips and zero failures. Strict Linux arm64 Node 24 Podman passed with
275 total, 264 passed, eleven platform skips and zero failures, using `--init`
and the checksummed Linux helper. Logs:
`/private/tmp/prism-reference-history-merged-strict-macos.log` and
`/private/tmp/prism-reference-history-merged-strict-linux-arm64.log`.

The combined product build staged at
`artifacts/release-prism-reference-history-merged-macos/` passed all ten existing
isolated live Herdr interaction/ownership gates. Proof:
`artifacts/prism-reference-history-merged-live-macos/features.json`.
Actual macOS arm64 Node 26 to Linux arm64 Node 24 SSH acceptance also passed,
including real host PTY navigation, remote CPU/RSS/Git/Refs/To-do, OSC52 copy,
disconnect preservation, reconnect and complete remote uninstall. Proof:
`artifacts/remote-reference-history-merged/remote.json`. Owned SSH files and
containers were removed. These fixtures use synthetic provider records/processes;
they do not certify paid-provider interaction, native sidebar pixels, WAN behavior
or the missing upstream viewer-visibility contract. Windows-specific fixes and
validation remain with the other agent.

## Reference target/source pagination — 2026-10-06

The reference hot bounds now have on-demand recovery. Refs `b` loads older
targets; `Space` opens mention history, `b` loads earlier sources, `Enter` reads
the exact recorded revision, and nested `Escape` restores both reader anchors.
`B` restarts history. Changed transcripts invalidate page cursors and mark cached
pages stale. Source cursors bind provider/session, canonical file identity, byte
offset and visible-body fingerprint; reused paths and later same-ID bodies cannot
silently replace the chosen source. Page cursors also bind the target scope.

Each page defaults to 50 items, caps at 200, and uses at most 201 candidates per
scan. A verification scan checks latest mentions before returning a target;
older windows refill displaced candidates without a lifetime ID set. A target key
breaks shared-message offset ties. UI caches retain at most 500 targets/sources
and 4 MiB per reader, with at most four target caches. Pages retain only first/
latest source metadata; complete source lists remain independently pageable.
Only selected-visible-session requests can read bodies; closure/selection changes
cancel scans. Claude unfinished visible text is retained separately at 16 heads /
1 MiB, with explicit partial coverage on overflow. Hidden reasoning is excluded.

Tests recover 2,105 distinct targets, 150 mirrored mentions and 405 targets from
one message, preserve explicit edits, distinguish completed same-ID revisions,
reject changed-file/target cursors, cancel in-flight work, restore nested readers
and bound retained pages. The Claude prefix regression failed before correction.
Strict macOS passed 283 tests: 273 passed, ten platform skips, zero failures.
Strict Linux arm64 Node 24 passed 283 tests: 272 passed, eleven platform skips,
zero failures, using the checksummed helper and `--init`. Logs are
`/private/tmp/prism-reference-pages-complete-strict-macos.log` and
`/private/tmp/prism-reference-pages-complete-strict-linux-arm64.log`.
After the requested pull through `2e68d55`, typecheck and 110 targeted provider,
content, collector, TUI, native, lease and lifecycle tests passed. The incoming
Windows-only admission guard and its evidence were preserved.

Actual staged macOS and Linux Herdr `--references` acceptance recovered 106
older targets from a 2,106-target fixture, displayed explicit edit evidence,
loaded all 150 mentions, opened the first source, and restored both readers.
All ten existing interaction/ownership gates passed alongside that eleventh gate.
The final package evidence is recorded under
`artifacts/prism-reference-pages-publish-live-macos/features.json` and
`artifacts/prism-reference-pages-publish-live-linux-arm64/features.json`.
Actual macOS-to-Linux SSH acceptance is recorded under
`artifacts/remote-reference-pages-publish/remote.json`.
These use synthetic provider fixtures and do not replace the remaining mixed-
provider, native-pixel, multi-client or performance acceptance.

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

- Windows-specific delivery is validated by the owning Windows agent through
  `5e9f4b1`, including both majors and ordinary GitHub installation. Its
  [all-ten-job CI run](https://github.com/alexiob/herdr-prism/actions/runs/37474269213)
  was independently read back as successful. Later general feature commits need
  their own platform evidence; this machine does not repeat Windows-specific fixes.
- The renamed advanced acceptance gate passed on all eight Unix CI jobs for
  `376d3a6`; subsequent source changes need their own evidence. Add actual Windows
  TTL coverage after user resumption, native client/theme pixels and multiple clients.
- Exercise the full mixed-provider/deep-child/second-worktree/registered-detached
  scenario, launch ownership, selected-session visibility and reconnect/upgrade
  recovery in live Herdr. Complete provider audit limitations remain explicit.
- Finish native numeric badge mapping under a provable host contract.
- Meet active CPU and full live-host performance budgets; run long recovery/soak
  acceptance. Unit fixtures and controlled transport profiles are not substitutes.
- Finish a requirement-by-requirement evidence audit and stage/install/remove
  the exact final artifacts. Release signing/notarization and public tagged
  release publication are separate from working development packages.

Full-access local testing and remote CI are available. No sandbox restriction is
an outstanding blocker. The original implementation goal remains active for
remaining acceptance; Windows work is explicitly deferred until user-requested
resumption on a Windows machine.

## Windows local resumption and merged delivery — 2026-10-06

Windows fixes `077736a` were merged with remote-support `f07281f` as `9c100f6`
and pushed. The other machine's shared implementation and evidence were preserved.
See [Windows validation](windows-validation.md) for the reproduced failures,
regressions, exact artifact and execution boundaries.

Actual Windows 11 x64 Node 22.23.3/24.21.0 passed live Herdr 0.9.3 installation,
authenticated readiness, right placement/native focus preservation, collector
restart and complete managed removal. Both also passed advanced follow/pin,
hidden pause/resume, actual production-publisher TTL, stale occupant guards,
source-safe coexistence and conflict-preserving removal/recovery. Five consecutive
Node 22 lifecycle repetitions passed after the empty-admission-lease correction.

Before the final native clock correction, the merged Node 24 strict suite passed
258 tests, zero failed and two Linux-only skips. A merged Node 22 run passed 257
but exposed an intermittent ConPTY quit hang; subsequent independent reproductions
confirmed it. Native Win32/Rust-to-Node wall-clock skew was also exposed in both
Windows CI jobs in run 37458785002. The new receiving-clock regression reproduced
the issue, passed after correction, and the real Node 22 sampler/protocol acceptance
passed all six tests. CPU counters, exact identities and working-set values were
not changed. Final ConPTY investigation and standard GitHub installation remain
separate acceptance work, rather than being inferred from these passing checks.

The executed Rust 1.90.0 static-MSVCRT x64 helper is now included under
`bin/win32-x64`, with exact SHA-256 and matching toolchain copyright/license texts.
Herdr 0.9.3 exists as an official Windows x64 release and was checksum-verified
locally. This machine's globally installed 0.9.2 does not meet Prism's declared
minimum; validation uses the isolated pinned 0.9.3 executable.

## Windows final local delivery — 2026-10-06

Implementation `5e9f4b1a568b444f1b99654aa26b8540103665f1` is pushed and
merges remote main through `7fc637e`, preserving the other machine's general
features. ConPTY now closes its owned Windows input after restoring raw mode;
30 consecutive real smoke runs passed. ACL requests wait for PowerShell reader
readiness inside the original deadline; the delayed-reader regression failed
before the correction and passed afterward. Explicit UTF-8 pipe readers/writers
also replace console-wide encoding changes. Both complete local suites and
ordinary GitHub lifecycles passed again after this change. Strict ACL ownership and refusal
checks remain unchanged.

Final merged Node 22.23.3 and 24.21.0 suites each passed 273/275 tests with zero
failures and two Linux-only skips, requiring native sampler, named pipes and
actual ConPTY. Typecheck/build, helper SHA/PE/system-import checks and staged
release checks passed. Post-fix live lifecycle and advanced interaction checks
passed on both majors; both repeated successfully on the final pipe-reader
implementation.

Windows atomic replacement also handles temporary delete-sharing reader locks
with five attempts and 375 ms total backoff, rerunning caller authorization each
time. The real file-lock regression reproduced CI's EPERM before the correction
and passes after it. Windows lifecycle evidence captures exact native process
births; a missing sampler record still requires ESRCH, and unreadable identities
cannot certify cleanup. Unix behavior is unchanged. These corrections preserve
the original historical CI failures rather than relabeling them as passes.

Production Windows ACL inspection now uses direct .NET Framework security and
typed JSON APIs, with the original strict fields, validator and deadlines.
Both Windows CI jobs passed in run 37472767803, including Node 24 ordinary
GitHub lifecycle. That run had seven passing Unix jobs; macOS arm64 Node 22
exposed the exact admission-file release race. A subsequent Windows-only guard
retries only ENOENT for the exact lease path through create:false acquisition;
removed state is never recreated. Unix implementation remains with the other
machine. The remote reference-history implementation is preserved; only three
Unix-specific test path expectations were made portable.

Ordinary GitHub installation of the exact pushed implementation passed on both
majors, including authenticated activation, safe reinstall, explicit restart,
disable/enable and uninstall. Managed removal separately restored exact original
configuration and purged only owned directories. Herdr's ordinary uninstall
retains private config/state as documented. Global Herdr 0.9.2 was not replaced;
tests used the checksum-verified official Windows 0.9.3 release.

See [Windows validation](windows-validation.md) and the capability-only
[durable evidence](evidence/windows-2026-10-06.json). Cross-platform CI results
are now complete: [run 37474269213](https://github.com/alexiob/herdr-prism/actions/runs/37474269213)
passed all ten jobs at `5e9f4b1`, including both Windows majors and all eight
macOS/Linux jobs. Broader native-pixel, multi-client,
paid-provider and soak acceptance remains outside this Windows delivery.

## Unix dependency bootstrap and Prism shortcut — 2026-10-06

`install.sh` now supplies verified user-local Node 24.21.0 and Herdr 0.9.3 when missing, resolves GitHub source to an immutable revision, stages an absolute-runtime manifest and uses authenticated live installation/removal. It does not restart existing servers or replace existing Prism registrations. A new empty headless session receives its initial workspace. The main README documents both installers and the keyboard map.

The installer owns a reversible `prefix+i` binding (`Ctrl+B`, then `i` by default), including inspector-only mode. It preserves collisions, binding arrays, whitespace and unsupported opaque syntax. Existing matching bindings remain user-owned. The open action now awaits panel-open/focus RPCs before closing its client; real shortcut testing discovered this existing asynchronous cleanup defect.

Actual isolated macOS arm64 and Podman Linux arm64 proofs cover no Node in the existing server PATH, checksum-pinned dependency setup, authenticated activation, real controlling-PTY shortcut dispatch, complete config/state/installation purge, original shortcut/layout restoration, dependency reuse and missing-server setup. See [durable evidence](evidence/unix-bootstrap-2026-10-06.json). Windows installer changes are pulled from the other machine and retain separate ownership. UI redesign requested by the user is the next feature phase, inspired primarily by btop and also htop, Radar and agent-panel; the existing crowded presentation is not claimed finished.

The public-source installer now passes the same complete delivery pipeline against actual GitHub downloads on macOS arm64 (`56f2ee9`) and Podman Linux arm64 (`e617f0c`). The macOS source-path and committed-helper regressions are fixed and covered; final installer-targeted suite passes 51 tests.

## UI redesign gallery — 2026-10-06

The [terminal design gallery](ui-design-preview.md) now implements the requested
reviewable preview: all eight tabs, Notes editing layout, compact native sidebar
content, selected-entry help on `?`, and full content on Enter. Right arrows
mark destinations; Overview Processes, Git, To-do and other activity summaries
have matching tab destinations. Long rows show meaningful summaries with full
facts in details. Dark/light/mono, ASCII and 36/50/80/120-column geometry are
covered. The synthetic gallery is open in the named local Herdr pane for user
iteration; the production UI and persistent Notes editor remain to be replaced.
Gallery + existing TUI/input tests pass 29/29, with TypeScript checks and actual
PTY help/detail/back/exit proof. Collection schedules and Windows code are
unchanged by this preview.
