# Prism terminal UI redesign

The user wants a monitor that can be scanned and navigated quickly. The current
native sidebar and inspector mix long prose, identifiers, counters and
definitions at the same visual weight. The new presentation uses btop's titled
regions and restrained resource charts, htop's aligned process columns, Radar's
session context, agent-panel's content tabs, and diskwatch's responsive summary
and detail views. This is an existing terminal UI, implemented in TypeScript;
no browser framework or new runtime dependency is needed.

## Interaction contract

- Every selectable entry has context-specific help, opened by `?` for the
  selected entry. Enter never opens an explanation of a metric.
- A right arrow marks every entry whose Enter action opens a detailed view,
  another tab, or the corresponding agent's inspector.
- Overview Processes, Agents, Messages, Refs, To-do and Git summaries open their
  corresponding tabs. CPU, memory, usage and work entries open their full facts.
- Navigation within Prism does not move focus to another Herdr terminal. `f`
  explicitly focuses a pane-backed agent; transcript-only agents explain why
  that action is unavailable.
- Long rows present a meaningful summary rather than a clipped wall of text.
  The entire summary, essential numbers, selection marker and right arrow must
  fit. Enter opens full content, wrapped and scrollable. Full path identities
  and full goals remain available. Headers and footers have dedicated space.
- Tab/Shift+Tab switch tabs. Arrows/j/k select. Space folds trees. Escape returns
  from help/detail with selection and scroll restored. Existing reference
  history, exact source cursors, local To-do checks, filtering and copy remain.
- Numeric agent jumps refer to Prism's displayed agent targets, not an invented
  native Herdr focus index.

## Layout and color

The native left sidebar has four configured rows: agent identity and state;
explicit Goal/Task when reported; CPU and RSS/WS plus readable descendant count
and cached state; machine/workspace and branch with colored Git additions,
deletions and actual conflicts. Herdr owns native wrapping and navigation.

The right inspector has eight tabs: Overview, Agents, Processes, Messages,
Refs, To-do, Git, Notes. Git and Notes append to the existing six tab IDs.
Chrome displays title, provider/model/state, collecting server, scope and
Follow/Pinned. Tabs remain discoverable at narrow widths. The footer displays
contextual controls and data freshness separately from content.

Overview uses Work, Resources, Usage, Checkout and Activity regions. At 36/50
columns these stack; at 80/120 they use two balanced columns. Other tabs use
tables or restrained content rows. Unavailable values show `—`; measured zero
shows `0`. CPU 100% means one logical core and can exceed 100%. Memory uses
RSS/working-set sums, not a fabricated percentage. Gaps stay gaps. Coverage,
provenance, timings, peak definitions, cost/cache semantics and retained-window
limits are accessible in details and help.

Process, scope-coverage and reference detail views use aligned label/value
columns with different semantic styles. Process facts group Identity, Resources
and Ownership; scope facts group Selected scope, Readable samples and Aggregate
readings; ref facts group Reference target and Recorded facts. Full paths wrap
at directory boundaries, and explanatory metric prose stays in `?` help.

Apply that structure consistently to memory, CPU, usage, Git and timing details.
Highlight by data type: quantities blue, identities/branches lavender, paths
teal, durations warm gold, units quieter than numbers, unavailable values amber,
and Git deltas green/red. Preserve textual labels and unavailable markers in
mono mode. At 80/120 columns use related regions in two columns, stacking at
36/50. Keep narrative content complete and place metric explanations in help.

Palette roles: text, secondary, border, one cyan accent, green additions,
amber stale/wait, red deletions/errors. Default terminal background; selectable
rows use a subdued background and a visible marker. Dark/light/mono and ASCII
must remain legible without color as the only signal.

## Notes

Notes are private Markdown files owned by the collecting server and canonical
provider/session identity. Enter edits, Escape exits editing, Ctrl+S flushes,
and edits autosave after 500 ms. Printable navigation keys insert text while
editing. Bracketed paste, Delete/Home/End and multiline cursor movement work.
Follow is held while editing so a draft cannot retarget another agent. Flush on
edit exit, tab/session switch and graceful close. Revision checks preserve
newer external edits and a recoverable draft on conflicts. Upgrades preserve
notes; complete owned-state removal deletes them. Notes do not enter exports,
transcripts, native tokens or telemetry.

## Review and delivery

First provide a terminal gallery with synthetic data for all eight tabs, the
native sidebar, contextual help and full detail. Label it a design preview,
not live telemetry. The user explicitly requested printed designs to evaluate
and iterate together. Keep the preview runnable and exportable at 36, 50, 80
and 120 columns. Product reimplementation follows this concrete reviewable
design; preserve collection cadence and upstream host API constraints.

Verify geometry, full summary visibility, Unicode widths, arrow/help actions,
selection/scroll restoration and draw/hitbox agreement. Verify Notes restart,
conflict, autosave and follow holding. Re-run reference paging, visibility and
owned native configuration tests. Windows-specific fixes/live validation remain
with the other machine. Computer-use screenshot capture is currently blocked
by the compatibility symlink in the workspace root; terminal output and PTY
proofs must not be described as native sidebar pixel certification.
