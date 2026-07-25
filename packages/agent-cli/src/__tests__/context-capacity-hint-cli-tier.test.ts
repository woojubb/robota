/**
 * NEUT-005 wave 2 — CLI-tier context-capacity hint.
 *
 * The zero-dependency core emits a product-neutral hard-capacity notice; the actionable
 * remediation wording is a SURFACE concern. The CLI registers a `/compact` command, so its
 * built command-module set must derive the concrete hint ("Run /compact and retry.") that the
 * framework injects into the session's Robota config via `IAgentConfig.contextCapacityHint`.
 */
import { describe, it, expect } from 'vitest';

import { deriveContextCapacityHint } from '@robota-sdk/agent-framework';

import { buildCommandSetup } from '../startup/command-setup.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;

describe('CLI-tier context-capacity hint (NEUT-005)', () => {
  it('registers a compact command in the default module set', () => {
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');
    const hasCompact = setup.baseCommandModules.some((m) =>
      m.systemCommands?.some((c) => c.name === 'compact'),
    );
    expect(hasCompact).toBe(true);
  });

  it('derives the actionable /compact hint from the CLI-built command set', () => {
    const setup = buildCommandSetup('/tmp', MINIMAL_ARGS, {}, '0.0.0-test');
    expect(deriveContextCapacityHint(setup.baseCommandModules)).toBe('Run /compact and retry.');
  });
});
