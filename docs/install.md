# Herdr Prism installation and complete removal

For SSH-connected machines, install and activate on each Herdr server;
[remote setup](remote.md) explains machine targeting, client-local sidebar
configuration and the outstanding visibility API boundary.

## Standard Herdr commands

### macOS and Linux setup

Install or update Prism with one command:

```sh
curl -fsSL https://raw.githubusercontent.com/alexiob/herdr-prism/main/install.sh | sh
```

The POSIX shell script supports macOS and glibc Linux on x64/arm64. It reuses
Node >=22.13.0 and Herdr >=0.9.3 when available. Missing Node is installed as
checksum-pinned Node 24.21.0; missing Herdr is installed as checksum-pinned
Herdr 0.9.3. Downloads live under
`XDG_DATA_HOME`/`~/.local/share/herdr-prism/dependencies`. Node's license is
included. No sudo, npm, Cargo or shell-profile edits are needed; Git is optional
for checkout metrics.

The script resolves `main` to an immutable GitHub commit, downloads its source
archive over HTTPS, and stages the committed JavaScript and matching helper.
It binds every manifest command to the selected absolute Node executable before
generating release checksums. This lets an existing Herdr server activate Prism
even when that server's PATH contains no Node. Dependency checksums detect
corruption; GitHub HTTPS and your chosen revision establish the source trust.

The managed live wrapper activates Prism, verifies readiness and prints a
shell-quoted command for complete removal. It also adds `prefix+i` using the
reversible configuration backup: **Ctrl+B, then `i`** with Herdr's default
prefix. The binding works in inspector-only mode too. A conflicting key or
unsupported key-table syntax is preserved and reported. An existing matching
Prism binding is reused without taking ownership of it. Removal restores the
owned shortcut and layout; shared Node/Herdr dependencies remain installed.

A missing local Herdr server is started headlessly. Attach using the command
printed by the installer. Existing servers are never restarted; an old server
must be upgraded deliberately before installation. Rerunning updates an existing
managed or GitHub installation through the preserving lifecycle below. Local
developer links are refused before deactivation; update those checkouts explicitly.

Pass options without saving the script:

```sh
curl -fsSL https://raw.githubusercontent.com/alexiob/herdr-prism/main/install.sh | sh -s -- --session work --inspector-only
```

Use `--ref <tag-or-commit>` for a reviewed revision, `--no-start` to require a
running server, or `--prepare-only` to set up dependencies only. `--node-bin`
and `--herdr-bin` select explicit executables. `--source-dir` installs a reviewed
local source tree; `--help` lists all options. For remote machines, run the
script on each server itself. The bootstrap does not install remotely through
a local client's `--machine` selector.

### Windows setup

Use the PowerShell bootstrap when Node is missing from PATH. Herdr 0.9.3 or
newer must already be installed. Run the standalone installer:

```powershell
irm https://raw.githubusercontent.com/alexiob/herdr-prism/main/scripts/install-windows.ps1 | iex
```

To save and review the script before running it, or to pass options:

```powershell
$installer = Join-Path $env:TEMP ("install-prism-" + [Guid]::NewGuid().ToString('N') + ".ps1")
Invoke-WebRequest -UseBasicParsing https://raw.githubusercontent.com/alexiob/herdr-prism/main/scripts/install-windows.ps1 -OutFile $installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer
```

The script supports Windows x64, reuses Node 22.13 or newer on PATH, and otherwise
installs checksum-pinned Node 24.21.0 under `%LOCALAPPDATA%\Programs` and adds it
to the user PATH. It notifies Windows environment listeners. No administrator
rights or persistent execution-policy change is required. Start the selected
Herdr session first; the installer keeps that server running.

It resolves the requested ref to an immutable commit, downloads that source and
validates a platform release before installation or deactivation. Manifest
commands use the verified absolute Node executable, including when a running
server has an older PATH. A first install activates Prism and configures the free
**Ctrl+B, then `i`** shortcut through the reversible configuration backup. Updates
retain the saved native mode and shortcut choice, including opt-outs and foreign
bindings. Both paths preserve private configuration/state permissions.

