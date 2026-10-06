# Windows x64 validation, 2026-10-06

## Windows installer shortcut

The standalone installer now configures `prefix+i` (default Ctrl+B, then I)
for `iob.herdr-prism.open`, including when Prism is already installed. Herdr
0.9.3's default `prefix+p` and `prefix+shift+p` remain untouched. Existing config
bytes, ownership and ACLs are preserved through exclusive in-place append with
an original-file backup. Conflicting bindings and unsupported TOML string forms
are skipped; reruns are idempotent.

Six focused installer tests passed on both Node 22.23.3 and 24.21.0, including
custom/built-in conflicts, escaped and multiline strings, BOM/CRLF/ACL preservation,
idempotence, and a 40 KiB configuration. TypeScript checking passed. A disposable
Herdr 0.9.3 server starting without Node completed fresh pinned Node setup,
standard GitHub installation at `2e68d55`, shortcut creation, and configuration
reload with zero diagnostics. The actual existing installation likewise accepted
the shortcut and a second run added nothing.

The initial shortcut release still depended on the launcher's Node PATH; even
restarting Herdr from an older shell retained `program not found`. The installer
now binds all recognized Prism Node commands to the verified executable in the
Windows installed manifest, including replacing an earlier absolute Node path
on rerun. It also repairs the exact legacy installed `openPanel` return sites to
await opening before RPC cleanup; shared repository sources remain untouched.
Original installed files are backed up and their ownership/ACLs preserved.
Seven installer tests passed on Node 22/24. Fresh installation against an already
running, Node-less disposable Herdr server now executes `doctor` successfully
without restarting the server. The actual installation's `open` action succeeded
and displayed Prism; repeated opening also succeeded. The older restart advice
is superseded by these Windows installed-copy repairs.

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
- ConPTY quit could restore the screen but leave a paused Windows TTY read
  alive. The interactive pane now restores raw mode, pauses and closes its owned
  Windows input stream. Unix input handling is unchanged. Thirty consecutive
  real ConPTY smoke runs passed; the regression also requires clean exit,
  restored raw mode/screen and output EOF within the original deadlines.
