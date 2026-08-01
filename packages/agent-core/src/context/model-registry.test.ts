import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTEXT_WINDOW,
  clearRegisteredModelMetadata,
  findModelDefinition,
  getModelContextWindow,
  getModelMaxOutput,
  getModelName,
  registerModelMetadata,
} from './models';
import { setGlobalLoggerSink, setGlobalLogLevel, type ILogger } from '../utils/logger';

/**
 * NEUT-010 — vendor model knowledge in the vendor-neutral package.
 *
 * `getModelContextWindow` answered `DEFAULT_CONTEXT_WINDOW` for anything it did not recognise, and
 * that constant is 200 000 — CLAUDE's window. So every non-Claude session was planned against a
 * number belonging to a different vendor's models, and the three consumers that act on it had no
 * way to know they were working from a guess.
 *
 * Two things change, and the tests are about both: a provider can now REGISTER the truth about its
 * own models, and when nothing owns a model the fallback SAYS SO instead of passing silently.
 */
function recordingSink(): { sink: ILogger; lines: string[] } {
  const lines: string[] = [];
  const push =
    () =>
    (...args: unknown[]) =>
      lines.push(String(args[0] ?? ''));
  return {
    lines,
    sink: {
      debug: push(),
      info: push(),
      warn: push(),
      error: push(),
      log: push(),
      group: push(),
      groupEnd: () => {},
    } as ILogger,
  };
}

describe('model metadata registry (NEUT-010)', () => {
  afterEach(() => {
    clearRegisteredModelMetadata();
    setGlobalLoggerSink(undefined);
    setGlobalLogLevel('warn');
  });

  it('a registered model answers with ITS numbers, not another vendor default', () => {
    registerModelMetadata({
      id: 'some-vendor/small',
      name: 'Some Vendor Small',
      contextWindow: 8_192,
      maxOutput: 2_048,
    });
    expect(getModelContextWindow('some-vendor/small')).toBe(8_192);
    expect(getModelMaxOutput('some-vendor/small')).toBe(2_048);
    expect(getModelName('some-vendor/small')).toBe('Some Vendor Small');
    // The premise: without registration this model would have received Claude's window.
    expect(DEFAULT_CONTEXT_WINDOW).toBe(200_000);
  });

  it('an UNKNOWN model still gets a number, but no longer silently', () => {
    const { sink, lines } = recordingSink();
    setGlobalLoggerSink(sink);
    expect(getModelContextWindow('nobody-owns-this')).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(lines.some((l) => l.includes('nobody-owns-this'))).toBe(true);
    expect(lines.some((l) => l.includes('registerModelMetadata'))).toBe(true);
  });

  it('warns ONCE per model and metric — a warning repeated every round is one nobody reads', () => {
    const { sink, lines } = recordingSink();
    setGlobalLoggerSink(sink);
    for (let i = 0; i < 5; i++) getModelContextWindow('noisy-unknown-model');
    expect(lines.filter((l) => l.includes('noisy-unknown-model'))).toHaveLength(1);
  });

  it('does NOT warn for a name — the id is a correct answer, not a guess about capability', () => {
    const { sink, lines } = recordingSink();
    setGlobalLoggerSink(sink);
    expect(getModelName('unregistered-model')).toBe('unregistered-model');
    expect(lines.filter((l) => l.includes('unregistered-model'))).toHaveLength(0);
  });

  it('a registered entry overrides the built-in table, so a stale built-in can be corrected', () => {
    const before = getModelContextWindow('claude-haiku-4-5');
    expect(before).toBe(200_000);
    registerModelMetadata({
      id: 'claude-haiku-4-5',
      name: 'Claude Haiku 4.5',
      contextWindow: 999,
      maxOutput: 1,
    });
    expect(getModelContextWindow('claude-haiku-4-5')).toBe(999);
  });

  it('findModelDefinition says when nothing owns a model, rather than inventing one', () => {
    expect(findModelDefinition('nobody-owns-this-either')).toBeUndefined();
  });
});
