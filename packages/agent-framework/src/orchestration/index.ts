/**
 * Multi-agent orchestration mechanism (SELFHOST-001).
 *
 * agent-core owns the neutral contracts + event-type unions; this layer
 * IMPLEMENTS the mechanism over `agent-executor`'s `ISubagentRunner` port
 * (surfaced as `ISubagentManager`). P1 ships `sequential`; P2 adds `parallel`
 * (bounded concurrency + aggregation) and `handoff` (control-transfer); P3 adds
 * `hierarchical` (manager-delegation) and `group-chat` (turn-taking). The
 * framework NEVER depends on `agent-subagent-runner` (that would be a cycle);
 * the concrete runner is injected at the `agent-cli` composition root.
 */
export { runSequential } from './sequential';
export type { ISequentialOrchestratorDeps, ISequentialRunContext } from './sequential';

export { runParallel } from './parallel';
export type { IParallelOrchestratorDeps } from './parallel';

export { runHandoff } from './handoff';
export type { IHandoffOrchestratorDeps, ResolveHandoff } from './handoff';

export { runHierarchical } from './hierarchical';
export type { IHierarchicalOrchestratorDeps, PlanDelegation } from './hierarchical';

export { runGroupChat } from './group-chat';
export type { IGroupChatOrchestratorDeps, SelectNextStep } from './group-chat';

export type { IOrchestrationRunContext } from './shared';
