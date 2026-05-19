import { getSession } from '../../session/playground-session-store.js';

import type { IToolState } from '@robota-sdk/agent-framework';
import type { Request, Response } from 'express';

interface ISessionSubmitBody {
  message?: unknown;
}

function sendEvent(res: Response, eventData: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(eventData)}\n\n`);
}

export async function playgroundSessionSubmitHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const body = req.body as ISessionSubmitBody;
  const { message } = body;

  if (typeof message !== 'string' || !message) {
    res.status(400).json({ error: 'Missing or invalid "message" field' });
    return;
  }

  const maybeSession = getSession(id);
  if (!maybeSession) {
    res.status(404).json({ error: `Session not found: ${id}` });
    return;
  }
  const session = maybeSession;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const toolStartIds = new Map<string, string>();

  const onTextDelta = (delta: string): void => {
    sendEvent(res, { type: 'text_delta', data: { text: delta } });
  };

  const onToolStart = (state: IToolState): void => {
    const toolId = crypto.randomUUID();
    toolStartIds.set(state.toolName, toolId);
    sendEvent(res, {
      type: 'tool_call_start',
      data: { id: toolId, name: state.toolName, input: { arg: state.firstArg } },
    });
  };

  const onToolEnd = (state: IToolState): void => {
    const toolId = toolStartIds.get(state.toolName) ?? crypto.randomUUID();
    toolStartIds.delete(state.toolName);
    sendEvent(res, {
      type: 'tool_call_complete',
      data: {
        id: toolId,
        output: state.toolResultData ?? (state.result === 'error' ? 'Tool failed' : 'Done'),
      },
    });
  };

  const onComplete = (): void => {
    cleanup();
    sendEvent(res, { type: 'done', data: { usage: {} } });
    res.end();
  };

  const onError = (error: Error): void => {
    cleanup();
    sendEvent(res, { type: 'error', data: { message: error.message } });
    res.end();
  };

  const onInterrupted = (): void => {
    cleanup();
    sendEvent(res, { type: 'done', data: { usage: {} } });
    res.end();
  };

  function cleanup(): void {
    session.off('text_delta', onTextDelta);
    session.off('tool_start', onToolStart);
    session.off('tool_end', onToolEnd);
    session.off('complete', onComplete);
    session.off('error', onError);
    session.off('interrupted', onInterrupted);
  }

  session.on('text_delta', onTextDelta);
  session.on('tool_start', onToolStart);
  session.on('tool_end', onToolEnd);
  session.on('complete', onComplete);
  session.on('error', onError);
  session.on('interrupted', onInterrupted);

  const isSlashCommand = message.startsWith('/');

  try {
    await session.submit(message, undefined, isSlashCommand ? message : undefined);
  } catch (err) {
    cleanup();
    sendEvent(res, {
      type: 'error',
      data: { message: err instanceof Error ? err.message : 'Submission failed' },
    });
    res.end();
  }
}
