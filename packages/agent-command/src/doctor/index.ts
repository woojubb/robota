export {
  DoctorCommandSource,
  createDoctorCommandEntry,
  createDoctorCommandModule,
} from './doctor-command-module.js';
export { createNodeDoctorDeps, resolveCommandOnPath } from './doctor-node-deps.js';
export { renderDoctorReport } from './doctor-render.js';
export { collectSettingsSecrets, redactDiagnosticText } from './doctor-redaction.js';
export {
  DOCTOR_REPAIR_ALLOWLIST,
  applyDoctorRepair,
  isDoctorRepairId,
  planDoctorRepair,
} from './doctor-repair.js';
export type {
  IDoctorRepairPlan,
  TDoctorRepairId,
  TDoctorRepairOutcome,
  TDoctorRepairPlanResult,
} from './doctor-repair.js';
export { buildDoctorReport, runDoctor } from './doctor-runner.js';
export type {
  IDoctorCheck,
  IDoctorDeps,
  IDoctorEndpointProbeResult,
  IDoctorInputs,
  IDoctorPathFacts,
  IDoctorReport,
  TDoctorCheckStatus,
  TDoctorNotProbed,
} from './doctor-types.js';
