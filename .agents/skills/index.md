# Skills Index

Procedural workflows and domain-specific rules for the Robota monorepo.
Parent: [AGENTS.md](../../AGENTS.md)

Consult the relevant skill before starting work in its domain. Each entry links directly to the skill file.

## Process & Planning

| Skill                                                                   | Description                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| [spec-first-development](spec-first-development/SKILL.md)               | Enforce spec-first workflow before touching contract boundaries |
| [spec-writing-standard](spec-writing-standard/SKILL.md)                 | Required sections and quality gates for SPEC.md authoring       |
| [spec-code-conformance](spec-code-conformance/SKILL.md)                 | Verification loop to align code with spec after spec changes    |
| [tdd-red-green-refactor](tdd-red-green-refactor/SKILL.md)               | Kent Beck TDD cycle: Red → Green → Refactor                     |
| [task-tracking](task-tracking/SKILL.md)                                 | Create and update task files in `.agents/tasks/`                |
| [post-implementation-checklist](post-implementation-checklist/SKILL.md) | Mandatory checklist after completing implementation work        |
| [repo-change-loop](repo-change-loop/SKILL.md)                           | Standard change loop: impact → build → verify → summarize       |
| [version-management](version-management/SKILL.md)                       | Coordinated version bumps with changesets across all packages   |

## Code Quality & Architecture

| Skill                                                                   | Description                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [architecture-patterns](architecture-patterns/SKILL.md)                 | Functional core/imperative shell, ports-and-adapters, DI composition |
| [architecture-decision-records](architecture-decision-records/SKILL.md) | ADR format for recording significant design decisions                |
| [type-boundary-and-ssot](type-boundary-and-ssot/SKILL.md)               | Trust-boundary validation, SSOT type ownership                       |
| [effect-style-error-modeling](effect-style-error-modeling/SKILL.md)     | Explicit error modeling with Result/Either patterns                  |
| [api-error-standard](api-error-standard/SKILL.md)                       | RFC 7807 Problem Details error response format                       |
| [state-machine-design](state-machine-design/SKILL.md)                   | Pure declarative state machines with guards and actions              |
| [ddd-tactical-patterns](ddd-tactical-patterns/SKILL.md)                 | Aggregate, Bounded Context, Value Object, Domain Event               |
| [cqrs-event-projection-basics](cqrs-event-projection-basics/SKILL.md)   | CQRS and event projection for read/write separation                  |
| [async-concurrency-patterns](async-concurrency-patterns/SKILL.md)       | Concurrent async with limits, cancellation, backpressure             |
| [logging-level-guide](logging-level-guide/SKILL.md)                     | When to use each log level, common anti-patterns                     |

## Testing

| Skill                                                                   | Description                                                     |
| ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| [vitest-testing-strategy](vitest-testing-strategy/SKILL.md)             | Practical unit, integration, and type-level testing with Vitest |
| [pre-refactor-test-harness](pre-refactor-test-harness/SKILL.md)         | Characterization tests before refactoring monolithic files      |
| [contract-testing](contract-testing/SKILL.md)                           | Consumer-driven contract testing for API boundaries             |
| [scenario-verification-harness](scenario-verification-harness/SKILL.md) | Scenario verification loop for example flows                    |
| [contract-audit](contract-audit/SKILL.md)                               | Class contract registry audit and SPEC.md update                |

## Build & Repository

| Skill                                               | Description                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| [pnpm-monorepo-build](pnpm-monorepo-build/SKILL.md) | pnpm workspace build commands and order                          |
| [repo-writing](repo-writing/SKILL.md)               | `.design/` docs, ADRs, conventional commit messages              |
| [harness-governance](harness-governance/SKILL.md)   | Rule-skill consistency, undefined terminology, mechanical checks |
| [branch-guard](branch-guard/SKILL.md)               | Guard against direct commits to protected branches               |
| [execution-caching](execution-caching/SKILL.md)     | Caching workflows, invalidation, cache system operations         |
| [semver-api-surface](semver-api-surface/SKILL.md)   | Semver impact of API surface changes across packages             |

## Package-Specific

| Skill                                               | Description                                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [robota-sdk-usage](robota-sdk-usage/SKILL.md)       | Robota SDK constructor config and migration patterns                                                        |
| [plugin-development](plugin-development/SKILL.md)   | Plugin validation, disable strategies, error handling                                                       |
| [dag-node-standard](dag-node-standard/SKILL.md)     | AbstractNodeDefinition, zod config, NodeIoAccessor                                                          |
| [api-spec-management](api-spec-management/SKILL.md) | API specification management for external-facing endpoints                                                  |
| [package-code-review](package-code-review/SKILL.md) | Six-perspective code review: correctness, architecture, type safety, security, performance, maintainability |

## Frontend & UI

| Skill                                                               | Description                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| [web-design-guidelines](web-design-guidelines/SKILL.md)             | UI accessibility, design, and UX compliance review         |
| [tailwind-truncation](tailwind-truncation/SKILL.md)                 | Tailwind single-line and multi-line text truncation        |
| [vercel-react-best-practices](vercel-react-best-practices/SKILL.md) | React/Next.js performance patterns from Vercel Engineering |
| [vercel-composition-patterns](vercel-composition-patterns/SKILL.md) | React composition patterns                                 |
| [vercel-react-native-skills](vercel-react-native-skills/SKILL.md)   | React Native skills                                        |
| [deploy-to-vercel](deploy-to-vercel/SKILL.md)                       | Deploy apps to Vercel (preview and production)             |
