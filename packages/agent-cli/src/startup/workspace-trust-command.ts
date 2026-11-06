import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { createInterface } from 'node:readline/promises';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { productProviderDefinitions } from '../product/provider-definitions.js';
import {
  type TWorkspaceProjectAccess,
  type WorkspaceTrustService,
} from '@robota-sdk/agent-framework';
import { BrokeredWorkspaceTrustService } from './brokered-workspace-trust.js';

import { formatProjectContributionPreview } from './project-contribution-preview.js';
import { trustQuestionFor } from './interactive-trust-prompt.js';
import { createInitialCliWorkspaceComposition } from './workspace-project-composition.js';
import { providerEnvironmentReferences } from '../product/restart-environment.js';

type TWorkspaceTrustAction = 'status' | 'grant' | 'revoke' | 'release';

function accessState(access: TWorkspaceProjectAccess): string {
  return access.status === 'trusted' ? 'trusted' : access.trustState;
}

function accessPath(access: TWorkspaceProjectAccess): string | undefined {
  return access.status === 'trusted' ? access.identity.displayPath : access.displayPath;
}

function printAccess(access: TWorkspaceProjectAccess, runtime: ICliRuntimeContext): void {
  process.stdout.write(`Workspace trust: ${accessState(access)}\n`);
  const displayPath = accessPath(access);
  if (displayPath !== undefined) process.stdout.write(`Workspace: ${displayPath}\n`);
  if (access.status !== 'trusted') {
    process.stdout.write(
      'Project settings, hooks, plugins, skills, and provider overrides are disabled.\n',
    );
    if (access.trustState !== 'identity-unavailable') {
      process.stdout.write(`Grant access with: ${runtime.config.identity.cliName} trust --yes\n`);
    }
  }
}

/** The state, the folder, whether a person can be asked, and what trust would load. */
function trustStatusJson(
  access: TWorkspaceProjectAccess,
  cwd: string,
  runtime: ICliRuntimeContext,
  providerDefinitions: readonly IProviderDefinition[],
  candidate?: string,
): Record<string, unknown> {
  const question = trustQuestionFor(access, cwd, runtime);
  return {
    state: accessState(access),
    workspace: accessPath(access) ?? cwd,
    askable: question !== undefined,
    loads: question?.loads ?? [],
    ...(candidate === undefined ? {} : { candidate }),
    ...(access.status === 'trusted' ? {
      providerEnvRefs: providerEnvironmentReferences(
        createInitialCliWorkspaceComposition(cwd, { productRuntime: runtime, projectAccess: access }).settingsSources,
        providerDefinitions,
      ),
    } : {}),
  };
}

/** Handle trust before normal startup; load project settings only after trusted admission. */
export async function runWorkspaceTrustCommand(
  argv: readonly string[],
  cwd: string,
  runtime: ICliRuntimeContext,
  service?: WorkspaceTrustService,
  providerDefinitions?: readonly IProviderDefinition[],
): Promise<number> {
  const action = ((argv[0] !== undefined && !argv[0].startsWith('-') ? argv[0] : undefined) ??
    (argv.includes('--yes') ? 'grant' : 'status')) as TWorkspaceTrustAction;
  if (!['status', 'grant', 'revoke', 'release'].includes(action)) {
    process.stderr.write(`Usage: ${runtime.config.identity.cliName} trust [status [--json]|grant|revoke|release] [--yes]\n`);
    return 1;
  }
  if (action !== 'status' && action !== 'release' && process.stdin.isTTY !== true && !argv.includes('--yes')) {
    process.stderr.write(`${runtime.config.identity.cliName} trust ${action} requires --yes in headless mode.\n`);
    return 1;
  }
  try {
    const brokered = service === undefined ? await BrokeredWorkspaceTrustService.create(runtime) : undefined;
    const trust = service ?? brokered!;
    if (action === 'release') {
      const index = argv.indexOf('--candidate');
      if (brokered === undefined || index < 0 || argv[index + 1] === undefined) return 1;
      await brokered.release(argv[index + 1]!);
      return 0;
    }
    let prepared: string | undefined;
    if (action === 'grant' && brokered !== undefined) {
      if (process.stdin.isTTY !== true) {
        process.stderr.write('Workspace trust requires a person at this terminal.\n');
        return 1;
      }
      prepared = await brokered.prepare(cwd);
      const current = await brokered.inspect(cwd);
      process.stdout.write(`Workspace: ${accessPath(current) ?? cwd}\n`);
      process.stdout.write(formatProjectContributionPreview(current.identity, cwd, runtime));
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      let answer: string;
      try {
        answer = await prompt.question('Trust this exact folder? [y/N] ');
      } finally {
        prompt.close();
      }
      if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
        await brokered.release(prepared);
        process.stdout.write('Workspace trust was not granted.\n');
        return 1;
      }
    }
    const access =
      action === 'grant'
        ? brokered === undefined ? await service!.grant(cwd) : await brokered.grant(cwd, prepared!)
        : action === 'revoke'
          ? await trust.revoke(cwd)
          : await trust.inspect(cwd);
    if (action === 'status' && argv.includes('--json')) {
      // For a client that asks a person itself (the desktop app) before it starts a runtime here.
      const candidate = brokered !== undefined && trustQuestionFor(access, cwd, runtime) !== undefined
        ? await brokered.prepare(cwd) : undefined;
      process.stdout.write(`${JSON.stringify(trustStatusJson(access, cwd, runtime, providerDefinitions ?? productProviderDefinitions(), candidate))}\n`);
      return 0;
    }
    printAccess(access, runtime);
    if (action === 'status' && access.status !== 'trusted') {
      process.stdout.write(formatProjectContributionPreview(access.identity, cwd, runtime));
    }
    // A grant succeeds when the folder ends up trusted; a revoke when it no longer is.
    if (action === 'grant') return access.status === 'trusted' ? 0 : 1;
    if (action === 'revoke') return access.status === 'trusted' ? 1 : 0;
    return 0;
  } catch (error) {
    process.stderr.write(
      `Workspace trust ${action} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