Pass `-Ref <tag-or-commit>`, `-Session <name>`, or `-InspectorOnly` when invoking the
saved script. `-InspectorOnly` applies to a first installation; updates retain
the existing mode. `-PrepareOnly` sets up prerequisites without installing or
updating Prism. `-SourceDir <reviewed-source>` uses local reviewed compiled source.
`-Yes` remains accepted for compatibility; invoking the installer authorizes its
reviewed install/update operation. No separate activation command is needed.

For your Windows update test: create a Note, resize two panels independently,
leave one closed and focus either a native or Prism pane; rerun the same installer
and verify version `0.5.0`, the Note, widths, visibility and focus. CI also runs
isolated update acceptance with synthetic private Notes and two named servers.

### Install and activate

The marketplace and GitHub source identifier is `alexiob/herdr-prism`; the stable
plugin ID used by actions/settings is `iob.herdr-prism`.

```sh
herdr plugin install alexiob/herdr-prism
herdr plugin action invoke activate-overview --plugin iob.herdr-prism
herdr plugin list --plugin iob.herdr-prism --json
```

Use `--yes` on install only after reviewing the manifest if a noninteractive
installation is desired. Herdr clones the repository into its managed plugin
store. The root manifest's build command validates the committed dependency-free
JavaScript and the matching committed native helper. Node.js is required;
installation does not run npm, Cargo, a compiler or a helper download. Repository
installation currently includes both macOS helpers and uses procfs on Linux.
Windows x64 includes its locally executed static-CRT helper, checksum and Rust
notices; see [Windows validation](windows-validation.md). No runtime toolchain
or helper download is required.

`activate-overview` opens the right inspector and configures the native overview
with a reversible backup. `activate-inspector` opens only the inspector. Herdr
0.9.3 does not call startup when an installation is added or enabled; explicit
activation starts the plugin in the existing session and enables future startup.
Activation is an asynchronous Herdr action: inspect its exact plugin command log
for successful completion rather than treating a returned invocation ID as ready.
The release wrapper below additionally waits for authenticated readiness.

### Preserving updates

Use the same shell or PowerShell command shown above. The shared updater works
with both receipt-owned managed copies and Herdr GitHub installations. It validates
and prepares the new code before stopping the old collectors. It keeps the same
canonical installation root, managed receipt token, and GitHub source metadata;
GitHub revision metadata records the exact reviewed commit.

The updater discovers recorded local servers and captures each panel's owning
terminal, open/closed intent and exact focus. Deactivation flushes Notes editors
and saves live widths before replacement. Reopening restores each panel beside
its own agent using the existing per-view preference stores. Notes and recovery
drafts are never copied from a stale pre-stop snapshot. Settings, local To-do
checks, tab order, reader choices, pinning, theme, native ownership and shortcut
opt-outs remain private and retained. Disabled/deactivated installations remain
inactive. Running Herdr servers and agent jobs are not restarted.

Code replacement is reversible and uses a same-filesystem staged directory.
Failed activation restores the previous installation and views. An incomplete
recovery leaves a private `update-recovery.json` journal, code backup and lock
rather than deleting evidence; the error reports the recovery locations. Do not
use complete removal for updating: it deliberately purges private data.

The bare Herdr 0.9.3 reinstall command replaces code but does not run this Prism
state-preserving lifecycle. Use the Prism installer for updates. Local developer
source links require explicit source-checkout maintenance and are never replaced
by the installer.

To stop, restore the previous layout and disable automatic startup:

```sh
herdr plugin action invoke deactivate --plugin iob.herdr-prism
herdr plugin disable iob.herdr-prism
```

Wait for successful deactivation in the plugin log before disabling. Activation
restores the free default `prefix+i` binding after updates or deactivation; foreign
key assignments and recorded installer opt-outs are preserved. To enable and
reactivate later:

```sh
herdr plugin enable iob.herdr-prism
herdr plugin action invoke activate-overview --plugin iob.herdr-prism
```

Herdr's standard unregister command accepts either the plugin ID or repository:

On Windows, use the PowerShell uninstaller to also remove the installer-owned
**Ctrl+B, then I** shortcut:

