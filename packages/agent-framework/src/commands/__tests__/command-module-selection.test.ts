import { describe, expect, it } from 'vitest';

import { selectCommandModules } from '../command-module-selection.js';
import { SystemCommandExecutor } from '../system-command.js';

import type { ICommandModule } from '../../command-api/index.js';

/**
 * PRESET-015 — the live command-module re-selection path is `selectCommandModules` (pure filter)
 * feeding `SystemCommandExecutor.replaceCommands`. The full SessionSkillRouter is impractical to
 * construct (≈12 required collaborators), so TC-02/TC-03 exercise the filter logic directly and
 * then assert the rebuilt executor reflects the selection — the exact two-step the router performs
 * in `reapplyCommandModuleSelection`.
 */
const MODULE_ALPHA: ICommandModule = {
  name: 'alpha',
  systemCommands: [
    { name: 'a1', description: 'alpha one', execute: () => ({ success: true, message: '' }) },
  ],
};

const MODULE_BETA: ICommandModule = {
  name: 'beta',
  systemCommands: [
    { name: 'b1', description: 'beta one', execute: () => ({ success: true, message: '' }) },
  ],
};

const ALL_MODULES: readonly ICommandModule[] = [MODULE_ALPHA, MODULE_BETA];

/** Mirror of SessionSkillRouter.reapplyCommandModuleSelection over a fresh executor. */
function rebuildExecutor(
  enabled: readonly string[] | undefined,
  disabled: readonly string[] | undefined,
): SystemCommandExecutor {
  const executor = new SystemCommandExecutor(
    ALL_MODULES.flatMap((module) => module.systemCommands ?? []),
  );
  const selected = selectCommandModules(ALL_MODULES, enabled, disabled);
  executor.replaceCommands(selected.flatMap((module) => module.systemCommands ?? []));
  return executor;
}

describe('selectCommandModules (PRESET-015)', () => {
  it('returns the full set unchanged when neither list is given', () => {
    expect(selectCommandModules(ALL_MODULES, undefined, undefined)).toEqual(ALL_MODULES);
  });

  it('TC-02: disable removes a module — its commands disappear from the rebuilt executor', () => {
    const executor = rebuildExecutor(undefined, ['beta']);
    expect(executor.hasCommand('a1')).toBe(true);
    expect(executor.hasCommand('b1')).toBe(false);
  });

  it('TC-03: allowlist keeps only the listed module — only its commands remain', () => {
    const executor = rebuildExecutor(['beta'], undefined);
    expect(executor.hasCommand('a1')).toBe(false);
    expect(executor.hasCommand('b1')).toBe(true);
  });

  it('deny wins over allow when a module appears in both lists', () => {
    const selected = selectCommandModules(ALL_MODULES, ['alpha', 'beta'], ['beta']);
    expect(selected.map((module) => module.name)).toEqual(['alpha']);
  });
});
