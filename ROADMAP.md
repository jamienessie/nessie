# Nessie Roadmap

What's shipped, what's coming, and what we deliberately deferred.

## Shipped — v1 spine (Phases −1 → 6)

| Phase | What landed |
| --- | --- |
| **−1** | Fork from `paperclipai/paperclip @ 824298f`. Namespace flip `@paperclipai/*` → `@nessie/*`. Soft-stripped multi-user, telemetry, cloud sandbox. Plugins gated off. Branding (NESSIE banner, `N` favicon). Data dir isolated to `~/.nessie/`. |
| **0** | Cost-tier proxy on `127.0.0.1:7777`. `credentials` / `credential_health` / `subscription_quotas` schemas. Tier router (T1/T2/T3 by header or model alias). Cost meter writing `cost_events`. Health monitor. TOS dial (Conservative default). |
| **1** | Adapter catalog narrowed to four: `claude_local`, `codex_local`, `openai_compatible`, `http_webhook`. Six legacy adapter packages remain on disk, no longer registered. |
| **2** | Reviewer pattern + Departments. `agents` extended (humanFirstName, humanLastName, tier, departmentId, autonomyLevel, reputationScore, roleTemplateKey). `issues` extended (reviewerAgentId, acceptanceCriteria, evidenceRefs, tierRequired). 8 `departments` seeded with oklch design tokens. 16 named role templates seeded (Aria Whitfield CEO, Marcus Chen CTO, Lena Park Head of HR, Owen Mackenzie Senior Reviewer, etc.). |
| **3** | Meetings as first-class. `meetings` / `meeting_participants` / `meeting_messages` / `meeting_outcomes` schemas. Lifecycle state machine. Atomic message append with cost rollup. Outcome write policy gating DECIDE/ACTION/MEMORY/ISSUE behind operator approval. 8 REST endpoints. |
| **4** | HR pipeline. `role_templates` (DB mirror of static seed) + `hires` + `candidates` + `scorecards`. 5-stage pipeline (open → sourcing → interviewing → trial → recommended → hired/rejected). `mintHiredAgent()` atomic transaction. Hard rule: trial candidates only ever T3 credentials. |
| **5** | Cockpit UI. `tokens.css` (oklch design tokens). `<AgentLabel>` load-bearing primitive (always renders Name + Title). `CockpitShell` + `Rail` + `Topbar`. Four pages: Control Tower (live tier strip + spend gauge + agent feed), Meetings (rooms + active room), HR (5-stage kanban + 16 named templates), Org (8 dept cells + roster). Routes `/tower`, `/meet`, `/hr`, `/org`. |
| **6** | Trust layer. `agent_bus_messages` (10 typed kinds), `work_contracts` (one per issue), `black_box_records` (forensic log), `reputation_events` (delta log → aggregate). Autonomy gating L0–L5. Bus rewraps low-autonomy state-changing kinds into `operator_approval_request` automatically. |
| **7 starter** | v0.8 starter pack: `inbox_items` (universal capture + triage), `operator_constitution` (editable top-level doc with version history), `trust_receipts` (closes the Phase 6 loop — what shipped, who approved, cost, evidence, contributors, limitations). |

The v1 spine is complete. From here, every feature is opt-in and additive.

## Up next — v0.8 wave 2 (high leverage on existing infra)

These use the v1 spine without new schema:

- **Chief of Staff Mode** (§20.2) — the Inbox + Cockpit topbar already cover capture and tier surfacing; what remains is the natural-language command surface that reads state and routes work.
- **Executive Briefs** (§20.12) — daily / weekly / monthly summaries. Pulls from `cost_events` (Phase 0), `meeting_outcomes` (Phase 3), `hires` (Phase 4), `reputation_events` (Phase 6), and `inbox_items` (Phase 7). Writes into `documents` + a Cockpit Tower panel.
- **Disaster Recovery Pack** (§20.52) — operational. One-button export of every Nessie table to a tarball + import / verify. CLI surface, no new schema.
- **Trust Receipts UI** — schema is in (Phase 7); needs a Cockpit drill-down that pulls evidence from `work_contracts` + cost from `cost_events` + reviewers from `meeting_outcomes`.
- **Reviewer wakeup integration** — when `issues.status` flips to `in_review`, enqueue a `review_request` bus message (Phase 6) for the reviewer agent. Bridges Phase 2's reviewer pattern to Phase 6's bus.

## Up next — v0.8 wave 3 (new schema, contained scope)

Each is one new schema + service + REST + Cockpit panel:

