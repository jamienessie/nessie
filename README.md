<p align="center">
  <strong>Nessie</strong> · a self-hosted AI company OS for one operator
</p>

<p align="center">
  <a href="#what-is-nessie">What</a> &middot;
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="ATTRIBUTION.md">Attribution</a>
</p>

---

## What is Nessie?

Nessie is a personal operating system for running a small AI company. One human operator hires AI agents into departments, runs live Meetings to make decisions, assigns Work Contracts, routes model spend across cost tiers, and reviews outcomes — all on their own machine.

It is a deliberate fork of [Paperclip](https://github.com/paperclipai/paperclip) (MIT). Paperclip is the foundation; Nessie diverges toward a single-operator workflow with a cost-tier proxy, reviewer pattern, Cockpit UI, HR pipeline, and trust layer. See [`ATTRIBUTION.md`](ATTRIBUTION.md) for upstream provenance.

## Who is it for?

A solo developer who wants:

- A single dashboard ("Cockpit") to run a tiny AI company from
- Cost routing across subscription seats (T1), paid APIs (T2), and free credits (T3)
- Real human-named agents with job titles, not anonymous bot slots
- Reviewer pattern: cheap IC writes, expensive senior reviews
- Live multi-agent Meetings that produce decisions, not chat
- Trust earned through reputation, contracts, and replayable evidence

Nessie is **not** SaaS. It runs on your laptop, talks to your subscriptions and APIs, and never phones home.

## Quickstart

> **Status:** Phase −1 (fork baseline). Boot path is being stabilized.

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Server boots on `http://localhost:3100`, UI on the Vite dev port, and the cost-tier proxy on `http://localhost:7777/v1`.

> **Requirements:** Node 20+, pnpm 9.15+

## Architecture

Single Node.js process, embedded Postgres, four panes of glass:

```
NESSIE (single process)
├─ React UI  ↔  Express API  ↔  Drizzle / Postgres
└─ Heartbeat Scheduler  ↔  Adapter Dispatcher  ↔  Local Proxy :7777/v1
   ├─ Family A (T1) — subscription CLI: claude-code, codex
   └─ Family B (T2/T3) — API router: openai-compatible, http-webhook
```

See [`doc/`](doc/) for deeper dives on subsystems.

## License

MIT. Inherits Paperclip's MIT license — see [`LICENSE`](LICENSE) and [`ATTRIBUTION.md`](ATTRIBUTION.md).
