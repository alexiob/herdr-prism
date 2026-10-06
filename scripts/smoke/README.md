# Required terminal smoke

Run `npm run build` followed by `node scripts/smoke.mjs`. This is an actual terminal test of the compiled inspector’s disposable `--demo` mode. It does not connect to Herdr, read provider homes, or change user configuration.

On macOS/Linux the harness uses Python’s standard-library `pty.openpty`, validates the terminal descriptor, sets the real window size with `TIOCSWINSZ`, and notifies only the isolated child with `SIGWINCH`. On Windows a fixed PowerShell `Add-Type` harness uses `CreatePseudoConsole`, an attached `CreateProcessW`, and `ResizePseudoConsole`. It reads the ConPTY output pipe on a dedicated thread and places the suspended child into an owned kill-on-close job before resuming it. Application paths are explicit argv/quoted process arguments, never shell expressions.

The smoke requires alternate-screen startup, Tab changing the active view, Down and Up arrows producing fresh selection frames, real terminal sizes 80×24 → 26×12 → 80×24 with corresponding layout repaints, `q` restoring the terminal, child exit status 0, and output EOF. Captures and timeouts are bounded. Every failure cleans up the disposable child; no unavailable capability is replaced with a stdout-only rendering. Missing Python, ConPTY, the compiled inspector, or a denied terminal API makes the required command fail.

Success emits JSON containing the real transport, keyboard/resize/lifetime evidence, sizes and captured byte count. The four booleans summarize assertions made by the native harness, not inferred platform support. This proves the demo terminal interface; live Herdr focus/placement and process sampling have separate platform gates.

Regression tests reject a one-shot stdout fixture and a deliberately unresponsive interactive child, then verify that the latter was reaped. After building, run `HAT_PTY_TESTS=1 node --experimental-strip-types --test test/smoke.test.ts` to include the complete terminal test. The required CI command always runs the complete smoke regardless of this optional unit-test flag.

Local 2026-10-06 evidence: the Unix PTY test first failed the 26-column repaint, exposing the demo entrypoint’s missing resize listener. After the entrypoint fix and rebuild it passed with all keyboard/resize/exit/EOF assertions, including a negative child-timeout cleanup test. The fixed C# ConPTY source also compiled against the installed local .NET reference assemblies with zero errors; that is a syntax/type check, not Windows execution. The actual Windows ConPTY run remains a required Windows CI gate.

Primary platform references: [CreatePseudoConsole](https://learn.microsoft.com/en-us/windows/console/createpseudoconsole), [ResizePseudoConsole](https://learn.microsoft.com/en-us/windows/console/resizepseudoconsole), [pseudoconsole process lifetime](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session), [Windows job lifetime](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
