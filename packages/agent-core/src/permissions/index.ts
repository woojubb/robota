// Permissions module
export type {
  TPermissionMode,
  TTrustLevel,
  TPermissionDecision,
  TBackgroundPermissionPolicy,
} from './types.js';
export { TRUST_TO_MODE, DEFAULT_BACKGROUND_PERMISSION_POLICY } from './types.js';
export {
  evaluatePermission,
  registerToolPermissionProfile,
  clearRegisteredToolProfiles,
  getToolPermissionProfile,
} from './permission-gate.js';
export type {
  TToolArgs,
  IPermissionLists,
  IToolPermissionProfile,
  IToolPermissionArgument,
  TArgumentKind,
} from './permission-gate.js';
export { resolvePermissionByPolicy } from './permission-policy.js';
export type { TPermissionPolicyDecision, IPermissionPolicyContext } from './permission-policy.js';
export { RISK_CLASS_POLICY, UNCLASSIFIED_TOOL_FALLBACK } from './permission-mode.js';
export type { TToolRiskClass } from './permission-mode.js';
export { applyPresetToolLists, toolNamesToPatterns } from './tool-list-patterns.js';
