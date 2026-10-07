# Prism settings and actions

Find Prism's configuration directory with:

```sh
herdr plugin config-dir iob.herdr-prism
```

Edit `settings.json` there, preserving other fields and valid JSON. This is
separate from Herdr's `config.toml`. For a remote panel, change settings on its
collecting server. [Installation](install.md) describes the platform paths,
named sessions and reversible ownership of native rows and shortcuts.

## Every supported setting

| Setting | Default | Meaning and accepted values |
| --- | --- | --- |
| `ui.tabOrder` | Overview, Notes, To-do, Git, Agents, Processes, Refs, Messages | Nonempty array of view names. Case-insensitive; `To-Do` is accepted. Omitted views are appended. Unknown or duplicate names are rejected. |
| `ui.nativeGrouping` | `"none"` | `"none"`, `"project"` or `"tab"`. Groups native cards by cached repository/cwd identity or Herdr tab label. Attention sorting applies within groups. |
| `nativeMode` | `"overview"` | `"overview"`, `"inspector-only"` or legacy `"native"`. Prefer the activation actions below to change mode: native rows also require an ownership record. |
| `providerHomes` | `{}` | Optional `codex`, `claude` and `pi` home directories; omitted entries use each adapter's normal local home. These are provider roots, not individual transcript files. |
| `todosEnabled` | `true` | Parse supported complete ACTION lists. Local checkmarks never edit transcripts. |
| `sampleIntervalMs` | `2000` | Integer from 250 to 60000 milliseconds. Sets the collector's normal refresh interval; visibility gating and slower inventory caches still apply. |
| `follow` | `true` | Follow the conversation attached to the panel's owning native pane. Pinning, Notes editing and confirmation dialogs pause following. |
| `ascii` | `false` | Use ASCII alternatives for supported terminal glyphs. |
| `monochrome` | `false` | Suppress terminal colors. |
| `theme` | Unset; dark rendering | `"dark"`, `"light"` or `"mono"`. Selects the inspector palette and the native preset when configured. |
| `autostart` | Unset | Boolean. Successful activation sets `true`; deactivation sets `false`. Host startup only starts a configured, enabled installation. |
| `costRates` | Unset | Map from exact model name to explicit per-million-token prices. Each entry requires a nonempty `currency`; optional `input`, `output`, `cacheRead`, `cacheWrite` values must be finite, nonnegative numbers. Missing prices remain unavailable or partial. |

Provider-home defaults are `CODEX_HOME` or `~/.codex`, `CLAUDE_CONFIG_DIR` or
`~/.claude`, and `PI_CODING_AGENT_DIR` or `~/.pi/agent`. An explicit nonempty
`providerHomes` entry overrides that provider's environment/default path.

Example: merge the fields you want into the existing document; the model and
prices below are illustrative, not a published price list.

```json
{
  "ui": {
    "tabOrder": ["Overview", "Messages", "Notes", "Git"],
    "nativeGrouping": "project"
  },
  "sampleIntervalMs": 2000,
  "follow": true,
  "todosEnabled": true,
  "theme": "dark",
  "costRates": {
    "exact-model-name": {
      "currency": "USD",
      "input": 1,
      "output": 2,
      "cacheRead": 0.1,
      "cacheWrite": 1
    }
  }
}
```

`reload-settings` applies **only** `ui.tabOrder` and `ui.nativeGrouping` to a
running collector. The next poll updates open panels without interrupting Notes
editing or resetting the selected view. Invoke it in each active named session:

```sh
herdr --session work plugin action invoke reload-settings --plugin iob.herdr-prism
```

Other changes require successful deactivation and reactivation in the intended
mode. Save Notes first; deactivation also flushes active editors. Do not use
complete uninstall to reload settings. `herdr server reload-config` reloads
Herdr's configuration and shortcuts, not Prism's settings.

Per-panel selected conversation, pin, selected view, reader positions and folds
are stored privately by native target. Width is saved separately for each target.
These are not `settings.json` options. Reopening and preserving updates restore
them within Herdr's available split space. Notes remain attached to the panel
owner even while inspecting a worker; a captured edit keeps its original identity.
See [controls](controls.md) and [privacy](privacy.md).

## Herdr actions

Invoke any registered action with
`herdr plugin action invoke ACTION --plugin iob.herdr-prism`; add
`herdr --session NAME` or the appropriate remote machine selector when needed.
Action invocation is asynchronous: check the exact plugin action log for success.
The preserving installer additionally waits for authenticated readiness.

