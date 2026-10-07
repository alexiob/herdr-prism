# Dashboard features and controls

Prism gives each native agent pane its own inspector, with independent width,
selected view, pin and reader preferences. Panels share one collector on each
Herdr server. Close one panel with `q`; reopen it through prefix+i or the `open`
action. Updates restore open panels and retain closed ones, settings and exact
native/Prism focus. [Installation](install.md) explains preserving updates and
complete removal, which deliberately deletes private data.

## The eight views

| View | What you can inspect and do |
| --- | --- |
| Overview | Read explicit goal, delegated task, initial request, session/turn/harness timing, resource charts, coverage, provider usage and checkout facts. Open the matching view from an activity row. Account/limits appears only with supported recent client reports. |
| Notes | Read and edit private Markdown for this panel's owning agent, including while inspecting its workers. Autosave, explicit save and conflict recovery retain drafts across restarts and updates. Empty notebooks are labeled Empty. |
| To-do | Read complete supported ACTION lists with source provenance; check/reopen items locally without editing the transcript. Repeated items retain their local checked state. Disable parsing with `todosEnabled`. |
| Git | Inspect the exact repository/worktree, branch/HEAD, working-tree additions/deletions, file counts, conflicts and upstream ahead/behind when available. No fetch or remote contact. Binary/untracked files and unborn branches retain honest separate coverage. |
| Agents | Inspect the panel owner and its recorded descendants; read task, goal, status and identity. Fold child trees or group the same tree by worktree. Recorded workers without a live pane remain inspectable; unrelated host sessions are excluded. |
| Processes | Inspect the verified harness and owned process tree, names/PIDs, threads, CPU, resident memory and sample coverage. Open bounded retained terminal output or explicitly request termination after a confirmation. |
| Refs | Read assistant links/files and explicit edit markers beyond the hot message window. Inspect target details, mention history and the exact source message; deliberately open or copy a target. Older targets and mentions are paged separately. |
| Messages | Read visible user/assistant messages and supported tool results in separate subpanels. Expand long entries, open full detail, copy text, filter, or request older messages. Scrollback stays anchored while new messages arrive; the end resumes following. |

The header breadcrumb is **Owner > Parent > Current** for worker inspection.
Click an ancestor to inspect it, or use Parent/Owning agent controls. Missing or
cyclic links and omitted ancestors use `…`; narrow layouts preserve the current
agent. Enter inspects inside Prism; only explicit `f` moves native Herdr focus.
Temporary missing identity during startup does not replace a saved selection
with another notebook. Notes always use the bound owner, or the captured active
edit identity, and wait when that owner is unresolved.

## Normal reading

| Input | Effect |
| --- | --- |
| `Tab` / `Shift+Tab`, click view name | Next/previous or chosen view; obey configured order. |
| Up/down, `k`/`j` | Move one logical entry. Multiline entries select and highlight together. |
| Left/right | Switch independent subpanels; very short panels expose the active subpanel. |
| `Home`/`End`, `g`/`G` | First/last entry in the active reader; Messages end resumes following. Notes uses Home/End to scroll its text. |
| `PageUp`/`PageDown`, wheel | Scroll content in the active/pointed subpanel; long entries stay readable. At the top of Messages, PageUp can request older messages. |
| Click entry body | Select the whole entry. |
| `Enter`, click its right arrow | Open its detail, destination or selected agent. |
| `d` | Open full identity/detail when the selected entry provides it. |
| `?` | Context help for the selected entry; Escape restores the previous position. |
| `Escape` | Close help/detail/filter or clear a numeric prefix; otherwise return one worker-parent level. |
| `Backspace` | Return one worker-parent level outside editors, filters and details. |
| `Shift+F` | Return to this panel's bound owner and its Overview, clearing pin/inspection state. |
| `p` | Toggle pin; holds the inspected conversation. |
| `u` | Toggle Self + jobs / Subtree resource and usage scope. |
| `/` | Edit the case-insensitive filter for Agents, Processes, Messages, Refs and To-do; Enter/Escape finishes, Backspace edits it. The owner remains visible in Agents. |
| `y` | Request copy of the full selected value/text. In a termination dialog it instead confirms the captured target. |
| `s` | Open the exact source message when the entry has one. |
| `,` | Read settings. |
| `e` | Write a redacted diagnostic export to private server state and show its path. Includes availability/counts/counters, excludes Notes, message bodies, raw IDs and paths. |
| `q` / `Ctrl+C` | Close the current panel. In a confirmation dialog these cancel first. |

Each list and subpanel stays inside terminal bounds, has its own scroll
position and uses alternating entry bands in color themes. Long entries have
one action arrow, on the first line. Dark, light, mono and ASCII modes retain
textual meaning; native Herdr cards cannot use the inspector's alternating bands.

## View-specific controls

To-do parsing accepts `ACTION: item` lines, optionally prefixed by `-` or `*`,
outside code fences in a complete assistant message. Each report is a complete
replacement list, up to 200 items; a lone `ACTION: none` explicitly clears it.
Empty items or mixed clear/item reports are rejected. Arbitrary prose, ordinary
Markdown checklists and inter-agent messages do not establish an ACTION list.
If one item contains exactly one backtick command, `y` copies that command;
otherwise it copies the item text. This never executes the command.