```powershell
irm https://raw.githubusercontent.com/alexiob/herdr-prism/main/scripts/uninstall-windows.ps1 | iex
```

It waits for successful Prism deactivation, removes only the unchanged installer
binding, reloads Herdr, then unregisters the plugin and verifies removal. It
preserves other bindings and config edits, Node, backups and retained plugin
preferences. Reruns are safe. The installer also accepts `-Uninstall` when saved
locally. The bare Herdr command below has no plugin cleanup hook and leaves an
installer-added shortcut behind.

```sh
herdr plugin uninstall alexiob/herdr-prism
```

Deactivate successfully before using it. Herdr 0.9.3 removes its managed GitHub
checkout but retains plugin configuration and state; the newer documented
lifecycle also retains installation generations. Neither invokes plugin-owned
deactivation or purges all private state. For
the requested one-command activation and complete owned-file purge, install a
checksummed release with the managed wrapper below. A GitHub installation is not
silently adopted by that wrapper or deleted by guessing Herdr's store paths.

The standard command behavior is specified by the [official plugin contract](https://github.com/herdrdev/herdr/blob/3d9d2b18dab139ba226ebc5a1c9a9f2c9c3ee4df/docs/next/website/src/content/docs/plugins.mdx).
Public repositories with a parseable default-branch manifest and `herdr-plugin`
topic are automatically indexed, normally on the marketplace's 30-minute refresh
cycle. See [marketplace discovery](https://herdr.dev/docs/marketplace/).

## Managed live lifecycle

Use the lifecycle wrapper to install into a **running Herdr session**. It activates
the dashboard immediately and waits for authenticated readiness. Its uninstall
command stops owned collection, restores configuration, unregisters the plugin
and removes the plugin-owned installation, configuration and state directories.

Herdr's ordinary link/enable commands do not run startup immediately. Its
ordinary uninstall retains plugin configuration/state; installation-file cleanup
depends on the host version and installation type. The inspected manifest has
no uninstall hook. Consequently, those bare commands cannot provide
the requested complete lifecycle automatically. The wrapper supplies it through
explicit actions; it never claims that vanilla Herdr uninstall performs cleanup.
These boundaries come from the [official pinned plugin documentation](https://github.com/herdrdev/herdr/blob/3d9d2b18dab139ba226ebc5a1c9a9f2c9c3ee4df/docs/next/website/src/content/docs/plugins.mdx)
and [the tested 0.9.3 CLI implementation](https://github.com/herdrdev/herdr/blob/v0.9.3/src/cli/plugin.rs).

## Installer option reference

The bootstrap commands install or update; the low-level live wrapper creates a
first managed copy or completely removes it. Updates preserve the existing
mode and shortcut choice, so inspector-only flags apply to a first installation.

| Unix `install.sh` option | Effect |
| --- | --- |
| `--ref REF` | Install the requested tag, branch or commit; default `main`. Downloads resolve to an immutable commit. |
| `--session NAME` | Select a named local Herdr server. |
| `--inspector-only` | First install: coexist without native sidebar ownership. |
| `--prepare-only` | Set up dependencies without installing/starting Prism. |
| `--no-start` | Require the selected Herdr server already to be running. |
| `--node-bin PATH` | Use the specified compatible Node executable. |
| `--herdr-bin PATH` | Use the specified Herdr executable. |
| `--source-dir PATH` | Stage reviewed local compiled source instead of downloading source. |
| `--help`, `-h` | Print bootstrap help. |

| Windows PowerShell option | Effect |
| --- | --- |
| `-Ref REF` | Select the source revision; default `main`. |
| `-Session NAME` | Select a named local running Herdr server. |
| `-InspectorOnly` | First install: retain native sidebar ownership elsewhere. |
| `-SourceDir PATH` | Use reviewed local compiled source. |
| `-PrepareOnly` | Set up prerequisites without installing/updating Prism. |
| `-Uninstall` | Deactivate and unregister using the Windows removal workflow. Retains plugin preferences/state; use managed complete removal to purge private data. |
| `-Yes` | Accepted compatibility switch; invocation authorizes the requested install/update. |

PowerShell resolves `herdr.exe` and a compatible Node from PATH; it installs Node
when needed but does not install Herdr or start its server. Save the script to
pass these options. Standard PowerShell common parameters, such as `-Verbose`,
are supplied by PowerShell rather than Prism.

| `node scripts/live-install.mjs` option | Effect |
| --- | --- |
| `install --root DIR` | Verify the source release and create/activate a new managed copy. |
| `uninstall` | Complete owned removal using the managed copy's receipt. |
| `--managed-dir DIR` | Install destination or explicit removal target; an install destination must not exist. |
| `--own-native` | Explicit alias for default reversible native ownership. |
| `--inspector-only` | Coexist without native takeover; mutually exclusive with `--own-native`. |
| `--herdr-bin PATH` | Select the Herdr executable. |
| `--session NAME` | Select a named server. |
| `--timeout-ms N` | Bound lifecycle readiness/action waits; default 30000 ms. |

For settings defaults, live reload, every action and advanced compiled entrypoint,
see [configuration](configuration.md). For interaction and provider-specific
limitations, see [dashboard controls](controls.md).

## Prerequisites

- Node.js **22.13.0 or newer** and a running Herdr session with the protocol-22
  surfaces used by this plugin. The installed 0.9.3 schema was inspected; actual
  platform/live-session certification is described in [compatibility](compatibility.md).
- A reviewed, checksummed release directory containing compiled `dist/`,
  `scripts/live-install.mjs`, `scripts/check-install.mjs`, `release.json`,
  `checksums.json`, the manifest and compiled companion.
- macOS: the matching `darwin-arm64` or `darwin-x64` native helper. Windows:
  `win32-x64`. Linux x64/arm64 uses procfs and needs no native runtime helper.
- Git enables checkout metrics; collection never fetches or contacts remotes.

There is no runtime npm install, compiler, Rust toolchain or download. The installer
validates compiled files, release checksums and helper checksum/platform headers,
then verifies the copied installation again. Checksums detect corruption; obtain
the archive from a reviewed pinned release. Keep the helper's `sha256.json` and
matching `rust-licenses/` notices.

## One-command live install

Extract the reviewed release, change into its directory, then run:

```sh
node scripts/live-install.mjs install --root .
```

The wrapper creates a new private managed copy, links it disabled, enables it,
invokes activation and waits for the foreground inspector to report readiness.
It additionally waits for the exact Herdr activation action to finish successfully.
No restart of the existing Herdr session is required. The inspector opens on the
right, native rows/projection are configured, and `autostart` is enabled for later
server startups. Its foreground lifetime owns collection and the sampler.

Successful output includes `managedDir`, the exact plugin config/state directories,
and an `uninstallCommand` argv array. Keep that location. Default managed copies
live under `XDG_DATA_HOME`/`~/.local/share/herdr-prism/installs` on Unix or
`LOCALAPPDATA`/`APPDATA` on Windows. A specific destination can be selected:

```sh
node scripts/live-install.mjs install --root . --managed-dir "/absolute/path/herdr-prism-live"
```

The destination must not exist and must be separate from the source checkout.
The wrapper copies only verified release files. It never installs directly into
or later deletes the user's source checkout or extracted release directory.
The low-level `live-install.mjs install` command creates a first managed copy and
refuses an existing registration. For updates, use the platform bootstrap above;
it runs the shared preserving updater on the same canonical managed root.

## Existing native layout ownership

Default installation takes native overview ownership with a reversible backup,
including preexisting Agents rows. `--own-native` is an explicit alias for that
default. Another plugin is never disabled automatically. If Radar or Pi-tree owns
the native projection, disable that competing owner yourself before using native
mode, or select inspector-only coexistence. The explicit native form is:

```sh
node scripts/live-install.mjs install --root . --own-native
```

Radar and Pi-tree cannot concurrently own the same native projection/layout.
For coexistence, choose the fully running inspector without native takeover:

```sh
node scripts/live-install.mjs install --root . --inspector-only
```

The explicit flags are mutually exclusive. Native takeover changes Agents rows, the owned sidebar selection background
(`theme.custom.active_row_bg`), and explicitly selected optional keys. Unrelated TOML source/comments are preserved.
Provider-specific `rows_by_agent` values are managed reversibly. Ambiguous dotted
or inline ancestor topology is rejected before modification; inspector-only is
available when the existing document cannot be safely patched. The original selection background is restored with owned rows on removal. Fonts,
Spaces layout, tab bar, provider instructions and project AGENTS.md are preserved.

The private ownership manifest records original/written values, hashes and a
backup. A concurrent config change aborts atomic replacement. Restoration applies
only while a value still equals the plugin's written value; user modifications
are preserved and reported as conflicts.

## One-command complete uninstall

From the original release directory, supply the managed path returned at install:

```sh
node scripts/live-install.mjs uninstall --managed-dir "/absolute/path/herdr-prism-live"
```

Alternatively, invoke the managed copy's own script; it detects its installation:

```sh
node "/absolute/path/herdr-prism-live/scripts/live-install.mjs" uninstall
```

Removal first invokes deactivation in the live session. That action shuts down
all ownership-checked collectors/helpers/popups recorded for the plugin, clears
only its native metadata/projection, disables autostart and restores still-owned
configuration. The wrapper waits for both authenticated cleanup acknowledgement
and successful completion of that exact Herdr action before disabling/unregistering.
It verifies registration is absent, rechecks private ownership markers, then
purges the exact plugin configuration/state directories and its managed copy.

Complete uninstall deletes local preferences, To-do state, explicit goals, launch
records, plugin backups and other plugin-owned state. It preserves the restored
Herdr config, user edits, source checkout and files owned by other plugins.
Herdr's own unrelated global/server data is not purged.

If collectors cannot stop, the action fails, user-edit conflicts remain, ownership
cannot be proven, or acknowledgement times out, removal fails visibly and retains
registration/owned files where possible for recovery. An asynchronous CLI
invocation ID is not considered success. Do not run bare `herdr plugin uninstall`
first: it bypasses deactivation, and cleanup cannot be presumed afterward.

A registered installation created outside this wrapper is not adopted or deleted
by guessing directories. Its explicit `deactivate` action can restore runtime/config
state, while its original source and administrative installation remain subject
to their own ownership/removal workflow. Use the wrapper for complete managed
installation and removal.

## Preferences and optional companion

The complete [settings and action reference](configuration.md) lists all defaults,
accepted values, reload behavior and direct-entrypoint options. The
[controls guide](controls.md) lists keyboard/mouse behavior and every view.

`settings.json` in `HERDR_PLUGIN_CONFIG_DIR` holds validated preferences. Defaults
include a 2000 ms sample interval, follow enabled, Unicode/color enabled, and
ACTION To-do parsing enabled on Windows, macOS and Linux. `nativeMode` accepts `overview`, `inspector-only`
or `native`; successful activation sets its selected mode plus `autostart: true`.
Provider homes can contain exact `codex`, `claude` and `pi` paths; paths retain
Unicode, drive letters and UNC spelling. Sampling intervals are 250–60000 ms.

Panel order lives in the `ui` section of that file:

```json
{
  "ui": {
    "tabOrder": ["Overview", "Notes", "To-do", "Git", "Agents", "Processes", "Refs", "Messages"]
  }
}
```

Merge this section into existing JSON; keep provider homes and other settings.
Use `herdr plugin config-dir iob.herdr-prism` to find the exact directory, then
edit its `settings.json`. Names are case-insensitive, omitted tabs are appended,
and empty/unknown/duplicate lists fail clearly. Run
`herdr plugin action invoke reload-settings --plugin iob.herdr-prism` in the
collecting session to update all open panels at their next poll, preserving
active views, readers and Notes editing. A closed collector uses the file on its
next start. Removing `ui.tabOrder` and reloading restores the default. Reloading
Herdr's `config.toml` is separate (`herdr server reload-config`). Other collector
settings still need reactivation. See [update instructions](../README.md#update-to-the-latest-version)
for GitHub, Unix installer, Windows and local source installations.

Set `todosEnabled: false` to disable parsing. Existing explicit settings are
preserved; older installations that saved `false` must change it to `true` and
restart Prism's collector. Checkboxes change local state, never
transcripts or instruction files. Optional per-model `costRates` require explicit
`currency` and nonnegative per-million-token `input`, `output`, `cacheRead` and
`cacheWrite` prices; absent pricing remains unknown/partial.

The compiled Pi companion is a separate explicit opt-in. It adds `prism-goal`,
`prism-parent` and versioned state evidence; ordinary forks do not prove delegation.
The installer does not silently modify provider extension settings or install hooks.

Herdr supplies plugin config/state/socket environment for actions. Direct action
entrypoint use outside that environment requires `--config-dir` and `--state-dir`.
`--config-path` overrides `HERDR_CONFIG_PATH`, then the Herdr config location under
`XDG_CONFIG_HOME`/Windows `APPDATA` or `~/.config`. Testing uses disposable paths.
The lifecycle wrapper obtains exact cleanup paths from authenticated action results,
not guessed home-directory layouts.

For an explicit foreground command, the optional launch bridge records a sampled
parent/child identity for a selected session:

```sh
node "/managed/plugin/dist/entrypoints/run.js" --agent "codex:SESSION_ID" --config-dir "/plugin/config" --state-dir "/plugin/state" -- executable argument
```

Use the exact config/state paths returned by installation; an explicit collector
endpoint can be passed with `--socket`. Arguments after `--` remain literal argv.
The bridge does not change provider instructions or infer a task from arbitrary
shell output. If collection or the sampler is unavailable, the command still runs
with an explicit untracked diagnostic; commands that exit before sampling remain
unmeasured. See the [privacy boundaries](privacy.md) for the recorded evidence.

## Development and distribution

From the source checkout:

```sh
npm ci
npm run check
npm test
npm run build
rustup component add rust-docs
cargo test --locked --offline --manifest-path native/sampler/Cargo.toml
node native/sampler/package.mjs
node scripts/release.mjs --output artifacts/release --platform darwin-arm64
node artifacts/release/scripts/check-install.mjs --root artifacts/release
node artifacts/release/scripts/live-install.mjs install --root artifacts/release
```

Select the actual target: `darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-arm64`,
`linux-x64`. Linux runtime releases do not require a native helper. `--platform all`
requires both macOS architectures and Windows x64 artifacts with matching checksums
and Rust notices. Staging does not compile/download or overwrite existing output.
A GitHub source installation must already contain reviewed compiled release files;
Herdr's build hook only checks prerequisites. Linking does not build source.

Development/distribution option reference:

| Command | Options |
| --- | --- |
| `node scripts/release.mjs` | `--output DIR` is required and must not exist; `--root DIR` selects the source (default repository root); repeat `--platform TARGET` to choose targets, or use `all` (default host platform/architecture); `--node-bin ABSOLUTE_PATH` binds manifest commands to that reviewed runtime. |
| `node scripts/check-install.mjs` | `--root DIR` selects the installation (default plugin root); `--platform darwin\|linux\|win32` and `--arch arm64\|x64` select the target to inspect (default current process). Cross-platform inspection verifies files/checksums, not execution on that host. |

The Unix/Windows bootstrap helper modules and update recovery modules are called
by their platform installers; use the installer option reference rather than
invoking internal update transactions directly.

For an update that retains private data and panel state, use the platform installer
with the new reviewed source/revision. Its lifecycle stops the old code before
replacement and restores the existing view/focus state. Complete uninstall is
reserved for a deliberate reset and purges local plugin state. Registering new
files or reloading Herdr configuration alone does not restart Prism's collectors.

Each Herdr tab remembers its own Prism right pane and inspector preferences.
The open shortcut creates or focuses the pane in the current tab. Q closes only
that view; other tabs and the shared collector continue running. Activation
restart restores open views and preserves closed tabs. Deactivate or uninstall
closes every recorded plugin view and stops the shared collector.

Native grouping uses `ui.nativeGrouping`: `none` (default), `project`, or `tab`.
Edit the same file and invoke `reload-settings`; grouping uses cached repository
identity/working directories and real card labels, with no background Git reads.
See [native cards and Codex identity troubleshooting](../README.md#native-overview-and-privacy).
