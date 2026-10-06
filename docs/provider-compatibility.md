# Herdr Prism provider compatibility

Read-only local audit: 2026-10-06, macOS arm64. Version flags, an authoritative
Herdr snapshot, exact local session references and existing JSONL records were
inspected. No model was invoked, no provider configuration or transcript was
modified, and no raw messages, environment values, account identifiers or private
paths were exported. The regression fixtures are synthetic structural examples.

## Versions and sample boundaries

| Provider | Installed CLI on PATH | Records actually inspected | Boundary |
| --- | --- | --- | --- |
| Codex | `0.160.0` | One exact native session whose header reports `0.160.1`; explicit descendant metadata | The shell CLI and the process that authored a rollout need not be the same build. This is evidence for these recognized record shapes, not every Codex release. |
| Claude Code | `2.1.291` | One exact native session containing envelopes from `2.1.283` and `2.1.289`; subagent directory metadata | The installed CLI version alone does not establish the version of an existing transcript. No new `2.1.291` model response was requested. |
| Pi | `0.79.10` | One existing exact local session file, header version `3` | There was no native Pi attachment in the inspected Herdr snapshot. The header does not record the CLI build that authored it. Live Pi launch, tool execution and companion delegation were not exercised. |

Each body read was a finite snapshot. Bounded retention intentionally reports
partial coverage for long histories; counts and file growth are observations,
not a claim of complete lifetime coverage. Background sessions remain metadata
only unless selected for detailed inspection. Same cwd never establishes identity
or delegation.

## Codex

The local records matched `session_meta.payload.id`, visible response messages,
paired calls/results, explicit task boundaries and `token_usage_record`. Root
accounting `session_id` is distinct from thread identity. System/developer
messages, reasoning items and hidden content remain excluded.

The audit found and the adapter now covers three newer shapes:

- `event_msg.thread_goal_updated` validates both owner thread IDs, preserves the
  original record reference and normalizes camelCase lifecycle states. Goal
  timestamps are epoch seconds and become milliseconds in normalized evidence.
  Unknown owners/statuses do not replace a recognized goal. Tool-result goal
  handling remains available for older records.
- `response_item.agent_message` retains explicit author/recipient metadata and
  displays a separate communication kind. Only wholly plaintext `input_text`
  bodies are complete. Mixed encrypted or unsupported content yields an
  incomplete unavailable-body placeholder, without retaining its plaintext
  envelope prefix or ciphertext. These records do not become initial requests,
  user ACTION lists, assistant refs or inferred delegation edges.
- `token_usage_record.turn_token_usage` is a cumulative turn snapshot nested in
  the single cumulative thread observation. Explicit turn identity is required;
  foreign thread owners are rejected. The reducer can report provider turn
  totals without inventing a baseline or adding them to lifetime totals twice.

The pinned [protocol types](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594c/codex-rs/protocol/src/protocol.rs),
[agent-message content rules](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594c/codex-rs/protocol/src/models.rs),
[turn/thread accumulation tests](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594c/codex-rs/core/tests/suite/token_usage_rollout.rs),
[Responses usage conversion](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594c/codex-rs/codex-api/src/sse/responses.rs)
and [goal timestamp conversion](https://github.com/openai/codex/blob/822e58cc3d666166c7446c5b1ea2e52f5d09594c/codex-rs/ext/goal/src/tool.rs)
support those interpretations. Cached reads and writes come from input-token
details; they are not extra tokens to add to input. The inspected responses
reported zero cache writes, so nonzero writes are covered by synthetic schema
fixtures and source evidence rather than a local live observation.

A post-fix exact-session read recognized an explicit goal, both plaintext and
unavailable encrypted communication records, and turn counters reduced as
`provider-turn` with known coverage. This certifies extraction of these local
records, not delivery of a complete inter-agent messaging bus.

Reported model changes currently come from `turn_context`. The observed
`thread_settings_applied` event is not normalized, so a standalone settings
change can precede the next recognized model update. Completion records also
carry time-to-first-token; that is not a generation interval and is not used to
claim generation speed.

## Claude Code

The inspected main JSONL starts with a non-message `mode` envelope carrying
`sessionId`; identity does not depend on the first line being a user message.
Message records include `uuid`, `requestId`, `message.id`, content blocks, usage
and completion reasons. All 5,649 inspected assistant envelopes had recognized
completion reasons (`tool_use`, `end_turn` or `stop_sequence`); this sample does
not support treating missing/null completion fields as complete.

The supported usage fields were present: input, output, cache-read input and
cache-creation input. Cache categories remain separate, as described in
[Anthropic's cache documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
Exact subagent files and paired Agent/Task results support explicit lineage;
directory membership alone does not establish arbitrary grandparent structure.
See the [official subagent documentation](https://code.claude.com/docs/en/sub-agents).

Additional observed title, queue, attachment and system events are not all
normalized. `thinkingDurationMs` and system `turn_duration.durationMs` were
observed but are not treated as generation time or a provider turn-token ID.
These require separate fixtures and semantics before expanding metrics.
Claude does not publish a complete versioned JSONL compatibility contract.

## Pi

The local version-three header, model-change records and visible message usage
matched the adapter. Input/output/cache-read/cache-write/total fields were
present. Message-entry `parentId` describes entry ancestry, and `parentSession`
can describe a fork; neither proves delegated-agent ownership. This agrees with
the provider's [session manager](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/session-manager.ts)
and [usage types](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts).
The installed `0.79.10` package's session-manager constant was also verified as
version three without starting a provider session.

No companion goal/delegation or real Pi tool result occurred in this local
sample. Those paths have isolated fixtures, not live acceptance evidence.
Current provider `context_edit` projection and branch-specific context fidelity
are not implemented by the append-only history reader; neither feature occurred
in the inspected file. Do not claim its history view is the provider's current
model-context projection. Unknown session/companion versions remain diagnosed.

## Regression and remaining acceptance

Synthetic regressions cover owned goal updates, lifecycle status/timestamp
normalization, encrypted-message rejection, explicit routing, duplicate item
IDs, nested turn counters, foreign owners and unknown turn identity. Existing
fixtures cover bounded tails, rotation, malformed input, archive merging and
selected-session privacy gates. This audit did not install hooks, run paid
models, modify instructions or exercise every provider version. Broader live
provider/platform acceptance remains a separate release gate.
