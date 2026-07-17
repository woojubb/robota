/**
 * SELFHOST-002: explicit plan-mode.
 *
 * Public surface of the plan module: the pure phase controller. The plan artifact + approval-event
 * contract types (`IPlanArtifact`, `IPlanApprovalEvent`, …) live in
 * `@robota-sdk/agent-interface-transport` (the persistence/transport SSOT), beside `IGoalState`.
 */

export { PlanController, type TPlanDecision, type IPlanControllerDeps } from './plan-controller.js';
