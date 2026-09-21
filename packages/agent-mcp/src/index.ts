// @robota-sdk/agent-mcp

// MCP-001: the definition control plane. `agent-mcp` is the sole owner of MCP server definitions
// and their raw/validated/resolved forms, provenance and shadow metadata, strict foreign decoding,
// environment templates, whole-entry precedence, reversible disable overlays, redacted management
// projections, activation identity, and pure management results (ADR-005).
export type {
  IMCPDefinitionProblem,
  IMCPDefinitionShadow,
  IMCPResolvedEntry,
  IMCPServerDefinition,
  IMCPServerDefinitionRaw,
  IMCPServerDefinitionResolved,
  IMCPUnsetVariable,
  TMCPDefinitionSource,
  TMCPTransport,
} from './definition/types.js';
export {
  decodeEntry,
  decodeSource,
  readRawEntries,
  type IMCPDecodeResult,
} from './definition/decode.js';
export { materializeDefinition, type IMCPEnvironment } from './definition/env-template.js';
export {
  MCP_SOURCE_PRECEDENCE,
  resolveByPrecedence,
  type IMCPSourceCandidates,
} from './definition/precedence.js';
export {
  applyDisableOverlay,
  clearDisable,
  isDisabled,
  MCPOverlayError,
  type IMCPDisableOverlay,
} from './definition/overlay.js';
export {
  projectEntries,
  projectEntry,
  REDACTED,
  type IMCPDefinitionProjection,
} from './definition/projection.js';
export {
  activationIdentity,
  definitionFingerprint,
  securityIdentity,
  type IMCPActivationIdentity,
} from './definition/identity.js';
export {
  MCPDefinitionRegistry,
  type IMCPDefinitionRegistryOptions,
} from './definition/registry.js';
export {
  getServer,
  listServers,
  statusOf,
  type IMCPListResult,
  type IMCPStatusResult,
  type TMCPGetResult,
} from './management/results.js';
export { MCPTool, createMCPTool, type IMCPConfig, type IMCPToolOptions } from './mcp-tool';
export {
  InMemoryMCPActivationApprovalStore,
  MCPActivationAdmissionService,
  MCPActivationPolicyError,
  createFailClosedMCPActivationAdmission,
  type IMCPActivationAdmission,
  type IMCPActivationApprovalRecord,
  type IMCPActivationApprovalStore,
  type IMCPActivationAuditEvent,
  type IMCPActivationProvenance,
  type IMCPActivationRequest,
  type IMCPActivationStatusResult,
  type IMCPActivationWorkspace,
  type TMCPActivationSource,
  type TMCPActivationStatus,
  type TMCPApprovalAuthority,
  type TMCPWorkspaceTrustState,
} from './mcp-activation.js';
export {
  MCPActivationController,
  type IMCPActivationDefinitionRegistry,
  type IMCPActivationSummary,
} from './mcp-activation-controller.js';
export { RelayMcpTool, type IRelayMcpOptions, type IRelayMcpContext } from './relay-mcp-tool';
// CORE-040: the third-party trust boundary. Exported because the decision it encodes — which parts
// of someone else's schema this runtime can enforce — is one a consumer needs to be able to inspect
// and to be told about, not one that should only exist inside two classes.
export {
  narrowToUniversalSubset,
  ThirdPartySchemaValidator,
  type INarrowedSchema,
  type TUnenforceableSchemaReporter,
} from './third-party-schema';
