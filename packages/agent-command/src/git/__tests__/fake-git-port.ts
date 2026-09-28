/**
 * A scripted `IGitProcessPort`: answers by argv, records every call, throws on an unscripted one.
 *
 * The port and outcome types moved to `@robota-sdk/agent-framework` with the git process module
 * (#3282 §4c); this double stays here (duplicated, not imported cross-package) because it is a tiny,
 * self-contained test fixture, the same call `agent-framework`'s own `git/__tests__/fake-git-port.ts`
 * makes for its side.
 */
import type { IGitProcessPort, TGitProcessOutcome } from '@robota-sdk/agent-framework';

export interface IFakeGitPort extends IGitProcessPort {
  readonly calls: readonly (readonly string[])[];
}

export function exited(stdout: string, exitCode = 0, stderr = ''): TGitProcessOutcome {
  return { kind: 'exited', stdout, stderr, exitCode };
}

export function fakeGitPort(
  script: Readonly<
    Record<string, TGitProcessOutcome | ((args: readonly string[]) => TGitProcessOutcome)>
  >,
): IFakeGitPort {
  const calls: (readonly string[])[] = [];
  return {
    calls,
    async run(args) {
      calls.push([...args]);
      const key = args.join(' ');
      const entry = script[key];
      if (entry === undefined) throw new Error(`unscripted git call: ${key}`);
      return typeof entry === 'function' ? entry(args) : entry;
    },
  };
}
