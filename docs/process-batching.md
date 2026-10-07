# Process collection and batching

Herdr Prism's Rust helper already collects the host process list in one OS batch per `sample` request. The protocol remains the existing bounded `sample\n` command and version 1 JSON response. Linux uses the TypeScript `/proc` sampler by default; its host scan reads stat files in bounded groups. This change does not change installation or select a different Linux sampler.

## Implemented attribution and aggregation

`ProcessTracker` verifies roots against the fresh process batch using PID, birth identity and boot identity. It resolves each process's nearest verified harness or validated launch ancestor once per batch, memoizing both attributed and unattributed ancestry. Birth ordering rejects a reused parent PID; cycles do not create ownership. Previously observed detached processes retain only their own exact identity associations. Remembered ownership does not turn a detached process into a root for newly appearing children.

After attribution, one pass creates a private index per owner with processes, unreadable PIDs, readable counts, complete CPU counts and RSS sums. Panel views visit the requested owner indices rather than repeatedly filtering every owned process and reparsing RSS counters. Subtree owner sets are deduplicated; processes retain batch ordering. Returned process snapshots are copies, so a consumer cannot modify the next CPU baseline.

CPU still requires two readable observations of each required process, compatible boot and helper clock epoch, increasing monotonic time and nondecreasing CPU counters. A new compiler process can make the complete aggregate unavailable while every RSS reading is present. If some owned processes already have valid CPU deltas, `cpuLowerBound` records their sum and the UI displays `≥`; a first sample with no measured deltas stays unavailable. History retains lower bounds separately from complete measurements and labels partial observations. RSS/working-set totals include the harness and every verified owned process.

## Shared native-card collection

The collector reuses one host batch for visible-panel telemetry and a separate native-card tracker. Native cards show each live agent’s Self + jobs total, rather than only its harness. Independent baselines keep opening, hiding or switching a right panel from resetting native CPU measurements. When no inspector is visible, the process batch runs at most every five seconds; no background transcript bodies or Git status/diff scans are loaded. Native root proofs expire within five seconds and still require exact occupant, boot and birth identities.

Read-only measurements during concurrent compilation on macOS found a Claude harness at 4.70% while its verified jobs totaled at least 102.57%, and another at 2.42% versus 192.36%. The same host batch collected 1,033 processes in 6.25 ms plus 0.67 ms encoding; another collection took 3.42 ms plus 0.63 ms. These are observed intervals, not performance guarantees or host-wide attribution claims. Unassociated compiler trees stay unattributed.

## Native timings and recovery

New Rust responses optionally include `timings.collectionNs` and `timings.serializationNs` as decimal strings. Collection timing covers the OS sampler call. Serialization timing covers encoding the process and error payloads; it excludes the stdout write and small outer envelope formatting. Older responses remain valid. Node validates bounds and exact wide counters.

The Node supervisor retries only helpers that it spawned. Defaults allow at most three restarts per minute, with a one-second cooldown. Failed helpers receive termination and a bounded forced-termination fallback; close waits for all owned helper children. Packaged helpers are checked against their pinned checksum again on each start. Recovery does not signal observed agents or compiler jobs.

Each owned helper start gets a new `clockEpoch`, because its relative monotonic clock restarts even when the OS boot and process birth identities remain unchanged. The first sample after restart warms CPU again; ownership and memory can remain usable. During timeout, cooldown or exhausted retry budget, metrics remain unavailable or stale according to the collecting runtime.

## Synthetic benchmark

Run from the repository root:

```sh
node --experimental-strip-types scripts/benchmark-process-tracker.mjs
```

The fixture has 64 sessions, 6,144 stable synthetic compiler processes, depth 96, and 12 measured polls. Every poll checks exact per-session process coverage, RSS totals and available second-sample CPU. Timings cover attribution/index creation and producing all 64 panel views; they exclude OS collection and raw batch construction.

Measured on macOS arm64 with Node 26.10.0:

| Implementation/run | Update median | Update p95 | All views median | All views p95 |
| --- | ---: | ---: | ---: | ---: |
| Before | 61.23 ms | 82.75 ms | 5.35 ms | 6.68 ms |
| After, concurrent development | 18.58 ms | 71.41 ms | 0.456 ms | 3.71 ms |
| After, independent quieter run | 8.91 ms | 13.21 ms | 0.435 ms | 1.48 ms |

These are synthetic attribution measurements, not a claim about whole-plugin CPU or actual compilation throughput. Scheduling and garbage collection affect the tails. A regression also bounds identity inspections for a reverse-ordered 600-process chain; the earlier implementation made 540,902 inspections, while the new path stays below 9,000.

The current Rust payload encoder has a separate manual benchmark:

```sh
cargo test --manifest-path native/sampler/Cargo.toml payload_encoding_benchmark -- --ignored --nocapture
```

On the same host, its development/test build encoded 6,144 synthetic processes in a median 7.29 ms (p95 9.56 ms), producing about 1.15 MB. This is a diagnostic baseline, not a before/after Rust optimization or release-build measurement. The encoder still builds intermediate process strings; a future single-buffer encoder can be measured separately.

## Future optional Rust agent digests

Native per-agent ownership and CPU aggregation are **not implemented**. Moving them into Rust requires more than summing process counters: Node currently owns verified native attachments, validated launch associations, detached ownership and visibility transitions. The measured Node index avoids that protocol coupling while preserving current proofs.

A future optional protocol can advertise `agent-digests-v1` after a plain response. Only after that advertisement would Node send a bounded ASCII root list: at most 2,048 root hints and 64 KiB per command. Numeric request-local tokens would identify owners; session IDs, paths and transcript content would never enter that command. Old helpers would continue receiving plain requests.

The helper must validate hinted PID/birth pairs against its new OS batch and honor all known harness roots as attribution boundaries. Digests would retain the raw identity fields needed for process details and termination proofs, report complete/partial coverage, and preserve wide counters. Node must validate response caps, token membership, aggregate consistency and exact equality between requested hints and freshly verified roots/launch proofs. Any new, missing, reused or changed root makes that batch use the TypeScript fallback. Previous cached root proofs are hints, not authority. Counter reduction must also remain compatible with helper clock epochs, CPU warmup, denied processes, shared roots and remembered detached processes.

That proof boundary needs dedicated parity tests and a separate benchmark before a Rust digest can become an active path. The current implementation adds no command protocol, dependency or native installation change.
