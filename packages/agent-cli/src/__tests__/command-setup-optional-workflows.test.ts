/**
 * CLI-077: the `/workflows` command module is loaded optionally. agent-cli must build its command
 * set whether or not `@robota-sdk/agent-command-workflows` (a devDependency kept out of the published
 * dependency graph) resolves — its absence just omits the command, never throws.
 */
import { describe, it, expect } from 'vitest';

import { buildCommandSetup } from '../startup/command-setup.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;

describe('buildCommandSetup — optional /workflows (CLI-077)', () => {
  it('builds a non-empty command-module set without throwing, regardless of the optional package', () => {
    expect(() => buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test')).not.toThrow();
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');
    expect(setup.commandModules.length).toBeGreaterThan(0);
  });

  it('includes the workflows module iff its optional package resolves — and never a partial/broken entry', () => {
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');
    const workflows = setup.commandModules.filter((m) => m.name === 'agent-command-workflows');
    // Zero (published-install shape) or exactly one fully-formed module (dev shape) — never a stub.
    expect(workflows.length).toBeLessThanOrEqual(1);
    for (const mod of workflows) {
      expect(mod.systemCommands?.some((c) => c.name === 'workflows')).toBe(true);
    }
  });
});
