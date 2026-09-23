import type { IProviderDefinition, IToolResultAdmissionOptions } from '@robota-sdk/agent-core';
import type {
  IMCPActivationApprovalStore,
  IMCPHttpTransportDeps,
  IMCPStdioAuthority,
} from '@robota-sdk/agent-mcp';
import type {
  ICommandMCPActivationAdapter,
  ICommandModule,
  IWorkspaceProjectMutation,
  IWorkspaceProjectSettingsWriter,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { IOutputStyleSource } from '@robota-sdk/agent-preset';

/**
 * Leaf type module: holds {@link IStartCliOptions} so it can be imported by both
 * `command-setup.ts` and `doctor-inputs.ts` without creating an import cycle between them.
 * Re-exported from `command-setup.ts` so existing imports keep working.
 */
export interface IStartCliOptions {
  commandModules?: readonly ICommandModule[];
  providerDefinitions?: readonly IProviderDefinition[];
  /** Initial trusted-or-restricted workspace decision. Absence is Restricted. */
  projectAccess?: TWorkspaceProjectAccess;
  /** Separately approved project-settings write capability. */
  projectSettingsWriter?: IWorkspaceProjectSettingsWriter;
  /** Separately approved bounded project mutation capability. */
  projectMutation?: IWorkspaceProjectMutation;
  /** Host-composed MCP definition registry and trust-admission controller. */
  mcpActivationAdapter?: ICommandMCPActivationAdapter;
  /** Host-owned per-server subprocess capabilities; never inferred from settings. */
  mcpStdioAuthorities?: Readonly<Record<string, IMCPStdioAuthority>>;
  /** Host-owned approval state, shared with the canonical MCP activation controller. */
  mcpApprovalStore?: IMCPActivationApprovalStore;
  /** Host-owned HTTP transport policy; never supplied by MCP settings or a remote caller. */
  mcpHttpTransportDeps?: IMCPHttpTransportDeps;
  /** Host-configured character limits; generic admission validates the ordering and ceiling. */
  mcpResultAdmissionLimits?: Pick<
    IToolResultAdmissionOptions,
    'warningChars' | 'hardChars' | 'repositoryMaxChars'
  >;
  /** Host-composed managed output styles, applied above user/project style sources. */
  managedOutputStyleSources?: readonly IOutputStyleSource[];
}
