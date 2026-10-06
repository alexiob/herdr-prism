# Resume Windows validation

Status: **Windows fixes and helper are pushed; Node 22/24 local acceptance and
all ten final CI jobs pass.
See [current Windows evidence](windows-validation.md).**
The recorded runner failures below are the historical handoff baseline.
The paragraphs below describe the original handoff, before the resumed Windows
fixes, local validation and runner retries on 2026-10-06.

Repository: [alexiob/herdr-prism](https://github.com/alexiob/herdr-prism).
Last Windows-tested implementation commit: `376d3a6b1453275485c6f52f34111d791612b6e9`.
The subsequent [remote-server amendment](remote.md) changes shared identity,
selection, native ordering and clipboard code, with macOS/Linux evidence. It
does not resume or resolve Windows validation. Use current main when resuming;
the failure logs below remain the exact Windows baseline.
Project/package: `herdr-prism`; plugin ID: `iob.herdr-prism`.
Stack: strict TypeScript, compiled dependency-free ESM and a Rust native sampler.
Keep exact client-visible collection as an upstream Herdr API dependency, as the
user chose; see [the host contract](remote-visibility-api.md).

Coordination: a separate Windows agent is now working on another machine. The
remote-support pass made no Windows-specific fixes or runner retries and has
stopped further edits. Fetch/rebase onto current main before continuing. Shared
changes include `src/runtime/collector.ts`, `src/runtime/server.ts`,
`src/entrypoints/inspector.ts`, `src/native/publisher.ts`, `src/tui/platform.ts`,
native row configuration and dashboard types/rendering. Preserve those changes
when integrating Windows fixes, then regenerate `dist/` from the merged source.
The added SSH harness's strict host-keyboard check remains incomplete; it is
separate from the Windows ACL/sampler/ConPTY work described below.

## Exact latest result

[Run 37450329250](https://github.com/alexiob/herdr-prism/actions/runs/37450329250)
passed all eight macOS/Linux jobs: both architectures on Node 22 and 24. They
include strict tests, PTY, distribution checks, live install/restart/complete
removal and advanced follow/pin/visibility/TTL/ownership checks. Linux Node 24
also passed exact-commit ordinary GitHub installation.

| Actual Windows Server 2022 x64 | Passed | Failed | Skipped |
| --- | --- | --- | --- |
| Node 22, job `112225060846` | 240 | 8 | 3 |
| Node 24, job `112225060640` | 241 | 7 | 3 |

Both Windows jobs passed native build/unit tests and TypeScript checking, then
failed the strict suite. Later compiled release, required successful ConPTY smoke,
distribution and live Herdr lifecycle steps were not reached. Do not treat them
as passing. The Windows helper is **not committed in `bin/`**; ordinary Windows
repository install therefore still fails its missing-helper preflight explicitly.

## Remaining observed failures

These are observed errors, not proven diagnoses. Reproduce locally before fixing
them; distinguish fixture construction from actual runtime admission behavior.

| Area | Observed failure | Files to start with |
| --- | --- | --- |
| Inspector validation/admission | Expected malformed-JSON failure instead encounters `DACL inheritance is not protected` | `test/entrypoints.test.ts`, `src/runtime/admission.ts` |
| Four lifecycle checks | Existing state-directory admission encounters the same inheritance-protection error, before expected restart/close/startup behavior | `test/lifecycle-races.test.ts`, `test/lifecycle.test.ts`, `src/runtime/lifecycle.ts` |
| Launch bridge removal | `collector removal during a live command…` expects true and receives false | `test/launch-bridge.test.ts`, `src/entrypoints/run.ts` |
| Mailbox | `echo: collector unavailable or response timed out` | `test/state.test.ts`, `src/state/mailbox.ts`, `src/state/store.ts` |
| Exact-session sampler, Node 22 only | No positive CPU value appears in the controlled session's CPU history; Node 24 passed this test | `test/native-sampler.test.ts`, `src/runtime/collector.ts`, `src/process/native-helper.ts` |

The admission errors involve existing intermediate state directories. Investigate
which directories each recursive creation actually creates and protects. Do not
make generic existing-directory admission strip permissions to hide the errors.
Mailbox/state writes currently invoke PowerShell ACL inspection; its effect on
real request timing should be measured rather than assumed.

## Corrections already present

- `src/config/safe-file.ts` validates structured user/owner/token-owner SIDs,
  reparse status, protected DACL, null DACL and foreign allow grants.
- Fresh artifacts or exact environment-validated Herdr plugin namespaces may
  normalize the creator's default owner. Generic existing paths remain immutable.
  Both raw environment and argument spellings are checked before canonicalization
  so a junction alias cannot bypass rejection.
- Separate literal `icacls` commands set the owner, protect inheritance/grant user
  access, and remove validated foreign grant SIDs. The current user is excluded
  and SIDs are deduplicated. Strict post-verification remains mandatory.
- Actual baseline [diagnostics 37449369685](https://github.com/alexiob/herdr-prism/actions/runs/37449369685)
  found explicit SYSTEM (`S-1-5-18`) and Administrators (`S-1-5-32-544`) grants
  surviving inheritance removal. The new actual Windows ACL regressions passed
  in the final strict suites. Astra reviewed the authorization boundaries.
- ConPTY explicitly initializes standard slots. Baseline diagnostics on both Node
  versions passed actual TTY/raw input, keyboard, resize, exit, EOF and owned PID
  cleanup with NULL or invalid slots; default inherited pipes failed TTY checks.
- `scripts/smoke/conpty-bootstrap.mjs` paints a saved-screen sentinel before the
  actual entrypoint. It preserves argv and real stdio/TTY behavior. The smoke
  driver requires the original sentinel to reappear after quit, measured raw-mode
  restoration, clean exit and EOF, rather than assuming alternate-screen escape
  bytes pass through ConPTY unchanged. The deliberate stuck-keyboard regression
  passed in the final Windows suites; the successful compiled-inspector smoke
  still needs execution.
- Linux Node 24 names its main thread `MainThread`. The advanced test now names
  only its explicitly synthetic Pi fixture `pi`; all Unix CI jobs passed.

## Reproduce on Windows x64

Use an actual Windows terminal and test both Node 22 and Node 24. Development
needs the Rust MSVC toolchain/build tools; ordinary plugin installation must not
require them. Run from the repository root in PowerShell, recording command exit
codes and retaining failure output.

```powershell
npm ci
npm run check
$env:RUSTUP_TOOLCHAIN = "1.90.0"
rustup toolchain install 1.90.0 --profile minimal --component rust-docs
cargo test --locked --offline --manifest-path native/sampler/Cargo.toml
node native/sampler/package.mjs
$env:HAT_SOCKET_TESTS = "1"
$env:HAT_REQUIRE_NATIVE = "1"
$env:HAT_NATIVE_HELPER = "native/sampler/artifacts/win32-x64/hat-sampler.exe"
npm test
npm run build
node scripts/smoke.mjs
```

Run the successful ConPTY smoke independently even when an earlier suite fails,
so it is not hidden behind CI's early exit. Narrow reproductions can use Node's
`--experimental-strip-types --test` with the files listed above. Optional owned
diagnostics are `scripts/windows-diagnostics/acl.mjs` and `conpty.mjs`; they write
capability-only reports under `artifacts/windows-diagnostics/`.

Once the tests pass, choose fresh output directories and validate an exact staged
release with the pinned Herdr 0.9.3 test binary:

```powershell
node scripts/herdr-test-bin.mjs
$proof = Get-Content artifacts/herdr-test-bin/source.json -Raw | ConvertFrom-Json
$env:HERDR_BIN_PATH = $proof.binary
node scripts/release.mjs --output artifacts/windows-resume-release --platform win32-x64
node scripts/check-distribution.mjs --root artifacts/windows-resume-release --platform win32 --arch x64
node scripts/live-herdr-test.mjs --release artifacts/windows-resume-release --proof artifacts/windows-resume-live
node artifacts/windows-resume-release/scripts/check-install.mjs --root artifacts/windows-resume-release
```

The harness uses its own server, settings, workspace and managed installation.
Preserve user sessions/configuration and unrelated plugin state. Full advanced
Windows acceptance still needs a portable metadata-TTL fixture; the current
advanced harness explicitly records that Windows stage as not run. Do not label
that partial run complete or silently skip required behavior.

## Finish Windows delivery

After actual Windows tests, ConPTY and live lifecycle pass, include the exact
validated `win32-x64` helper with its `sha256.json` and matching `rust-licenses/`
under `bin/win32-x64/`. Then verify ordinary
`herdr plugin install alexiob/herdr-prism`, explicit activation, safe reinstall,
enable/disable and deactivation/uninstall on Windows, plus the managed wrapper's
complete removal. Herdr 0.9.3 does not auto-activate on install or purge private
state on ordinary uninstall; retain the documented distinction.

Keep macOS/Linux behavior and privacy/ownership assertions intact. Add regressions
for demonstrated bugs; do not increase timeouts, weaken assertions, invent CPU
measurements or adopt foreign directories just to obtain a green run. Update
`docs/compatibility.md`, `docs/implementation-progress.md` and installation docs
with exact source/artifact evidence, then commit and push. The full original
specification remains `docs/design/herdr-prism.md`; broader performance/soak and
native-client acceptance gates are still open.
