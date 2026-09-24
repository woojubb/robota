/**
 * The doctor's evidence model (OBSERVABILITY-1991).
 *
 * `fail` is the only status that raises the exit code — the CLI-067 contract `robota diagnose`
 * shipped with. `not-configured` names an absent optional capability out loud instead of treating
 * it as healthy. `not-probed` is a CLOSED list of probes the read-only doctor deliberately does not
 * run (see {@link TDoctorNotProbed}); an UNEXPECTED inability to probe is `warn` with its reason,
 * never `not-probed` — the third state `enforcement-architecture.md` says must never read as a pass.
 */
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IContributionSource,
  ISkillRootDescriptor,
  TSettingsSource,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { ICommandMCPActivationAdapter } from '@robota-sdk/agent-framework';

export type TDoctorCheckStatus = 'ok' | 'warn' | 'fail' | 'not-configured' | 'not-probed';

/** The enumerated probes the read-only doctor does not run. Adding one is a spec change. */
export type TDoctorNotProbed = 'mcp-connection' | 'hook-execution' | 'owner-only-mode';

export interface IDoctorCheck {
  /** Stable, user-typeable id (`settings.<scope>.<family>`, `storage.user`, `mcp.plugin.<id>.<server>`). */
  readonly id: string;
  readonly label: string;
  readonly status: TDoctorCheckStatus;
  /** The exact file or directory the finding is about, when there is one. */
  readonly path?: string;
  /** The specific cause, as the owner reported it — a state word, an issue path, an errno; never a secret. */
  readonly cause?: string;
  /** Free-text detail lines rendered under the check. */
  readonly detail?: readonly string[];
  /** Present when this run can repair the finding; names the allowlisted repair id (equal to `id`). */
  readonly repair?: string;
}

export interface IDoctorReport {
  readonly checks: readonly IDoctorCheck[];
  readonly failCount: number;
  readonly warnCount: number;
  /** Ids of checks whose `repair` is set in THIS run. */
  readonly repairable: readonly string[];
  /** Exit-code contract: `0` when `failCount === 0`, else `1`. */
  readonly exitCode: 0 | 1;
}

/** One TCP reachability result; the probe is injected so tests never touch the network. */
export interface IDoctorEndpointProbeResult {
  readonly reachable: boolean;
  readonly elapsedMs?: number;
  readonly error?: string;
}

/** What the host knows and the runner does not: the composition the shell built, and its facts. */
export interface IDoctorInputs {
  readonly cwd: string;
  readonly userHome: string;
  /**
   * The product's own user settings file — the only settings layer the repair allowlist may rewrite.
   * The host names it; this library knows no product layout.
   */
  readonly userSettingsPath: string;
  /** The product's user store root and its sessions directory, as the host lays them out. */
  readonly userStorage: { readonly root: string; readonly sessions: string };
  /** The project state root under a trusted workspace, when the host has one. */
  readonly projectStorageRoot?: string;
  /** Every settings source the runtime merge chain reads, in precedence order. */
  readonly settingsSources: readonly TSettingsSource[];
  readonly projectAccess: TWorkspaceProjectAccess;
  readonly providerDefinitions: readonly IProviderDefinition[];
  /** Environment map (test seam; default `process.env`). */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly contributionSources: readonly IContributionSource[];
  readonly skillRoots: readonly ISkillRootDescriptor[];
  /** Plugin scope directories, most specific first — the same list the session loader reads. */
  readonly pluginsDirs: readonly string[];
  /** Host-composed MCP activation adapter; absent means the CLI has no MCP host. */
  readonly mcpActivation?: ICommandMCPActivationAdapter;
  /** Checks only the host can make (Node version, terminal, CLI version); rendered first. */
  readonly hostChecks: readonly IDoctorCheck[];
  /** A workspace-composition failure the host converted into a check rather than a crash. */
  readonly compositionFailure?: IDoctorCheck;
}

/** Storage facts about one path, probed without writing. */
export interface IDoctorPathFacts {
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly writable: boolean;
  /** POSIX mode bits, or `undefined` when the platform does not assert them. */
  readonly mode?: number;
}

/** Every side effect the runner needs, with Node defaults in `doctor-node-deps.ts`. */
export interface IDoctorDeps {
  readonly probeEndpoint: (host: string, port: number) => Promise<IDoctorEndpointProbeResult>;
  readonly inspectPath: (path: string) => IDoctorPathFacts;
  /** `true` when a bare command name resolves on `PATH`, or a path-form command exists. */
  readonly resolveCommand: (command: string) => boolean;
  /** The platform's owner-only guarantee, from `@robota-sdk/agent-core/node`. */
  readonly ownerOnlyGuarantee: () => 'posix-mode' | 'windows-acl';
}
