# Per-server remote support

User-selected architecture: Prism runs on every remote Herdr server. The parent
implementation goal remains active, and Windows work is explicitly deferred.
This amendment uses the existing collector and Herdr SSH transport; it does not
add a local SSH-agent daemon or merge foreign process tables.

1. Inspect pinned Herdr 0.9.3 selected-server routing, installation commands,
   combined native projection, machine label ownership and surface visibility.
2. Add persisted endpoint-scoped server UUIDs and hostname/session display.
   Prefix native ranks so identical server-local ordinals do not interleave
   independent remote trees. Preserve Herdr's built-in machine row token.
3. Forward deliberate copy through Herdr's terminal clipboard path and pause
   heavy work for inspector panes hidden by zoom. Keep headless remote file
   opening and clipboard delivery limits explicit.
4. Test isolation/reconnect identity, lexical rank grouping, labels, redaction,
   clipboard control encoding and zoom. Run macOS strict/unit/distribution/live
   acceptance. Run a disposable Linux SSH server and real macOS Herdr client
   through attachment, remote collection, actions, disconnect/reconnect and
   complete owned removal; keep all SSH configuration and keys isolated.
5. Package remote docs with releases and update the design/evidence ledger.
   Record exact evidence rather than claim complete remote certification.

The exact client-visible heavy-update rule cannot be completed using the pinned
public API. `docs/remote-visibility-api.md` supplies the concrete host contract
and acceptance needed for that remaining requirement. No upstream message or
issue is sent automatically. No Windows CI or debugging is resumed in this pass.
The user explicitly chose to keep the host API as an upstream dependency,
instead of preparing/testing a Herdr fork.
