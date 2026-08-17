import { describe, expect, it } from 'vitest';

import { buildCreateSessionOptions } from '../create-session-projection.js';

import type { ICreateSessionProjectionDeps } from '../create-session-projection.js';
import type { IInitOptions } from '../interactive-session-options.js';
import type { TGuardrail } from '@robota-sdk/agent-core';
import type { IRetrievalAdapter } from '@robota-sdk/agent-tools';

/**
 * ARCH-013 stage 3 — the two consumer-supplied extension ports reach the session.
 *
 * `guardrails` and `retrievalAdapter` were both READ all along: `create-session.ts` installs a
 * `PreToolUse` guardrail hook whenever the registry is non-empty, and `create-tools.ts` gates the
 * `CodebaseRetrieval` tool on the adapter. Neither could be SET, because this projection dropped
 * them — so two documented capabilities (SELFHOST-005, SELFHOST-003) were unreachable from every
 * public surface rather than merely unused.
 *
 * Both are consumer-supplied ports: the repo ships no implementation of either, which is what makes
 * "the chain is broken" the whole defect. Stage 1's `scan-option-reachability` froze both as
 * unreachable keys; this change removes them from that baseline, and the scan is what stops them
 * silently returning to it.
 */
const DEPS: ICreateSessionProjectionDeps = {
  mergedConfig: { provider: { name: 'test', model: 'test-model' } } as never,
  cwd: '/arch-013-stage-3',
  context: {} as ICreateSessionProjectionDeps['context'],
  projectInfo: {} as ICreateSessionProjectionDeps['projectInfo'],
  sessionId: 'test-session',
  logsDir: '/arch-013-stage-3/logs',
  contextCapacityHint: undefined,
};

function initOptions(extra: Partial<IInitOptions>): IInitOptions {
  return { cwd: '/arch-013-stage-3', provider: {} as never, ...extra } as IInitOptions;
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

describe('ARCH-013 stage 3 — a consumer can supply the retrieval adapter', () => {
  it('projects the adapter that gates CodebaseRetrieval', () => {
    // The real member is `retrieve` returning `IRetrievalResult`, and it is written cast-free for a
    // reason: an `as unknown as` here would encode a member name and a return shape that do not
    // exist, and the gate is truthiness-only so nothing would ever catch it.
    const adapter: IRetrievalAdapter = { retrieve: async () => ({ symbols: [], totalTokens: 0 }) };

    const built = buildCreateSessionOptions(initOptions({ retrievalAdapter: adapter }), DEPS);

    expect(built.retrievalAdapter).toBe(adapter);
  });

  it('omits the key entirely when no adapter is supplied', () => {
    const built = buildCreateSessionOptions(initOptions({}), DEPS);

    expect('retrievalAdapter' in built).toBe(false);
  });
});
