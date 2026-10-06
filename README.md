# Herdr Prism

A six-view terminal dashboard for Codex, Claude and Pi sessions in Herdr.
It follows agent lineage, process ownership, messages, references, explicit goals,
local To-do checkboxes and Git checkout state. An optional native overview adds
compact summaries to Herdr's existing Agents panel.

**Release status:** implementation candidate. Actual macOS and Linux CI and
GitHub installation checks have passed. Windows x64 now has local Node 22/24
live lifecycle and advanced-interaction evidence; see
[Windows validation](docs/windows-validation.md). The Windows native helper
is included with its checksum and matching toolchain notices. See
[compatibility](docs/compatibility.md) for the exact evidence and remaining gates.

## Install and open

macOS and Linux (x64 or arm64):

```sh
curl -fsSL https://raw.githubusercontent.com/alexiob/herdr-prism/main/install.sh | sh
```

The installer checks dependencies, supplies checksum-pinned Node and Herdr when
missing, and activates Prism in your local Herdr session. It uses user-local
directories and configures **Ctrl+B, then `i`** to open the panel when the
shortcut is free. It prints the exact command for complete Prism removal.
A running Herdr server needs no restart; a missing server is started headlessly.
See [Unix installer options](docs/install.md#macos-and-linux-setup) for named
sessions, inspector-only mode and dependency-only setup.

Windows x64, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/alexiob/herdr-prism/main/scripts/install-windows.ps1 | iex
```

The Windows installer also configures **Ctrl+B, then `i`** when the shortcut is
free. Its setup and activation details are in
[Windows setup](docs/install.md#windows-setup).

To uninstall on Windows and remove the installer-owned shortcut:

```powershell
irm https://raw.githubusercontent.com/alexiob/herdr-prism/main/scripts/uninstall-windows.ps1 | iex
```

Install from GitHub with Herdr's standard command:

```sh
herdr plugin install alexiob/herdr-prism
herdr plugin action invoke activate-overview --plugin iob.herdr-prism
```

The repository ships compiled JavaScript and macOS native helpers with
checksums and license notices. The install build hook checks these files; it
does not run npm or Cargo. The second command activates the plugin in the
current live session, because Herdr 0.9.3 runs startup hooks at server startup.
Use `activate-inspector` instead for inspector-only coexistence. Standard update,
enable/disable and uninstall commands are described in
[installation](docs/install.md#standard-herdr-commands).

The plugin is listed in the [Herdr marketplace](https://herdr.dev/plugins/).
The public repository's `herdr-plugin` topic and root manifest provide automatic
discovery. Listing is separate from installation and platform verification.

For immediate activation and complete removal through one lifecycle wrapper,
use a checksummed release as described below.

Use a reviewed release directory that includes compiled `dist/` JavaScript and,
on macOS/Windows, its matching `bin/<platform>-<arch>/` helper. Installation needs
Node.js 22.13 or later and Herdr. Git enables checkout metrics. No runtime npm
installation, compiler, Rust toolchain, downloads or agent hooks are required.

```sh
node scripts/live-install.mjs install --root .
```

Run this from an extracted checksummed release. It creates a managed copy,
activates immediately in the running Herdr session, and prints the exact command
for complete removal. Default installation takes reversible native layout ownership;
use `--inspector-only` for coexistence. Read [live installation and complete removal](docs/install.md)
for the lifecycle and configuration details.

## Dashboard

| View | Contents |
| --- | --- |
| Overview | Session/scope, explicit goal, resources, usage, timing, messages and Git |
| Agents | Verified arbitrary-depth lineage and checkout grouping |
| Processes | Readable process identities, exclusive ownership and resource coverage |
| Messages | Visible user/assistant text, inline expansion and full detail |
| Refs | Assistant links/files, explicit edit markers, exact source history and deliberate open/copy |
| To-do | Complete ACTION lists enabled by default, with local checked state and source provenance |

Refs are recovered from the selected session's transcript history independently
of the 200-message hot window. The coverage row shows when history is partial
or unavailable and when local existence was last checked. Native `rN+` means a
bounded or partial count; `r—` means the source is unavailable. The current
index keeps at most 2,000 targets and 100 source mentions per target. In Refs,
`b` loads older targets; `Space` opens a target's mention history, where `b`
loads older sources. `Enter` opens the exact recorded source. `Escape` returns
to the prior reader position; `B` reloads history from its newest page. Changed
transcripts invalidate page cursors and label retained pages as stale.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+B`, then `i` | Open Prism (installer binding; uses your configured Herdr prefix) |
| `q` | Close the focused Prism panel |
| `Tab` / `Shift+Tab` | Next / previous view |
| Arrows or `j` / `k` | Move selection |
| `Home` / `End`, `PageUp` / `PageDown` | Navigate the current reader |
| `Enter` | Focus/open the selected item |
| `Space` | Fold/expand; open a reference's source history |
| `Escape` | Return from details or close help/filter |
| `b` / `B` | Load older messages/refs / reload reference history |
| `p` / `u` / `w` | Pin session / subtree scope / Agents worktree grouping |
| `s` / `y` / `x` | Jump to source / copy / check or reopen To-do |
| `/` / `?` / `,` / `e` | Filter / help / settings / diagnostic export |
| Agent number, then `Enter` | Select that displayed agent target |

An existing `prefix+i` assignment is preserved. The installer reports the
conflict; Prism remains available through its Herdr action menu. The Unix
installer removes its owned shortcut during complete removal.

Numeric Agents selection preserves the target that was displayed when typing
began. Selecting transcript-only descendants inspects them without inventing a
native pane.

Full transcript, refs, To-do, Git and frequent resource updates follow only the
selected inspector session. Closing the pane or changing its server's active
workspace/tab pauses that work; other agents retain lightweight inventory and
explicitly stale cached summaries. Reopening warms up CPU measurements and catches
up selected content. Herdr 0.9.3 exposes no attached-client visibility query, so
last-client disconnect and background-machine pause remain an outstanding gate.
Verified roots of other agents remain process attribution boundaries.

Install Prism on each remote Herdr server to collect that host's sessions,
transcripts, processes and Git state. The dashboard identifies its server and
native rows retain Herdr's machine label. See [remote setup and limitations](docs/remote.md).

`—` means unavailable; `0` means measured zero. Stale values include freshness
information. CPU 100% represents one logical core. Resident memory is summed
RSS on Unix and working set on Windows. Git line counts measure **working tree
vs HEAD**; untracked and binary files have separate counts, and unborn branches
have no invented line totals. Provider counters retain their documented cache
and cumulative semantics; absent cost rates produce unavailable/partial costs.

## Native overview and privacy

Native rows format existing agent entries and retain provider/workspace/tab
labels when plugin tokens expire. Herdr's current API cannot create arbitrary
native process/transcript rows or independent clickable fields. The inspector
provides those details. One native projection has one owner; choose inspector
only when another plugin owns the view.

Collection stays on each agent's Herdr server, with no analytics/backend or
automatic transcript uploads. A remote dashboard reaches its viewing client
through Herdr's SSH terminal transport.
Hidden reasoning and system/developer content are excluded. Raw transcript
archives are not created. User preferences, explicit goals, validated launch
associations and local To-do state remain in private plugin directories.
[Privacy and storage details](docs/privacy.md) explain what is retained.

## Development and releases

```sh
npm ci
npm run check
npm test
npm run build
```

For native development, install Rust and its matching `rust-docs` component,
then run `cargo test --locked --offline --manifest-path native/sampler/Cargo.toml`
and `node native/sampler/package.mjs`. These are development commands, not
installation hooks. Linux runtime metrics use procfs directly.

```sh
node scripts/release.mjs --output artifacts/release --platform linux-x64
node artifacts/release/scripts/check-install.mjs --root artifacts/release
```

Choose `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-arm64` or `linux-x64`.
`--platform all` refuses to stage until every required native helper, matching
checksum and Rust license artifact is present. Staging copies compiled code,
protocol schema, manifest, optional companion, docs and notices; it does not
build, download or overwrite an existing output directory. SHA-256 files detect
corruption; verify the reviewed release provenance separately.

The [CI workflow](.github/workflows/verify.yml) requires Node 22/24 checks on five
actual platform/architecture runners, native lifecycle/resource tests, socket
or named-pipe tests, and terminal smoke checks. Missing smoke tooling fails CI.
The source [design](docs/design/herdr-prism.md) and implementation evidence
ledger in `docs/implementation-progress.md` describe the complete acceptance scope.
The [provider audit](docs/provider-compatibility.md) records inspected versions
and format-specific coverage.

Licensed under [MIT](LICENSE); see [third-party notices](THIRD_PARTY_NOTICES.md).
