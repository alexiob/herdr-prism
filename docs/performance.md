# Performance and responsiveness

Prism uses one collector per Herdr server. Adding a sidebar adds a terminal UI
process; it does not add another host process sampler or provider index.

## Scheduling and avoided work

- Native inventory and panel records are cached centrally. Lifecycle events are
  coalesced for 100 ms; maintenance also rechecks inventory every second.
- Dashboard projections are cached by data revision and scope. Unchanged replies
  carry freshness and visibility metadata without another full dashboard body.
- The focused Prism sidebar polls every 500 ms. Other visible sidebars poll every
  second. Hidden sidebars keep a 500 ms visibility heartbeat, omit subsequent
  dashboard bodies and suspend rendering entirely. Returning to their tab resumes
  rendering and requests current content.
- Transcript bodies, detailed Git, references and frequent resource collection
  follow the union of visible selections. One shared host process batch supplies
  verified per-agent harness and owned-job totals. Background native cards retain
  a slower shared batch and lightweight cached checkout identity.
- Background paints coalesce the rendering work itself, rather than rendering and
  then discarding frames. Identical frames emit no terminal output. Local Prism
  input bypasses the background paint delay and cancels queued older frames.
- Fresh process identity, native occupant and visibility checks still run for
  process output and termination. A cached display is not authority to act.

Herdr 0.9.3 does not expose a reliable last-keystroke event for neighboring agent
panes. Prism uses native focus and actual pane/tab visibility to reduce work;
it does not infer typing from private input or terminal output. Sample warmup,
missing observations and stale sources remain explicitly labeled.

## Measured multi-panel overhead

Measured on 7 October 2026 using macOS arm64, an Apple M1 Max with ten logical
cores, Herdr 0.9.3 and Node 26.10.0. The baseline is commit `be34c14` before the
shared-view and rendering changes. CPU is the average percentage of **one core**;
RSS is median summed resident memory during each 8-second phase.

| Panels / visibility / workload | Prism CPU, before → after | Prism RSS, before → after | Internal snapshot RPCs, before → after |
| --- | --- | --- | --- |
| 8 / visible / idle | 62.42% → 16.29% | 1585 → 1035 MiB | 171 → 18 |
| 8 / visible / echo | 56.77% → 18.50% | 1614 → 1123 MiB | 163 → 16 |
| 8 / hidden / idle | 54.78% → 5.61% | 1636 → 1316 MiB | 164 → 17 |
| 8 / hidden / echo | 51.93% → 5.78% | 1645 → 1308 MiB | 167 → 18 |

Eight visible panels used about 74% less CPU in the no-input phase and 67% less
in the echo phase. Eight hidden panels used about 89% less CPU while echo traffic
continued. Snapshot traffic fell from 163–171 requests per phase to 16–18.
Memory improved, but eight separate frontends and one collector still have a
substantial resident footprint; these results do not establish negligible memory
use or a guarantee under arbitrary compilation and provider workloads.

The initial baseline covers all 14 cases for 0, 1, 4 and 8 panels in
`artifacts/interactivity-baseline/interactivity.json`. A full intermediate
optimization run is in `artifacts/interactivity-visibility/interactivity.json`.
The table above uses the final compiled build with responsive charts and the
additional metadata-only redraw suppression:
`artifacts/interactivity-ready-eight/interactivity.json`. Its four eight-panel
phases all passed. Before measurement, every visible panel was checked for its
own canonical owner/selected key, expected header/body and 200 retained messages.
Generated artifacts are local and excluded from Git; their checksums, system
context, tracked process identities and separate Herdr measurements are retained.

## Measured attached-client typing

Each row contains 100 paced single-key samples through an actual attached Herdr
TUI. The optimized core and client tests use the same exact compiled release.

| Panels / visibility | Key-to-grid p95, before → after | p99, before → after |
| --- | --- | --- |
| 8 / visible | 30.18 → 16.19 ms | 52.60 → 19.83 ms |
| 8 / hidden | 45.19 → 8.40 ms | 65.92 → 13.19 ms |

The successful baseline is
`artifacts/interactivity-client-baseline-eight/interactivity.json`; the final two
phases are in `artifacts/interactivity-client-ready-eight/interactivity.json`.
Both final core and direct runs verified panel content before measurement and
reaped their owned processes. The final consolidated comparison is
`artifacts/interactivity-ready-eight/comparison.json`.

Earlier 0/1-panel controls varied between runs: the Prism-off p95 was 1.94–4.07 ms,
and one-visible-panel p95 was 7.49–7.67 ms with noisier p99 tails. The eight-panel
results support an improvement in this tested scenario, rather than a blanket
latency improvement at every panel count or on every machine.

## Reproduce the comparison

Run these development tools from the repository checkout, not the installed
plugin directory. Create separate checksummed releases for the baseline and changed build. Use
`scripts/release.mjs` as described in [installation](install.md); output directories
must not exist. Run the same fixture sequentially for each release:

```sh
node scripts/benchmark-interactivity.mjs --release /absolute/release --proof artifacts/interactivity-proof --panels 0,1,4,8 --samples 100 --duration 8
node scripts/benchmark-interactivity.mjs --release /absolute/release --proof artifacts/interactivity-client-proof --panels 0,1,8 --samples 100 --duration 8 --client-only
```

The benchmark starts isolated synthetic Herdr sessions with private temporary
configuration, state, provider homes and a socket proxy. It sends input only to
its own synthetic panes and reaps its owned processes. It never sends keys to a
user's Herdr session. Choose distinct proof directories for each run.

The core fixture uses eight synthetic Pi-shaped native panes, 200 static messages
of 200 characters per agent, inspector-only mode and the Messages view. It tests
0, 1, 4 and 8 same-tab sidebars, then another tab with those sidebars hidden. Each
8-second phase sends 100 paced snapshot probes; echo phases also send 100 API
input/echo probes. A synthetic 960×50 terminal lets eight panels remain visible.
This isolates panel count rather than modeling an ordinary physical display.

CPU sums exact boot/PID/birth-matched collector, frontend and helper deltas; 100%
means one logical core. Herdr, synthetic agents and the benchmark driver are
separate. Resident sums include shared pages and do not measure unique physical
memory; short-lived or inaccessible processes can be missed. The socket proxy
counts Prism-to-Herdr RPCs and bytes, excluding benchmark probes and mailbox I/O.

The separate Unix attached-client test requires Python 3. It writes one printable
key per sample to an actual foreground Herdr TUI in a PTY and timestamps its
incrementing synthetic echo in the reconstructed terminal grid. This measures
local key-to-grid response, not screen pixels, model/network latency or Windows
ConPTY. API echo timings have a polling floor and are not a typing-latency claim.
The workload excludes native overview publication and live provider generation.
System load, runtime, hardware and release checksums are retained in each proof;
results describe this fixture and are not universal performance guarantees.

A smaller deterministic projection benchmark covers unchanged and 1 Hz changing
metadata without a server, OS sampler, rendering or mailbox fsync:

```sh
node scripts/benchmark-dashboard-projection.mjs --runtime-root /absolute/release
node --experimental-strip-types scripts/benchmark-dashboard-projection.mjs --source
```

For process ownership/indexing measurements, see
[process batching](process-batching.md). Full platform CI also exercises panel
visibility, independent ownership, update recovery and private state preservation.
