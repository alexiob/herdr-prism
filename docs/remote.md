# Remote Herdr servers

Install Prism on **each Herdr server that runs the agents**. A dashboard opened
for a remote server runs there: its provider homes, transcripts, processes,
sampler, launch ledger, Git checkouts, goals and To-do state belong to that host.
Prism uses the socket supplied by that server. It does not match a remote PID,
session ID or checkout path against the viewing client's local machine.

This follows [Herdr's selected-server plugin model](https://herdr.dev/docs/connecting-machines/).
Herdr does not copy local plugins, Node, helper executables or configuration to
SSH hosts. Install the appropriate platform package and Node on each host. The
current Windows validation remains deferred; installing on a Windows SSH host
does not bypass the [Windows release gate](windows-handoff.md).

## Install and activate remotely

In an SSH shell or a pane on the remote machine, with its Herdr session running:

```sh
herdr --session work plugin install alexiob/herdr-prism
herdr --session work plugin action invoke activate-inspector --plugin iob.herdr-prism
```

Use that server's actual session name instead of `work`. Use
`activate-overview` if you also want Prism to own the server's native agent
projection. As for local installation, wait for the exact activation log to
finish successfully. The [managed lifecycle wrapper](install.md#managed-live-lifecycle)
can instead install and completely remove a checksummed release on that host;
run it there with the intended `HERDR_SESSION` selected.

From the viewing client, API-backed actions can target a saved machine explicitly:

```sh
herdr --machine builder plugin action invoke open --plugin iob.herdr-prism
herdr --machine builder plugin list --plugin iob.herdr-prism --json
```

Here `builder` is the saved machine's label or ID. Herdr 0.9.3 does **not** forward
the `plugin install` command through `--machine`; installation must run on the
remote host. A command run inside an existing local pane still targets its local
server unless it explicitly selects a machine. Plugin commands chosen in the
remote client's command palette execute on that selected remote server.

Deactivate before disabling or uninstalling, on the same remote server/session.
Use the wrapper's returned uninstall command there for complete owned-file
removal. Disconnecting SSH is not an uninstall and leaves remote agents running.

## Identity, sidebar and actions

The dashboard header identifies its **server hostname/session**. This is distinct
from the client's saved-machine label: that label is not exposed to server
plugins. Each endpoint's private state has a persisted random server identity,
so identical hostnames, pane IDs, session IDs and socket paths on separate hosts
do not collide. Native rank tokens include that identity before their ordinal;
trees from Prism-enabled servers remain contiguous under the combined native
projection. Herdr owns native combined-machine focus numbers.

The viewing client's sidebar rows/theme/keybindings remain client-local. Remote
configuration does not change them. Prism's native preset includes Herdr's
built-in `machine` token, which the client fills with its own saved-machine label.
Configure the desired rows on the viewing client separately; retain that token
if you customize them. Inspector-only mode needs no client sidebar changes.

Explicit `y` copy in a Herdr pane emits an OSC 52 clipboard write. Herdr forwards
it to the server-designated foreground viewing client, including over SSH; the
viewing terminal's clipboard support/policy still applies. Delivery is best-effort
without an acknowledgment, and an inactive endpoint can drop clipboard effects.
Prism sends no clipboard reads. Outside
an interactive Herdr pane, the existing OS clipboard tools are used.

References are resolved and existence-checked on the collecting server. File/URL
open uses that server's desktop opener and may be unavailable on a headless SSH
host. Copy the reference for your remote editor instead. A failed remote open
never opens a same-named local file automatically. Message/ref source jumps and
detail popups stay on their owning server.

## Visibility boundary in Herdr 0.9.3

Native cards on each macOS/Linux server retain lightweight checkout metadata
(no status/diff scans) and five-second samples of verified harness PIDs. These
are independent of the inspector and do not enumerate child processes.

The current selected-session gate pauses heavy transcript, refs, To-do, Git and
process work when the inspector closes or its server's active workspace/tab
changes or another pane is zoomed. It does **not** establish that a client is currently viewing that
machine: the public `session.snapshot` API reports server focus, but no attached
client list or visible-pane union. Switching to another machine or disconnecting
the last SSH client can leave the remote server's focus unchanged while Prism's
collector continues its selected-session work.

This is an outstanding part of the requested visibility guarantee, including
local detached servers. Terminal focus reports describe only the focused pane;
they cannot prove whether an unfocused side panel is visible to any of several
clients. Prism therefore does not substitute focus reports, local PID lookup or
invented activity timestamps for a visibility API.

[The proposed host API](remote-visibility-api.md) describes the read-only
visibility query/event needed to complete this guarantee. Remote functionality
must not be advertised as fully certified until machine switching, last-client
disconnect and multi-client visibility pass that acceptance.
The user chose to keep this as an upstream dependency; this plugin does not
require or install a patched Herdr build.

## Verification

The full SSH acceptance passed on a macOS arm64 client with a Linux arm64 server
and on a Linux x64 client with a Linux x64 server: remote collection, actual
host-keyboard navigation, copy, disconnect/reconnect and complete removal.
The previous keyboard failure came from the disposable
client's first-run onboarding overlay, which intercepted pane input. The fixture
now configures `onboarding = false` only in its temporary home and records that
the overlay was absent. It still requires host PTY input to change the remote
Prism view to Agents; the assertion was not weakened. See the evidence ledger.

`scripts/remote-herdr-test.mjs` is the isolated SSH acceptance harness. It uses a
disposable Linux container, a generated fixture key, an isolated SSH config and
known-hosts file, and a real macOS/Linux Herdr terminal client. It does not use or
change personal SSH keys, saved machine profiles or the user's running session.
Its evidence distinguishes remote collection/attachment/reconnect from the
unavailable host visibility guarantee. Exact results are recorded in
[implementation progress](implementation-progress.md).

From a source checkout with compiled `dist/`, Podman, SSH tools, Python 3 and
Herdr 0.9.3:

```sh
node scripts/remote-herdr-test.mjs --connection YOUR_PODMAN_CONNECTION --proof artifacts/remote-check
```

Omit `--connection` with native Linux Podman or a correctly selected default
connection. The harness downloads only a checksummed, pinned Herdr **test**
binary when needed; normal plugin installation performs no such download.
The manual [Linux-only workflow](../.github/workflows/remote.yml) defines this
test without triggering Windows validation. Its first Linux x64 run reproduced
the onboarding failure. The corrected fixture passed all stages in
[run 37459983924](https://github.com/alexiob/herdr-prism/actions/runs/37459983924)
at commit `9b554ee`, including cleanup of the owned client, container and SSH files.

The inspected routing contract is pinned to Herdr 0.9.3:
[plugin runtime](https://github.com/herdrdev/herdr/blob/v0.9.3/src/app/api/plugins/runtime.rs),
[client aggregate ordering](https://github.com/herdrdev/herdr/blob/v0.9.3/src/client/shell/aggregate_navigation.rs),
[snapshot schema](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/schema/session.rs),
and [client clipboard forwarding](https://github.com/herdrdev/herdr/blob/v0.9.3/src/server/headless/notifications.rs).
