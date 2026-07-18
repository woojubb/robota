# Vision — Robota builds Robota

**The ultimate goal: make `robota` a general development agent so capable that it can build even Robota
itself.** The target is a **sophisticated, general-purpose agent** — one that can develop _any_ demanding
software project. "Robota builds Robota" is the **validation benchmark** for that general capability (the
hardest possible dogfood), **not** the purpose.
로보타로 로보타를 만든다 = 로보타를 만들 수 있을 만큼 정교한 **범용** 에이전트가 된다는 것. 로보타 제작은 그 범용 능력의
**검증**이다.

> ### What this does NOT mean (read this first)
>
> This is **NOT** a directive to build a Robota-specific or Robota-only tool, and **NOT** a license to
> bake Robota-development assumptions into the product. The agent's capabilities must stay **general and
> neutral** — usable to build any project — because that generality is exactly what "capable enough to
> build Robota" is measuring. Robota is chosen only because it is the **hardest dogfood** (a strict-TS
> monorepo under a rigorous harness); succeeding on it proves _general_ capability. Making `robota`
> dedicated to developing Robota would be **failing** the north-star, not reaching it.
> 로보타 **전용** 도구를 만드는 게 아니다. 역량은 어떤 프로젝트든 만들 수 있는 **범용·중립**이어야 하며(그 범용성이 곧
> 검증 대상), 로보타는 가장 어려운 dogfood라서 골랐을 뿐이다. 로보타-전용화는 북극성 **달성이 아니라 실패**다.

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

**Library neutrality is not a side rule here — it is the goal restated.** Because the target is a _general_
agent (see "What this does NOT mean"), every capability must be a neutral mechanism usable on any project;
Robota-specific content in `packages/` would make the agent less general, i.e. move it away from the
north-star. Enforced by the library-neutrality rule (TRANS-001, [project-structure.md](.agents/project-structure.md))
and the neutrality scans (e.g. `orchestration-neutrality`). "Self-hosting" is a benchmark, never a licence to
couple the product to the Robota domain.

---

_This vision is intentionally surfaced every session (linked from `AGENTS.md` and `README.md`) so it stays
the thing every change is measured against. Keep it current as the flywheel turns._
