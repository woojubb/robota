/**
 * Multi-agent orchestration mechanism (SELFHOST-001).
 *
 * agent-core owns the neutral contracts + event-type unions; this layer
 * IMPLEMENTS the mechanism over `agent-executor`'s `ISubagentRunner` port
 * (surfaced as `ISubagentManager`). P1 ships `sequential`; `parallel`/`handoff`
 * (P2) and `hierarchical`/`group-chat` (P3) follow. The framework NEVER depends
 * on `agent-subagent-runner` (that would be a cycle); the concrete runner is
 * injected at the `agent-cli` composition root.
 */
export { runSequential } from './sequential';
export type { ISequentialOrchestratorDeps, ISequentialRunContext } from './sequential';
