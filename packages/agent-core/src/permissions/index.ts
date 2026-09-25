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
  requiresFreshApproval,
  isToolDeniedOutright,
  toolNameMatches,
  parseParameterRule,
  matchesAnyPattern,
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
  TMatchDirection,
  IPermissionEvaluationContext,
  IParameterRule,
} from './permission-gate.js';
export { projectPermissionPolicy } from './permission-policy.js';
export {
  isProtectedPath,
  removesCriticalPath,
  PROTECTED_DIRECTORY_NAMES,
  PROTECTED_FILE_NAMES,
} from './permission-safeguards.js';
export type { ICriticalPathContext } from './permission-safeguards.js';
export {
  validatePermissionPattern,
  findInvalidPermissionPatterns,
  findPermissionPatternWarnings,
} from './pattern-validation.js';
export type { IPermissionPatternProblem } from './pattern-validation.js';
export type { IPermissionPolicyContext, IPermissionPolicyProjection } from './permission-policy.js';
export { RISK_CLASS_POLICY, UNCLASSIFIED_TOOL_FALLBACK } from './permission-mode.js';
export type { TToolRiskClass } from './permission-mode.js';
export { applyPresetToolLists, toolNamesToPatterns } from './tool-list-patterns.js';
export { splitCommandSegments } from './command-segments.js';
export { isReadOnlyCommandLine } from './read-only-commands.js';
export type { IReadOnlyCommandContext, TResolveInWorkspace } from './read-only-commands.js';
