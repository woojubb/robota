/**
 * CORE-035 — the same-tool-input loop guard: one stated contract, pinned.
 *
 * The SPEC said the guard throws an `AbortError` at the Nth identical call. The code threw a bare
 * `Error` at the N+1th. The gap was not cosmetic: `isAbortFailure` resolves an `AbortError` as
 * `success: true, interrupted: true`, so a caller reading the SPEC would have expected a run that
 * detected a pathological loop and gave up to be reported as a SUCCESS.
 *
 * Resolved toward the code's semantics and the SPEC's intent, which are not the same thing:
 *
 * - **Failure, not abort.** A guard trip is the agent giving up, not the user cancelling. The user
 *   asked a question and got no answer; reporting that as `success: true` would hide it. `AbortError`
 *   means "the caller asked us to stop", and nobody did.
 * - **Named, not bare.** What the SPEC was reaching for by naming a type was that this condition is
 *   DISTINGUISHABLE. A bare `Error` is not: a caller cannot tell "the agent looped" from "the network
 *   died". `SameToolInputLoopError` extends `RobotaError`, so CORE-027 carries its `code`,
 *   `category` and `recoverable` out to the caller intact.
 * - **N is the maximum ALLOWED.** `maxSameToolInputs` names a ceiling, so the Nth identical call is
 *   permitted and the N+1th trips. The SPEC's "N or more times" contradicted its own option name.
 */

import { describe, expect, it } from 'vitest';

import { checkSameToolInputLimit } from '../execution-round-tools';
import { Robota } from '../../core/robota';
import { SameToolInputLoopError } from '../../utils/errors';

import type { IExecutionRoundState } from '../execution-types';
import type { IAgentConfig } from '../../interfaces/agent';
import type { IToolCall } from '../../interfaces/messages';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';

import { AbstractTool } from '../../abstracts/abstract-tool';
import { createScriptedProvider } from '../../testing/scripted-provider';

function call(name: string, args: string): IToolCall {
  return { id: `tc-${name}-${args}`, type: 'function', function: { name, arguments: args } };
}

function state(): IExecutionRoundState {
  return { sameToolInputCounts: new Map<string, number>() } as IExecutionRoundState;
}

describe('CORE-035 — the guard trips at N+1, not N', () => {
  it('allows exactly maxSameToolInputs identical calls', () => {
    const roundState = state();
    expect(() => {
      for (let i = 0; i < 3; i += 1) {
        checkSameToolInputLimit([call('ping', '{}')], roundState, 3);
      }
    }).not.toThrow();
  });

  it('throws on the call after that, carrying what tripped it', () => {
    // The error is caught and inspected rather than matched with `toThrow(SomeClass)`. If the class
    // reference were ever undefined, `toThrow(undefined)` degenerates to "threw anything" and this
    // case would go green against a bare `Error` — which is precisely the state this item found.
    const roundState = state();
    for (let i = 0; i < 3; i += 1) {
      checkSameToolInputLimit([call('ping', '{}')], roundState, 3);
    }

    let caught: unknown;
    try {
      checkSameToolInputLimit([call('ping', '{}')], roundState, 3);
    } catch (error) {
      caught = error;
    }

    expect(SameToolInputLoopError).toBeTypeOf('function');
    expect(caught).toBeInstanceOf(SameToolInputLoopError);
    const typed = caught as SameToolInputLoopError;
    expect(typed.toolName).toBe('ping');
    expect(typed.callCount).toBe(4);
    expect(typed.maxSameToolInputs).toBe(3);
  });

  it('does not conflate different inputs to the same tool', () => {
    const roundState = state();
    expect(() => {
      for (let i = 0; i < 5; i += 1) {
        checkSameToolInputLimit([call('ping', `{"i":${i}}`)], roundState, 1);
      }
    }).not.toThrow();
  });
});

describe('CORE-035 — the guard reports a FAILED run, not a successful interruption', () => {
  class LoopTool extends AbstractTool {
    override get schema(): IToolSchema {
      return {
        name: 'loop',
        description: 'always the same',
        parameters: { type: 'object' as const, properties: {} },
      };
    }

    protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
      return { success: true, data: { same: true } };
    }
  }

  it('rejects the run, and the error is distinguishable from any other failure', async () => {
    // The provider keeps asking for the identical call, which is exactly the loop the guard exists
    // for. Driven through the public `run()` because the point is the RUN's outcome: a bare `Error`
    // and a `SameToolInputLoopError` both reject, but only one tells the caller what happened.
    const scripted = createScriptedProvider(
      Array.from({ length: 8 }, () => ({ toolCalls: [{ name: 'loop', args: {} }] })),
    );
    const agent = new Robota({
      name: 'core-035',
      aiProviders: [scripted.provider],
      defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
      tools: [new LoopTool()],
      maxSameToolInputs: 2,
      logging: { level: 'silent', enabled: false },
    } as IAgentConfig);

    try {
      const caught = await agent.run('go').then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(caught).toBeInstanceOf(SameToolInputLoopError);
      const typed = caught as SameToolInputLoopError;
      expect(typed.code).toBe('SAME_TOOL_INPUT_LOOP');
      expect(typed.category).toBe('system');
      // Not an abort: `isAbortFailure` must not classify this, or the run would resolve
      // `success: true, interrupted: true` and the caller would never learn the agent gave up.
      expect(typed.name).not.toBe('AbortError');
      expect(typed.message).toContain('loop');
    } finally {
      await agent.destroy();
    }
  });
});
