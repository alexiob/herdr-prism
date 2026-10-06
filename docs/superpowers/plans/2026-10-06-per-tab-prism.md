# Independent Prism panels per agent tab

The user requires each agent tab to retain its own open/closed right panel.
Opening Claude must not remove Codex's panel; closing either view must leave the
other intact. Preserve one proven collector lease per Herdr endpoint, private
state permissions, shared checkbox/goals and verified complete removal.

1. Add a detached collector entrypoint and authenticated view operations, keeping
   existing collector ownership, admission and publication mechanisms. Serialize
   start through the existing lease; never reclaim a live or uncertain owner.
2. Add a remote collector facade for inspector views. Poll shared data with a
   bounded mailbox response; forward existing content/actions and visibility.
   Only the visible tab enables heavy sampling. View preferences live per tab.
3. Open/focus one registered Prism view in the target tab. Remove automatic pane
   relocation. Register stable terminal identities centrally; closing a view
   unregisters only that view. The collector survives a view closing.
4. Extend activation/deactivation cleanup to every recorded view and restore
   previously open views on activation restart. Preserve closed tabs as closed.
5. Add tests for independent panels, shared collector ownership, view close,
   tab-local selection/preferences and guarded complete removal. Rebuild shipped
   JavaScript and validate Node22/24 and Windows live Claude/Codex views before
   updating evidence/docs, merging latest main, committing and pushing.

Files: `src/runtime/collector-service.ts`, `remote-collector.ts`,
`src/entrypoints/collector.ts`, existing inspector/action/lifecycle entrypoints,
mailbox bounded response support, install artifact checks, relevant tests/docs.

Implementation completed: independent tab views and shared collector ownership,
per-tab preferences, all-view teardown/restoration, dead-owner recovery, bounded
loss-of-server shutdown and delayed-poll regression. Local Windows Node 22/24
acceptance is recorded in docs/windows-validation.md. Remote main's UI preview
work was fast-forwarded without altering its source implementation.
