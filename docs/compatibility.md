# Compatibility and validation status

Updated 2026-10-06. The first complete release requires actual macOS, Linux and
Windows execution plus live Herdr acceptance. Those gates are **not yet complete**.
The source has implementation/tests and strict CI definitions; an unexecuted
workflow is not runtime evidence.

## Platform matrix

| Target | Runtime backend | Packaged native artifact | Evidence recorded in this workspace |
| --- | --- | --- | --- |
| macOS arm64 | Rust libproc/sysctl helper | `bin/darwin-arm64/hat-sampler` | Actual enumeration, single/multicore ownership, memory and teardown passed. Signed development artifact built and checked. Live Herdr install/restart/remove passed in an isolated server; install/remove also passed in the user's session. Complete dashboard acceptance remains pending. |
| macOS x64 | Rust libproc/sysctl helper | `bin/darwin-x64/hat-sampler` | Thin x64 artifact built and checked. x64 Node/helper suite passed under Rosetta (214 passed, zero failed, two skipped). Physical Intel host and latest live lifecycle validation remain pending. |
| Linux x64 | TypeScript procfs | Not required | Parser/ownership fixture tests pass locally; actual Linux controlled-worker/procfs, terminal and socket CI execution pending. |
| Linux arm64 | TypeScript procfs | Not required | Actual Podman arm64 suite passed (221 passed, zero failed, two other-platform skips), with PTY, staged release, preflight and live Herdr install/restart/removal. Final renamed-source rerun remains pending. |
| Windows x64 | Rust Win32 working-set/process helper | `bin/win32-x64/hat-sampler.exe` | Win32/ACL/named-pipe/ConPTY implementations require actual Windows CI; no local Windows certification. |

Windows arm64 and other platforms are not release targets; the installation
checker rejects them rather than selecting a mismatched helper. Host platform
and Node process architecture determine artifact lookup. macOS arm64/x64 helpers
are thin Mach-O images, Windows x64 is PE; preflight checks the header and the
SHA-256 manifest. Checksums establish byte integrity, not platform execution or
release provenance. Linux does not require a native runtime helper.

## Runtime and protocol

| Component | Supported/tested contract | Limits |
| --- | --- | --- |
| Node.js | Minimum 22.13.0; CI matrix 22 and 24 | Local arm64 development used Node 26.10.0; translated macOS x64 used Node 22.23.3; Podman Linux arm64 used Node 24.21.0. Full matrix runs remain unrecorded. Release code is compiled ESM, with no runtime npm install. |
| Herdr | Installed 0.9.3, protocol 22 | Actual ordinary RPC/subscription and macOS live install/restart/remove exercised. Ordinary calls use separate connections; event subscriptions have dedicated streams. Complete native renderer and cross-platform lifecycle acceptance remain required. |
| Native sidebar | Real agent rows, ≤16 rows/tokens per row; ≤14 `hat_` keys in default template | No synthetic native nodes or per-field click handlers. Metadata shares the pane's retained-key budget. |
| Native projection | One source-guarded owner | Radar/Pi-tree cannot concurrently own the same layout/projection; inspector-only mode is the fallback. |
| Git | Explicit argv, porcelain-v2 NUL status and HEAD numstat | No network/fetch. Unborn line totals unavailable; binary/untracked files separate. Inaccessible/timed-out snapshots remain labeled. |
| Remote sessions | Herdr attachment facts | Unavailable remote process/transcript/Git data is not substituted by matching local cwd. |

Native overview dark/light/monochrome layouts have configuration fixtures and
fallback built-in labels. Native rendering on each actual client/theme still
requires live Herdr acceptance. The terminal renderer has deterministic 26/42/80
column fixtures, sanitized text and input tests; PTY/ConPTY smoke is required in CI.

## Provider evidence

Adapters cover explicit local schemas through versioned fixtures. They are not
a guarantee that every historical/future provider release shares those formats.

| Provider | Evidence supported by fixtures | Availability boundary |
| --- | --- | --- |
| Codex | Exact session/header IDs, explicit paired spawns, visible messages/tools/edits, model/usage/cache/turn records and successful explicit goal results | No same-cwd inference; unsuccessful goal requests do not become goals. Partial/rotated/malformed tails remain diagnosed. |
| Claude | Main and flat subagent JSONL records with explicit paired Agent links, streaming identity and supported usage | Hidden/system content omitted; absent parent/tool/usage facts remain absent. |
| Pi | Header ID/path identity, version-one records, visible custom content, supported auxiliary usage | Ordinary forks do not prove delegation. Unknown schemas are partial. |
| Optional Pi companion | Original compiled extension with version-one explicit goal/parent/state records | Loaded only by user choice; no automatic hook/instruction installation or detached-job ownership claims. |

Counters retain cumulative/delta, epoch, cache and subtree meaning. Missing
categories/prices/inclusion flags cannot establish a complete total. The dashboard
shows source/coverage/freshness and separates explicit goals, delegated tasks and
opt-in ACTION To-do lists.

## CI gates and pins

`.github/workflows/verify.yml` defines actual-platform jobs for:

- Ubuntu 24.04 x64 and arm64.
- macOS 15 arm64 and macOS 15 Intel x64.
- Windows Server 2022 x64.
- Node 22 and 24 on each target.

Each job performs `npm ci`, typecheck, locked/offline Rust tests, native package
checksum/notices, strict socket/named-pipe and resource tests, compiled build,
required PTY/ConPTY smoke, release staging, helper signing/system-dependency
checks, pinned Herdr isolated live lifecycle acceptance and installation preflight. Environment
flags `HAT_SOCKET_TESTS=1` and `HAT_REQUIRE_NATIVE=1` promote unavailable required
capabilities to failures. The smoke command runs unconditionally; a missing
script or unsupported terminal cannot silently pass the gate. CI artifacts are
archived with executable permissions retained. There is no automatic publishing.

Action pins were checked against the official repositories' tag references on
2026-10-06: [checkout v5.0.0](https://github.com/actions/checkout/releases/tag/v5.0.0),
[setup-node v5.0.0](https://github.com/actions/setup-node/releases/tag/v5.0.0),
[cache v4.2.4](https://github.com/actions/cache/releases/tag/v4.2.4), and
[upload-artifact v4.6.2](https://github.com/actions/upload-artifact/releases/tag/v4.6.2).
Workflow uses their full immutable commit hashes. Runner labels/architectures were
checked against [GitHub's official runner image inventory](https://github.com/actions/runner-images/blob/main/README.md).
The development native toolchain is pinned to [Rust 1.90.0](https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/)
with its matching `rust-docs` notices. None of these build tools is installed by runtime hooks.

## Remaining acceptance

Record actual CI results before advertising complete platform support. Live
Herdr acceptance must still verify right placement/follow/pin, multi-client local
rows, metadata TTL/readback, source-safe coexistence, pane/PID replacement,
upgrade lifetime, disconnect recovery and reversible unconfigure. The full
Codex→Claude→transcript-only child plus another-worktree Pi scenario, registered
launch ownership, native focus races and realistic performance/soak budgets must
be exercised. Cross-compilation and fixture correctness do not satisfy these gates.

The evolving source evidence ledger is `docs/implementation-progress.md`. The
automated suite uses disposable repositories/config/provider homes. A separate,
user-authorized current-session macOS lifecycle test temporarily installed and
removed the plugin; it verified exact original configuration restoration and
preservation of all original panes and the other plugin. It left this plugin
uninstalled. Windows will be validated in GitHub Actions once the repository is
hosted on GitHub; a workflow definition alone is not execution evidence.
