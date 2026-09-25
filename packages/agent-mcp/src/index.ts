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

// MCP-2520: the reusable trust boundary. Host-injected, transport-neutral, deny-by-default.
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

// MCP-002/MCP-2522: the official-SDK client behind one admit-then-construct transport seam.
export {
  admitHttpEndpoint,
  constructStreamableHttpTransport,
  createStreamableHttpAdapter,
  MCPTransportRedirectRefusedError,
  MCPTransportResponseLimitError,
  type IMCPAdmittedHttpEndpoint,
  type IMCPHttpEndpoint,
  type IMCPHttpTransportDeps,
  type IMCPTransportAdapter,
  type TMCPTransportAdmission,
  type TMCPTransportKind,
} from './client/transport.js';
export {
  createStdioAdapter,
  type IMCPAdmittedStdioEndpoint,
  type IMCPStdioAdapterOptions,
  type IMCPStdioAuthority,
  type IMCPStdioExecutable,
  type IMCPStdioInput,
} from './client/stdio.js';
export { MCPStdioError } from './client/stdio-transport.js';
export {
  MCPSessionError,
  MCP_EXTERNAL_EVENT_CAPABILITY,
  MCP_EXTERNAL_EVENT_METHOD,
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  openMcpSession,
  type IMCPDiscoverOptions,
  type IMCPOpenSessionOptions,
  type IMCPSession,
  type IMCPSessionTimeouts,
  type IMCPExternalEvent,
  type IMCPToolCallOptions,
  type IMCPToolCallResult,
  type TMCPListChangedListener,
  type TMCPExternalEventListener,
} from './client/session.js';

// MCP-002: the canonical catalog — what a server disclosed, and what this package decided to expose,
// with provenance, stable collision-safe naming and explicit adopted / adapted / rejected dispositions.
export {
  MCP_CANONICAL_NAME_BUDGET,
  MCPDiscoveryError,
  catalogIdentityOf,
  sameCatalogIdentity,
  type IMCPCatalog,
  type IMCPCatalogIdentity,
  type IMCPCatalogPromptEntry,
  type IMCPCatalogProvenance,
  type IMCPCatalogRejection,
  type IMCPCatalogResourceEntry,
  type IMCPCatalogServerEntry,
  type IMCPCatalogToolEntry,
  type IMCPDiscoveredPrompt,
  type IMCPDiscoveredPromptArgument,
  type IMCPDiscoveredResource,
  type IMCPDiscoveredTool,
  type IMCPDiscovery,
  type IMCPDiscoveryDomainResult,
  type IMCPDiscoveryFailure,
  type IMCPServerIdentity,
  type TMCPCanonicalName,
  type TMCPCapabilityDomain,
  type TMCPCapabilityState,
  type TMCPCatalogDisposition,
  type TMCPCatalogEntry,
  type TMCPDiscoveryFailureKind,
} from './catalog/types.js';
export {
  canonicalName,
  resolveNameCollisions,
  type INameCollisionCandidate,
} from './catalog/naming.js';
export { buildCatalog, type IBuildCatalogOptions, type IMCPCatalogInput } from './catalog/build.js';
export {
  createDiscoveredTool,
  type ICreateDiscoveredToolOptions,
  type IMCPToolInvoker,
} from './catalog/discovered-tool.js';

// MCP-002 (absorbing MCP-003): connection and catalog lifecycle. `TMCPConnectionState` is the ONE
// connection-state union under `src/**`.
export {
  DEFAULT_MCP_BACKOFF,
  MCPConnectionSupervisor,
  MCPSupervisorError,
  classifyMcpFailure,
  type IMCPBackoffPolicy,
  type IMCPConnectionSupervisorOptions,
  type IMCPLastKnownGood,
  type IMCPSupervisorClock,
  type IMCPTimeouts,
  type TMCPConnectionState,
  type TMCPFailureClass,
} from './supervisor/connection.js';

// CORE-040: the third-party trust boundary. Exported because the decision it encodes — which parts
// of someone else's schema this runtime can enforce — is one a consumer needs to be able to inspect
// and to be told about, not one that should only exist inside the catalog builder.
export {
  narrowToUniversalSubset,
  ThirdPartySchemaValidator,
  type INarrowedSchema,
  type TUnenforceableSchemaReporter,
} from './third-party-schema';
