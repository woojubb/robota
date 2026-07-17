/**
 * Neutral multi-agent orchestration contracts + event-type unions (SELFHOST-001).
 *
 * agent-core owns these; the framework layer implements the mechanism over
 * `agent-executor`'s `ISubagentRunner` port. Pure types only — no runtime.
 *
 * Extraction trigger (B3): when a second implementer family lands (a dag-* adapter
 * mapping sequential/parallel onto the graph engine), BOTH these contracts AND the
 * event-type unions move to a new `agent-interface-orchestration` package
 * (deps ⊆ {agent-core}), so that adapter need not depend on heavy agent-core for
 * the event types.
 */
export type {
  TOrchestrationPrimitive,
  IOrchestrationStep,
  ISequentialOrchestrationSpec,
  IParallelOrchestrationSpec,
  IHandoffOrchestrationSpec,
  IOrchestrationDelegation,
  IHierarchicalOrchestrationSpec,
  IGroupChatOrchestrationSpec,
  IOrchestrationStepResult,
  IOrchestrationRunResult,
  IOrchestrationEventData,
} from './orchestration-contracts';

export {
  ORCHESTRATION_EVENTS,
  ORCHESTRATION_EVENT_PREFIX,
  type TOrchestrationEvent,
} from './orchestration-events';
