// @robota-sdk/agent-tool-mcp
export { MCPTool, createMCPTool, type IMCPConfig } from './mcp-tool';
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
