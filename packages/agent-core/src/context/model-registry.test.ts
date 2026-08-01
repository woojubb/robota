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

  /**
   * Named "overrides the built-in table" in review of #1595, which was WRONG in a way worth
   * recording: this change removes the built-in table, so there is nothing to override. Its `before`
   * value of 200 000 was the unknown-model FALLBACK, which happens to equal the window Claude Haiku
   * really has — the exact coincidence this suite avoids elsewhere by probing with Sonnet, whose
   * real window differs from the default. A test whose premise is a coincidence proves nothing.
   *
   * What the re-registration behaviour actually is: the last registration wins, and a CONFLICTING
   * one says so rather than replacing a value in silence.
   */
  it('re-registering the same id replaces it, and a conflicting value is announced', () => {
    const { sink, lines } = recordingSink();
    setGlobalLoggerSink(sink);
    registerModelMetadata({ id: 'vendor/x', name: 'X', contextWindow: 1_000, maxOutput: 100 });
    expect(getModelContextWindow('vendor/x')).toBe(1_000);

    // Same values again: nothing changed, so nothing to report.
    registerModelMetadata({ id: 'vendor/x', name: 'X', contextWindow: 1_000, maxOutput: 100 });
    expect(lines.filter((l) => l.includes('vendor/x'))).toHaveLength(0);

    // Different values: one of the two owners is wrong, and that is worth knowing.
    registerModelMetadata({ id: 'vendor/x', name: 'X', contextWindow: 2_000, maxOutput: 100 });
    expect(getModelContextWindow('vendor/x')).toBe(2_000);
    expect(lines.some((l) => l.includes('vendor/x'))).toBe(true);
  });

  it('findModelDefinition says when nothing owns a model, rather than inventing one', () => {
    expect(findModelDefinition('nobody-owns-this-either')).toBeUndefined();
  });
});