- A cold CI ACL worker timed out during ordinary GitHub activation. Requests
  now wait for a fixed readiness marker after PowerShell initializes its UTF-8
  reader. A controlled delayed-reader regression failed before the handshake
  and passes afterward. Startup remains inside the original 15-second deadline;
  paths remain literal JSON data and failures still close the owned worker.
  The handshake alone did not resolve the Node 24 CI activation timeout in
  [run 37465418338](https://github.com/alexiob/herdr-prism/actions/runs/37465418338):
  nine jobs passed, including Windows Node 22 and all eight Unix jobs; Windows
  Node 24 passed strict/ConPTY/live/advanced gates before this failure. The
  follow-up uses explicit UTF-8 readers/writers on redirected standard pipes,
  avoiding process-wide console encoding changes. Timeout diagnostics distinguish
  reader startup from response wait. Final runner evidence is recorded below;
  the historical failure is not treated as a passing run.
  Receipt diagnostics in run 37469353206 proved the request reached the worker
  and stalled inside inspection. Production now uses direct .NET Framework
  filesystem-security and typed JSON APIs, eliminating cmdlet/module pipelines.
  All strict policy fields and Node validation remain unchanged. Both Windows
  jobs subsequently passed in run 37472767803, including Node 24 ordinary
  GitHub install/reinstall/restart/disable/uninstall acceptance.
- CI also exposed a temporary Windows delete-sharing lock during lifecycle
  acknowledgement replacement. A real `FileShare.Read` fixture reproduced the
  same `EPERM`. Windows replacement now makes at most five attempts with
  375 ms total backoff, preserving the original file and rechecking the caller's
  authorization before every attempt. Other errors and Unix behavior are
  unchanged. The actual-lock regression passes with strict final ACLs.
- Windows lifecycle acceptance now captures each owned collector's exact native
  birth identity before restart/removal. A different readable birth can prove a
  numeric PID was recycled. Missing sampler records still require `ESRCH`;
  unreadable identities cannot certify cleanup. PID recycling is a possible
  cause of the earlier numeric-PID assertion, not an established diagnosis.
- A local Windows Node 22 run also reproduced `ENOENT` when an owner released
  the admission file between `EEXIST` and inspection. Windows admission retries
  only the exact missing lease path through guarded `create:false` acquisition
  inside the original deadline. Missing state directories still fail immediately;
  Unix code paths are unchanged. The same release race appeared in a macOS
  arm64 Node 22 CI job; its implementation remains with the other machine.

## Executed evidence

Before the final clock correction, both Node versions passed 253 tests with
zero failures and two Linux-only skips, including required ConPTY. The merged
source added remote regressions: Node 24 passed 258 with zero failures and two
skips. One merged Node 22 run exposed an intermittent ConPTY quit hang, which
was also reproduced independently; retain that failure when evaluating later
successful runs. Final results are recorded in the progress ledger.

After both corrections, Node 22 and 24 each passed 260 tests, zero failures and
two Linux-only skips, with native sampler, named pipes and ConPTY required.
Both also passed staged live lifecycle and advanced feature acceptance. Actual
host-clock metadata expiry was 15,063 ms and 15,010 ms respectively. These runs
preceded merging the other machine's mouse-disclosure and pane-order commits;
the final delivery evidence records the subsequent merged verification.

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

Final implementation `5e9f4b1a568b444f1b99654aa26b8540103665f1` merges the
other machine's `7fc637e` reference-history work, including the earlier pane-order
and mouse-disclosure changes. Its implementation is preserved; three test path
expectations were made portable. Both Node majors passed the merged 275-test
suite: 273 passed, zero failed, two Linux-only skips.
Typecheck/build and the staged distribution checks passed. Both Node majors
also passed final staged live lifecycle and all advanced feature checks after
the explicit pipe-reader change.

Ordinary GitHub installation of that exact pushed commit passed on both Node
22.23.3 and 24.21.0: normal clone and committed-helper preflight, authenticated
activation, deactivation/reinstall/reactivation, explicit restart with old pane
cleanup, disable/enable, and ordinary uninstall. Disposable harness cleanup
completed on both majors. Capability-only durable evidence is
[windows-2026-10-06.json](evidence/windows-2026-10-06.json); detailed local
proofs are in `artifacts/windows-delivery-*`, `artifacts/windows-pipe-*` and
`artifacts/windows-replacement-*`, `artifacts/windows-reference-merged-*` and
`artifacts/windows-complete-*`.

Herdr 0.9.3 requires explicit activation, safe
deactivation before reinstall/disable/uninstall, and retains private config/state
on ordinary uninstall. The authenticated wrapper supplies complete removal.

The isolated harnesses use disposable servers, configurations and synthetic
provider homes. They do not certify paid provider versions, native sidebar
pixels/themes, exact multi-client visibility, performance budgets or long soaks.

## Final CI

[Run 37474269213](https://github.com/alexiob/herdr-prism/actions/runs/37474269213)
passed all ten jobs on implementation `5e9f4b1`: both Windows Node 22/24 jobs
and all eight macOS/Linux jobs. Windows jobs exercised strict native/socket
tests, required real ConPTY, helper distribution, live install/restart/complete
removal and advanced interactions. Windows Node 24 also passed the pinned
ordinary GitHub lifecycle gate; both majors passed that flow locally.

Historical failures above remain part of the evidence. The final Windows
admission retry is platform-scoped; macOS/Linux and general feature
implementation remain with the other machine.

## Windows bootstrap installer

`scripts/install-windows.ps1` runs standalone through `irm <raw-GitHub-URL> | iex`.
It checks Herdr 0.9.3+, reuses supported Node or installs official Node 24.21.0
under the user profile with pinned archive and executable SHA-256 checks, and
uses Herdr's normal installation command. Existing plugins are left in place.

Local Node 22/24 installer tests passed for version boundaries, corrupt archive
refusal and preserving a different existing runtime. Fresh extraction/reuse of
the verified archive passed. User PATH updates were checked for deduplication
and unchanged machine PATH. An isolated Herdr session started without Node
successfully installed Prism after bootstrap; its retained server environment
still failed to launch a Node action, confirming the documented restart
requirement. The harness used a verified cached archive and a process-only PATH
override to avoid modifying real user settings. Proof:
`artifacts/windows-installer-proof/acceptance.json`.

The current-session activation failure was likewise an old server PATH, not a
plugin build failure. A user-authorized activation through the verified absolute
Node executable opened the real right pane without stopping existing agents.
Normal actions in that already-running server need an environment refresh via
a convenient restart; the installer never silently stops the server.
