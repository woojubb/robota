/** A scripted `IGitProcessPort`: answers by argv, records every call, throws on an unscripted one. */
import type { IGitProcessPort, TGitProcessOutcome } from '../git-process.js';

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
