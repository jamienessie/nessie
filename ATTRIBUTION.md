# Attribution

Nessie is a fork of **Paperclip** (paperclipai/paperclip), released under the MIT License. We are deeply grateful to the Paperclip authors for the foundation.

## Upstream

- **Project:** [Paperclip](https://github.com/paperclipai/paperclip)
- **License:** MIT (see [`LICENSE`](LICENSE), retained verbatim)
- **Fork point:** commit `824298f414f33bc9c151be5556bbaedd4d35e9ec` ("Route sidebar search icon directly to search (#5440)")

## Relationship

Nessie is a **hard fork**, not an upstream-tracking branch. The two projects share an architectural baseline (companies, agents, issues, runs, heartbeats, the adapter pattern, atomic checkout, audit log, skills system, worktree workflow, MCP server, embedded-postgres dev story) but diverge on:

- Single-operator focus — Nessie removes multi-tenancy, multiple human users, cloud sandbox agents, and remote telemetry.
- Cost-tier strategy — Nessie adds a local OpenAI-compatible proxy on `:7777` that routes calls across T1 (subscription seat), T2 (paid API), and T3 (free / cheap credit) credentials.
- Reviewer pattern, named-agent UX, Cockpit UI, Meetings as first-class, HR pipeline, Trust layer.

See `README.md` and `doc/` for the divergence details.

## Changes credit

All Nessie-specific code is © the Nessie authors and licensed under MIT. The combined work is distributed under MIT.
