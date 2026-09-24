export {
  DoctorCommandSource,
  createDoctorCommandEntry,
  createDoctorCommandModule,
} from './doctor-command-module.js';
export { createNodeDoctorDeps, resolveCommandOnPath } from './doctor-node-deps.js';
export { renderDoctorReport } from './doctor-render.js';
export type { IDoctorDisplayVocabulary } from './doctor-render.js';
export { collectSettingsSecrets, redactDiagnosticText } from './doctor-redaction.js';
export {
  STORAGE_REPAIR_ID,
  doctorRepairAllowlist,
  applyDoctorRepair,
  isDoctorRepairId,
  planDoctorRepair,
} from './doctor-repair.js';
export type {
  IDoctorRepairPlan,
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
