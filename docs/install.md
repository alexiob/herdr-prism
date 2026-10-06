# Herdr Prism installation and complete removal

For SSH-connected machines, install and activate on each Herdr server;
[remote setup](remote.md) explains machine targeting, client-local sidebar
configuration and the outstanding visibility API boundary.

## Standard Herdr commands

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
to the user PATH. It updates the current installation process's PATH immediately
and notifies Windows environment listeners. No administrator rights or persistent
execution-policy change is required. Existing plugin state and permissions are
handled by Herdr's normal installation flow. An existing Prism installation is
left in place; follow the deactivation/reinstallation commands below for updates.

After installation (including reruns), the Windows installer adds **Ctrl+B, then I**
(`prefix+i`) to open Prism and reloads Herdr's configuration. With a custom prefix,
use that prefix followed by I. Press **Q** in the focused Prism panel to close it.
The installer preserves existing config bytes and ACLs, saves the original as
`config.toml.prism-shortcut.bak`, and skips the shortcut with a warning if it is
already assigned. Reruns do not duplicate the binding. `-PrepareOnly` does not
configure it. The shortcut remains available after Prism deactivation; remove its
`[[keys.command]]` block if uninstalling Prism permanently.

Use `-Yes` to accept the reviewed plugin manifest without a prompt, `-Ref <commit>`
to choose a Git revision (default `main`), or `-PrepareOnly` to set up prerequisites
without installing the plugin. The script does not restart an existing Herdr
server or activate a pane. It binds commands in the Windows installed manifest
to the verified absolute Node executable and reloads Herdr, so an existing
server's stale PATH does not prevent actions or panes from starting. Older
installed `open` actions receive a backed-up compatibility repair that awaits
panel opening before closing RPC; shared repository sources remain untouched.
Backups use `.prism-windows.bak` beside each changed installed file, preserving
its original contents and permissions. Then activate Prism explicitly in your
chosen session using the command below.

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

Herdr 0.9.3 updates a GitHub installation by reinstalling it. Stop the old
collector before replacing its files, then activate the new installation:

```sh
herdr plugin action invoke deactivate --plugin iob.herdr-prism
herdr plugin install alexiob/herdr-prism
herdr plugin action invoke activate-overview --plugin iob.herdr-prism
```

Wait for successful deactivation before reinstalling. For a reviewed release,
add `--ref <tag-or-commit>` to install. The tested 0.9.3 CLI has no `plugin update`
command and replaces its managed GitHub checkout during reinstall. Newer Herdr
documentation describes a separate update command and retained installation
generations; check the installed CLI/version before relying on those features.

To stop, restore the previous layout and disable automatic startup:

```sh
herdr plugin action invoke deactivate --plugin iob.herdr-prism
herdr plugin disable iob.herdr-prism
```

Wait for successful deactivation in the plugin log before disabling. To enable
and reactivate later:

```sh
herdr plugin enable iob.herdr-prism
herdr plugin action invoke activate-overview --plugin iob.herdr-prism
```

Herdr's standard unregister command accepts either the plugin ID or repository:

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
It refuses to supersede an existing plugin registration; this release uses a
fresh managed copy rather than an in-place update.

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

The explicit flags are mutually exclusive. Native takeover changes Agents rows and only
explicitly selected optional keys. Unrelated TOML source/comments are preserved.
Provider-specific `rows_by_agent` values are managed reversibly. Ambiguous dotted
or inline ancestor topology is rejected before modification; inspector-only is
available when the existing document cannot be safely patched. No font/global
theme, Spaces layout, tab bar, provider instructions or project AGENTS.md is changed.

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

`settings.json` in `HERDR_PLUGIN_CONFIG_DIR` holds validated preferences. Defaults
include a 2000 ms sample interval, follow enabled, Unicode/color enabled, and
ACTION To-do parsing disabled. `nativeMode` accepts `overview`, `inspector-only`
or `native`; successful activation sets its selected mode plus `autostart: true`.
Provider homes can contain exact `codex`, `claude` and `pi` paths; paths retain
Unicode, drive letters and UNC spelling. Sampling intervals are 250–60000 ms.

Enable `todosEnabled` only when wanted. Checkboxes change local state, never
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

For a fresh upgrade, complete uninstall through the old managed wrapper, then
install the new reviewed release. This removes prior local plugin state as requested
by complete uninstall. An existing collector is not assumed to restart merely
because Herdr registers a new installation. Actual macOS/Linux/Windows live
lifecycle tests and CI runs are required before advertising certification.
