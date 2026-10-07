# Herdr Prism

An eight-view terminal dashboard for Codex, Claude and Pi sessions in Herdr.
It follows agent lineage, process ownership, messages, references, explicit goals,
local To-do checkboxes, Git checkout state and private Markdown notes. An optional native overview adds
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

Each agent tab remembers its own Prism right pane. Opening Prism in Claude's
tab leaves Codex's pane intact. Press **Q** inside a pane to close only that tab's
view; opening it again restores that view's preferences. Prism restarts restore
the previously open tabs and keep closed tabs closed. All views share one
collector, with heavy collection limited to the visible tab.

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

Next, add the shortcut to Herdr's `config.toml`: `~/.config/herdr/config.toml`
on macOS/Linux, or `%APPDATA%\herdr\config.toml` on Windows. If you set
`HERDR_CONFIG_PATH`, edit that file instead; `herdr --help` shows the resolved
path. Plain GitHub installation does not add this binding automatically.

Add this block once, preserving other bindings. If `prefix+i` is already
assigned, choose another free key instead of adding a duplicate:

```toml
[[keys.command]]
key = "prefix+i"
type = "plugin_action"
command = "iob.herdr-prism.open"
description = "Open Prism"
```

Then apply the configuration in the running session:

```sh
herdr server reload-config
```

Press **Ctrl+B, then lowercase `i`** to open Prism's right-side panel (or your
custom prefix, then `i`). No pane restart is required. You can also open Prism
directly without the shortcut:

```sh
herdr plugin action invoke open --plugin iob.herdr-prism
```

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

## Update to the latest version

First stop Prism in each Herdr session where it is active:

```sh
herdr plugin action invoke deactivate --plugin iob.herdr-prism
herdr plugin log list --plugin iob.herdr-prism --limit 5
```

Wait for the returned deactivation log ID to show `succeeded` before replacing
files. This closes Prism views and flushes notes; agent panes keep running.
Use `--session <name>` before `plugin` for a named Herdr session.

For a GitHub installation, reinstall the latest `main`:

```sh
herdr plugin install alexiob/herdr-prism --ref main
```

On Windows, rerun the PowerShell installer after reinstalling to restore its
absolute Node runtime binding and check the shortcut:

```powershell
irm https://raw.githubusercontent.com/alexiob/herdr-prism/main/scripts/install-windows.ps1 | iex
```

For a macOS/Linux shell-installer or managed-release installation, unregister the
stopped linked copy while retaining private settings and notes, then rerun the
installer:

```sh
herdr plugin unlink iob.herdr-prism
curl -fsSL https://raw.githubusercontent.com/alexiob/herdr-prism/main/install.sh | sh
```

For an inspector-only Unix installation, use the installer flag:

```sh
curl -fsSL https://raw.githubusercontent.com/alexiob/herdr-prism/main/install.sh | sh -s -- --inspector-only
```

For a named session, append `--session <name>` to the installer arguments, for
example `sh -s -- --inspector-only --session work`. Preserve your installation
mode and session when updating.

A local development link can instead be updated with `git pull --rebase` and
`npm run build` in its source checkout. After a GitHub reinstall or local rebuild,
activate the new code and open the panel:

```sh
herdr plugin action invoke activate-overview --plugin iob.herdr-prism
herdr plugin log list --plugin iob.herdr-prism --limit 5
```

Use `activate-inspector` if you use inspector-only mode. Wait for the activation
log to show `succeeded`, then open the updated panel:

```sh
herdr plugin action invoke open --plugin iob.herdr-prism
```

The Unix installer activates automatically. Settings, notes and To-do checks are retained
by these update steps; complete removal scripts purge that data and are for
uninstallation. Reloading Herdr configuration alone does not restart Prism code.
Herdr 0.9.3 uses reinstall, with no `plugin update` command. Check the installed
source/revision with `herdr plugin list --plugin iob.herdr-prism --json`.

## Dashboard

| View | Contents |
| --- | --- |
| Overview | Session/scope, explicit goal, resources, usage, timing, messages and Git |
| Notes | Persistent per-agent Markdown, autosave and recovered conflict drafts |
| To-do | Complete ACTION lists enabled by default, with local checked state and source provenance |
| Git | Exact checkout, colored line changes, tracking and snapshot facts |
| Agents | Verified arbitrary-depth lineage and checkout grouping |
| Processes | Readable process identities, exclusive ownership and resource coverage |
| Refs | Assistant links/files, explicit edit markers, exact source history and deliberate open/copy |
| Messages | Visible user/assistant text, inline expansion and full detail |

