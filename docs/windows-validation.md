# Windows x64 validation, 2026-10-06

Windows work resumed locally on Windows 11 x64 (NT build 26200), using
checksum-verified portable Node 22.23.3 and 24.21.0, Rust MSVC 1.90.0 and
the checksum-pinned official Herdr 0.9.3 binary (protocol 22).

The Windows source fixes were committed as `077736a`, then merged with the other
machine's remote-support commit `f07281f` as `9c100f6`. Remote identity, selection,
native rank and clipboard changes were preserved; compiled ESM was regenerated
from the merged source.

## Reproduced failures and corrections

- Recursive directory creation protected only its leaf. Windows now creates and
  protects each missing intermediate separately. Existing directories still get
  verification only, including strict owner, protected DACL, non-null DACL,
  foreign-grant and reparse checks. The existing ancestor's ACL is unchanged.
- An unmapped inherited SID was removed by inheritance protection, then sent
  unnecessarily to `icacls /remove:g`, which returned 1332. The code reinspects
  the protected DACL and removes only surviving grants. Final strict verification
  remains mandatory; exact namespace authorization remains unchanged.
- PowerShell startup on every inspection exhausted the mailbox's existing
  500 ms deadline and delayed launch registration. A bounded readonly interpreter
  serializes fresh inspections using literal JSON path data. Its 64-request bound
  and 15-second deadline include queue wait; EOF ends the owned interpreter.
  No ACL result is cached. Mailbox and lifecycle deadlines were not increased.
- Real live restart intermittently read an empty exclusively created admission
  lease before its owner-record write. A controlled regression reproduced the
  same JSON failure. Empty leases remain uncertain ownership; admission waits
  within its existing deadline without reclaiming them. Malformed nonempty and
  live owner records retain their strict refusal behavior.
- The finite action could resolve Node while the pane's ConPTY PATH could not.
  Windows inspector and detail launches carry the already-running Node directory
  in their explicit pane environment. Unix launch parameters are unchanged.
- Windows native history could discard a positive measurement because Rust's
  wall timestamp was ahead of Node's lower-precision history clock. Windows
  history now dates receipt on Node's own timeline. Exact helper monotonic,
  process identity, memory and CPU counters are unchanged. A future-clock
  boundary regression fails before this correction and passes afterward.

## Executed evidence

Before the final clock correction, both Node versions passed 253 tests with
zero failures and two Linux-only skips, including required ConPTY. The merged
source added remote regressions: Node 24 passed 258 with zero failures and two
skips. One merged Node 22 run exposed an intermittent ConPTY quit hang, which
was also reproduced independently; retain that failure when evaluating later
successful runs. Final results are recorded in the progress ledger.

The merged staged release passed actual isolated live installation, authenticated
readiness, right placement and preserved native focus, explicit collector
restart, old pane/PID cleanup, and complete managed removal on both Node majors.
Five consecutive Node 22 lifecycle runs also passed after the lease correction.
Removal restored original config bytes, retained the original pane and removed
only authenticated owned namespaces and the managed installation.

Advanced live Windows acceptance passed on both majors: real synthetic provider
processes and metadata, right follow across tabs, pin, hidden pause/resume,
stale occupant rejection, collector close/restart, projection source guards,
foreign metadata preservation, and configuration-conflict refusal/recovery.
The portable Windows TTL fixture stops the owned periodic publisher gracefully,
publishes once through production `NativePublisher`, observes actual host-clock
expiry at about 15 seconds, and explicitly restarts publication. It neither
suspends a process nor uses a fake clock or clears the tested keys.

Rust's six native tests passed. Actual sampler tests measured controlled
one-core and multicore CPU, exact birth identities and working-set units;
five repeated Node 22 exact-session/multicore acceptance runs passed. Helper EOF
and foreground-parent-death teardown were exercised by the strict suite.

## Packaged helper

`bin/win32-x64/hat-sampler.exe` is the exact locally executed Rust 1.90.0
`x86_64-pc-windows-msvc` release artifact, with static MSVC CRT and matching
Rust library copyright plus all 12 toolchain license texts.

SHA-256: `606d61f8aa935e633638ccde01e8fa90ddc14350774ca2798e84ae6eeb0bd82c`.

Distribution checks validated the checksum, PE x64 architecture, normal and
delayed imports, compiled release integrity and system-only dependencies:
`KERNEL32.dll`, `ntdll.dll`, `api-ms-win-core-synch-l1-2-0.dll` and
`bcryptprimitives.dll`. The binary is an unsigned development artifact.

Ordinary GitHub installation results are recorded separately after the packaged
commit is pushed and tested. Herdr 0.9.3 requires explicit activation, safe
deactivation before reinstall/disable/uninstall, and retains private config/state
on ordinary uninstall. The authenticated wrapper supplies complete removal.

The isolated harnesses use disposable servers, configurations and synthetic
provider homes. They do not certify paid provider versions, native sidebar
pixels/themes, exact multi-client visibility, performance budgets or long soaks.