| Context | Input | Effect |
| --- | --- | --- |
| Agents | Displayed number then Enter | Inspect that captured displayed target. Prism numbers are independent of Herdr's native focus indices; Escape cancels the numeric prefix. |
| Agents | `f` | Explicitly focus a verified live native pane; recorded-only workers report no live pane. |
| Agents | `Space` | Fold descendants, or expand a leaf's facts. |
| Agents | `w` | Switch lineage/worktree grouping within this owner's tree. |
| Processes | `Space` | Fold/expand process children. |
| Processes/detail | `Shift+K` | Open termination confirmation with Cancel selected. Enlarge a tiny pane to review and confirm. |
| Process detail | `r` | Refresh retained Output, only while the owning process/view still passes verification. |
| Messages | `Space` | Expand/collapse a selected message preview inline; Enter opens full message/tool details. |
| Messages | `b` | Load older retained messages. |
| Refs | `Space` | Open target mention history; on a mention, open its exact source. |
| Refs/mention history | `b` / `Shift+B` | Load older targets/mentions or restart history from newest. Changed transcripts mark retained pages stale and invalidate old cursors. |
| To-do | `x` | Check/reopen selected local item. |
| Notes | `Enter` or edit arrow | Start editing this owner's Markdown. |

## Notes editing

`q`, `p`, `/`, `?`, numbers and spaces are literal text while editing. Arrows,
Home/End, Backspace/Delete and bracketed paste edit Markdown. Mouse wheel reads
other parts of the draft without moving the caret; a subsequent editing key
brings the caret back into view. Pasting more than 1 MiB is refused in full.

| Input | Effect |
| --- | --- |
| Pause typing | Autosave after 500 ms. |
| `Ctrl+S` | Save immediately and continue editing. |
| `Escape` | Save and return to reading. |
| `Tab` / `Shift+Tab`, click another view | Save and switch views. |
| `Ctrl+C` | Save and close this panel. |

When too small to display the editor and caret, text editing pauses until the
pane is enlarged. Follow also pauses during editing, retaining the captured
owner even if it disappears. A newer external save stays intact; the conflicting
draft goes to a separate recovery file whose path is available through `?` after
editing. Notes are private files on the collecting server, outside the code
checkout; they are neither sent to the model nor copied into diagnostic exports.

## Evidence and action boundaries

CPU 100% means one logical core; aggregate usage can exceed 100%. Resident memory
is RSS on Unix and working-set sum on Windows; shared pages may be counted by
several processes. Charts cover the observed period, up to 15 minutes, with
the newest sample at right and adapt to the allocated panel width. Each measured
reading forms a step until the next sample, for at most five seconds. Unavailable
readings and explicit collection gaps stop the step. CPU and memory details include scale, sample time, scope and
coverage; memory scale is its observed chart peak, not host-memory percent. Unreadable or
warming-up processes produce partial/lower-bound coverage; `—` is unavailable,
`0` is measured zero and cached values carry age. Subtree includes recorded
descendants only. Detached/shared jobs need verified ownership, not a guessed cwd.

Token/cache/turn/context counters retain provider semantics. Generation rates
require a sourced generation interval; model epochs and incomplete pricing remain
explicit. Costs use configured rates, not an inferred bill. Account limits need
recent supported client reports; Codex transcript quota fields work automatically,
Claude uses its optional status-line reporter, and unsupported/missing reports
hide the block. Quotas are never added across agents. See [provider coverage](provider-compatibility.md)
and [account setup](../README.md#account--limits-in-overview).

Output is a snapshot of the verified owning harness's **shared terminal**, up to
200 retained lines / 64 KiB. It may include harness UI and other jobs; Prism
cannot retroactively recover uncaptured output or tap a running process's pipes.
Logs/artifacts are readable when provided as accessible references/tool results;
they are not a universal per-PID stdout feed. Captures are not archived.

Termination targets only the captured PID: SIGTERM on Unix or termination on
Windows, with no child/group signaling or escalation. `Escape`, `n`, `q`,
`Ctrl+C` or Enter on Cancel aborts; select Terminate then Enter, or `y`, confirms.
The server rechecks visibility, birth/boot identity and ownership, rejecting
stale/inaccessible targets. Killing the harness can end the agent. The portable
PID signal call still has a last-moment identity race. Demo mode never signals.

Opening a reference uses the collecting host's default opener only for supported
HTTP(S) URLs or absolute paths, after explicit selection. Remote file opening
does not fall back to a similarly named client file; clipboard forwarding depends
on Herdr's foreground client. Collection stays local to each server, with no
analytics/backend or automatic transcript upload. See [remote limitations](remote.md)
and [privacy and storage](privacy.md).

## Native owner cue

Focusing a Prism sidebar retains a bold cyan name and `>` marker on its owning
agent in Herdr's left Agents list. The cue follows the bound native owner while
you inspect workers; it does not move keyboard focus away from Prism. The full
card selection background remains Herdr's native-pane focus indicator.
