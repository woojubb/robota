import type { IToolWithEventService, TToolParameters } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import {
  createComputerActTool,
  createComputerTool,
  createComputerViewTool,
} from '../computer-tool.js';
import { ScriptedComputerDriver } from '../testing/scripted-computer-driver.js';

import type { IComputerToolResult } from '../computer-tool.js';
import type {
  IComputerActionResult,
  IComputerDriver,
  IComputerScreenshot,
  TComputerAction,
} from '../types.js';

async function run(
  tool: IToolWithEventService,
  parameters: Record<string, unknown>,
): Promise<IComputerToolResult> {
  const params = parameters as TToolParameters;
  const raw = await tool.execute(params, { toolName: tool.getName(), parameters: params });
  return JSON.parse(raw.data as string) as IComputerToolResult;
}

const SHOT_A: IComputerScreenshot = {
  data: 'AAAA',
  mediaType: 'image/png',
  width: 800,
  height: 600,
};
const SHOT_B: IComputerScreenshot = {
  data: 'BBBB',
  mediaType: 'image/png',
  width: 800,
  height: 600,
};

describe('createComputerTool', () => {
  it('registers exactly ComputerView + Computer', () => {
    const driver = new ScriptedComputerDriver();
    expect(createComputerTool({ driver }).map((tool) => tool.getName())).toEqual([
      'ComputerView',
      'Computer',
    ]);
  });

  // TC-01: perceive round-trips screenshot() through the injected driver.
  it('TC-01: ComputerView round-trips screenshot() through the driver', async () => {
    const driver = new ScriptedComputerDriver({ screenshots: [SHOT_A] });
    const tool = createComputerViewTool({ driver });

    const result = await run(tool as unknown as IToolWithEventService, {});

    expect(result.success).toBe(true);
    expect(result.screenshot).toEqual(SHOT_A);
    expect(driver.screenshotCalls).toBe(1);
    expect(driver.actions).toHaveLength(0);
  });

  // TC-01: each mutating action round-trips through act() and returns the resulting screenshot.
  it('TC-01: Computer round-trips each mutating action and returns the screenshot', async () => {
    const cases: Array<{ args: Record<string, unknown>; expected: TComputerAction }> = [
      { args: { type: 'click', x: 10, y: 20 }, expected: { type: 'click', x: 10, y: 20 } },
      {
        args: { type: 'click', x: 1, y: 2, button: 'right' },
        expected: { type: 'click', x: 1, y: 2, button: 'right' },
      },
      {
        args: { type: 'double_click', x: 5, y: 6 },
        expected: { type: 'double_click', x: 5, y: 6 },
      },
      { args: { type: 'type', text: 'hello' }, expected: { type: 'type', text: 'hello' } },
      {
        args: { type: 'keypress', keys: ['Control', 'a'] },
        expected: { type: 'keypress', keys: ['Control', 'a'] },
      },
      {
        args: { type: 'scroll', x: 3, y: 4, deltaX: 0, deltaY: 120 },
        expected: { type: 'scroll', x: 3, y: 4, deltaX: 0, deltaY: 120 },
      },
      {
        args: {
          type: 'drag',
          path: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        },
        expected: {
          type: 'drag',
          path: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      },
      { args: { type: 'wait', ms: 250 }, expected: { type: 'wait', ms: 250 } },
    ];

    for (const { args, expected } of cases) {
      const driver = new ScriptedComputerDriver({ screenshots: [SHOT_B] });
      const tool = createComputerActTool({ driver });

      const result = await run(tool as unknown as IToolWithEventService, { action: args });

      expect(result.success, JSON.stringify(args)).toBe(true);
      expect(result.screenshot).toEqual(SHOT_B);
      expect(driver.actions).toEqual([expected]);
    }
  });

  it('reports unavailability when no driver is injected', async () => {
    const view = await run(createComputerViewTool() as unknown as IToolWithEventService, {});
    expect(view.success).toBe(false);
    expect(view.error).toMatch(/not available/i);

    const act = await run(createComputerActTool() as unknown as IToolWithEventService, {
      action: { type: 'click', x: 1, y: 1 },
    });
    expect(act.success).toBe(false);
    expect(act.error).toMatch(/not available/i);
  });

  it('returns a validation error for an action missing required fields', async () => {
    const driver = new ScriptedComputerDriver();
    const result = await run(
      createComputerActTool({ driver }) as unknown as IToolWithEventService,
      {
        action: { type: 'click' },
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires numeric/i);
    expect(driver.actions).toHaveLength(0);
  });

  // TC-03: takeover suspends the action loop and pauses perception.
  it('TC-03: takeover suspends the loop and pauses perception until resume', async () => {
    const driver = new ScriptedComputerDriver({ screenshots: [SHOT_A] });
    const view = createComputerViewTool({ driver });
    const act = createComputerActTool({ driver });

    // A takeover action returns takeover:true with NO screenshot (perception paused).
    const takeover = await run(act as unknown as IToolWithEventService, {
      action: { type: 'takeover', reason: 'enter your password' },
    });
    expect(takeover.takeover).toBe(true);
    expect(takeover.screenshot).toBeUndefined();
    expect(driver.isSuspended()).toBe(true);

    // Perception is paused: no screenshot is captured while the human enters credentials.
    const perceiveWhilePaused = await run(view as unknown as IToolWithEventService, {});
    expect(perceiveWhilePaused.screenshot).toBeUndefined();
    expect(perceiveWhilePaused.takeover).toBe(true);

    // The action loop is halted: a further action does not capture a screenshot either.
    const actWhilePaused = await run(act as unknown as IToolWithEventService, {
      action: { type: 'click', x: 1, y: 1 },
    });
    expect(actWhilePaused.screenshot).toBeUndefined();
    expect(actWhilePaused.takeover).toBe(true);

    // Resume signal — perception + actions work again.
    await driver.endTakeover();
    const perceiveAfter = await run(view as unknown as IToolWithEventService, {});
    expect(perceiveAfter.screenshot).toEqual(SHOT_A);
  });

  // TC-05: swapping the driver needs no agent-tools change — a second, independent driver
  // satisfies IComputerDriver and drives the same factory unchanged.
  it('TC-05: a second driver satisfies IComputerDriver and drives the factory unchanged', async () => {
    const recorded: TComputerAction[] = [];
    const secondDriver: IComputerDriver = {
      async screenshot(): Promise<IComputerScreenshot> {
        return SHOT_B;
      },
      async act(action: TComputerAction): Promise<IComputerActionResult> {
        recorded.push(action);
        return { screenshot: SHOT_B };
      },
    };

    const [view, act] = createComputerTool({ driver: secondDriver });
    const perceived = await run(view as unknown as IToolWithEventService, {});
    expect(perceived.screenshot).toEqual(SHOT_B);

    const acted = await run(act as unknown as IToolWithEventService, {
      action: { type: 'type', text: 'swap' },
    });
    expect(acted.screenshot).toEqual(SHOT_B);
    expect(recorded).toEqual([{ type: 'type', text: 'swap' }]);
  });
});
