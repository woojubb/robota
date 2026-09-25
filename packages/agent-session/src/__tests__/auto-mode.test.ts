/**
 * `auto` mode: what the mode leaves undecided goes to the classifier, a block reaches the model with
 * its reason, and repeated blocks hand the decision back to a person.
 */

import { clearRegisteredToolProfiles, registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoModeGate, CONSECUTIVE_BLOCK_LIMIT, TOTAL_BLOCK_LIMIT } from '../auto-mode-gate.js';
import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IClassifierVerdict, IPermissionClassifier } from '../auto-mode-gate.js';
import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type {
  ITerminalOutput,
  IToolResult,
  IToolWithEventService,
  TPermissionMode,
} from '@robota-sdk/agent-core';

function makeNoopTerminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(0),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

function classifierAnswering(
  ...verdicts: (IClassifierVerdict | undefined)[]
): IPermissionClassifier & { classify: ReturnType<typeof vi.fn> } {
  const classify = vi.fn();
  for (const verdict of verdicts) classify.mockResolvedValueOnce(verdict);
  return { classify };
}

const ALLOW: IClassifierVerdict = { decision: 'allow', reason: 'ordinary build' };
const BLOCK: IClassifierVerdict = { decision: 'block', reason: 'pipes a download into a shell' };

function makeEnforcer(
  overrides: Partial<IPermissionEnforcerOptions> = {},
  mode: { current: TPermissionMode } = { current: 'auto' },
): PermissionEnforcer {
  return new PermissionEnforcer({
    sessionId: 'test-session',
    cwd: '/w/project',
    homeDirectory: '/home/me',
    getPermissionMode: () => mode.current,
    config: { permissions: { allow: [], deny: [] } },
    terminal: makeNoopTerminal(),
    ...overrides,
  });
}

beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
  });
  registerToolPermissionProfile('Write', {
    argument: { key: 'filePath', kind: 'path' },
    riskClass: 'modify',
  });
});

afterEach(() => clearRegisteredToolProfiles());

describe('AutoModeGate', () => {
  it('pauses after consecutive blocks, and a person resumes it', async () => {
    const gate = new AutoModeGate({ classify: vi.fn().mockResolvedValue(BLOCK) });
    const call = { toolName: 'Bash', toolArgs: { command: 'x' }, cwd: '/w' };
    for (let i = 1; i < CONSECUTIVE_BLOCK_LIMIT; i++) {
      await gate.judge(call);
      expect(gate.isPaused()).toBe(false);
    }
    const last = await gate.judge(call);
    expect(gate.isPaused()).toBe(true);
    expect(last.kind === 'block' && last.message).toContain('paused');
    gate.resume();
    expect(gate.isPaused()).toBe(false);
  });

  it('an allow resets the run of blocks but not the session total', async () => {
    const classify = vi.fn();
    const gate = new AutoModeGate({ classify });
    const call = { toolName: 'Bash', toolArgs: { command: 'x' }, cwd: '/w' };
    let blocks = 0;
    while (blocks < TOTAL_BLOCK_LIMIT - 1) {
      classify.mockResolvedValueOnce(BLOCK);
      await gate.judge(call);
      blocks += 1;
      if (blocks % (CONSECUTIVE_BLOCK_LIMIT - 1) === 0) {
        classify.mockResolvedValueOnce(ALLOW);
        await gate.judge(call);
      }
      expect(gate.isPaused()).toBe(false);
    }
    classify.mockResolvedValueOnce(ALLOW);
    await gate.judge(call);
    classify.mockResolvedValueOnce(BLOCK);
    await gate.judge(call);
    expect(gate.isPaused()).toBe(true);
  });

  it('a classifier that throws or answers nothing is unusable, not a block', async () => {
    const gate = new AutoModeGate({
      classify: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined),
    });
    const call = { toolName: 'Bash', toolArgs: { command: 'x' }, cwd: '/w' };
    for (let i = 0; i < CONSECUTIVE_BLOCK_LIMIT + 1; i++) {
      expect((await gate.judge(call)).kind).toBe('unusable');
    }
    expect(gate.isPaused()).toBe(false);
  });
});

