/**
 * The shell child gets Robota's `TRACEPARENT` in a fresh environment copy when the call's context
 * carries one; otherwise the ambient environment reaches it untouched. `process.env` never changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createBashTool } from '../shell-tool';

import type { IToolExecutionContext } from '@robota-sdk/agent-core';

const TRACE = { TRACEPARENT: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' };
const AMBIENT = '00-99999999999999999999999999999999-8888888888888888-01';
const COMMAND = 'printf "%s|%s" "${TRACEPARENT:--}" "${TRACESTATE:--}"';

async function run(context: Partial<IToolExecutionContext>): Promise<string> {
  const tool = createBashTool({ cwd: process.cwd() });
  const result = await tool.execute({ command: COMMAND }, {
    toolName: 'Bash', parameters: { command: COMMAND }, ...context,
  } as IToolExecutionContext);
  return (JSON.parse(String(result.data)) as { output: string }).output;
}

describe.runIf(process.platform !== 'win32')('shell tool trace environment', () => {
  beforeEach(() => {
    vi.stubEnv('TRACEPARENT', AMBIENT);
    vi.stubEnv('TRACESTATE', 'vendor=ambient');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sets the call trace, drops the ambient TRACESTATE and leaves process.env as it was', async () => {
    const before = { ...process.env };
    expect(await run({ shellTraceEnv: TRACE })).toBe(`${TRACE.TRACEPARENT}|-`);
    expect(process.env).toEqual(before);
  });

  it('passes the ambient environment untouched without a call trace', async () => {
    expect(await run({})).toBe(`${AMBIENT}|vendor=ambient`);
  });

  it('ignores the hook value, which names the prompt root rather than this call', async () => {
    expect(await run({ hookTraceEnv: TRACE })).toBe(`${AMBIENT}|vendor=ambient`);
  });
});