Refs are recovered from the selected session's transcript history independently
of the 200-message hot window. The coverage row shows when history is partial
or unavailable and when local existence was last checked. Native `rN+` means a
bounded or partial count; `r—` means the source is unavailable. The current
index keeps at most 2,000 targets and 100 source mentions per target. In Refs,
`b` loads older targets; `Space` opens a target's mention history, where `b`
loads older sources. `Enter` on a target opens its complete styled details; `s` opens the exact recorded source. The detail view also offers Open target and Mention history. `Escape` returns
to the prior reader position; `B` reloads history from its newest page. Changed
transcripts invalidate page cursors and label retained pages as stale.

## Configure the panel tab order

The default order is **Overview, Notes, To-do, Git, Agents, Processes, Refs,
Messages**. To change it, find Prism's own configuration directory:

```sh
herdr plugin config-dir iob.herdr-prism
```

Edit `settings.json` inside the printed directory. The usual path is
`~/.config/herdr/plugins/config/iob.herdr-prism/settings.json` on macOS/Linux,
or `%APPDATA%\herdr\plugins\config\iob.herdr-prism\settings.json` on Windows.
For a remote panel, edit this file on its collecting Herdr server.

Add or edit the `ui` section below, preserving other settings and valid JSON:

```json
{
  "ui": {
    "tabOrder": ["Overview", "Notes", "To-do", "Git", "Agents", "Processes", "Refs", "Messages"]
  }
}
```

Move the names into your preferred order, then reload the setting live:

```sh
herdr plugin action invoke reload-settings --plugin iob.herdr-prism
```

The next panel poll updates open views without restarting them or interrupting
Notes editing. Tab/Shift+Tab and mouse navigation follow the new order; the
selected view and reader position stay intact. Names are case-insensitive;
`To-Do` is accepted. Omitted tabs are appended in the default order. Empty lists,
unknown names and duplicates are rejected, keeping the previous live order.
Remove `ui.tabOrder` and reload to restore the default.

