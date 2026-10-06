# Herdr Prism

A local, six-view terminal dashboard for Codex, Claude and Pi sessions in Herdr.
It follows agent lineage, process ownership, messages, references, explicit goals,
local To-do checkboxes and Git checkout state. An optional native overview adds
compact summaries to Herdr's existing Agents panel.

**Release status:** implementation candidate. Actual macOS and Linux CI and
GitHub installation checks have passed. Windows validation is in progress, and
its native helper is not yet included in the repository installation. See
[compatibility](docs/compatibility.md) for the exact evidence and remaining gates.

## Install and open

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
| Refs | Mentioned or explicitly edited references, source jump, deliberate open/copy |
| To-do | Opt-in complete ACTION lists with local checked state and source provenance |

`Tab` changes views; arrows or `j`/`k` move; `Enter` activates the selected item;
`Space` folds or expands; `/` filters; `?` shows help; `q` closes the inspector.
`p` pins, `u` selects subtree scope, `w` switches Agents grouping, `s` jumps to a
source, `y` copies, `x` toggles a To-do checkbox, `e` exports and `,` opens settings.
Numeric Agents selection preserves the target that was displayed when typing
began. Selecting transcript-only descendants inspects them without inventing a
native pane.

Full transcript, refs, To-do, Git and frequent resource updates follow only the
session shown in an open, visible inspector. Hidden or closed panes pause that
work; other agents retain lightweight inventory and explicitly stale cached
summaries. Reopening warms up CPU measurements and catches up selected content.
Verified roots of other agents remain process attribution boundaries.

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

Collection is local, with no analytics/backend or automatic transcript uploads.
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