- **Goal-to-Company Compiler** (§20.3) — turns a rough goal into project plans, departments, meetings, issue graphs, work contracts.
- **Code Atlas + Repo Archaeologist** (§20.4–20.5) — live map of packages/modules/routes/migrations. New `code_entities` + `code_relationships` tables.
- **Model Arena** (§20.6) — runs the same task against multiple T2/T3 models, scores quality/cost/speed.
- **Agent Exams / Promotion** (§20.7) — `agent_exams` + `agent_exam_attempts` + `agent_badges`. Wires to autonomy level (Phase 6) so passing exams raises L.
- **Computer Lab** (§20.8) — controlled visual/browser environment. Playwright-backed sandbox runtime.
- **Visual QA** (§20.9) — `visual_snapshots` + `visual_reviews` for screenshot comparison.
- **Artifact Factory + Publishing Pipeline** (§20.10–20.11) — `artifacts` + `artifact_versions` + `publishing_targets` + `publishing_jobs`.
- **Telemetry Brain + Reliability** (§20.13–20.14) — `telemetry_events` + `reliability_findings`. Ingests traces / metrics / logs / CI output / proxy traces.
- **Chaos Lab** (§20.15) — `chaos_scenarios`. Controlled failure injection.
- **Feature Flag Lab + Experiment Lab** (§20.16–20.17) — `feature_flags` + `experiments`.
- **Bounty Board** (§20.18) — `bounty_bids` against issues.
- **Capacity Planner** (§20.19) — `capacity_snapshots`.
- **Procurement Scout** (§20.20) — `procurement_findings`.
- **Secure Remote Command** (§20.21) — `remote_sessions`.
- **Guest Review Links** (§20.22) — `guest_links`.
- **Prompt / Skill Version Control** (§20.25) — `prompt_versions` + `skill_versions`.
- **Agent Diff Viewer** (§20.26) — `agent_diffs`.
- **Data Rooms** (§20.27) + **Privacy Preflight** (§20.28) — `data_rooms` + `privacy_preflight_results`. Gates T3 access to sensitive context.
- **Token Diet Coach** (§20.29) — `token_diet_findings`.
- **Meeting Director Upgrades** (§20.30) — agenda timer, vote mode, decision lock. Mostly UI on top of Phase 3.
- **Meeting Replay / Highlight Reel** (§20.31) — `meeting_replays`. Two-minute summaries.
- **Persona Council** (§20.32) — `persona_council_reviews`. 7 simulated personas critique UX/copy.
- **Support Simulator** (§20.33) — `support_simulator_tickets`.
- **Onboarding Wizard 2.0** (§20.34) — extends the existing wizard with the operator-preferences interview from §20.45.
- **Company Templates** (§20.35) — JSON bundles (Solo SaaS Builder, Open Source Maintainer, …).
- **Release Train** (§20.36) — `releases`.
- **Regression Memory + Technical Debt Ledger** (§20.37–20.38) — `regression_memories` + `technical_debt_items`.
- **Architecture Fitness Functions** (§20.39) — `architecture_fitness_results`.
- **Local App Store / Plugin Packs** (§20.40) — re-enables the plugin system (gated off in Phase −1) with a reviewed local catalog.
- **External Agent Gateway** (§20.41) — exposes selected agents as MCP tool providers / webhook workers / public cards.
- **Event Spine** (§20.42) — unified envelope across runs/meetings/HR/Finance/Policy. Reuses `activity_log` + a typed projection.
- **Policy-as-Code** (§20.43) — `policy_rules` evaluated by a simple engine.
- **Approval Simulator** (§20.44) — `approval_simulations`. What-if scenarios.
- **Ask the Company Mode** (§20.47) — fan-out across departments (Phase 2) returning a synthesis.
- **AI Whiteboard** (§20.48) — `whiteboards`.
- **Roadmap Negotiator** (§20.49) — `roadmap_options`.
- **Demo Recorder** (§20.50) — `demo_recordings`.
- **Explain This System Mode** (§20.51) — pulls from docs + Code Atlas + decision records.

## Hardening pass (pre-feature cleanup)

A pre-feature audit pass landed before the v0.8 wave 2 work started:

- Activity logging fully wired across mutating endpoints in
  `meetings`, `hires`, `trust-layer`, and `executive-briefs` routes.
  Every mutation now writes an `activity_log` row per `AGENTS.md` Rule 3.
- Cost-tier proxy (`packages/proxy`) has Vitest coverage on `router`,
  `cost-meter`, `credentials`, and `tos-dial` (34 tests).
- Bus autonomy gating, send rewrap, and reputation aggregation
  covered by unit tests (`agent-permissions.test.ts`,
  `agent-bus.test.ts`, `reputation.test.ts`).
- Black-box recorder now auto-records: heartbeat run lifecycle
  transitions, meeting state transitions + outcome approvals, and
  agent mint events.

## Engineering loose ends

These don't add features but tighten the spine:

- ~~Heartbeat tier stamping~~ — **shipped**. `X-Nessie-Tier` is stamped from
  `agents.tier` in `server/src/services/heartbeat.ts:7596-7611`.
- ~~Black-box auto-recording~~ — **shipped** for run / meeting / hire scopes.
- **Self-host Geist fonts** — currently loaded from Google Fonts CDN. Self-host at `ui/public/fonts/`.
- **Pixel parity with the cockpit reference** — Phase 5 ships structurally faithful screens; refining each panel against the design HTML is iterative.
- **Drill-down reskins** — `/agents/:id`, `/issues/:id`, `/approvals/:id` still render the legacy Layout. Reskin onto `<Panel>` + `<AgentLabel>`.
- **SSE meeting transcripts** — `/api/meetings/:id/messages` is currently polled. Wire to SSE.
- **Real `applyOutcomeEffects`** — Phase 3's outcome applier stubs creation. Real wiring to issues / decision_records / institutional memory.
- **Hard delete of legacy adapters** — `cursor-local`, `gemini-local`, `opencode-local`, `acpx-local`, `pi-local`, `openclaw-gateway` were soft-stripped in Phase 1. Real deletion is a tree cleanup any time.
- **`pnpm dev` orchestrator (`dev-runner.ts`) tsx resolution** — `pnpm dev:server` works; the combined `pnpm dev` hits a Windows pnpm-exec quirk on tsx. Workaround: run `dev:server` and `dev:ui` separately.
- **Heartbeat service split** — `server/src/services/heartbeat.ts` is ~9.7k lines. Worth extracting workspace handling, cost tracking, and adapter dispatch into siblings as its own dedicated PR.

## Out of scope for v1

Explicitly deferred per the plan:

- **Multi-user** — Nessie is single-operator. Re-adding requires reverting the soft-strip in Phase −1.
- **Cloud sandbox agents** — operator-machine-first. Re-add via the plugin system if needed.
- **Telemetry leaving the machine** — never re-enabled by default.