For a named session, use `herdr --session <name> plugin action invoke
reload-settings --plugin iob.herdr-prism`; repeat in each active server/session.
This action reloads `ui.tabOrder` and `ui.nativeGrouping`. Other collector settings still need
reactivation. **`herdr server reload-config` reloads Herdr's `config.toml` and
shortcuts; it does not reload Prism's `settings.json`.**

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+B`, then `i` | Open Prism (installer binding; uses your configured Herdr prefix) |
| `q` | Close the focused Prism panel |
| `Tab` / `Shift+Tab` | Next / previous view |
| Arrows or `j` / `k` | Move selection |
| `Home` / `End`, `PageUp` / `PageDown` | Navigate the current reader |
| `Enter` | Open the selected detail or corresponding tab; inspect an agent inside Prism |
| `K` in Processes or process details | Ask to terminate the selected process; Cancel is selected initially |
| `f` in Agents | Explicitly focus the selected live Herdr pane |
| `Space` | Fold/expand; open a reference's source history |
| `Escape` | Return from details or close help/filter |
| `b` / `B` | Load older messages/refs / reload reference history |
| `p` / `u` / `w` | Pin session / subtree scope / Agents worktree grouping |
| `s` / `y` / `x` | Jump to source / copy / check or reopen To-do |
| `?` | Explain the selected entry; `Escape` returns to its saved position |
| `/` / `,` / `e` | Filter / settings / diagnostic export |
| Agent number, then `Enter` | Inspect that displayed Prism agent target |
| `Enter` in Notes | Start editing Markdown |
| `Ctrl+S` while editing | Save immediately; otherwise autosave after 500 ms |
| `Escape` while editing | Save and return to reading |
| `Ctrl+C` while editing | Save and close this panel |

Entries that open another view carry a right arrow. Overview Processes, Git,
Agents, Messages, Refs, To-do and Notes entries open their matching tabs. At wide
widths, Overview uses two columns; left/right moves between visible columns.
Fact details align quiet labels with colored quantities, identities, paths,
durations and Git changes. Long rows show a concise summary; Enter retains full
wrapped content. Dark, light and monochrome themes are supported through
`inspector --theme dark|light|mono` or the persisted `theme` setting.

In Notes edit mode, `q`, `p`, `/`, `?`, numbers and spaces are literal text.
Arrows, Home/End, Backspace/Delete and bracketed paste edit the source. A pane
too small to show content and the caret visibly pauses text editing until enlarged. Tab saves
and leaves Notes. Follow pauses during editing, even if the agent disappears;
its draft stays attached to that agent. Notes live on the collecting server,
shared by its panels and retained across restarts/upgrades. A newer external edit
is preserved; Prism saves the stale draft separately and reports its recovery
path through `?` after leaving edit mode. Complete Prism removal deletes notes
and recovery drafts along with owned state. Demo Notes use disposable files.

`K` opens a confirmation for the captured process name, PID, owner and collecting
server. Press `Enter` on Cancel or `Escape` to return; select Terminate and press
`Enter`, or press `y`, to confirm. Follow and tab/scope changes pause while this
dialog is open. A tiny pane must be enlarged before confirmation. macOS/Linux
send `SIGTERM`; Windows terminates the process. Only the selected PID is targeted,
with no child/group termination or automatic escalation. Terminating the harness
root can end its agent session. Demo mode simulates the action without OS signals.
The server rechecks visibility, birth/boot identity and ownership, refuses stale
or inaccessible targets, and reports a request rather than claiming exit. The
portable OS signal call uses a PID: a simultaneous PID reuse or Herdr occupant
replacement after validation cannot be eliminated atomically by the current APIs.

An existing `prefix+i` assignment is preserved. The installer reports the
conflict; Prism remains available through its Herdr action menu. The Unix
installer removes its owned shortcut during complete removal.

Numeric Agents selection preserves the target that was displayed when typing
began. Selecting an agent stays inside Prism. `f` focuses a live pane; transcript-only
descendants remain inspectable. Prism numbers are separate from Herdr focus indices.

An unpinned panel opens on an agent in its own tab. Follow watches that tab's
last focused agent, including session changes while keyboard focus is inside
Prism. Explicit child/history inspection stays selected until the native focus
or binding changes. Pinning and Notes editing hold the selected conversation.

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

## Codex session identity

Codex 0.160's shared background server can inherit the `HERDR_PANE_ID` of its
first terminal. Herdr's SessionStart hook can then report a new thread onto that
older pane, leaving another pane without a session ID. Prism rejects host Codex
reports whose transcript header belongs to a different working directory, before
loading their bodies; it shows an unavailable pane record rather than another
project's messages, tokens or goals. Matching directories never identify a
session. Compatibility symlinks are resolved before comparison.

For future Herdr terminal sessions, launch `codex --no-daemon` (or
`codex --no-daemon resume <thread-id>`). This gives the hook the terminal's own
environment without stopping an existing shared server. Verify each terminal's
actual thread with Codex `/status`; don't use a thread ID inherited by an agent's
tools, a launch argument, or the latest file in a project as the current identity.

An operator can repair an existing report using the exact pane and the thread ID
confirmed in that terminal:

```sh
herdr pane report-agent-session <pane-id> --source herdr:codex --agent codex --agent-session-id <thread-id> --session-start-source resume --seq <fresh-sequence>
herdr agent get <pane-id>
```

`fresh-sequence` must exceed the hook's previous sequence; its Unix hook uses
`time.time_ns()` (for example, `python3 -c 'import time; print(time.time_ns())'`).
Read back `agent_session.value`: a successful command alone does not prove that
Herdr accepted a replacement. A later shared-server hook can overwrite this
repair. Valid resumes into another directory may also trigger the conservative
guard. Resolving those cases automatically needs upstream terminal/thread
provenance; Prism does not guess a replacement or move saved Notes between
conflicting identities.

## Native overview and privacy

The native card starts with status, a compact session name and the tab label.
The next rows show CPU and RSS (Windows: WS), then machine, branch and colored
Git changes. Memory uses human sizes such as `3.2kB` or `1.2GB`; values have at
most one decimal. `~` marks a cached resource sample. Full names, branches,
Goals and descendant counts remain in the right panel. The final field on the
machine/branch/Git row shows the harness (`codex`, `claude`, `pi`, etc.) in muted
text.

Blocked agents have a bold amber **INPUT REQUIRED** row. Idle agents show
**WAITING FOR YOU** and completed agents **READY TO REVIEW**. These labels use
Herdr's native state, so idle means waiting for another request, not necessarily
an unanswered approval. Empty attention and group rows are hidden.

To group native cards, add `"nativeGrouping": "project"` or `"tab"` inside the
same `ui` object in `settings.json`, then invoke `reload-settings` as above.
`"none"` is the default and retains agent lineage order. Project grouping uses
cached Git repository identity or the agent's working directory; it performs no
background Git scans. Group labels belong to the first real card in each group;
Herdr cannot insert independent expandable group headers. Tab names follow
Herdr's labels (Herdr omits an unnamed single tab).

Native mode owns the Agents rows and `theme.custom.active_row_bg` in Herdr's
`config.toml`: dark/mono uses a dark selection background and light uses pale
blue. The ownership backup restores the previous background on removal and
preserves subsequent user edits. Inspector-only mode leaves these values alone.
Prism publishes the short name as expiring display metadata; it does not change
the session ID, provider, native name or lifecycle state. When metadata expires,
the first row falls back to Herdr's native name/provider and tab.

Upgrades migrate only unchanged Prism-owned values; user-edited rows and
shortcuts are preserved. Herdr's current API cannot create arbitrary
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

For the UI redesign, print every synthetic terminal design with
`npm run ui:preview`, or browse with `npm run ui:preview -- --browse --width 80`.
See the [gallery controls and theme/size options](docs/ui-design-preview.md).
These are design previews; they do not replace the live plugin or persist Notes.

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