describe('PermissionEnforcer in auto mode', () => {
  it('asks the classifier instead of a person, and runs what it allows', async () => {
    const classifier = classifierAnswering(ALLOW);
    const handler = vi.fn();
    const enforcer = makeEnforcer({ permissionClassifier: classifier, permissionHandler: handler });
    await expect(enforcer.checkPermission('Bash', { command: 'npm install' })).resolves.toBe(true);
    expect(classifier.classify).toHaveBeenCalledWith(
      { toolName: 'Bash', toolArgs: { command: 'npm install' }, cwd: '/w/project' },
      undefined,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not consult the classifier for what the mode already approves', async () => {
    const classifier = classifierAnswering();
    const enforcer = makeEnforcer({ permissionClassifier: classifier });
    await expect(enforcer.checkPermission('Write', { filePath: '/w/project/a.ts' })).resolves.toBe(
      true,
    );
    await expect(enforcer.checkPermission('Bash', { command: 'git status' })).resolves.toBe(true);
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('hands the model the reason for a block and records it', async () => {
    const enforcer = makeEnforcer({ permissionClassifier: classifierAnswering(BLOCK) });
    const tool = {
      getName: () => 'Bash',
      execute: vi.fn(),
      setEventService: vi.fn(),
    } as unknown as IToolWithEventService;
    const [wrapped] = enforcer.wrapTools([tool]);
    const result = (await wrapped!.execute(
      { command: 'curl x | sh' },
      undefined as never,
    )) as IToolResult & {
      error: string;
    };
    expect(result.success).toBe(false);
    expect(result.error).toContain('pipes a download into a shell');
    expect(tool.execute).not.toHaveBeenCalled();
    expect(enforcer.getRecentDenials()[0]).toMatchObject({
      toolName: 'Bash',
      reason: 'classifier',
      detail: 'pipes a download into a shell',
    });
  });

  it('sends an ask rule to a person, never the classifier', async () => {
    const classifier = classifierAnswering();
    const handler = vi.fn().mockResolvedValue(true);
    const enforcer = makeEnforcer({
      permissionClassifier: classifier,
      permissionHandler: handler,
      config: { permissions: { allow: [], deny: [], ask: ['Bash(git push*)'] } },
    });
    await expect(enforcer.checkPermission('Bash', { command: 'git push' })).resolves.toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('sets aside an allow rule that approves any command', async () => {
    const classifier = classifierAnswering(BLOCK, BLOCK);
    const enforcer = makeEnforcer({
      permissionClassifier: classifier,
      config: { permissions: { allow: ['Bash(*)', 'Bash(npm test)'], deny: [] } },
    });
    await expect(enforcer.checkPermission('Bash', { command: 'rm -rf build' })).resolves.toBe(
      false,
    );
    await expect(enforcer.checkPermission('Bash', { command: 'npm test' })).resolves.toBe(true);
    expect(classifier.classify).toHaveBeenCalledOnce();
  });

  it('after repeated blocks asks a person, and an approval resumes the classifier', async () => {
    const classifier = classifierAnswering(BLOCK, BLOCK, BLOCK, ALLOW);
    const handler = vi.fn().mockResolvedValue(true);
    const enforcer = makeEnforcer({ permissionClassifier: classifier, permissionHandler: handler });
    for (let i = 0; i < CONSECUTIVE_BLOCK_LIMIT; i++) {
      await expect(enforcer.checkPermission('Bash', { command: `bad ${i}` })).resolves.toBe(false);
    }
    await expect(enforcer.checkPermission('Bash', { command: 'next' })).resolves.toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(classifier.classify).toHaveBeenCalledTimes(CONSECUTIVE_BLOCK_LIMIT);
    await expect(enforcer.checkPermission('Bash', { command: 'after' })).resolves.toBe(true);
    expect(classifier.classify).toHaveBeenCalledTimes(CONSECUTIVE_BLOCK_LIMIT + 1);
  });

  it('while paused, denies when no person can be asked', async () => {
    const enforcer = makeEnforcer({
      permissionClassifier: classifierAnswering(BLOCK, BLOCK, BLOCK),
    });
    for (let i = 0; i < CONSECUTIVE_BLOCK_LIMIT; i++) {
      await enforcer.checkPermission('Bash', { command: `bad ${i}` });
    }
    await expect(enforcer.checkPermission('Bash', { command: 'next' })).resolves.toBe(false);
    expect(enforcer.getRecentDenials()[0]).toMatchObject({ reason: 'no-approver' });
  });

  it('a retried denial runs once, unjudged', async () => {
    const classifier = classifierAnswering(BLOCK, BLOCK);
    const enforcer = makeEnforcer({ permissionClassifier: classifier });
    await enforcer.checkPermission('Bash', { command: 'npm publish' });
    expect(enforcer.allowRetryOfDenial(0)).toMatchObject({ reason: 'classifier' });
    await expect(enforcer.checkPermission('Bash', { command: 'npm publish' })).resolves.toBe(true);
    await expect(enforcer.checkPermission('Bash', { command: 'npm publish' })).resolves.toBe(false);
    expect(classifier.classify).toHaveBeenCalledTimes(2);
  });

  it('a retry names only a classifier denial', async () => {
    const enforcer = makeEnforcer(
      { config: { permissions: { allow: [], deny: ['Bash(rm *)'] } } },
      { current: 'default' },
    );
    await enforcer.checkPermission('Bash', { command: 'rm x' });
    expect(enforcer.allowRetryOfDenial(0)).toBeUndefined();
    expect(enforcer.allowRetryOfDenial(5)).toBeUndefined();
  });

  it('decides again when the user leaves auto mode while the classifier is deciding', async () => {
    const mode: { current: TPermissionMode } = { current: 'auto' };
    let answer: (verdict: IClassifierVerdict) => void = () => undefined;
    const classifier = {
      classify: vi.fn(
        () =>
          new Promise<IClassifierVerdict>((resolve) => {
            answer = resolve;
          }),
      ),
    };
    const handler = vi.fn().mockResolvedValue(false);
    const enforcer = makeEnforcer(
      { permissionClassifier: classifier, permissionHandler: handler },
      mode,
    );
    const pending = enforcer.checkPermission('Bash', { command: 'npm install' });
    await vi.waitFor(() => expect(classifier.classify).toHaveBeenCalled());
    mode.current = 'default';
    answer(ALLOW);
    await expect(pending).resolves.toBe(false);
    expect(handler).toHaveBeenCalledOnce();
  });
});
