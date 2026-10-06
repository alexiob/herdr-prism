# Optional Pi evidence companion

This extension is never installed or loaded automatically. Supply the compiled
`companion/pi/index.js` explicitly to Pi's extension loader (for example
`pi -e /path/to/companion/pi/index.js`). It has no external package dependencies.
Loading it registers `/prism-goal <objective>` and `/prism-parent <JSON>` commands.
The parent JSON is `{ "provider": "codex", "id": "exact-thread-id", "task": "Build parser" }`.
Only submit a parent relation when the session was actually delegated; ordinary
Pi forks are not delegation evidence.

The extension appends Pi `custom` entries with `customType` equal to
`iob.herdr-prism`. Their `data` is versioned (`version: 1`):

- Goal: `{kind:"goal", id, objective, status:"active"}`.
- Delegation: `{kind:"delegation", parent:{provider,id}, task?}`.
- State: `{kind:"state", state:"running"|"idle", parent?, task?}` on Pi agent
  boundaries. Explicit current-session delegation is repeated here so a bounded
  metadata reader can discover it without replaying unrelated message bodies.
  Session switches clear this context and restore only that session's saved facts.

The reader also accepts explicit version-one `usage` facts with `counterKind`
(`delta` or `cumulative`), `usage` counters, `cacheSemantics`, and optional
`turnId`, `generationMs` and `turnMs`. It never guesses intervals.
Future record versions produce a diagnostic. These facts stay outside model
context through Pi's `appendEntry`; no prompts, instructions, AGENTS.md files,
provider configuration or process ownership are modified. `idle` is not a claim
that a task or goal completed.

The adapter boundary follows the upstream [Pi extension API](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)
and [session entries](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts).
