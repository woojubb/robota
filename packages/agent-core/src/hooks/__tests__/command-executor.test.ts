import { describe, it, expect } from 'vitest';

import { CommandExecutor } from '../executors/command-executor.js';

import type { IHookInput } from '../types.js';

const input: IHookInput = {
  session_id: 'test',
  cwd: process.cwd(),
  hook_event_name: 'SessionStart',
};

describe('CommandExecutor', () => {
  const executor = new CommandExecutor();

  it('should have type "command"', () => {
    expect(executor.type).toBe('command');
  });

  it('exit 0 is allow, carrying stdout', async () => {
    const outcome = await executor.execute({ type: 'command', command: 'echo hello' }, input);
    expect(outcome.outcome).toBe('allow');
    expect(outcome.outcome === 'allow' && outcome.stdout.trim()).toBe('hello');
  });

  it('should pass JSON input on stdin', async () => {
    const outcome = await executor.execute(
      { type: 'command', command: 'cat' },
      { ...input, cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'Bash' },
    );
    expect(outcome.outcome).toBe('allow');
    if (outcome.outcome !== 'allow') return;
    const parsed = JSON.parse(outcome.stdout) as { session_id: string; tool_name: string };
    expect(parsed.session_id).toBe('test');
    expect(parsed.tool_name).toBe('Bash');
  });

  // SEC-015 TC-03 — the exit-code mapping. Each row below was one `exitCode` number before, and
  // three of them were the SAME number: a timeout, a signal kill and `exit 1` all resolved to 1,
  // which is what made "the gate failed" indistinguishable from "the gate ran".
  describe('TC-03 exit mapping', () => {
    it('exit 2 is deny, carrying stderr as the reason', async () => {
      const outcome = await executor.execute(
        { type: 'command', command: 'echo "no thanks" >&2; exit 2' },
        input,
      );
      expect(outcome.outcome).toBe('deny');
      expect(outcome.outcome === 'deny' && outcome.reason).toBe('no thanks');
    });

    it('exit 2 with no stderr still denies, with a default reason', async () => {
      const outcome = await executor.execute({ type: 'command', command: 'exit 2' }, input);
      expect(outcome).toEqual({ outcome: 'deny', source: 'command', reason: 'Blocked by hook' });
    });

    it.each([1, 3, 127])('exit %i is error/nonzero-exit, not a verdict', async (code) => {
      const outcome = await executor.execute({ type: 'command', command: `exit ${code}` }, input);
      expect(outcome.outcome).toBe('error');
      expect(outcome.outcome === 'error' && outcome.kind).toBe('nonzero-exit');
      expect(outcome.outcome === 'error' && outcome.reason).toContain(`exited ${code}`);
    });

    it('a nonexistent binary is error/nonzero-exit — the shell reports 127, it does not fail to spawn', async () => {
      const outcome = await executor.execute(
        { type: 'command', command: 'definitely-not-a-real-binary-xyz' },
        input,
      );
      expect(outcome.outcome).toBe('error');
      expect(outcome.outcome === 'error' && outcome.kind).toBe('nonzero-exit');
    });

    it('a signal kill is error/nonzero-exit, naming the signal — not exit code 1', async () => {
      const outcome = await executor.execute({ type: 'command', command: 'kill -TERM $$' }, input);
      expect(outcome.outcome).toBe('error');
      if (outcome.outcome !== 'error') return;
      expect(outcome.kind).toBe('nonzero-exit');
      expect(outcome.reason).toContain('signal');
      expect(outcome.reason).toContain('SIGTERM');
    });

    it('a timeout is error/timeout, distinguishable from a nonzero exit', async () => {
      const outcome = await executor.execute(
        { type: 'command', command: 'sleep 10', timeout: 1 },
        input,
      );
      expect(outcome.outcome).toBe('error');
      expect(outcome.outcome === 'error' && outcome.kind).toBe('timeout');
    }, 15_000);

    it('a spawn failure is error/spawn-failure', async () => {
      // Reached only through `child.on('error')`, which a missing COMMAND does not trigger — the
      // shell starts fine and reports 127 (the row above). An unusable `cwd` is what actually makes
      // `spawn` itself fail, and it is the trigger measured rather than assumed: an earlier draft of
      // this test also set `env.SHELL` to a nonexistent path and credited that, but `SHELL` alone
      // yields `allow` because `resolvePlatformShell()` never reads it. Driving only the condition
      // that does the work is the difference between a test that constrains the code and one that
      // happens to be green.
      const outcome = await executor.execute(
        { type: 'command', command: 'echo hi' },
        { ...input, cwd: '/nonexistent/directory' },
      );
      expect(outcome.outcome).toBe('error');
      expect(outcome.outcome === 'error' && outcome.kind).toBe('spawn-failure');
    });
  });

  // SEC-015 TC-05
  it('every outcome carries source: "command"', async () => {
    const outcomes = await Promise.all([
      executor.execute({ type: 'command', command: 'exit 0' }, input),
      executor.execute({ type: 'command', command: 'exit 2' }, input),
      executor.execute({ type: 'command', command: 'exit 1' }, input),
    ]);
    expect(outcomes.map((o) => o.source)).toEqual(['command', 'command', 'command']);
  });
});
