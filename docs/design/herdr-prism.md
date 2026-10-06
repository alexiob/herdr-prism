# Herdr Prism — architectural design

Design date: 2026-10-06. Requested design agent: GPT-6 Astra. This document records the architectural design and subsequent user amendments. Implementation is in progress; current code and executed acceptance evidence are tracked in `docs/implementation-progress.md`. The original research statements below describe evidence at design time, not the latest implementation status.

## Recommendation and intended outcome

Build **Herdr Prism** for **macOS, Linux, and Windows**, primarily in **TypeScript compiled to Node.js ESM**, with a small, separately packaged **Rust process sampler for macOS and Windows**. Keep the existing left **Agents** panel as the primary overview. Enrich each real agent pane with its lineage, process count and CPU/resident memory, message/ref counts, goal preview, worktree branch, colored Git statistics, and focus position. Use a plugin-owned **right split terminal dashboard**, inspired by btop, for selected harness-session tokens, messages, timing, resource histories and fully expandable agent/process trees. It follows the selected root agent with an optional pin; selecting a child within it changes the inspected session without changing the native focus. The user explicitly approved the right-panel fallback and subsequently requested this fuller harness-session dashboard and all three operating systems.

This achieves most of the requested native-panel experience through supported APIs today. **A literal arbitrary native tree containing transcript-only agents, process rows, messages, refs, and independent clickable fields is not supported by the inspected plugin API.** Native layouts format existing agent entries; they cannot add genuine child items. Pane-backed subagents can look nested through indentation and depth-first sorting. Other children appear in their nearest pane-backed ancestor's summary, then become individual interactive nodes in the inspector. Full native replacement requires an upstream extension, specified below.

The user should be able to answer: who is doing what, who spawned whom, which jobs are still running, how much local compute they use, which checkout they affect, and where to focus next. Accuracy and stable navigation take priority over animations or automatic activity-based reordering.

Three approaches were considered:

| Approach | Benefit | Limitation | Decision |
|---|---|---|---|
| Native overview only | Small footprint; changes the exact requested left panel | No synthetic child items, field clicks, true collapse, or complete transcript browsing | Offer as a compact mode with explicit limitations |
| Native overview + terminal inspector | Uses supported APIs; preserves native focus/navigation and provides every requested information category | An additional split consumes terminal columns; only an approximation of a tree in native rows | **Recommended first release** |
| Upstream native tree provider | Exact requested interaction and one coherent native surface | Depends on new Herdr capabilities; cannot be shipped as an ordinary plugin alone | Separate upstream proposal, not an implementation prerequisite |

## Verified research baseline

The four requested resources were inspected. The documentation URL failed direct web retrieval, so its current source in the official Herdr repository was fetched. Reference repository source was fetched through GitHub, not merely inferred from README screenshots. Repository names below link to the inspected revisions.

