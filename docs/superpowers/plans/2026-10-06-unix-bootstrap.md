# Unix bootstrap implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan inline. Steps use checkbox syntax for tracking.

**Goal:** Install dependencies and activate Herdr Prism on macOS/Linux from a curl-to-sh command.

**Architecture:** A POSIX shell entry point supplies a checksum-pinned Node runtime when needed and downloads an immutable Prism revision. A dependency-free Node utility supplies a verified Herdr binary when needed, stages a release with absolute Node command paths, and uses the existing authenticated live lifecycle. Start a headless Herdr server only if the selected local session has none; never restart a running server or replace an existing plugin installation.

**Tech Stack:** POSIX sh, Node ESM, existing compiled TypeScript runtime.

**Spec:** User's Unix installer request; `docs/design/herdr-prism.md` live-lifecycle and remote amendments.

## Global constraints

- macOS/Linux x64 and arm64; Node >=22.13.0; Herdr >=0.9.3/protocol 22.
- User-local dependency downloads; no sudo, npm, Cargo, shell-profile edits or replacement of system dependencies.
- Bind every manifest command to the chosen absolute Node executable before generating release checksums.
- Installation/removal use the existing authenticated wrapper. Shared dependencies and Herdr server remain after Prism removal.
- Run on each remote server; never infer a remote machine from a local client.
- Windows installer belongs to the other machine's agent and remains unchanged.

## Review focus

- Existing server PATH lacks Node: actual actions and pane must still launch.
- Bad dependency checksum: no executable installed and existing files survive.
- Spaces, apostrophes and non-ASCII paths: preserve argv and valid TOML.
- Old or unreachable server: no plugin registration or unproven readiness.
- Existing foreign/GitHub registration: no adoption, overwrite or deletion.

### Task 1: Absolute runtime release binding

- [x] Write and observe a failing test for all command vectors and escaped Unix paths.
- [x] Add optional `nodeBin` release binding before checksum generation; default staging remains unchanged.
- [x] Verify release integrity tests and refuse relative/unsupported runtime bindings.

### Task 2: Dependency bootstrap and lifecycle integration

- [x] Write failing tests for server targeting, checksum rejection, existing registration and no-start behavior.
- [x] Add `install.sh` and `scripts/bootstrap-unix.mjs`, with immutable GitHub source resolution and pinned Node archives.
- [x] Verify POSIX syntax, isolated download tests and lifecycle tests.

### Task 3: Actual delivery evidence and docs

- [x] Exercise actual macOS and Linux live install/uninstall with an absolute Node executable absent from the server PATH.
- [x] Exercise checksum-pinned dependency download/setup without replacing personal dependencies.
- [x] Update README/install docs, record exact evidence, review changes and push normally.

Ruling: Execute this bounded installer extension inline under the user's existing implementation and push authorization; no additional design approval is needed for these routine installer choices.

Verification: release runtime-binding RED→GREEN, initial bootstrap tests RED→GREEN, shortcut inspector-only RED→GREEN, review array/whitespace conflict RED→GREEN, delayed action RPC RED→GREEN. 49 targeted tests pass, macOS strict suite 299 total / 282 pass / 17 platform skips / zero failures. Actual macOS/Linux arm64 pipeline, pinned dependencies, missing server, real Ctrl+B then i PTY dispatch, inspector-only shortcut and complete removal pass. Linux strict suite passes: 299 total / 281 pass / 18 platform skips / zero failures. Final public-source smoke is recorded after publication.

Final review: Astra found one Important issue (array/whitespace shortcut collisions); fixed with observed RED→GREEN regression. No Critical findings. Actual PTY testing additionally found the existing open-action premature RPC close; fixed and tested for delayed open and focus.

Public-source delivery: actual immutable GitHub API/codeload bootstrap passed on macOS arm64 at `56f2ee9` and Podman Linux arm64 at `e617f0c`, including all five stages above. Public-source testing found two additional defects: physical path canonicalization on macOS and staging committed helpers rather than ignored local artifacts. Both were reproduced RED→GREEN; checksum/architecture/notices verification remains enforced. Final targeted suite: 51 passed, zero failed.
