import type { IAgentConfig, IProviderDefinition, IToolResultAdmissionOptions } from '@robota-sdk/agent-core';
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
import type { IProductConfig, TConfigEnvironment } from '@robota-sdk/product-config';
import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { THostedRuntimeExecutorFactory } from '../hosted/hosted-runtime-types.js';

/**
 * Leaf type module: holds {@link IStartCliOptions} so it can be imported by both
 * `command-setup.ts` and `doctor-inputs.ts` without creating an import cycle between them.
 * Re-exported from `command-setup.ts` so existing imports keep working.
 */
export interface IStartCliOptions {
  /** Optional operator override for the installed hosted worker execution owner. */
  hostedRuntimeExecutorFactory?: THostedRuntimeExecutorFactory;
  /** Host-owned product configuration resolved once per invocation. */
  productConfig?: IProductConfig;
  /** Explicit source/development environment snapshot; never retained across invocations. */
  environment?: TConfigEnvironment;
  /** Explicit absolute product environment-file selection. */
  productConfigFile?: string;
  /** Already-resolved context shared by this invocation and its mode branches. */
  productRuntime?: ICliRuntimeContext;
  commandModules?: readonly ICommandModule[];
  providerDefinitions?: readonly IProviderDefinition[];
  /** Initial trusted-or-restricted workspace decision. Absence is Restricted. */
  projectAccess?: TWorkspaceProjectAccess;
  /** `--safe-mode`: every customization off — see `SAFE_MODE_FLAG`. */
  safeMode?: boolean;
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
  /** Local embedding-host policy; worker hosts supply their own, never a serialized host function. */
  toolExecutionPolicy?: IAgentConfig['toolExecutionPolicy'];
  /** Host-configured character limits; generic admission validates the ordering and ceiling. */
  mcpResultAdmissionLimits?: Pick<
    IToolResultAdmissionOptions,
    'warningChars' | 'hardChars' | 'repositoryMaxChars'
  >;
  /** Host-composed managed output styles, applied above user/project style sources. */
  managedOutputStyleSources?: readonly IOutputStyleSource[];
}
