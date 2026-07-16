# Vision — Robota builds Robota

**The ultimate goal: use Robota to build Robota.** The `robota` CLI and the Robota desktop app
develop the Robota repository itself — Robota codes Robota — so the product improves itself in a loop.
로보타 CLI/앱으로 로보타 레포의 로보타를 개발한다: 로보타로 로보타를 만든다.

## The flywheel

```
   Robota (the agent: CLI + app)
        +  the Robota harness (the enforced, self-improving dev process)
        ↓  develops
   Robota (the code)
        ↓  becomes
   a more capable Robota
        ↺  which develops Robota better
```

Two loops, one flywheel:

- **Product self-hosting** — Robota (the agent) is capable enough to do real engineering on the Robota
  monorepo: plan, understand the codebase, change it across layers, test, review, and ship.
- **Process self-improvement** — the harness (SENSE → ENFORCE → IMPROVE; see
  [`.agents/rules/enforcement-architecture.md`](.agents/rules/enforcement-architecture.md) and the
  [orchestration map](.agents/specs/orchestration-map.md)) makes every one of those steps correct and
  gets better over time.

Each turn of the flywheel makes both the agent and the process stronger, so the next turn is easier.

## Why this is the north-star

- **The hardest possible dogfood.** Robota is a strict-TypeScript pnpm monorepo with a rigorous,
  mechanically-enforced harness. An agent that can develop _this_ — under spec-gates, research gates,
  worker/guardian/orchestrator review, and branch-safety — can develop almost anything. Self-hosting is
  the forcing function that keeps the product honest.
- **Every capability is proven by use.** A feature is not "done" because it exists; it is done when
  Robota used it to build Robota. The [PR-review orchestration](.agents/specs/orchestration-map.md)
  (Robota reviewing Robota's PRs) is the first live instance of this.
- **Compounding.** A better Robota builds Robota faster and better, which produces a better Robota.

## What it demands of the product — the roadmap

To reach "Robota codes Robota", the product must have first-class, competitively-strong versions of the
capabilities a real development agent needs. These are surveyed from leading commercial/OSS agents
(Claude Code, Cursor, Devin, aider, CrewAI, Hermes, LangGraph, OpenAI Agents SDK, ADK, Mastra, …) and
tracked as the **self-hosting roadmap** in [`.agents/backlog/SELFHOST-*`](.agents/backlog/). Highlights:
crew/multi-agent orchestration, explicit plan-mode, codebase indexing/RAG, branching time-travel,
self-curating memory, run tracing + cost budgeting, guardrails, a rich hook catalog, computer use, and
evals-as-code — each placed at the **correct architectural layer** (never skinned onto a surface).

## Non-negotiable constraint — correct architecture

Every capability enters at its correct layer of the Robota architecture
(agent-core → agent-framework → provider family → transports → surfaces, plus the DAG subsystem), respects
library neutrality (`packages/` stay domain-free; product opinions live in `agent-cli` / `apps/agent-app`),
and is validated by Robota developing Robota. Reaching the goal by hacking a shortcut onto a surface is
not reaching the goal.

---

_This vision is intentionally surfaced every session (linked from `AGENTS.md` and `README.md`) so it stays
the thing every change is measured against. Keep it current as the flywheel turns._
