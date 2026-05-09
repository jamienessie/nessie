# 2026-05-09 Broken Adapters Remediation Plan

Status: Proposed
Date: 2026-05-09
Audience: Engineering
Related:
- `doc/SPEC-implementation.md`
- `doc/DEVELOPING.md`
- `doc/GOAL.md`
- `doc/PRODUCT.md`
- `packages/adapters/openclaw-gateway/doc/ONBOARDING_AND_TEST_PLAN.md`

## 1. Purpose

This plan covers the work to identify and repair every adapter package in Nessie that is currently broken, drifting from the shared adapter contract, or failing its package-level smoke/test path.

The goal is not just to make individual packages compile. The goal is to restore a coherent adapter surface across:

- server execution behavior
- UI config and transcript rendering
- adapter-specific tests and smoke checks
- registry metadata and docs

## 2. Adapter Surface In Scope

This plan covers all adapter packages under `packages/adapters/`:

- `acpx-local`
- `claude-local`
- `codex-local`
- `cursor-local`
- `gemini-local`
- `http-webhook`
- `openai-compatible`
- `openclaw-gateway`
- `opencode-local`
- `pi-local`

## 3. What Counts As Broken

An adapter is considered broken if any of the following are true:

1. Its package tests fail or do not cover the current contract.
2. Its server-side `execute` / `test` / config-schema surface no longer matches the shared adapter-utils contract.
3. The UI cannot render its config or transcript correctly.
4. The server registry advertises capabilities the adapter no longer supports.
5. The adapter breaks on a valid configuration that should work in local dev.
6. The docs still describe a behavior that the code no longer implements.

## 4. Repair Strategy

### Phase 1: Inventory and Triage

Create a concrete adapter matrix with one row per package:

- package name
- adapter type
- expected execution mode
- config schema entry points
- UI parser entry points
- test files
- known failure mode

Then run focused validation on each package to classify failures into:

- build/type errors
- runtime contract drift
- UI parser/config drift
- environment or auth setup drift
- unsupported-but-still-advertised behavior

### Phase 2: Fix Shared Contract Drift First

Repair any shared layer that is causing multiple adapters to fail at once:

- `packages/adapter-utils`
- shared adapter registry metadata
- common environment and session helpers
- UI dynamic adapter loading and parser fallbacks

This keeps the package-specific work from being patched around the same root problem ten different ways.

### Phase 3: Fix Local CLI / Session Adapters

Repair the local runtime adapters one by one, with priority on the ones that are most central to daily use:

1. `codex-local`
2. `claude-local`
3. `cursor-local`
4. `opencode-local`
5. `gemini-local`
6. `pi-local`
7. `acpx-local`

For each one:

- make the package build cleanly
- align `execute`, `test`, and config schema exports
- ensure adapter-specific session/env handling works on the current platform assumptions
- verify the UI can render its config and transcripts
- add or repair regression tests for the exact broken path

### Phase 4: Fix Transport / Protocol Adapters

Repair adapters that sit on a protocol boundary and are more likely to drift from external expectations:

- `http-webhook`
- `openai-compatible`
- `openclaw-gateway`

For each one:

- confirm request/response shape matches the current server contract
- confirm failure handling is explicit and user-visible
- confirm unsupported features are reported honestly instead of partially emulated
- keep gateway-only or remote-managed behavior aligned with the latest docs

### Phase 5: Align UI and Docs

Once the package behavior is stable:

- update adapter labels, descriptions, and capability flags in the UI
- make sure adapter forms only expose fields the adapter actually supports
- fix any stale docs in `doc/` and adapter-local README files
- align onboarding / test instructions with the repaired behavior

### Phase 6: Regression Hardening

Add or tighten coverage so the same class of breakage is caught early next time:

- package-level unit tests for config parsing and execution preparation
- server integration tests for adapter registration and execution plumbing
- UI tests for config form and transcript loading
- smoke tests for the adapters that require external CLIs, SDKs, or gateways

## 5. Recommended Execution Order

The safest order is:

1. inventory and triage all adapters
2. fix shared contract drift
3. repair the local CLI/session adapters
4. repair transport/protocol adapters
5. sync UI and docs
6. lock in regression coverage

That order reduces repeated work and keeps us from chasing symptoms adapter by adapter.

## 6. Verification Gates

The plan is complete only when all of the following are true:

- every adapter package in `packages/adapters/` builds
- every adapter package test suite passes
- server and UI adapter registries agree on supported adapter types
- the current docs match the implemented behavior
- a representative smoke path succeeds for each adapter family

Recommended commands for the final pass:

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

Run narrower package-level tests first during the repair loop, then use the repo-wide checks as the final gate.

## 7. Risks

- Some adapters may be broken for different reasons, so a single patch pattern may not cover all of them.
- External CLI and gateway adapters can fail because of local machine setup, not code, so the plan needs to separate true regressions from environment gaps.
- UI fixes may reveal that the server registry is advertising unsupported capabilities.
- Shared helper changes can improve many adapters at once, but they can also introduce broad regressions if we do not keep the verification loop tight.

## 8. Definition Of Done

This work is done when:

1. every adapter package is either working or explicitly documented as unsupported
2. there are no stale adapter claims in the UI or docs
3. the shared adapter contract is consistent across server, UI, and adapter packages
4. adapter regressions are covered by tests and smoke checks

