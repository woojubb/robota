import path from 'node:path';

import { WORKSPACE_ROOT } from './shared.mjs';

const PACKAGE_SCRIPT_CANDIDATES = {
  verify: [
    'scenario:verify',
    'verify:scenario',
    'example:verify',
    'verify:examples',
  ],
  record: [
    'scenario:record',
    'record:scenario',
    'record:examples',
  ],
};

// Transitional extension point for scopes that cannot yet expose package-level
// scenario scripts. Keep this empty by default and prefer owner package scripts
// for both verify and record flows.
const SCENARIO_OWNER_COMMANDS = {};

export function resolveScenarioCommand(scope, mode = 'verify') {
  for (const scriptName of PACKAGE_SCRIPT_CANDIDATES[mode] ?? []) {
    if (!scope.scripts[scriptName]) {
      continue;
    }

    return {
      source: 'package-script',
      commands: [
        {
          label: `package script ${scriptName}`,
          command: 'pnpm',
          args: [scriptName],
          workdir: path.join(WORKSPACE_ROOT, scope.relativeDir),
          env: {},
        },
      ],
    };
  }

  return SCENARIO_OWNER_COMMANDS[scope.relativeDir] ?? null;
}

export function resolveScenarioVerification(scope) {
  return resolveScenarioCommand(scope, 'verify');
}

export function resolveScenarioRecord(scope) {
  return resolveScenarioCommand(scope, 'record');
}
