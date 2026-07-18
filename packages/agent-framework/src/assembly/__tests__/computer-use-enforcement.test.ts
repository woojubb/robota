import { PermissionEnforcer } from '@robota-sdk/agent-session';
import { createComputerTool } from '@robota-sdk/agent-tools';
import { describe, expect, it, vi } from 'vitest';

import type {
  IToolWithEventService,
  ITerminalOutput,
  TPermissionMode,
} from '@robota-sdk/agent-core';
import type {
  IComputerActionResult,
  IComputerDriver,
  IComputerScreenshot,
  TComputerAction,
} from '@robota-sdk/agent-tools';

/**
 * SELFHOST-010 TC-02 / TC-07 / TC-08 — functional enforcement through the EXISTING PermissionEnforcer.
 *
 * The `ComputerView`/`Computer` tools are wrapped by the real `PermissionEnforcer` (the SAME path used for
 * Shell/Read — no new gate). This proves the security floor at the dispatch level: a mutating `Computer`
 * action is NOT dispatched to the driver without an approval decision, while read-only `ComputerView`
 * perception auto-runs (including in plan mode).
 */

const SHOT: IComputerScreenshot = { data: 'AAAA', mediaType: 'image/png' };

/** A recording driver (test-support; satisfies IComputerDriver — no ScriptedComputerDriver import needed). */
function makeRecordingDriver(): {
  driver: IComputerDriver;
  actions: TComputerAction[];
  screenshotCalls: () => number;
} {
  const actions: TComputerAction[] = [];
  let screenshots = 0;
  const driver: IComputerDriver = {
    async screenshot(): Promise<IComputerScreenshot> {
      screenshots += 1;
      return SHOT;
    },
    async act(action: TComputerAction): Promise<IComputerActionResult> {
      actions.push(action);
      return { screenshot: SHOT };
    },
  };
  return { driver, actions, screenshotCalls: () => screenshots };
}

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

function wrap(tool: IToolWithEventService, mode: TPermissionMode): IToolWithEventService {
  const enforcer = new PermissionEnforcer({
    sessionId: 'test',
    cwd: '/tmp',
    getPermissionMode: () => mode,
    config: { permissions: { allow: [], deny: [] } },
    terminal: makeNoopTerminal(),
    // No permissionHandler / promptForApprovalFn — an 'approve' decision therefore resolves to deny.
  });
  return enforcer.wrapTools([tool])[0] as IToolWithEventService;
}

function getTools(driver: IComputerDriver): {
  view: IToolWithEventService;
  computer: IToolWithEventService;
} {
  const [view, computer] = createComputerTool({ driver }) as unknown as IToolWithEventService[];
  return { view, computer };
}

describe('computer-use enforcement through PermissionEnforcer (SELFHOST-010)', () => {
  // TC-07: a mutating Computer action in default mode is NOT dispatched to the driver without approval.
  it('TC-07: Computer is not dispatched to the driver in default mode absent approval', async () => {
    const { driver, actions } = makeRecordingDriver();
    const { computer } = getTools(driver);
    const wrapped = wrap(computer, 'default');

    await wrapped.execute(
      { action: { type: 'click', x: 1, y: 2 } },
      { toolName: 'Computer', parameters: {} },
    );

    expect(actions).toHaveLength(0);
  });

  // TC-07/08: read-only perception auto-runs — ComputerView dispatches screenshot() and never a mutation.
  it('TC-02/08: ComputerView auto-runs and dispatches only screenshot(), never a mutation', async () => {
    for (const mode of ['plan', 'default'] as TPermissionMode[]) {
      const { driver, actions, screenshotCalls } = makeRecordingDriver();
      const { view } = getTools(driver);
      const wrapped = wrap(view, mode);

      const result = await wrapped.execute({}, { toolName: 'ComputerView', parameters: {} });
      const parsed = JSON.parse(result.data as string) as { screenshot?: IComputerScreenshot };

      expect(screenshotCalls(), mode).toBe(1);
      expect(actions, mode).toHaveLength(0);
      expect(parsed.screenshot, mode).toEqual(SHOT);
    }
  });

  // TC-02: a Computer mutation in plan mode is denied and not dispatched.
  it('TC-02: Computer is denied in plan mode and not dispatched', async () => {
    const { driver, actions } = makeRecordingDriver();
    const { computer } = getTools(driver);
    const wrapped = wrap(computer, 'plan');

    await wrapped.execute(
      { action: { type: 'type', text: 'secret' } },
      { toolName: 'Computer', parameters: {} },
    );

    expect(actions).toHaveLength(0);
  });

  // TC-07: auto-execution of a mutation occurs ONLY under bypassPermissions (an explicit user choice).
  it('TC-07: Computer auto-runs only under bypassPermissions', async () => {
    const { driver, actions } = makeRecordingDriver();
    const { computer } = getTools(driver);
    const wrapped = wrap(computer, 'bypassPermissions');

    await wrapped.execute(
      { action: { type: 'click', x: 5, y: 6 } },
      { toolName: 'Computer', parameters: {} },
    );

    expect(actions).toEqual([{ type: 'click', x: 5, y: 6 }]);
  });
});
