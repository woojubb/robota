import { describe, expect, it } from 'vitest';

import { createShellTool } from '../shell-tool';

describe('shell tool cancellation (CORE-018)', () => {
  it('an external abort kills the running child and settles as failed/Aborted', async () => {
    const tool = createShellTool();
    const controller = new AbortController();

    const pending = tool.execute(
      { command: 'sleep 30' },
      {
        toolName: 'Shell',
        parameters: { command: 'sleep 30' },
        signal: controller.signal,
      },
    );
    setTimeout(() => controller.abort(), 150);
    const result = await pending;

    const payload = JSON.parse(String(result.data));
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('Abort');
  }, 10_000);

  it('an already-aborted signal short-circuits before spawn', async () => {
    const tool = createShellTool();
    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      { command: 'echo hi' },
      { toolName: 'Shell', parameters: { command: 'echo hi' }, signal: controller.signal },
    );
    const payload = JSON.parse(String(result.data));
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('Aborted before start');
  });
});
