import { describe, expect, it, vi } from 'vitest';
import {
  createToolExecutionBridge,
  forwardToolExecutionEvent,
} from './session-tool-execution-bridge.js';

describe('session tool execution bridge', () => {
  it('forwards unknown tool execution request/result so UI can show the skipped call reason', () => {
    const onToolExecution = vi.fn();
    const bridge = createToolExecutionBridge({
      knownToolNames: ['ExecuteCommand', 'Read'],
      onToolExecution,
    });

    forwardToolExecutionEvent(bridge, 'tool_execution_request', {
      toolName: 'agent',
      toolCallId: 'call_unknown',
      parameters: { prompt: 'parallelize this work' },
    });
    forwardToolExecutionEvent(bridge, 'tool_execution_result', {
      toolName: 'agent',
      toolCallId: 'call_unknown',
      success: false,
      error: 'Tool "agent" is not registered, so the tool call was not executed.',
      metadata: {
        errorCode: 'unknown_tool',
        requestedTool: 'agent',
        availableTools: ['ExecuteCommand', 'Read'],
      },
    });

    expect(onToolExecution).toHaveBeenCalledTimes(2);
    expect(onToolExecution).toHaveBeenNthCalledWith(1, {
      type: 'start',
      toolName: 'agent',
      toolArgs: { prompt: 'parallelize this work' },
    });
    expect(onToolExecution).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'end',
        toolName: 'agent',
        success: false,
      }),
    );
    expect(onToolExecution.mock.calls[1]?.[0].toolResultData).toContain('unknown_tool');
    expect(onToolExecution.mock.calls[1]?.[0].toolResultData).toContain('not executed');
  });

  it('does not duplicate normal registered tool events handled by PermissionEnforcer', () => {
    const onToolExecution = vi.fn();
    const bridge = createToolExecutionBridge({
      knownToolNames: ['Read'],
      onToolExecution,
    });

    forwardToolExecutionEvent(bridge, 'tool_execution_request', {
      toolName: 'Read',
      toolCallId: 'call_read',
      parameters: { filePath: 'README.md' },
    });
    forwardToolExecutionEvent(bridge, 'tool_execution_result', {
      toolName: 'Read',
      toolCallId: 'call_read',
      success: true,
      result: 'ok',
    });

    expect(onToolExecution).not.toHaveBeenCalled();
  });
});
