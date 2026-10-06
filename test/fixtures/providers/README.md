# Provider fixture provenance

`test/providers.test.ts` creates isolated JSONL homes from hand-authored records.
No live user session, provider configuration or instruction file is opened by the
tests. The fixture records exercise real structural formats without copying
third-party parser implementations.

Schema sources inspected on 2026-10-06:

- Codex protocol at commit `822e58cc3d666166c7446c5b1ea2e52f5d09594c`,
  [SessionMeta, TokenUsage and task boundaries](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594c/codex-rs/protocol/src/protocol.rs)
  and [goal tool response](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594c/codex-rs/ext/goal/src/tool.rs).
  Session identity is `payload.id`; newer `session_id` is root accounting scope,
  so it is never used to merge descendants. Cached input is an input subset.
- [Claude Code subagent location and identity](https://code.claude.com/docs/en/sub-agents)
  and [Anthropic cache counters](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
  Visible transcript envelopes use `sessionId`, `uuid`, `requestId`,
  `message.id`, content blocks, and paired `toolUseResult.agentId`. Anthropic's
  input/cache-read/cache-write categories are separate. The provider does not
  publish a versioned transcript contract; support is conditional on these
  recognized envelopes, and broader CLI versions still require runtime checks.
- Pi session-manager source blob `df5281a0a4258462b14faa7d055efa09783ea6aa`
  [SessionHeader and entry types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts),
  AI types blob `7469f303875c2cdc30cdb7de2cbb18e246b9e908`
  [normalized usage](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts),
  and extension types blob `941cfe8cbafb20a0d73a6264ffd5d856d62cbace`.
  Version-three plus legacy headers without a version are covered. `parentId`
  refers to entry ancestry, while `parentSession` can be an ordinary fork.

Unknown schema versions, malformed records and bounded retention are visible
diagnostics. Token values and timing are never estimated from text or mtime.
Only Pi companion facts with explicit version-one schemas supply delegation or
goals. Codex goals require matched tool arguments/results and the exact owner
thread; a user prompt, ACTION list or assistant plan is not a goal API.
