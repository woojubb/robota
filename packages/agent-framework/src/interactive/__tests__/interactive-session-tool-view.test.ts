import { describe, expect, it, vi } from 'vitest';

import { MAX_TOOL_APP_VIEW_ENTRY_BYTES } from '../interactive-session-app-views.js';
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

function startCall(controller: SessionExecutionController, executionId: string): void {
  controller.handleToolExecution({ type: 'start', toolName: 'files__list', executionId });
}

function endCall(
  controller: SessionExecutionController,
  executionId: string,
  endView: unknown = view,
): void {
  controller.handleToolExecution({
    type: 'end',
    toolName: 'files__list',
    executionId,
    success: true,
    toolResultData: 'listed',
    view: endView as never,
  });
}

function endedStates(emit: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return emit.mock.calls
    .filter(([type]) => type === 'tool_end')
    .map(([, state]) => state as Record<string, unknown>);
}

describe('which calls keep a source view for a surface to read', () => {
  it("names the view of the model's own call by reference and keeps the document aside", () => {
    const emit = vi.fn();
    const controller = createController(emit);
    const claim = controller.executionClaim.acquire('prompt');
    startCall(controller, 'model-call');
    endCall(controller, 'model-call');
    controller.executionClaim.complete(claim, () => {});
    const [ended] = endedStates(emit);
    expect(ended).toMatchObject({
      executionId: 'model-call',
      appView: { sourceId: 'files', resourceUri: 'ui://files/list' },
    });
    expect(JSON.stringify(ended)).not.toContain('document-only');
    expect(ended).not.toHaveProperty('view');
    const { viewId } = ended!['appView'] as { viewId: string };
    expect(controller.appViews.get(viewId)).toEqual(view);
  });

  it('keeps both views when two calls share a provider tool-call id, each under its own viewId', () => {
    const emit = vi.fn();
    const controller = createController(emit);
    const first = { ...view, html: '<main>turn one</main>' };
    const second = { ...view, html: '<main>turn two</main>', callableTools: { other: 'mcp__x__y' } };
    // OpenAI-compatible providers fall back to `call_${index}`, so a later turn reuses the id.
    for (const turnView of [first, second]) {
      const claim = controller.executionClaim.acquire('prompt');
      startCall(controller, 'call_0');
      endCall(controller, 'call_0', turnView);
      controller.executionClaim.complete(claim, () => {});
    }
    const [one, two] = endedStates(emit).map(
      (state) => (state['appView'] as { viewId: string }).viewId,
    );
    expect(one).toBeDefined();
    expect(two).toBeDefined();
    expect(one).not.toBe(two);
    expect(controller.appViews.get(one!)?.html).toBe('<main>turn one</main>');
    expect(controller.appViews.get(two!)?.html).toBe('<main>turn two</main>');
    expect(controller.appViews.get(two!)?.callableTools).toEqual({ other: 'mcp__x__y' });
  });

  it('keeps nothing and names nothing for a direct call, recognised by the id it started with', () => {
    const emit = vi.fn();
    const controller = createController(emit);
    const claim = controller.executionClaim.acquire('runtime-tool');
    controller.directCallIds.add('direct-call');
    startCall(controller, 'direct-call');
    endCall(controller, 'direct-call');
    controller.directCallIds.delete('direct-call');
    controller.executionClaim.complete(claim, () => {});
    const [ended] = endedStates(emit);
    expect(ended).toMatchObject({ executionId: 'direct-call', toolResultData: 'listed' });
    expect(ended).not.toHaveProperty('appView');
    expect(ended).not.toHaveProperty('view');
  });

  it("keeps a model call's view when it ends while a direct call holds the claim", () => {
    const emit = vi.fn();
    const controller = createController(emit);
    // A background agent's own model call is a model call: it ends here whatever claim is held.
    startCall(controller, 'background-model-call');
    const claim = controller.executionClaim.acquire('runtime-tool');
    controller.directCallIds.add('direct-call');
    startCall(controller, 'direct-call');
    endCall(controller, 'background-model-call');
    endCall(controller, 'direct-call');
    controller.directCallIds.delete('direct-call');
    controller.executionClaim.complete(claim, () => {});
    const states = endedStates(emit);
    const modelState = states.find((state) => state['executionId'] === 'background-model-call');
    const directState = states.find((state) => state['executionId'] === 'direct-call');
    expect(modelState).toHaveProperty('appView');
    expect(directState).not.toHaveProperty('appView');
  });

  it('keeps nothing for an end event that has no running call here', () => {
    const emit = vi.fn();
    const controller = createController(emit);
    const put = vi.spyOn(controller.appViews, 'put');
    // No start: the end names a call this session is not running, so it must not take a slot.
    controller.handleToolExecution({
      type: 'end',
      toolName: 'files__list',
      executionId: 'stray',
      success: true,
      view,
    });
    expect(put).not.toHaveBeenCalled();
    // A call that already finished is no longer running either.
    startCall(controller, 'finished');
    endCall(controller, 'finished');
    expect(put).toHaveBeenCalledTimes(1);
    endCall(controller, 'finished');
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('does not keep a view for a call that cannot be named', () => {
    const emit = vi.fn();
    const controller = createController(emit);
    controller.handleToolExecution({ type: 'start', toolName: 'files__list' });
    controller.handleToolExecution({ type: 'end', toolName: 'files__list', success: true, view });
    expect(endedStates(emit)[0]).not.toHaveProperty('appView');
  });

  it.each<[string, unknown]>([
    ['a string where a view belongs', '<main/>'],
    ['a view without a document', { ...view, html: undefined }],
    ['a view whose tools are not names', { ...view, callableTools: { a: 1 } }],
  ])('drops %s and still finishes the call', (_label, malformed) => {
    const emit = vi.fn();
    const controller = createController(emit);
    startCall(controller, 'call-1');
    expect(() => endCall(controller, 'call-1', malformed)).not.toThrow();
    const [ended] = endedStates(emit);
    expect(ended).toMatchObject({ executionId: 'call-1', toolResultData: 'listed' });
    expect(ended).not.toHaveProperty('appView');
  });

  it('drops a view over the per-entry cap and leaves the views already kept', () => {
    const emit = vi.fn();
    const controller = createController(emit);
    startCall(controller, 'small-call');
    endCall(controller, 'small-call');
    startCall(controller, 'huge-call');
    endCall(controller, 'huge-call', { ...view, html: 'x'.repeat(MAX_TOOL_APP_VIEW_ENTRY_BYTES) });
    const [small, huge] = endedStates(emit);
    expect(huge).not.toHaveProperty('appView');
    const { viewId } = small!['appView'] as { viewId: string };
    expect(controller.appViews.get(viewId)).toEqual(view);
  });

  it('never lets a store failure reach the tool wrapper', () => {
    const emit = vi.fn();
    const controller = createController(emit);
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    startCall(controller, 'call-1');
    expect(() => endCall(controller, 'call-1', { ...view, structuredContent: cyclic })).not.toThrow();
    const [ended] = endedStates(emit);
    expect(ended).toMatchObject({ executionId: 'call-1' });
    expect(ended).not.toHaveProperty('appView');
  });
});
