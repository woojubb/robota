import { describe, expect, it } from 'vitest';

import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { buildCreateSessionOptions } from '../create-session-projection.js';

import type { ICreateSessionProjectionDeps } from '../create-session-projection.js';
import type { IInitOptions } from '../interactive-session-options.js';
import type { TGuardrail } from '@robota-sdk/agent-core';

/**
 * ARCH-013 stage 3 — the consumer-supplied guardrail registry reaches the session.
 *
 * `guardrails` was READ all along: `create-session.ts` installs a `PreToolUse` guardrail hook
 * whenever the registry is non-empty. It could not be SET, because this projection dropped it — so a
 * documented capability (SELFHOST-005) was unreachable from every public surface rather than merely
 * unused.
 *
 * It is a consumer-supplied port: the repo ships no implementation of it, which is what makes "the
 * chain is broken" the whole defect. Stage 1's `scan-option-reachability` froze it as an
 * unreachable key; this change removes it from that baseline, and the scan is what stops it
 * silently returning to it.
 */
const DEPS: ICreateSessionProjectionDeps = {
  mergedConfig: { provider: { name: 'test', model: 'test-model' } } as never,
  cwd: '/arch-013-stage-3',
  context: {} as ICreateSessionProjectionDeps['context'],
  projectInfo: {} as ICreateSessionProjectionDeps['projectInfo'],
  sessionId: 'test-session',
  contextCapacityHint: undefined,
  contributionSources: [],
  skillRoots: [],
};

function initOptions(extra: Partial<IInitOptions>): IInitOptions {
  return {
    host: createTestFrameworkHost(),
    cwd: '/arch-013-stage-3',
    provider: {} as never,
    ...extra,
  } as IInitOptions;
}

describe('ARCH-013 stage 3 — a consumer can supply the guardrail registry', () => {
  it('projects the registry onto the session options the assembler reads', () => {
    const blockEverything: TGuardrail = () => ({ pass: false, reason: 'blocked by test' });

    const built = buildCreateSessionOptions(initOptions({ guardrails: { blockEverything } }), DEPS);

    expect(built.guardrails).toBeDefined();
    expect(built.guardrails?.['blockEverything']).toBe(blockEverything);
  });

  it('omits the key entirely when no registry is supplied', () => {
    // A conditional spread rather than `guardrails: undefined`: `create-session.ts` branches on
    // `options.guardrails && Object.keys(...).length > 0`, and an explicitly-undefined key is the
    // shape that reintroduces an absent member through a spread (ARCH-029's lesson, one package over).
    const built = buildCreateSessionOptions(initOptions({}), DEPS);

    expect('guardrails' in built).toBe(false);
  });
});
