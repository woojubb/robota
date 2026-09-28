/**
 * #3282 §4e — the acceptance criterion as a test: every built-in command the GUI's `get-commands`
 * catalog can return is either GUI-available (not on the exclusion list — it has a screen, a
 * control, or it works fine typed, per the Step 1 inventory in the PR body) or is on the documented
 * exclusion list (`excluded-commands.ts`, reasons grouped in `packages/agent-gui-web/docs/SPEC.md`).
 *
 * `agent-ui-web` does not depend on `agent-command`/`agent-framework` (see its own SPEC.md), so this
 * is a hand-kept snapshot of the built-in registry (`packages/agent-command/src/default/default-command-modules.ts`,
 * plus `/workflows` which `agent-cli` registers alongside it) — not a live import of it. A command
 * added there needs a matching line here, exactly like any other cross-package contract this
 * repository does not enforce by the type system alone.
 */

import { describe, expect, it } from 'vitest';

import { excludedCommandMessage, isExcludedCommand } from '../excluded-commands.js';

import type { IExcludableCommandEntry } from '../excluded-commands.js';

/** Every built-in command name, as `createDefaultCommandModules` (+ `/workflows`) registers it. */
const BUILTIN_COMMANDS: readonly IExcludableCommandEntry[] = [
  { name: 'help' },
  { name: 'agent' },
  { name: 'effort' },
  { name: 'advisor' },
  { name: 'permissions' },
  { name: 'mode' },
  { name: 'sandbox' },
  { name: 'preset' },
  { name: 'output-style' },
  { name: 'language' },
  { name: 'background' },
  { name: 'fork' },
  { name: 'goal' },
  { name: 'plan' },
  { name: 'shell', runner: 'client', surfaces: ['terminal'] },
  { name: 'editor', runner: 'client', surfaces: ['terminal'] },
  { name: 'git' },
  { name: 'keybindings', runner: 'client', surfaces: ['terminal'] },
  { name: 'theme', runner: 'client', surfaces: ['terminal'] },
  { name: 'doctor' },
  { name: 'memory' },
  { name: 'mcp' },
  { name: 'skills' },
  { name: 'user-local' },
  { name: 'compact' },
  { name: 'context' },
  { name: 'exit' },
  { name: 'clear' },
  { name: 'rename' },
  { name: 'cd' },
  { name: 'resume' },
  { name: 'cost' },
  { name: 'validate-session' },
  { name: 'reset' },
  { name: 'rewind' },
  { name: 'schedule' },
  { name: 'monitor' },
  { name: 'loop' },
  { name: 'statusline' },
  { name: 'plugin' },
  { name: 'reload-plugins' },
  { name: 'settings' },
  { name: 'peers' },
  { name: 'events' },
  { name: 'handoff' },
  { name: 'remote-control' },
  { name: 'devices' },
  { name: 'provider' },
  { name: 'model' },
  { name: 'workflows' },
];

/** The documented exclusion list — this repository's answer to "GUI-available or excluded". */
const DOCUMENTED_EXCLUSIONS = new Set([
  'theme',
  'keybindings',
  'editor',
  'statusline',
  'shell',
  'exit',
  'devices',
]);

describe('#3282 §4e — every built-in command is GUI-available or on the exclusion list', () => {
  it('classifies every command consistently: excluded means documented, everything else is available', () => {
    for (const command of BUILTIN_COMMANDS) {
      const excluded = isExcludedCommand(command);
      const documented = DOCUMENTED_EXCLUSIONS.has(command.name);
      expect(
        excluded,
        `${command.name}: isExcludedCommand()=${excluded} but the documented exclusion list says ${documented}`,
      ).toBe(documented);
    }
  });

  it('the documented exclusion list is exactly the excluded set — nothing more, nothing fewer', () => {
    const actuallyExcluded = BUILTIN_COMMANDS.filter((c) => isExcludedCommand(c)).map((c) => c.name);
    expect(new Set(actuallyExcluded)).toEqual(DOCUMENTED_EXCLUSIONS);
  });

  it('every excluded command has its own plain sentence naming what to use instead', () => {
    for (const name of DOCUMENTED_EXCLUSIONS) {
      const message = excludedCommandMessage(name);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/not available on this surface/i);
    }
  });

  it('covers every command exactly once — no duplicate, nothing forgotten from the Step 1 inventory', () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBe(50);
  });
});
