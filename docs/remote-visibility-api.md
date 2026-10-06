# Host API needed for exact visible-pane collection

Herdr 0.9.3 keeps client surface interest and per-client displayed tabs internally.
Its public snapshot exposes only the server's focused workspace/tab/pane.
Prism cannot infer attached viewers from that snapshot. This proposal is a local
design artifact; no upstream issue or message has been submitted.

The user chose to keep this API as an **upstream dependency**. This pass does not
patch Herdr or require a fork. Exact background-machine/last-viewer pause remains
pending until a supported upstream release exposes the required facts.

## Proposed contract

Expose a read-only `pane.visibility` query, or equivalent optional snapshot data,
with the current server boot identity, observation revision and a set of terminal
identities visible to at least one active attached presentation client. Public
pane IDs may accompany terminal IDs for convenience. Include tiled panes and
displayed plugin popups/overlays; exclude panes hidden by zoom, inactive tabs,
background saved-machine connections and inactive surface leases. Count an
unfocused side panel as visible. Do not expose client credentials or SSH targets.

Return an explicit known-empty set when no viewer remains. Unsupported or failed
queries must be distinguishable from that empty result. Emit a subscribable
visibility-change event for client attach/detach, surface activation/deactivation,
workspace/tab changes, pane moves/closes, zoom and overlay changes. A revision
with a snapshot lets collectors reconcile lost events and avoid a read/subscribe
gap. The query must not acquire presentation interest or count the querying
plugin's API connection as a viewer.

The server already has the relevant internal information:
[surface leases](https://github.com/herdrdev/herdr/blob/v0.9.3/src/server/headless/surface_interest.rs),
[active client views](https://github.com/herdrdev/herdr/blob/v0.9.3/src/server/headless/client_views.rs),
and [the current snapshot boundary](https://github.com/herdrdev/herdr/blob/v0.9.3/src/api/schema/session.rs).
A host implementation should reuse those facts, including multiple clients,
rather than consulting shared server focus alone.

## Prism integration

Negotiate the supported method/schema on the connected server. Permit heavy
collection only for the selected session while the exact inspector terminal
identity is in a fresh known visibility set. Suspend sampling, transcript body
reads and Git jobs on a known-empty set, lost subscription or failed query; retain
bounded stale results. Keep lightweight inventory/TTL reconciliation available.
Recheck the visibility generation before each heavy stage and after awaits, so a
late response cannot reopen a hidden collector. On resume, warm up CPU counters
and hydrate only the displayed session. Boot changes invalidate viewer and
process identity proofs before reconnect recovery.

Support on unmodified 0.9.3 must remain explicitly partial; a new method cannot
be fabricated in Prism's pinned protocol schema or claimed to exist upstream.

## Acceptance

1. With a visible, unfocused right inspector, selected-session heavy work runs;
   another selected machine pauses it while both servers/agents keep running.
2. Last viewer disconnect yields a known-empty set and pauses heavy work. SSH
   reconnect resumes the same server/session without substituting local data.
3. With two clients viewing different tabs, the inspector stays active if either
   client can see it; it pauses only when neither can. A metadata-only background
   connection does not keep it active.
4. Zooming a different pane hides the inspector; showing the inspector or its
   full detail popup restores the appropriate scope. Moves and pane replacement
   use exact terminal identity.
5. Lost events, API timeout and server boot replacement suspend heavy work until
   an authoritative fresh visibility snapshot is reconciled.
6. A hidden transition during transcript/Git/process awaits starts no later
   heavy stage. An already running bounded child is drained/cleaned safely.