| Action | Result |
| --- | --- |
| `activate` | Start live Prism with native overview ownership and enable future startup. |
| `activate-overview` | Explicit native overview activation; opens/restores inspectors and takes reversible native configuration ownership. |
| `activate-inspector` | Start/restore inspectors without taking native sidebar ownership. |
| `deactivate` | Flush editors, close recorded Prism views, stop owned collection, restore still-owned configuration and disable autostart. Retains private data and remembered view intent. |
| `open` | Open or focus Prism beside the current native target; reuse its existing view. |
| `configure` | Configure the native preset and record its mode; does not supply the full live activation lifecycle. Existing foreign configuration requires explicit ownership or inspector-only mode. |
| `unconfigure` | Run deactivation and restore still-owned configuration. |
| `refresh` | Request a finite refresh, using an existing collector when available. A deactivated installation stays deactivated. |
| `native` | Alias for the finite refresh action. |
| `reload-settings` | Apply validated tab order and native grouping to an existing collector; otherwise report the settings for its next start. |
| `settings` | Print the settings path and validated settings; `,` inside Prism opens a read-only settings detail. |
| `doctor` | Report Node/platform, Herdr connectivity, supported API methods, collector presence, sampler availability, native configuration and To-do parsing. |
| `set-goal` | Store an explicit objective for an exact session already known to the open collector. Requires arguments through the direct entrypoint below. |

## Direct entrypoints and options

These advanced commands use the installed plugin's compiled files. Substitute
its actual root and exact plugin config/state paths. Herdr normally supplies
`HERDR_PLUGIN_CONFIG_DIR`, `HERDR_PLUGIN_STATE_DIR`, `HERDR_SOCKET_PATH` and the
registered pane identity. A live inspector requires its registered Herdr pane;
it is not a standalone attachment command. Demo mode needs no live server.

Common action/service options are `--config-dir DIR`, `--state-dir DIR`,
`--config-path FILE` (Herdr configuration) and `--socket ENDPOINT`. The config
path overrides `HERDR_CONFIG_PATH`, then the normal XDG/APPDATA Herdr location.

```sh
node "/plugin/root/dist/entrypoints/action.js" settings --config-dir "/plugin/config" --state-dir "/plugin/state"
node "/plugin/root/dist/entrypoints/action.js" settings --set 'todosEnabled=false' --config-dir "/plugin/config" --state-dir "/plugin/state"
node "/plugin/root/dist/entrypoints/action.js" set-goal --session "codex:EXACT_ID" --objective "Verify the parser" --status active --config-dir "/plugin/config" --state-dir "/plugin/state" --socket "/server/socket"
node "/plugin/root/dist/entrypoints/inspector.js" --demo --once --view Processes --theme mono
```

`settings --set KEY=JSON_VALUE` replaces one top-level setting, validates it,
and restores the previous document on validation failure. It accepts currently
present settings and `costRates`; use the file editor to introduce optional
`theme` or `autostart` fields when absent. Replace `ui` with a complete intended
object rather than using a dotted `ui.tabOrder` key. This write does not reload
the running collector. `set-goal` accepts 1–8192 characters, defaults status to
`active`, and retains the latest 100 local goal records per session. It does not
change the provider's prompts or declare completion from idle state.

| Entrypoint | Supported user options |
| --- | --- |
| `action.js` | Actions above and common paths; `--help` prints usage. `configure` accepts `--own-native`, `--inspector-only`, `--theme dark\|light\|mono`, `--key KEY`; `settings` accepts `--set KEY=JSON_VALUE`; `set-goal` accepts `--session PROVIDER:ID`, `--objective TEXT`, `--status TEXT`. |
| `inspector.js` | `--theme dark\|light\|mono`, `--ascii`, `--monochrome`, `--once`. `--demo` uses synthetic data; `--view NAME` selects its initial demo view. Common paths apply in live mode. |
| `run.js` | `--agent PROVIDER:ID`, common config/state/socket options, then `-- executable argument...`. Explicitly records a sampled foreground launch association; untracked commands still run if collection is unavailable. Short-lived commands may exit before sampling. |
| `claude-account.js` | `--state-dir DIR`, optional `--socket ENDPOINT`, `--print-config`, `--passthrough`. Optional Claude status-line reporter; [account setup](../README.md#account--limits-in-overview) explains preserving an existing status line. |

The collector, startup, event, detail popup and update recovery entrypoints are
managed by Prism. Their internal lifecycle flags are not installation settings.
The optional [Pi companion](../companion/pi/README.md) is loaded explicitly and
adds `/prism-goal` and `/prism-parent`; no companion or provider hook is silently
installed. [Installer options](install.md#installer-option-reference) and
[preview options](ui-design-preview.md#option-reference) have separate references.
