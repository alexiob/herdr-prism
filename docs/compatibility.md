# Compatibility and validation status

Updated 2026-10-06. The first complete release requires actual macOS, Linux and
Windows execution plus live Herdr acceptance. Those gates are **not yet complete**.
The original eight macOS/Linux CI jobs passed. Windows x64 work has now resumed
on an actual Windows machine with Node 22/24 live and strict evidence; see
[Windows validation](windows-validation.md) and the [handoff](windows-handoff.md)
and [progress ledger](implementation-progress.md).

## Platform matrix

| Target | Runtime backend | Packaged native artifact | Evidence recorded in this workspace |
| --- | --- | --- | --- |
| macOS arm64 | Rust libproc/sysctl helper | `bin/darwin-arm64/hat-sampler` | Actual host resource tests, ordinary GitHub installation and final Node 22/24 CI passed, including PTY, distribution, live lifecycle and advanced interactions. |
| macOS x64 | Rust libproc/sysctl helper | `bin/darwin-x64/hat-sampler` | Physical Intel CI passed on Node 22/24, including strict native/socket tests, PTY, distribution and live lifecycle. |
| Linux x64 | TypeScript procfs | Not required | Actual CI passed on Node 22/24 with strict procfs/socket tests, PTY, distribution and live lifecycle. Node 24 also passed ordinary GitHub installation. |
| Linux arm64 | TypeScript procfs | Not required | Actual CI passed on Node 22/24 with strict procfs/socket tests, PTY, distribution and live lifecycle. Node 24 also passed ordinary GitHub installation; earlier Podman acceptance passed. |
| Windows x64 | Rust Win32 working-set/process helper | `bin/win32-x64/hat-sampler.exe` plus checksum and Rust 1.90.0 notices | Actual Windows 11 x64 Node 22.23.3/24.21.0 native/socket/ConPTY, live install/restart/complete removal and advanced interactions passed locally. See the Windows evidence ledger for exact revisions and remaining gates. |

Windows arm64 and other platforms are not release targets; the installation
checker rejects them rather than selecting a mismatched helper. Host platform
and Node process architecture determine artifact lookup. macOS arm64/x64 helpers
are thin Mach-O images, Windows x64 is PE; preflight checks the header and the
SHA-256 manifest. Checksums establish byte integrity, not platform execution or
release provenance. Linux does not require a native runtime helper.

## Runtime and protocol

| Component | Supported/tested contract | Limits |
| --- | --- | --- |
| Node.js | Minimum 22.13.0; actual CI matrix 22 and 24 | Final eight Unix jobs passed; two Windows jobs failed. Local arm64 development used Node 26.10.0. Release code is compiled ESM, with no runtime npm install. |
| Herdr | Installed 0.9.3, protocol 22 | Actual ordinary RPC/subscription and macOS live install/restart/remove exercised. Ordinary calls use separate connections; event subscriptions have dedicated streams. Complete native renderer and cross-platform lifecycle acceptance remain required. |
| Native sidebar | Real agent rows, ≤16 rows/tokens per row; ≤14 `hat_` keys in default template | No synthetic native nodes or per-field click handlers. Metadata shares the pane's retained-key budget. |
| Native projection | One source-guarded owner | Radar/Pi-tree cannot concurrently own the same layout/projection; inspector-only mode is the fallback. |
| Git | Explicit argv, porcelain-v2 NUL status and HEAD numstat | No network/fetch. Unborn line totals unavailable; binary/untracked files separate. Inaccessible/timed-out snapshots remain labeled. |
| Remote sessions | Prism installed on each selected Herdr server; server-local socket, sampler, provider homes and Git | Server/session header, host-scoped ranks and client machine labels. No local PID/path fallback. Exact client-visible heavy-work gating needs a host API; see [remote support](remote.md). Windows hosts remain deferred. |

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
Unix jobs additionally require advanced live follow/pin, hidden pause/resume,
metadata TTL, stale occupant guards, close/restart and ownership-conflict checks.
Windows now runs the advanced gate too, using a portable production-publisher
TTL fixture with actual host-clock expiry and explicit restart.

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

The platform evidence above applies to source commit
`376d3a6b1453275485c6f52f34111d791612b6e9` in
[run 37450329250](https://github.com/alexiob/herdr-prism/actions/runs/37450329250).
It does not certify later changes. Complete Windows validation and ordinary repository
installation on every platform before advertising complete platform support. Live
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
uninstalled. Windows validation now uses actual GitHub Actions runners, as
requested; the current failed run is evidence of remaining work.
