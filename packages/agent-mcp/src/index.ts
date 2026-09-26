// @robota-sdk/agent-mcp

// MCP-001: the definition control plane. `agent-mcp` is the sole owner of MCP server definitions
// and their raw/validated/resolved forms, provenance and shadow metadata, strict foreign decoding,
// environment templates, whole-entry precedence, reversible disable overlays, redacted management
// projections, activation identity, and pure management results (docs/SPEC.md).
export type {
  IMCPDefinitionProblem,
  IMCPDefinitionShadow,
  IMCPHeadersHelper,
  IMCPOAuthConfig,
  IMCPResolvedEntry,
  IMCPServerDefinition,
  IMCPServerDefinitionRaw,
  IMCPServerDefinitionResolved,
  IMCPUnsetVariable,
  IMCPValueSpan,
  TMCPValueProvenance,
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
  isBlockedByManagedFailure,
  MCP_SOURCE_PRECEDENCE,
  resolveByPrecedence,
  type IMCPPrecedenceResult,
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
  activationEndpoint,
  activationIdentity,
  definitionFingerprint,
  securityIdentity,
  type IMCPActivationIdentity,
} from './definition/identity.js';
export {
  displayArgs,
  displayValue,
  isCredentialShapedName,
  looksLikeCredential,
  maskCredentials,
  SECRET_LITERAL,
  secretMarker,
  withoutExpansions,
  withoutSecrets,
} from './definition/secrecy.js';
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
// The client authentication port: a host-registered authenticator for one server identity.
export {
  MCPAuthenticationError,
  UNSUPPORTED_AUTHENTICATION_KEYS,
  type IMCPAuthorizationRejection,
  type IMCPAuthorizationRequest,
  type IMCPBoundAuthenticator,
  type IMCPClientAuthenticator,
  type TMCPAuthenticationFailure,
} from './client/authentication.js';
// The dynamic header helper: host-run, host-allowlisted, output parsed strictly here.
export {
  MCPHeadersHelperError,
  createHeadersHelperAuthenticator,
  isWorkspaceHelperSource,
  parseHeadersHelperOutput,
  refuseHeadersHelper,
  type IMCPHeadersHelperAuthenticator,
  type TMCPHeadersHelperFailure,
  type TMCPHeadersHelperRefusal,
  type TMCPHeadersHelperRun,
} from './client/headers-helper.js';
export {
  MCPSingleFlightCache,
  MCPSingleFlightClosedError,
  type IMCPSingleFlightEntry,
} from './client/single-flight.js';
export { isExecutionEnvironmentName } from './client/stdio-authority.js';
// OAuth sign-in and the authenticator that sends its tokens; storage and locking are ports.
export { MCPOAuthError, type TMCPOAuthFailure } from './client/oauth/errors.js';
export { createOAuthFetch, type IMCPOAuthNetwork } from './client/oauth/network.js';
export {
  canonicalServerUrl,
  discoverMCPOAuthServer,
  type IMCPOAuthDiscoveryInput,
  type IMCPOAuthServerInfo,
} from './client/oauth/discovery.js';
export {
  createPastedRedirectAcceptor,
  startOAuthCallbackServer,
  type IMCPOAuthPastedRedirect,
  type IMCPOAuthCallbackOptions,
  type IMCPOAuthCallbackResult,
  type IMCPOAuthCallbackServer,
} from './client/oauth/callback.js';
export {
  createFileOAuthCredentialStore,
  oauthCredentialKey,
  type IMCPOAuthCredential,
  type IMCPOAuthCredentialKey,
  type IMCPOAuthCredentialStore,
} from './client/oauth/store.js';
export {
  createFileOAuthRefreshLock,
  type IFileOAuthRefreshLockOptions,
  type IMCPOAuthRefreshLock,
} from './client/oauth/refresh-lock.js';
export {
  runMCPOAuthLogin,
  type IMCPOAuthLoginInput,
  type IMCPOAuthLoginResult,
} from './client/oauth/login.js';
export {
  readMCPOAuthCredentialState,
  runMCPOAuthLogout,
  type IMCPOAuthCredentialStateInput,
  type IMCPOAuthLogoutInput,
  type IMCPOAuthLogoutResult,
  type IMCPOAuthTokenRevocation,
  type TMCPOAuthCredentialState,
  type TMCPOAuthRevocationOutcome,
} from './client/oauth/lifecycle.js';
export {
  createOAuthAuthenticator,
  type IMCPOAuthAuthenticator,
  type IMCPOAuthAuthenticatorOptions,
  type TMCPOAuthNotice,
} from './client/oauth/authenticator.js';
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
  SUPPORTED_MCP_PROTOCOL_VERSIONS,
  openMcpSession,
  type IMCPDiscoverOptions,
  type IMCPOpenSessionOptions,
  type IMCPSession,
  type IMCPSessionTimeouts,
  type IMCPToolCallOptions,
  type IMCPToolCallResult,
  type TMCPListChangedListener,
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
