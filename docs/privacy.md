# Privacy and local operation

Collection runs locally. There is no analytics service, network backend,
automatic upload or remote transcript fallback. Git operations are read-only
and never fetch or contact remotes. Explicitly opening a web reference can launch
the user's browser; that user-requested browser action is separate from collection.

## Evidence read

The plugin reads Herdr's agent/session/pane facts, provider JSONL records inside
configured provider homes, local Git status and OS process counters. Sessions
resolve by exact provider ID/path; matching cwd alone does not establish identity.
Directory scanning stays within configured provider roots and does not follow
arbitrary directory symlinks into other home files. Missing or remote evidence
remains unavailable.

Only visible user/assistant messages and supported tool results are normalized.
System/developer content and hidden reasoning are excluded. Text and paths are
bounded, controls/ANSI are sanitized for display, and no transcript content is
evaluated or interpolated into shell commands. References open only after an
explicit user action. Optional command/argument detail is not automatically shown.

## Stored state

Raw transcript bodies remain at provider sources; the plugin does not maintain
a durable transcript archive. In-memory hot windows are bounded. Private plugin
state can contain:

- UI/settings preferences and exact provider-home paths.
- Local To-do item text, checkbox state, source message IDs and first-seen times.
- Explicit user-entered goal records.
- Agent Markdown notes and conflict recovery drafts in
  `servers/<endpoint hash>/notes/<provider-session hash>/note.md` and
  `recovery-<UUID>.md`. These files never enter provider transcripts, native
  tokens, diagnostic exports or telemetry.
- Validated launch associations containing session/process identity facts.
- Ownership/authentication records and transient request/response mailbox files.
  Message-detail IPC contains exact provider/reference/message locators; the detail
  child reads the source directly rather than serializing transcript bodies.
- Configuration ownership manifests and exact backups of selected client config.

A copied/exported message or dashboard contains the text the user deliberately
chose to copy/export. Protect or remove those user-created outputs as appropriate.
Configuration backups may include unrelated config content because restoring
source syntax requires retaining the original document. No provider instructions,
project AGENTS.md, transcript body or live agent session is modified by To-do
checking or normal collection.

## Permissions and lifetime

Remote collection runs on each remote Herdr host. Hostname/session labels identify
the collecting server; persisted server UUIDs scope native ranks, and diagnostic
exports omit those labels/IDs. Messages rendered in a remote dashboard travel
through Herdr's existing SSH terminal transport. Explicit clipboard writes use
Herdr's foreground-client OSC 52 forwarding; failed remote file opens never
fall back to a same-named local file. See [remote boundaries](remote.md).

Unix plugin state directories are current-user-owned and mode 0700; private files
are mode 0600. Symlink/non-regular state targets are refused. Windows newly created
plugin directories/files get current-SID-only ACLs through explicit argv; existing
directories are verified and fail clearly if foreign allow entries remain. The
plugin does not silently strip foreign ACLs from an existing user directory.

All per-tab inspectors share one collector/helper on their collecting server. Helpers use stdin/parent
lifetime supervision; there is no detached analytics daemon. Private mailbox
requests use a random ownership token, bounded JSON and per-operation cleanup.
Unconfigure requests owner-checked shutdown and restores still-owned config
without killing unrelated processes. Dynamic native tokens expire after a crash.

Closing/disabling does not purge notes, preferences, To-do state, goals, launch ledger,
configuration backups or other user data. Unconfigure before unlinking/uninstalling
and retain the returned backup/conflict report. Remove retained private data only
through complete owned removal after collection and inspector saves have stopped.
Notes autosave privately, and revision checks serialize cooperating panels. A
newer external edit stays intact; a conflicting draft is saved separately.

## Metric limits

CPU/RSS/working-set counters are measurements with coverage, identity and sample
age. They are not inferred from transcript activity. A denied read is partial or
unavailable, never a measured zero. Preexisting detached jobs without explicit
proven ownership are not attributed to an agent. Cached Git/token/message data
is freshness-labeled; a disconnect does not mean that all agents completed.

Provider counter semantics differ. Inclusive subtree usage, cache categories,
model epochs and incomplete pricing are surfaced explicitly. Goals, delegated
tasks and ACTION To-do lists are separate facts; the plugin does not manufacture
an objective from a prompt preview.
