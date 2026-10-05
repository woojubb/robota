import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';

import { withholdProviderCredentials } from '../product/command-environment.js';
import { createInitialCliWorkspaceComposition } from './workspace-project-composition.js';

import type { IStartCliOptions } from './cli-options-types.js';
import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

/**
 * Admits the startup trust decision. A trust granted just now admits project settings whose `$ENV:`
 * credentials the first withholding could not see, so it withholds again over the final settings
 * (issue #3429).
 */
export function admitStartupTrustDecision(
  startupOptions: IStartCliOptions,
  projectAccess: TWorkspaceProjectAccess,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  startupOptions.projectAccess = projectAccess;
  withholdProviderCredentials(
    createInitialCliWorkspaceComposition(cwd, startupOptions).settingsSources,
    startupOptions.providerDefinitions ?? createDefaultProviderDefinitions(),
    environment,
  );
}
