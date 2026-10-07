# Update acceptance

Run the actual-platform update regression against a reviewed, checksummed release and an existing Herdr binary:

```sh
node scripts/live-update-test.mjs --release artifacts/release --herdr /absolute/path/to/herdr --proof artifacts/live-update-proof
```

The test starts two named servers under private temporary configuration, data and state roots. It clears inherited `HERDR_*` variables, creates synthetic Pi-shaped sessions and notebooks, and binds every fixture manifest command to the executing Node binary. It does not download an update, build source, change the supplied release, or contact the user's running server.

The real `prepareCodeReplacement` and `updatePrism` engines must preserve six notebooks, a conflicting editor draft, four open panels, two closed panel records, each target's exact width and UI preferences, native mode, shortcut opt-out, and the original native or plugin focus. The test repeats the update, injects an activation exit to verify rollback of code and state, reruns `install.sh` or `scripts/install-windows.ps1` against the private reviewed source, and updates a disabled registration without starting collectors or panels. It uninstalls only its managed fixture afterward.

`update.json` contains synthetic checks and notebook byte counts, revisions and relative paths; it does not include notebook bodies. Failure evidence includes only the isolated servers' snapshots and plugin logs. CI runs the fixture after panel acceptance on every supported operating system and both Node versions, retaining proof even on failure.

The old and new fixture releases use the supplied compiled runtime with different checksummed markers. This proves replacement and rollback, not compatibility with an arbitrary historical state schema. Network download, GitHub source resolution and fresh-install bootstrap behavior have separate acceptance tests. Headless server results do not certify graphical client rendering.
