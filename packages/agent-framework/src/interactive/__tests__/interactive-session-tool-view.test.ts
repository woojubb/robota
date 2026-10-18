import { describe, expect, it, vi } from 'vitest';

import { SessionExecutionController } from '../interactive-session-execution-controller.js';

const view = {
  sourceId: 'files',
  resourceUri: 'ui://files/list',
  mimeType: 'text/html;profile=mcp-app',
  html: '<main id="document-only">rows</main>',
  callableTools: { list_files: 'mcp__files__list_files' },
};

function createController(emit: ReturnType<typeof vi.fn>): SessionExecutionController {
  return new SessionExecutionController(
    { getHistory: () => [] } as never,
    {} as never,
    {
      emit,
      getContextState: vi.fn(),
      getCwd: () => process.cwd(),
      getSession: () => null,
      getSessionOrThrow: vi.fn(),
      persistSession: vi.fn(),
    } as never,
  );
}

function finishCall(controller: SessionExecutionController, executionId: string): void {
  controller.handleToolExecution({ type: 'start', toolName: 'files__list', executionId });
  controller.handleToolExecution({
    type: 'end',
    toolName: 'files__list',
    executionId,
    success: true,
    toolResultData: 'listed',
    view,
  });
}

describe('which calls keep a source view for a surface to read', () => {
  it("names the view of the model's own call by reference and keeps the document aside", () => {
    const emit = vi.fn();
    const controller = createController(emit);
    const claim = controller.executionClaim.acquire('prompt');
    finishCall(controller, 'model-call');
    controller.executionClaim.complete(claim, () => {});
    const ended = emit.mock.calls.filter(([type]) => type === 'tool_end');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.[1]).toMatchObject({
      executionId: 'model-call',
      appView: { sourceId: 'files', resourceUri: 'ui://files/list' },
    });
    expect(JSON.stringify(ended[0]?.[1])).not.toContain('document-only');
    expect(ended[0]?.[1]).not.toHaveProperty('view');
    expect(controller.appViews.get('model-call')).toEqual(view);
  });

  it('keeps nothing and names nothing for a direct call, whose result goes back to its caller', () => {
    const emit = vi.fn();
    const controller = createController(emit);
    const claim = controller.executionClaim.acquire('runtime-tool');
    finishCall(controller, 'direct-call');
    controller.executionClaim.complete(claim, () => {});
    const ended = emit.mock.calls.filter(([type]) => type === 'tool_end');
    expect(ended).toHaveLength(1);
    expect(ended[0]?.[1]).toMatchObject({ executionId: 'direct-call', toolResultData: 'listed' });
    expect(ended[0]?.[1]).not.toHaveProperty('appView');
    expect(ended[0]?.[1]).not.toHaveProperty('view');
    expect(controller.appViews.get('direct-call')).toBeUndefined();
  });

  it('does not keep a view for a call that cannot be named', () => {
    const emit = vi.fn();
    const controller = createController(emit);
    const claim = controller.executionClaim.acquire('prompt');
    controller.handleToolExecution({ type: 'start', toolName: 'files__list' });
    controller.handleToolExecution({ type: 'end', toolName: 'files__list', success: true, view });
    controller.executionClaim.complete(claim, () => {});
    const ended = emit.mock.calls.filter(([type]) => type === 'tool_end');
    expect(ended[0]?.[1]).not.toHaveProperty('appView');
  });

  it('names what the held claim is for', () => {
    const controller = createController(vi.fn());
    expect(controller.executionClaim.activeKind).toBeUndefined();
    const claim = controller.executionClaim.acquire('runtime-tool');
    expect(controller.executionClaim.activeKind).toBe('runtime-tool');
    controller.executionClaim.complete(claim, () => {});
    expect(controller.executionClaim.activeKind).toBeUndefined();
  });
});