| Source | Inspected revision/version | Relevant evidence |
|---|---|---|
| [Herdr plugin documentation](https://herdr.dev/docs/plugins/) / [official source](https://github.com/herdrdev/herdr/blob/3d9d2b18dab139ba226ebc5a1c9a9f2c9c3ee4df/docs/next/website/src/content/docs/plugins.mdx) | Herdr master `3d9d2b18dab139ba226ebc5a1c9a9f2c9c3ee4df`, committed 2026-10-05 | Arbitrary argv programs, manifest actions/events/panes/startup, no native non-terminal plugin UI; startup is one-shot; runtime lifecycle and retained installations |
| [Official socket API](https://github.com/herdrdev/herdr/blob/3d9d2b18dab139ba226ebc5a1c9a9f2c9c3ee4df/docs/next/website/src/content/docs/socket-api.mdx) and [configuration](https://github.com/herdrdev/herdr/blob/3d9d2b18dab139ba226ebc5a1c9a9f2c9c3ee4df/docs/next/website/src/content/docs/configuration.mdx) | Same revision | Metadata tokens, Agent projection, subscriptions/recovery, process-info, row configuration/styles |
| Local installed Herdr | `0.9.3`; exported schema protocol `22`, schema version `1` | Read-only `herdr api schema --output …` confirms methods and request/response types. CLI lacks an `agent view` subcommand, but raw `agent.view.set/clear` exist. Schema was read from `/private/tmp/herdr-prism-herdr-0.9.3-schema.json`. This is schema verification, not a live integration test. |
| [flowy11/agent-panel](https://github.com/flowy11/agent-panel/tree/cc45980f90a40969ae5ba65ccc27948769cf3b8b) | `cc45980f90a40969ae5ba65ccc27948769cf3b8b`, manifest `0.4.2`, minimum Herdr `0.8.2` | `src/codex.mjs`, `src/claude.mjs`, `src/follow.mjs`, manifest: exact-session transcript resolution, subagent extraction, messages/refs, a moving split pane plus popup. Its right-hand split is the approved placement precedent for this design. No LICENSE file in inspected tree: **do not copy its code** without permission/license clarification. |
| [edxeth/herdr-pi-tree](https://github.com/edxeth/herdr-pi-tree/tree/bc4b5fc1720656a3bde39594f253e3b91a304ede) | `bc4b5fc1720656a3bde39594f253e3b91a304ede`, `0.1.5`, minimum Herdr `0.9.2`, Node `>=18` | `lib/state.js`, `lib/frame.js`, `lib/view.js`, `lib/herdr.js`, `lib/git-summary.js`, manifest: session-header parent links, tree prefixes/sort keys, custom focus numbers, Git tokens, managed configuration. MIT, copyright edxeth. |
| [hhdebb/herdr-radar](https://github.com/hhdebb/herdr-radar/tree/1ba8cc4a3900191c9f1f4f850398c7dd10212df2) | `1ba8cc4a3900191c9f1f4f850398c7dd10212df2`, `1.4.2`, minimum Herdr `0.9.0`, Node `>=18` | `lib/frame.js`, package/manifest/LICENSE: workspace/worktree grouping, stable token publication, activity styling, Node portability. MIT, copyright qintmb and herdr-kit contributors. |

Reference projects are precedents, not specifications of Herdr guarantees. In particular, resident daemons spawned by older reference hooks are **not** the lifecycle pattern proposed here. The newer official documentation explicitly requires detached work to stop before its parent command/pane exits. Any future reuse of MIT code must retain its copyright and license; the preferred implementation is original, with reference-derived fixture scenarios and attribution. No reference code was copied into this artifact.

## Actual extension boundaries

**Verified current surface:**

- `herdr-plugin.toml` declares argv-based `[[actions]]`, `[[events]]`, `[[startup]]`, and `[[panes]]`; no in-process TypeScript SDK is required or provided. Use `HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`, `HERDR_PLUGIN_ID`, config/state directories, and invocation context supplied by Herdr.
- `session.snapshot` returns agents, panes, workspaces, tabs, layouts and focus. `agent.list` is the unprojected list. An agent record includes `pane_id`, `terminal_id`, `revision`, `agent_session` with provider/kind/value/source, status, cwd, title, and token map. A pane is a presentation attachment, not a durable agent identity.
- `pane.report_metadata` publishes display-only custom tokens. It does not change lifecycle state, completion detection, waiting semantics, or notifications. Tokens have at most 32 retained keys per pane across reporters and 16 keys per report; names are 1–32 ASCII letters/digits/underscore/hyphen. String sets, null clears, omission preserves. Optional TTL expires individual updated keys. A source is provenance, **not an exclusive per-plugin token namespace**: prefix all names.
- `[ui.sidebar.agents].rows` has at most 16 rows and 16 token occurrences per row. `$custom_token` values are rendered by Herdr; missing values disappear. Fixed token colors and text rules are local configuration. `rows_by_agent` selects canonical provider IDs such as `claude`, `codex`, `pi`, **not individual sessions**. Rows apply only to expanded desktop. Collapsed/mobile layouts remain compact.
- `agent.view.set` installs **one** transient declarative filter/sort projection. It changes the visible native order, indexed focus, next/previous navigation, and mouse targets, including compact/mobile views. It does not change `agent.list`. Sorts are stable; missing values sort after present values. It cannot supply rows, parent IDs, groups, expansion state, custom render callbacks, or per-field click handlers. A later set replaces the previous owner. Owner-qualified `agent.view.clear` safely avoids clearing another plugin's view.
- `plugin.pane.open` supports split direction `right`, overlays/popups/tabs; a split is a normal terminal pane and may move/resize through normal APIs. A popup has no pane ID and is session-modal. There is no placement called `sidebar`.
- `pane.process_info` supplies shell PID, foreground PGID, TTY, and foreground process IDs/names/optional command/cwd. It has **no CPU/RSS, complete descendant graph, detached-job ledger, message history, or goals**.
- Herdr link handlers concern modified clicks on terminal URLs; they do not add native sidebar token click handlers.

These conclusions come from the [official plugin](https://github.com/herdrdev/herdr/blob/3d9d2b18dab139ba226ebc5a1c9a9f2c9c3ee4df/docs/next/website/src/content/docs/plugins.mdx), [socket](https://github.com/herdrdev/herdr/blob/3d9d2b18dab139ba226ebc5a1c9a9f2c9c3ee4df/docs/next/website/src/content/docs/socket-api.mdx), and [configuration](https://github.com/herdrdev/herdr/blob/3d9d2b18dab139ba226ebc5a1c9a9f2c9c3ee4df/docs/next/website/src/content/docs/configuration.mdx) contracts and the installed 0.9.3 schema.

## Requirement → evidence → implementation → fallback

“Supported” below means feasible with the verified surfaces; it does not mean implemented or tested in this workspace.

| Requirement | Verified source/API | Proposed implementation | Feasibility/fallback |
|---|---|---|---|
| Change existing left Agents entries | Native `rows`, `$tokens`, `pane.report_metadata` | Compact multiline card per real pane; metadata-only presentation | Supported expanded desktop; standard compact layout elsewhere |
| Nested pane-backed subagents | Pi-tree header links and `lib/frame.js`; view token sorts | Verified parent graph → stable DFS ranks + drawn guides | Supported visual nesting, not native expandable tree semantics |
| Transcript-only children/grandchildren | Agent-panel Codex/Claude parsers; no synthetic native API | Count/preview in ancestor card; real nodes in inspector | Full inspector support; native synthetic rows require upstream |
| Started processes | `pane.process_info`; OS process APIs | Foreground roots + observed descendants + explicit launch ledger | Preexisting detached/remote jobs may remain unattributed; never guess by cwd/name |
| CPU/memory | No Herdr resource API; Linux procfs, Apple libproc, Windows process timing/memory APIs | Delta CPU and per-process resident memory with precise process identity | All three platforms; Windows labeled working-set sum; unavailable if denied/helper absent |
| Harness-session dashboard | Verified provider transcript access and OS sampler foundations; exact usage/timing schemas still conditional | Separate token/message reducers and CPU/RSS history; selected-session/subtree scopes | Provider-reported fields only; missing usage/timing stays unavailable |
| Messages | Reference transcript parsers | Incremental local adapter, role/source/time, on-demand body | Missing/incompatible transcript → unavailable, optional labeled terminal excerpt |
| Refs | Agent-panel `src/refs.mjs` precedent | Deterministic assistant-message links/files with source message ID | Mentioned ≠ edited; explicit patch events mark edited separately |
| To-do | Agent-panel `src/claude.mjs` ACTION parser/list reducer and `src/panel.mjs` session checkbox state | Explicit user-action list, source links, first-seen age and local completion/reopen | Opt-in per provider; no ACTION report means not reported, never an inferred empty list |
| Goal | No generic Herdr goal field | Explicit local goal record or recognized tool event; delegated task separately | Show “Goal not reported”; first prompt is task, never silently a current goal |
| Worktree branches | `WorkspaceInfo.worktree`, Git CLI; Pi-tree state/git | Canonical repository family + actual checkout branch | Detached/unborn/non-Git labels; unknown if inaccessible |
| Colored Git stats | Styled `$tokens`; Pi-tree Git summary | Separate added/deleted/branch/divergence tokens; read-only Git cache | No upstream means no ahead/behind; binary changes are files, not invented lines |
| Focus indices | Native projected navigation; Pi-tree computed indices | Native numbering only when full order is reproducible; stable TUI target map | Hide potentially wrong native numbers on combined remote lists; TUI remains exact |
| Collapse, click message/ref/process | Native API absent; plugin terminal input supported | TUI tree controls + detail popup | Native row click focuses its pane only |
| Always-on updates | Startup is one-shot; normal panes have owned processes | Collector in live inspector/controller pane; event-triggered compact refresh otherwise | Closing collector stops sampling; true headless service requires explicit external lifecycle or upstream daemon support |

## Runtime and language decision

**Primary language: TypeScript, strict mode, compiled before runtime.** Target Node.js 22 or later, with a pinned CI-tested Node major matrix. This is a deliberate new-project support policy, not a claimed Herdr requirement. Publish generated ESM in the release source tree so GitHub installation does not require npm, TypeScript, or a compiler; build hooks validate prerequisites/artifacts only. Development uses a lockfile and pinned compiler. Bundle any TUI/runtime dependencies into the JS artifact with license notices; avoid a runtime npm install. A small custom terminal renderer is viable, but select the final renderer after a keyboard/mouse/Unicode resizing spike rather than promising an unverified library API.

| Choice | Assessment |
|---|---|
| Node + TypeScript | Best match for event/socket I/O, evolving JSONL provider formats, Pi TypeScript companion, and all three references. Easy shared models and fixtures; runtime needs Node. Strong types and runtime validation prevent provider/API drift from corrupting shared state. |
| Rust for entire plugin | Good native telemetry and standalone binaries; more target builds and slower iteration on transcript/TUI formats. Prefer if eliminating Node becomes the overriding distribution goal. Not necessary for the plugin's dominant work. |
| Go for entire plugin | Straightforward binaries/concurrency; still needs native macOS integration and platform packaging, and offers less reuse of the Pi/Node ecosystem. No verified Herdr advantage over either choice. |
| Python/shell | Useful prototypes, but transcript reconciliation, raw terminal UI, typing, portability and process accounting make them weaker defaults. Reference manifests themselves moved toward Node for runtime portability. |

**Narrow native component:** a Rust sampler provides process IDs/parent IDs, exact birth timestamps, cumulative CPU, resident memory, and executable basename on macOS and Windows. Platform backends use libproc or Win32 APIs, emit a versioned JSONL protocol, run as a child of the Node collector, and exit on stdin EOF. No agent parsing, Git, configuration, or network access belongs in it. Linux implements the same interface in TypeScript using procfs; shared conformance fixtures make the backend replaceable. Emit wide counters as decimal strings, converting with BigInt before safe floating-point display so Windows FILETIME and other 64-bit identities retain precision.

For macOS and Windows, full CPU/resident-memory support **requires this helper**, not an optional enhancement hidden behind a full-support claim. Package pinned, checksummed artifacts for macOS Apple Silicon/Intel and Windows x64, selected locally at launch; no runtime downloading. Native Windows ARM64 is an additional release target only after its helper and Herdr/Node combination pass CI; do not imply support merely from x64 emulation. Validate macOS signing and Windows executable distribution in release CI. Missing artifacts show “metrics unavailable: sampler missing.” A documented `cargo build --locked` is a developer fallback, never an undeclared install dependency. The first release manifest declares `platforms = ["macos", "linux", "windows"]`; every platform is a release gate, not deferred scope.

### Platform capability and portability contract

| Platform | Transport and resource backend | Release baseline and explicit limits |
|---|---|---|
| macOS | Node Unix socket; Rust libproc sampler; RSS sum | Apple Silicon and Intel artifacts; denied process reads become partial |
| Linux | Node Unix socket; TypeScript procfs sampler; RSS sum | Test x64 and ARM64 with Node 22+ and mounted procfs; restricted PID namespaces/access lower coverage |
| Windows | Node named pipe; Rust Win32 sampler; working-set sum | Windows x64 with a Herdr-supported ConPTY/VT environment; exact OS minimum determined by tested Herdr/Node requirements, not old individual Win32 API minima |

Connect to the exact `HERDR_SOCKET_PATH` supplied by Herdr: Node's `net` supports Unix sockets and Windows named pipes. Use `HERDR_BIN_PATH` with explicit argv as the portable CLI fallback. Windows pipe lifetime follows open handles, so close it instead of unlinking a pathname. The plugin's own control IPC must use current-user ACLs on Windows; Unix permission bits do not provide that guarantee. [Node 22 IPC documentation](https://nodejs.org/docs/latest-v22.x/api/net.html#ipc-support)

All runtime entrypoints use Node directly, with no dependency on `sh`, POSIX signals, `/tmp`, or a Unix home layout. Herdr resolves PATHEXT shims for non-pane build/actions as documented, but pane commands must be valid Windows argv themselves; shipped JavaScript and native `.exe` artifacts avoid runtime npm/cargo/shim requirements. Teardown requests EOF, waits, and closes handles; on failure terminate only the owned helper using the platform's process handle, never an unvalidated recycled PID. The helper exits on control-pipe loss; it does not remain detached.

Resolve provider homes from configured overrides and Node's OS home directory. Canonicalize filesystem identities with platform-aware paths/file identity, preserving display spelling; do not lowercase all paths or assume every Windows directory is case-insensitive. Test drive roots, UNC paths, extended-length prefixes, UTF-16 native names converted safely to UTF-8, separators, symlinks and junctions. Do not split paths on colon to find line numbers without accounting for drive letters.

State/config replacement uses a same-volume temporary file, closes file handles, validates expected content hash and then uses a tested platform replacement operation. Windows sharing violations get bounded retries and leave the original intact; never delete the original first. Store backups and state under Herdr-injected directories, using current-user ACLs on Windows and restrictive directory/file modes on Unix. Render within the Herdr-provided PTY/ConPTY using feature-tested VT sequences, UTF-8 and ASCII fallbacks; mouse, clipboard and resize features degrade independently without breaking keyboard navigation. No Windows runtime validation has yet occurred in this design task.

## Components and data flow

```text
Herdr snapshot/events ─┐
Codex / Claude / Pi ───┼─> normalized evidence store ─> reconciler
OS process sampler ───┤                              │
Git checkout cache ───┘                              ├─> native token/view publisher
explicit goal/launch records ────────────────────────┘
                                                    └─> terminal tree + detail views
```

Use one collector per Herdr server instance, not one per agent or per attached client. Key server-local state by endpoint identity plus a collector generation; pane IDs can repeat across machines and server restarts. Remote metrics must be collected on the remote host: never look up a remote PID in the local process table. Cross-machine aggregation is a later transport capability, not an implicit assumption.

The collector lives in a normal plugin split/tab pane. The pane's foreground Node process owns its subscription, watchers, sampler, and state. An action opens/focuses one existing controller/inspector on the right and can move it to the active tab without stealing focus; record the pane's real ownership and ID, not its label. The default inspector follows the selected root agent: selection changes update its content, and a tab change docks it on the right of the active agent tab without focusing it. A pin freezes the root and disables relocation until unpinned. Following is debounced, preserves user-resized width and never closes panes based on matching titles. Events caused by its own focus/moves do not select it as an agent root. `q` closes the inspector and stops that collector. An optional dedicated ordinary tab may keep collection alive when the inspector is not alongside an agent; no hidden detached daemon is created.

A startup command is finite: validate capability/state, perform one reconciliation, restore an owned view if enabled, and exit. An opt-in autostart setting may have it open the declared normal controller pane through `plugin.pane.open`, handing lifecycle ownership to Herdr. Compact native-only mode without a live controller updates on finite event hooks/manual refresh and labels metrics stale; continuous process sampling is not promised in that mode.

Event hooks are lightweight wakeups: use a plugin-private local IPC endpoint to notify an existing collector; if absent, a bounded one-shot refresh may run under a short lock. Never launch an orphan worker from the hook. A shutdown handler closes watchers/subscriptions, stops and waits for its own sampler, clears/lets expire volatile telemetry tokens, and clears its own view when returning to native mode. Do not kill agent processes. A restarted collector reconstructs current state from sources; the previous process's memory is never the authority.

## Identity, relationships and reconciliation

Define independent entities:

- `AgentKey = hostKey + provider + providerSessionId`; path-based sessions use a resolved session identity/header where available, plus canonical path/file generation as fallback. No session ref means an explicitly ephemeral key based on terminal/pane occupant generation, not a guessed nearby transcript.
- `PaneAttachment = hostKey + serverGeneration + paneId + terminalId`, linked to an agent with the Herdr-reported session evidence. A pane change increments occupant generation and clears old occupant metadata before new publication.
- `ProcessKey = hostBootIdentity + pid + preciseStartTime`; never PID alone.
- `MessageKey = agentKey + providerMessageId`, or immutable file identity + byte offset when no ID exists. `RefKey` includes normalized target/line and keeps all mentioning message IDs.
- Repository family key is canonical Git common directory; checkout key is canonical working tree root plus its Git directory. Branch labels are mutable attributes, not keys.

Every datum carries `source`, `observedAt`, optional `effectiveAt`, validity/error state, and provenance strength. Every parent edge carries its original record reference. The reconciler uses explicit parent/spawn evidence only. Same cwd, same project, similar title, nearby timestamps, and PPID do **not** establish an agent delegation relationship.

Maintain a graph separately from its presentation forest. Reject self-links/cycles; retain the offending evidence in diagnostics. A missing parent yields an “Unresolved parent” root or link to a historical parent, never adoption by the first agent in the workspace. This intentionally differs from reference fallback nesting. Multiple claims are marked conflicting rather than silently replacing a verified parent. A nested agent may work in another checkout: preserve the delegation edge and annotate its branch; the worktree belongs to the agent, not necessarily to the root task.

The inspector has two views of the same graph: **Agent lineage** (default, arbitrary depth, checkout badge per node) and **Worktrees** (repository → checkout → linked agents). Do not pretend repository grouping and delegation parentage are the same hierarchy. Native overview sorts lineage roots by existing workspace/tab/pane order, then descendants by stable discovery order; cross-worktree children retain their real parent order and show their own branch. Repository/worktree group headings, when drawn as native token lines, belong to an agent card and are not independently selectable.

Bootstrap/recovery follows the official socket contract: subscribe first, acknowledge, then fetch `session.snapshot`. Events and snapshots have **no common sequence boundary**. Events invalidate affected resources; refresh snapshots/targeted reads, repeat if dirtied during a read, and never replay buffered stale event payloads blindly over the new snapshot. `events_lost` means resubscribe + reconcile. A failed read is unknown/stale, not an empty agent list. Close events or a successful authoritative absent snapshot detach a pane; transcript history remains available as historical data.

Provider adapters tail incrementally with bounded buffers, partial-line carry, file inode/generation and byte offsets. Detect truncate/replace/rotation; rebuild that file's derived records transactionally. Cap record size and recursion, skip malformed complete records with diagnostics, preserve an unfinished last line. On rescan deduplicate IDs/events instead of appending duplicates. Cache index lookups and use watchers as hints with periodic reconciliation; never reread all transcript bodies on each CPU tick.

## Provider adapters and information provenance

| Provider | Verified reference behavior | Proposed adapter contract and limits |
|---|---|---|
| Codex | Agent-panel resolves exact `agent_session` ID through session metadata under `$CODEX_HOME/sessions` and `archived_sessions`; reads `response_item` messages; excludes analysis; discovers `source.subagent.thread_spawn.parent_thread_id` or `thread_source…` and recorded `spawn_agent` results | Versioned adapters validate records, correlate calls/results by `call_id`, recursively index descendants, deduplicate message/event mirrors. Do not treat all tool result `session_id` values as OS PIDs. `create_goal`/`update_goal` records are recognized only if present in that rollout and arguments/results match a tested schema; otherwise explicit goal unavailable. |
| Claude Code | Agent-panel reads main JSONL plus `<session>/subagents/agent-<id>.jsonl` and optional metadata; task notifications/paired tool results inform status | Resolve exact session first. Nested edges require explicit spawning tool/metadata IDs; directory membership establishes only the known session relationship, not arbitrary grandparent structure. Support fixture-proven agent/tool naming variants. Hook evidence can enrich launch/session identity, but broad global hooks are optional and additive. |
| Pi | Pi-tree reads session headers containing `parentSession` paths; `session_info` names; a companion extension reports interactive prompt state | Resolve path or ID, validate linked header identity, tail message records behind a schema-tested adapter. Do not interpret an ordinary Pi session fork/branch as delegated work unless spawner/companion evidence identifies delegation. Optional TypeScript companion emits versioned explicit parent/task/goal/launch facts. An unknown spawner leaves parent unresolved. |

The collector never changes Herdr's semantic state to make the tree prettier. Show native Herdr state for pane-backed agents; show explicitly labeled provider-derived state for transcript-only nodes. “No recent activity” is not “failed,” “done,” or “waiting for user.” A recognized completion can be superseded by a later resume/turn event.

**Messages:** a dedicated tab lists individual visible user and assistant messages chronologically, oldest first, with role/provider, timestamp, up-to-three-line text preview and associated tool-call/result summaries. Space expands inline; Enter opens the full message in a popup (or in-panel detail fallback), preserving scroll position on return. `y` copies the selected message. New messages do not pull a reader away from older content; show a new-item indicator unless already following the end. Do not expose hidden reasoning or system/developer instructions. Inter-agent message events appear separately only when explicitly recorded; no claim of a complete messaging bus. Lazy-load bodies and keep at most a bounded hot window in memory.

**Refs:** a dedicated tab parses links/file mentions in visible assistant text deterministically, excluding user text and raw tool-call arguments. Group by originating message, newest groups first; show each normalized target under its latest mention while retaining earlier provenance in details. Relative paths resolve against the message/turn cwd, never an unrelated current pane cwd; display paths relative to that session context. Keep source message and mentioned line; stat asynchronously. Missing files show `?`, folders have a trailing slash, and only explicit tool/patch evidence earns an “edited” mark. Enter opens a ref, `y` copies its full target, Space reveals its full path/URL, and activating the group heading jumps to the source message. Default open permits local readable files and http(s) URLs through explicit user interaction; unsafe URI schemes, shell fragments, and embedded terminal escapes are inert. File Viewer integration, if desired later, requires its separately verified interface; no dependency on that plugin is assumed.

**To-do:** a dedicated tab contains **actions the agent explicitly asks the user to take**. It is distinct from the assistant's work plan, tool jobs, delegated tasks, progress, and the explicit Goal field. Match the reference's complete-list convention: the latest visible assistant message containing `ACTION:` entries replaces the current list; `ACTION: none` clears it; a message without entries leaves the list unchanged. Parse outside code fences only, from the selected session's assistant messages, behind an opt-in provider setting. Assemble all text blocks belonging to the message before committing a replacement so a partial stream cannot transiently erase items. Malformed/mixed clear-and-item reports surface a parser diagnostic rather than silently changing semantics.

Keep current-list timestamp/source and each item's first-seen timestamp/source. Pending items appear first; local checked items remain accessible and can reopen with `x`. Persist checkbox state by full `AgentKey` plus item identity under plugin state, using text identity with conservative whitespace normalization (do not lowercase commands or fuzzily merge differently worded requests). Repeated unchanged items retain first-seen and checkbox state. A changed request is a new item. Source-list removal archives it; a repeated identical request retains its local completion marker with a visible indication and a reopen action. Local checking never edits transcripts, sends a message, or claims provider-confirmed completion. Enter opens the first source message; `y` copies an unambiguous single inline command when present, otherwise the full request. The header shows list age and pending count. Distinguish “reporting disabled,” “not reported,” “source unavailable,” and an explicit empty list.

These interaction precedents were checked against [agent-panel's pinned README](https://github.com/flowy11/agent-panel/blob/cc45980f90a40969ae5ba65ccc27948769cf3b8b/README.md), [ACTION reducer](https://github.com/flowy11/agent-panel/blob/cc45980f90a40969ae5ba65ccc27948769cf3b8b/src/claude.mjs), and [panel state/input](https://github.com/flowy11/agent-panel/blob/cc45980f90a40969ae5ba65ccc27948769cf3b8b/src/panel.mjs). Implement independently. The same opt-in convention can work for Codex, Claude or Pi when visible messages are available; no provider instruction, hook or AGENTS.md modification happens automatically.

**Goal:** three separate labels: `Goal` for explicit current goal state; `Task` for a delegated spawn instruction; `Initial request` for the first user request. A summary, if ever added, is visibly marked inferred and cannot overwrite the explicit goal. Provide a plugin action to set an explicit local goal per agent and a documented optional companion record format. Store who set it, timestamp, status and source message/tool reference. “Goal not reported” is valid. Never modify AGENTS.md or prompt agents to emit special text automatically. Explicit `ACTION:`/`PROGRESS:` conventions may be read opt-in, but are not authoritative goal APIs.

## Process ownership and telemetry

The process tree and the agent delegation tree are different graphs. An in-process subagent may have no dedicated PID. Show its resource usage as “shared with parent,” not a fabricated CPU slice.

1. For each pane use `pane.process_info` to identify the shell and foreground group. Sample the OS table once per host interval. Validate the agent process root using PID/start time and foreground evidence; do not charge all shell siblings to the agent automatically.
2. Follow PPID edges captured while both identities are valid. Attribute a process to its nearest verified agent root. If a child is itself another known agent root, that child owns its subtree; the parent's **exclusive** total excludes it.
3. Remember observed ownership across reparenting only for the same `ProcessKey`. After the process exits or birth time changes, terminate that association. A preexisting detached process cannot be recovered reliably from name/cwd alone.
4. Add an optional explicit launch bridge: `agent-tree run --agent <key> -- <argv...>` or a cooperating provider hook records launch ID, parent agent/task/tool ID, PID+birth time, cwd and exit. Ordinary launches do not require this bridge, but it is how to prove otherwise unobservable detached ownership. The ledger is plugin-specific proposed data, **not an existing Herdr API**. Launch records require locally validated process identity; arbitrary transcript JSON cannot take ownership of a PID.
5. Detached children that daemonize before an observed sample require cooperation from the actual daemon/wrapper to register their final identity. Report coverage as partial if untracked launches are known; do not claim all background jobs. Short-lived processes entirely between samples may appear only as completed tool/launch records, with CPU/RSS unavailable.

For each process, CPU is `100 × Δ(userCPU + systemCPU) / ΔmonotonicWallTime`, with both quantities in the same units. **100% means one fully used logical core**; multicore totals may exceed 100%. Never sum per-process waited-child CPU fields. First sample, reboot, negative counters, birth change, or denied read yields unavailable until a valid pair exists. Batch observation timestamps bound interval skew. Sleeping shows a measured 0%, not unavailable.

Memory is live **RSS** on macOS/Linux and **working set** on Windows, in bytes displayed as MiB/GiB. The discussion below uses RSS terminology for Unix; the Windows renderer uses working-set labels and the same deduplicated resident-memory aggregation policy. Sum each process identity once. RSS sum can double-count shared pages across processes; label it “RSS sum,” not unique physical memory or memory allocated by the agent. Parent `Self/jobs` means its exclusive owned set; optional `Subtree` is the union of descendant agent-owned sets. Never obtain subtree totals by recursively adding already-inclusive parent totals. The dashboard's **observed peak RSS sum** is the maximum aggregate sample during its labeled observation window, not a sum of process peaks or a lifetime OS high-water mark. PSS and machine-normalized CPU are separate optional metrics.

Linux reads PID stat/status with boot identity and start ticks; CPU comes from `utime + stime`, not `cutime + cstime`, and page units are converted correctly. Permission-denied or disappearing `/proc` entries do not terminate the whole sample. Procfs RSS is approximate. See [Linux proc_pid_stat](https://www.man7.org/linux/man-pages/man5/proc_pid_stat.5.html).

macOS helper reads `proc_pidinfo` with `PROC_PIDTBSDINFO` and `PROC_PIDTASKINFO`: birth seconds/microseconds, parent ID, cumulative task CPU and resident size. Validate structure lengths and consistent birth identity around reads; inaccessible fields become unavailable. Avoid `ps %cpu`, which is not this specified interval metric. Use native API bindings and ABI tests rather than parsing locale-dependent command output. See [Apple proc_info.h](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info.h) and [libproc wrapper](https://github.com/apple-oss-distributions/xnu/blob/main/libsyscall/wrappers/libproc/libproc.c).

Windows helper uses `GetProcessTimes` for process creation identity and cumulative user/kernel CPU in 100 ns units, computing the same monotonic interval formula. Keep validated process handles during sampling; creation-time changes start a new identity. `GetProcessMemoryInfo` supplies working-set memory, labeled **working-set sum** rather than private committed bytes or an exact cross-OS RSS equivalent. Modern documented query rights are `PROCESS_QUERY_INFORMATION` or `PROCESS_QUERY_LIMITED_INFORMATION`; the extra `PROCESS_VM_READ` requirement in that documentation applies to legacy XP/Server 2003. Protected/access-denied processes yield partial coverage. [Process times](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes), [process memory](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getprocessmemoryinfo)

Toolhelp's `PROCESSENTRY32W` supplies PID, parent PID, thread count and executable name. Its parent PID is not an immutable identity: validate parent/child creation times and retain observed edges only for those identities. Probe actual Herdr shell/foreground data on Windows; absent associations remain unknown rather than borrowing Unix PGID assumptions. A Toolhelp snapshot cannot recover ownership of arbitrary already-detached jobs. [Process entry structure](https://learn.microsoft.com/en-us/windows/win32/api/tlhelp32/ns-tlhelp32-processentry32w)

No stop/kill control ships in the first release. The plugin is observational; it only terminates its own sampler/utility children during shutdown. Process names are executable basenames by default; full argv is a deliberate reveal and is never persisted in diagnostic logs. Environment variables are not collected.

## Right-panel harness-session dashboard

The selected **harness session** is the scope, not the entire machine or every process with the same executable name. Default `Self + jobs` includes its verified harness process and exclusively owned jobs; `Subtree` unions verified descendant-session process identities. A shared-process child displays “shared with parent.” Provider token scope is independent: include each selected session's own usage once, or explicitly sum distinct descendant sessions. The scope controls, selected identity and coverage remain visible while changing tabs.

The btop influence is functional: compact live statistics, bounded sparklines and inspectable tables. The persistent header identifies provider, reported model, session, state and pin. Six tabs are `Overview`, `Agents`, `Processes`, `Messages`, `Refs`, and `To-do`; Tab/Shift-Tab cycles them, preserving numeric agent-navigation semantics. Narrow panels show the selected tab plus neighbors; Messages/Refs/To-do remain dedicated views rather than telemetry counters alone. Overview expands the useful information list:

- **Identity and timing:** provider/model (including model switches), session age, current harness-process uptime, current/last turn elapsed time and idle age. Only explicit boundaries yield turn durations; file modification time is not a generation timer.
- **Tokens:** recorded input/output, provider-reported cache reads and cache writes, cumulative usage and last/current-turn deltas. Show context occupancy and limit only when compatible context/window evidence exists. Cumulative consumed tokens are not context occupancy.
- **Activity:** visible messages by role, tool calls/results/errors, active tool calls, known background jobs, running/idle/blocked/completed subagents, last activity, explicit goal/task/progress. Queued messages, approval waits, retries and interruptions appear only when recorded, not inferred from silence.
- **Resources:** CPU interval history, current RSS sum and observed peak, process count/tree and active owned jobs. Distinguish an active job from an OS-runnable process; thread count, disk read/write rates and network throughput are optional only with measured, attributable backend evidence. Machine totals may be shown as separately labeled context, never session usage.
- **Workspace:** checkout/branch, colored Git changes, refs and edited-file evidence already specified above.

Usage adapters emit normalized records containing session/request/turn IDs where available, model, counter kind (`delta` or `cumulative`), coverage, timestamp and original source reference. Reducers deduplicate repeated snapshots, streaming updates and resumed transcripts before aggregation. Never add a cumulative counter to earlier deltas representing the same requests. Reset/discontinuity starts a new counter epoch rather than inventing a negative delta. Parent usage that already includes children is not added again to child totals; unknown inclusion semantics prevents a purported deduplicated total.

Cache semantics are provider-specific: cached input may be a subset of input, while another schema distinguishes new input, cache read and cache creation. Preserve these meanings and show separate labeled fields; never derive “total” by blindly adding every token field. Do not estimate missing tokens from character counts. The UI may show “recorded since …” or “partial transcript” instead of claiming a complete lifetime total.

Output tokens divided by a recorded **generation interval** may be labeled generation tokens/s. Output tokens divided by a whole turn is **turn throughput**, which includes thinking/tool/wait time; absent compatible timing, omit the rate. Context percentage requires a known model-specific capacity and an actual current-context measurement; otherwise display the known value alone. Optional cost uses explicit user-provided model/rate configuration, identified currency and cache pricing rules; unavailable components yield a partial cost, never an assumed bill. No price lookup is required for this design.

Provider capabilities below intentionally separate inspected evidence from conditional implementation. No Herdr-wide token API or uninspected rollout field names are assumed.

| Provider | Verified from inspected reference | Conditional dashboard capability |
|---|---|---|
| Codex | Exact rollout/session resolution; visible message/tool records; task start/completion and child links parsed by agent-panel | Enable model, usage/cache/context and per-turn counters only after exact rollout-version fixtures establish fields, cumulative semantics and scope. Recorded task boundaries can support labeled turn elapsed time, not automatically generation speed. |
| Claude Code | Main/subagent transcript and tool-result correlation | Fixture-validate usage/model records and cache semantics; streaming duplicates require request/message identity. Subagent usage is separate unless evidence explicitly includes it in parent accounting. |
| Pi | Session identity/name/parent header evidence | Fixture-validate assistant usage/model records, or use the opt-in companion's versioned usage/turn events. No verified usage evidence means messages/tree/resources remain available while tokens show unavailable. |

At roughly 42 columns, Overview becomes a compact instrument panel; values below are illustrative Unix readings (Windows labels resident memory as WSΣ):

```text
Codex · model: reported-model     [pin]
session …4af2  working     Self + jobs
CPU   124%  ▁▂▃▆█▅▃▅    sample 2s
RSSΣ  620M  ▂▂▃▃▄▅▅▅    peak 710M
4 procs · 2 active jobs   observed 8m
Tokens recorded         last turn
input  42,180               3,020
output  6,210                 410
cache read 30,000 [subset of input]
context —        turn elapsed 00:18
Messages U12 A18 · tools 31 · errors 2
Agents 3: 1 working 1 idle 1 no pane
Goal: pass login acceptance
feat/auth   +83 -21   ↑1
< Overview >           To-do: 2 pending
```

Example To-do view on the same right panel:

```text
Codex …4af2      To-do · 2 pending
List reported 3m ago
[ ] Review docs/auth.md       first 8m
[ ] Restart the dev server    first 3m
[x] Confirm callback URL      local
x check/reopen · Enter source · y copy
```

At 26 columns, stack labels/values, reduce sparkline width, and use a single tab label with arrows. At wider widths, Overview can place telemetry above the nested tree. Retain at most 15 minutes of raw sample history in a bounded ring; sparklines use fixed windows with explicit gaps, never interpolation across disconnects. Reset or segment history on session/scope changes. The source/coverage/age footer distinguishes OS samples, provider reports and explicit local records. Selecting any metric opens its definition and provenance.

## Git and worktree model

Use Herdr worktree provenance where available to connect UI workspaces, then resolve the actual cwd through Git for arbitrary agent checkouts. Canonicalize the working root and `--git-common-dir`; do not assume `.git` is a directory or that one branch uniquely identifies a checkout. Symlink aliases share a cache only after canonical resolution. Git branch state is explicit: named branch, detached HEAD with abbreviated commit, unborn branch, non-Git, or inaccessible.

One bounded Git job queue per host, maximum two concurrent Git children. Every checkout cache serves all attached agents. Run argv commands without a shell, timeouts, `--no-optional-locks`, `--no-ext-diff`, `--no-textconv` where applicable, and avoid fetching/remotes/network. Parse `status --porcelain=v2 -z --branch` for file/status/divergence; use NUL-safe `diff --numstat -z HEAD` for tracked net additions/deletions against HEAD. Name the metric **working tree vs HEAD**, not staged + unstaged total. Untracked files get a separate file count; do not read their contents for line totals. Binary diffs are file counts. For unborn HEAD, report staged/unstaged counts separately or line totals unavailable until a specifically tested equivalent baseline is implemented; never add overlapping diffs blindly.

Show green `+N`, red `-N`, amber conflict count, text `↑ahead ↓behind`, branch, and untracked `?N`. Labels/signs convey meaning without color. Divergence is against the locally known upstream ref and may be stale relative to its remote; no upstream is “—”, not zero. A read failure preserves last sample with age/stale marker, not a clean state.

Refresh focused/working checkouts on a debounced change signal or at most once every 5 seconds; idle checkouts every 30 seconds; worktree lifecycle events invalidate immediately. Watch Git/index/HEAD and relevant directories as hints, plus TTL refresh to catch external changes and watcher gaps. Bound massive repositories with timeouts, backoff and visible “Git timed out.” Do not run a Git subprocess per agent per render.

## Native row budget and terminal interaction

Use names prefixed `hat_`, source `plugin:<HERDR_PLUGIN_ID>`, and no overrides of native titles, agent labels or lifecycle authority. A default expanded card uses at most these 14 keys: `hat_line`, `hat_goal`, `hat_load`, `hat_counts`, `hat_branch`, `hat_add`, `hat_del`, `hat_div`, `hat_conflict`, `hat_last`, `hat_rank`, `hat_index`, `hat_fresh`, `hat_group`. Reserve capacity for other plugins; reject rich mode cleanly if the pane has insufficient shared token capacity. Detail bodies never become tokens. Use short plain text with terminal control characters stripped.

Proposed config structure uses only verified existing syntax:

```toml
[ui.sidebar.agents]
row_gap = 0
rows = [
  ["$hat_group"],
  ["state_icon", "agent", "$hat_line"],
  ["workspace", "tab"],
  ["$hat_goal"],
  ["$hat_load", "$hat_counts"],
  ["$hat_branch", { token = "$hat_add", fg = "#42B883" }, { token = "$hat_del", fg = "#E06C75" }],
  ["$hat_div", "$hat_conflict", "$hat_fresh"],
  ["$hat_last"],
]
```

Color values are the dark-theme preset; provide a tested light preset and monochrome mode. Empty optional rows disappear. Typical cards are 3–5 lines; selection details and latest message previews are opt-in to control density. The built-in `agent`, `workspace` and `tab` values keep this template readable when every `hat_` token expires. `hat_line` therefore carries the index/tree/name portion without repeating the provider. The optional group line is omitted unless a group heading is useful.

Approximate 38-column native overview (Herdr supplies its standard token separators and row focus; there are no field-level buttons):

```text
Agents — tree
● 1 Codex · implement auth
  Goal: pass login acceptance
  CPU 124% RSSΣ 620M · p4 a3 m18 r5
  feat/auth · +83 · -21
  ├─ 2 Claude · review API
     CPU 6% RSSΣ 310M · p1 m7 r2
     feat/auth · +83 · -21
  └─ 3 Pi · fix tests
     Goal: not reported
     wt/tests · +12 · -4
```

Here `a3` is three known descendant agents, including transcript-only children; process and message/ref counts are per-agent and distinctly labeled in help. Native index includes only focusable agent entries, not card continuation lines. Real token separators mean exact pixel/column matching of this conceptual mockup is not promised.

At 26 columns use two or three rows: identity, `124% 620M p4 a3`, and `feat/auth +83 -21`. Hide previews before truncating identity; preserve status and a readable provider/name. Native metadata publishers cannot know every attached client's width, so native density is selected by client config, not a server-global width guess. The inspector adapts to its own PTY size.

Right split inspector, approximately 42 columns:

```text
Prism   Lineage    / filter
▾ [1] Codex implement auth       working
  Goal  pass login acceptance
  ▾ Agents (3)
    ▾ Claude review API          idle
      └─ Codex check edge cases  no pane
    ▸ Pi fix tests               working
  ▾ Processes (4) 124% RSSΣ 620M
    cargo test      98%  240M  observed
    dev server       2%   81M  launch
  ▸ Messages (18)   last 12s ago
  ▸ Refs (5)        2 edited
  Worktree feat/auth  +83 -21  ↑1
──────────────────────────────────────────
Enter focus/open  Space fold  d details
```

Only the selected agent expands detail categories by default. Arbitrary depth remains stored; after excessive indentation display a compact ancestor breadcrumb so useful text remains visible. Unicode guides are optional, with ASCII `+`, `-`, `|` fallback. Keyboard supports arrows/j/k, Home/End, PageUp/PageDown, Space collapse, Enter explicit open/focus, `/` filter, Escape back, `d` detail popup, and `?` help. Never auto-open a ref or inject text into an agent on selection. Mouse hit targets cover the row, with expansion on the disclosure control in the TUI only. Selection, scroll anchor and collapsed IDs survive updates by entity key.

Provide reduced-motion/no-spinner mode, high-contrast focus, textual statuses, no color-only meanings, grapheme-aware truncation, wide-cell handling, and a plain-text snapshot/export for accessible reading. Popup failure (`ui_busy`) falls back to in-inspector detail and preserves selection. Export is explicit and redacted by default.

## Focus indices and stable navigation

Herdr's projection governs native numerical focus. Publish `hat_rank` as a zero-padded depth-first ordinal using token sorting, e.g. `0000000042`; default order changes only on topology changes, not on CPU samples, message arrival, or status transitions. Await rank publication before enabling the view. Any partial write failure disables plugin numerical badges until reconciliation rather than presenting a false mapping.

There is no verified API for an atomic multi-pane token transaction or a client-specific ordered-index read. Native badges are therefore computed only for the tested single-server, unfiltered configuration whose tie-break order can be reproduced from the snapshot; reconcile through a readback and never promise atomicity during concurrent joins/leaves. Native keyboard focus remains Herdr-owned. For combined saved-machine views or unknown competing projections, omit plugin native numbers and retain the host's navigation. This is a real API limitation.

The TUI has a separate stable render-generation map from its displayed numeric labels to **agent/pane identities**, not native ordinals. Digit-prefix + Enter supports more than nine entries. Resolve a label against the generation the user saw, then revalidate occupant/session and call `agent.focus` with an explicit pane target. If it vanished, show “Agent ended” instead of intentionally focusing a replacement. The current focus request has no verified expected-occupant precondition, so the read→focus race cannot be eliminated atomically by this plugin; revalidate immediately and reconcile after focus, and do not promise an absolute guarantee across a simultaneous occupant replacement. A transcript-only node opens its conversation and displays “no live pane.” Changing filter/collapse rebuilds labels only after input is committed or cancelled. Native numbers and TUI numbers are labeled as separate scopes when their lists differ.

## Update cadence, limits and errors

| Source/work | Cadence and control |
|---|---|
| Herdr subscription | Continuous while collector lives; subscribe to verified lifecycle/status/layout types. Some status subscriptions require explicit `pane_id`; install/remove per known pane from the schema. |
| Authoritative snapshot | Startup/reconnect; 100 ms debounced invalidations; 10 s safety reconciliation. Single in-flight read plus dirty flag. |
| Transcript tails | Watcher debounce 150–250 ms; focused/active 1 s fallback, inactive 5 s; directory index at most every 5 s on misses. |
| Process sample | One host scan every 2 s by default, 1 s while Processes is expanded, 5 s when no active agent. First valid delta needs two samples. |
| Git | Focused/working 5 s, idle 30 s, event invalidation with debounce and two-job cap. |
| Native token writes | Only changed values; coalesce to at most 2 updates/s/pane, one in-flight publisher. Renew dynamic tokens before 15 s TTL, e.g. every 5 s. Stable identity/order tokens use a longer TTL with controlled refresh. |
| TUI paint | Diff-render, capped at 10 fps; no full redraw for unchanged data; no animation polling that forces source reads. |

Ignore self-induced metadata-only invalidations unless they change relevant facts; compare content hashes to prevent report → event → report loops. Backoff on socket/helper/Git errors, retain a small bounded diagnostics ring, and keep the input loop responsive. Never turn polling failure into zero resources, “no messages,” or “all agents closed.”

Availability states are `known`, `not_applicable`, `unavailable(reason)`, `stale(age)`, and `partial(coverage)`. Unknown is `—`, measured zero is `0`, stale adds age, and partial is labeled. Parent metrics need a coverage count (`3/4 processes readable`) rather than silently omitting denied entries. Every detail screen can reveal source and sample time.

Initial budgets to validate, not measured claims: with 50 live agents, 500 tracked processes and 100 MB of transcript history, hot memory below 150 MiB excluding Node runtime baseline/helper, idle plugin CPU below 1% of one core, steady active overhead below 3%, p95 keyboard response below 100 ms, and host events reflected within 500 ms except intentionally throttled samplers. Bound hot messages to 200 per agent and lazy-load older pages; profile budgets before advertising capacity.

## Configuration, coexistence and reversibility

Plugin ID: `iob.herdr-prism` (proposed; final publisher namespace may change). Declared actions: `configure`, `unconfigure`, `open`, `refresh`, `native`, `settings`, `doctor`, `set-goal`. Pane entrypoints: `inspector` and `detail` popup. No dynamic action registration is assumed. Default keybinding suggestions use prefixed keys and are optional; never intercept plain printable keys globally.

`configure` computes a previewable, minimal TOML edit for `[ui.sidebar.agents]` and optional keybindings. Preserve unrelated tables, comments and user values. Use a real TOML-aware editor or syntax-preserving patcher validated by roundtrip fixtures; never append duplicate tables. A plugin-owned manifest records original values, written values, hashes and backup path. Recheck the original hash immediately before atomic rename. Detect foreign ownership/overlapping rows before modification. Changes to local client presentation and remote server collection are configured separately, because Herdr's sidebar/theme are client-local.

Do not install a custom font, change the global theme, rewrite Spaces/tab-bar layouts, install agent hooks, or launch a collector as a build side effect. Those reference features are outside this request. An optional Pi companion/launch bridge is an explicit separate configuration choice, copies only marked plugin-owned files, refuses foreign file overwrite, and is removed only if its checksum/marker still matches.

Radar and Pi-tree both own native sidebar layout and may set the single Agent projection; they cannot simultaneously control the same surface reliably. Offer two explicit installation modes: **own native overview** (replace only selected overlapping configuration with reversible backup; user disables the other view owner) and **inspector only** (publish no native view or conflicting layout). Do not fight another publisher by repeatedly calling `agent.view.set`. Native summary token names avoid their generic keys but still share Herdr's total token budget. Agent-panel may coexist as a separate pane, but two following panels compete for width; doctor recommends pinning one or disabling one panel's follow behavior. Never move, close or resize the other plugin's pane.

On disable/unconfigure: stop this plugin's collector through its ownership-checked IPC, clear only `hat_` keys it owns, clear the view with the `source` guard, restore only configuration values still equal to what this plugin wrote, and report user-modified conflicts instead of overwriting them. Restore preexisting values, not factory defaults. Unconfigure is idempotent, works with the collector dead, and keeps user data unless an explicit purge is requested. Uninstall alone unregisters the plugin but preserves state/config; document unconfigure-before-uninstall. Dynamic token TTLs prevent stale CPU from looking live after a crash. Cleanup must not kill unrelated processes or delete another plugin's files.

Pin installs to reviewed refs during rollout. Official current docs say updates retain old installations for live commands, new invocations use the new installation, and existing processes are not restarted. Restart the collector explicitly through the action after upgrade; do not assume reload or enable triggers startup. Validate this behavior on the actual target release because the local 0.9.3 schema verifies API shapes, not every newer documented lifecycle behavior.

## Privacy and safe local operation

All collection is local by default with no analytics or network backend. Restrict transcript discovery to configured provider homes and exact session references; don't scan arbitrary home-directory files. Store UI preferences, offsets, explicit goal/launch ledger and normalized identities under `HERDR_PLUGIN_STATE_DIR`; raw transcript bodies remain at their source. State and IPC paths use user-only permissions and a per-instance random token. Clean stale state by identity/age without following arbitrary symlinks outside owned directories.

Treat transcript text and process command lines as untrusted display data: strip ANSI/OSC/control sequences, bound sizes, never eval text or splice it into a shell command, and pass explicit argv to Git/open helpers. Do not infer a command to execute from a goal or message. References and optional raw argv require deliberate reveal/open. Remote records identify their host; unavailable remote files remain unavailable rather than falling back to local paths with matching names.

## Proposed upstream extensions — not existing APIs

To fulfill the literal all-native request, propose a declarative **Agent tree provider** to Herdr. Method names are intentionally not presented as callable endpoints. The needed contract is:

1. A plugin submits an atomic, versioned tree snapshot/diff with stable IDs, parent IDs, typed node kinds (agent/process/message/ref/group), bounded styled spans, accessibility labels, optional native pane target, and declared action IDs. No arbitrary code executes in Herdr's renderer.
2. Herdr owns expansion, selection, scrolling, keyboard navigation and row hit testing; emits declared activation/disclosure events with stable node identity and tree revision. It distinguishes focusable agent indices from other items.
3. One surface owner with explicit acquire/release/lease semantics, automatic cleanup on disable/crash, and a built-in restore command. Client-scoped width/visible-range information and client-scoped projected focus indices avoid combined-machine ambiguity.
4. Atomic metadata/projection publication or server-provided projected order prevents transient mismatches during topology changes. Optional typed process/launch attribution and supervised plugin-service lifecycle would remove the helper/controller-tab compromises.

These extensions are separately reviewable and do not justify fabricating native rows by reporting fake agents, renaming real panes, injecting input, or modifying Herdr internals from a plugin.

## Proposed module layout

```text
herdr-plugin.toml
package.json / package-lock.json / tsconfig.json
src/
  entrypoints/{startup,action,inspector,detail}.ts
  herdr/{schema,client,capabilities,subscription,projection}.ts
  model/{entities,evidence,reconcile,lineage,availability}.ts
  metrics/{usage-reducer,message-counts,turns,scope,history}.ts
  content/{messages,refs,todo-parser,todo-reducer}.ts
  providers/{adapter,codex,claude,pi,tail,index}.ts
  process/{sampler,linux,native-helper,ownership,ledger,aggregate}.ts
  git/{identity,status,cache,queue}.ts
  native/{tokens,layout,publisher}.ts
  tui/{tree,rows,input,focus,details,accessibility}.ts
  config/{load,managed-toml,install-state,unconfigure}.ts
  state/{store,todo-completion,ipc,lock,diagnostics}.ts
companion/pi/agent-tree.ts
native/sampler/{Cargo.toml,Cargo.lock,src/main.rs,src/macos.rs,src/windows.rs}
dist/                         # release ESM + notices
bin/<platform-arch>/          # verified release sampler artifacts
test/{fixtures,unit,contract,integration,acceptance}/
docs/{design,install,compatibility,privacy}/
```

Each provider implements `resolveSession`, incremental `readEvidence`, `capabilities`, and optional companion validation. Adapters emit normalized events; they never publish native tokens or perform focus. The process backend emits raw samples; only the ownership/aggregate modules decide attribution. Both native and TUI renderers consume immutable reconciled views. Runtime JSON validation guards every external boundary even when generated TypeScript types exist.

## Delivery phases and acceptance

**Phase 0 — contract harness and lifecycle proof.** Pin 0.9.3 schema fixtures, confirm all required methods locally, build a tiny declared split/controller proof on a disposable Herdr session, verify foreground-child teardown, native fallback rows and keybindings. Detect unsupported schema/protocol and show an actionable doctor result. Set initial `min_herdr_version = "0.9.3"` only after this actual integration test; current evidence supports a candidate, not a certified minimum. Produce release prerequisite checks for Node/helper. No deployment to the user's live config is part of this design task.

**Phase 1 — native overview and stable identity.** Snapshot/subscription recovery, pane/session identities, branch/cache, token TTL and source guards, stable DFS for fixture-backed links, reversible configuration, inspector skeleton. Acceptance: same-cwd sessions never merge; pane reuse clears prior session data; unavailable tokens leave a usable native card; disabling returns to native behavior; competing plugin is not repeatedly overridden.

**Phase 2 — complete provider tree and content.** Codex/Claude/Pi fixture adapters, arbitrary-depth links, message/ref/goal provenance, dedicated Messages/Refs/To-do views, local checkbox persistence, lazy detail views, keyboard/mouse and narrow layouts. Acceptance: 4+ nested levels, missing parent, cross-worktree child, resumed child, malformed JSONL, rotation/partial writes, duplicate mirrors, paths with Unicode/spaces/newlines, unavailable files and no local rollout. Verify chronological messages and inline/popup return position; refs deduplicate under latest source, open/copy/jump correctly and mark edits only from explicit evidence. To-do tests cover complete-list replacement, no-report preservation, explicit clear, fenced examples, streamed text blocks, first-seen provenance, pending count, per-session isolation, checked-state restart/reopen and unavailable versus empty. No hidden reasoning/system instructions displayed. Unknown goals are explicit. No checkbox action or parser installation mutates transcripts, provider instructions or project AGENTS.md.

**Phase 3 — resource and launch ownership.** Linux backend and packaged macOS/Windows helper, nearest-root exclusive ownership, subtree union, launch ledger and opt-in bridge. Acceptance on all three platforms: controlled CPU worker measures approximately one core after warmup; multicore exceeds 100%; RSS/working-set units and labels are correct; nested agent counts once; two agents sharing a harness display shared usage; reparented observed child remains correctly owned; PID reuse/creation-time/boot changes clear attribution; denied reads show partial; preexisting unproven detached process is not guessed; helper exits when parent dies. Full metrics release requires all three platform suites.

**Phase 4 — distribution, compatibility and performance.** Pinned artifacts, license notices, build/link distinction, upgrades with live old collectors, explicit collector restart, unconfigure conflict cases, concurrent config edit, remote-host unavailable behavior, light/dark/monochrome, 26/38/80-column layouts, multi-client width differences, performance budgets and soak/reconnect tests. Publish capability matrix by tested Herdr/provider version. Inspector-only mode is the fallback when native features or configuration coexistence fail.

Test strategy is behavior-based: property tests for graph acyclicity/identity and aggregate disjointness; transcript golden fixtures for outputs/provenance; fake clocks/counters for metrics; schema-contract validation for every request; fake socket integration for delayed replies/events_lost; isolated real Herdr tests for focus/row layout; disposable Git repositories with rename, binary, conflict, unborn, detached HEAD and worktrees. Golden pictures supplement, not replace, input/focus assertions.

CI runs macOS, Linux and Windows, with actual-platform smoke tests for Unix sockets/named pipes, sampler warmup and teardown, process creation-time precision, provider home/path resolution, Unicode/UNC fixtures, config roundtrip/concurrent replacement, Git NUL parsing, PTY/ConPTY resize and keyboard behavior. Verify installer/linker argv and local helper artifact selection without a runtime toolchain. Publish only the platform/provider combinations actually tested; Windows support is required before the first complete release, not claimed from cross-compilation alone.

Dashboard acceptance additionally covers repeated cumulative usage, streaming duplicates, cache-as-subset versus separate cache categories, counter resets, missing historical records, model changes, and nested token totals. A tool-heavy turn must never be mislabeled as measured generation speed. Test context unknowns, shared-process children, scope changes, timeline gaps and observed-peak definitions; 26/42-column layouts must retain session/scope/availability. Provider metrics remain unavailable until their adapter fixtures establish semantics. Resource charts must represent the same owned set as the Processes table.

The final acceptance scenario starts a Codex root, a pane-backed Claude child, a transcript-only grandchild, and a Pi agent in another worktree; launches a compiler and registered detached server; appends messages/ref mentions and explicit goal changes; then closes/reuses a pane and restarts the collector. The native panel must summarize every category without inventing child rows; the inspector must show the full verified lineage, readable process ownership, accurate availability and checkout context; stale selections must be rejected when occupant replacement is detected, and the remaining read→focus race must be documented. Finally, unconfigure must restore the prior user layout and stop only plugin-owned collection.

## Remaining decisions and explicit limits

The design is implementation-ready at the architecture level, but does not claim that live Herdr behavior or provider formats have been integration-tested. Phase 0 certifies the exact compatible release and renderer. Default first-release choices are macOS/Linux/Windows, Node 22+, supported native overview plus right dashboard with six views, stable ordering, local-only data, no process termination, no automatic provider instructions, and no hidden daemon. Native synthetic rows, exact combined-machine numeric badges, and complete attribution of uncooperative preexisting detached jobs remain outside the verified plugin surface. They stay visibly unavailable or use the documented inspector/bridge paths.

## Live lifecycle amendment — 2026-10-06

The user requires installation/removal during a running Herdr session, immediate
activation, and complete removal of the plugin's owned files and configuration.
This supersedes the earlier manual unconfigure-before-uninstall and retain-state
default for the supported full-removal path.

Herdr does not call startup on link/enable and does not expose an uninstall
hook. Uninstall retains configuration/state. The tested 0.9.3 CLI deletes its
managed GitHub checkout on uninstall and replaces it on reinstall; newer
documentation describes retained installation generations and `plugin update`.
The wrapper does not depend on either host installation-retention policy.
A release therefore includes `scripts/live-install.mjs`: it copies a checked
release to a separately owned managed directory, registers/enables it, invokes a
declared activation action and waits for authenticated collector readiness plus
successful Herdr command completion. Native ownership has an explicit takeover
option; inspector-only mode remains available for coexistence.

The same wrapper removes the installation: deactivate all recorded server
collectors, await their leases and detail popups finishing, close panes identified
by recorded terminal identity, clear source-guarded projection and still-owned
metadata, restore original configuration, then disable/unregister and purge only
marker-proven plugin config/state and the managed installation. User-modified
configuration conflicts stop deletion and retain the recovery backup. The source
checkout remains the user's project. Vanilla `herdr plugin uninstall` cannot offer
these stronger guarantees; no build hook or detached service attempts to bypass
that host limitation. Live acceptance must exercise the wrapper on all targets.

## Selected visible session collection amendment (2026-10-06)

Heavy updates run only for the session currently shown in the open, visible
right inspector. Closing it, hiding its workspace/tab, or losing the server
connection pauses transcript/body/tool/usage hydration, refs and complete ACTION
list extraction, Git detail refresh and periodic OS sampling. Finite hooks without
an inspector reconcile Herdr inventory without transcript discovery or OS sampling.
Switching selected sessions hydrates the new exact source. Lightweight session
metadata and relationships remain available; previously loaded background details
are explicitly cached/stale. The selected session's archive mirrors belong to the
same source, while descendant transcripts require deliberate selection.

Sampling a selected harness needs a system process inventory to find jobs and
ancestry. Other agents' verified roots remain lightweight cached exclusion
boundaries, refreshed on occupant/process identity changes or expiry, so another
harness never becomes the selected parent's Self + jobs. Subtree resource scope
can measure descendant harnesses as part of the displayed scope, but does not
hydrate their transcripts. Context/model/current-turn timing remain facts of the
selected harness. Missing or stale child usage cannot imply complete subtree
usage.

Visibility transitions keep old resources stale until a fresh sample, warm up CPU
rather than averaging across a hidden interval, and rehydrate complete ACTION
state so updates outside the recent message window remain visible. Asynchronous
stages recheck the visibility generation before starting additional heavy work.
Explicit source/message readers perform bounded-memory, on-demand reads of their
requested session only; they do not start background collection.
