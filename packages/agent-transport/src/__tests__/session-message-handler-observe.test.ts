/**
 * The read-only `observe` role: an observer reads the session's own conversation and state, never
 * counts as a surface that can answer a prompt, and cannot submit, answer, or control anything.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import {
  ATTACHED_SURFACE_MAX_PENDING_BYTES,
  createOutboundDelivery,
} from '../outbound-delivery.js';
import { createSessionMessageHandler } from '../session-message-handler.js';

import type { TClientMessage, TServerMessage } from '../wire-messages.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

type TListener = (...args: unknown[]) => void;

function createSession(): IInteractiveSession & {
  emit: (event: string, ...args: unknown[]) => void;
  listenerCount: (event: string) => number;
} {
  const listeners = new Map<string, Set<TListener>>();
  const session = createTestInteractiveSession({
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    executeCommand: vi.fn(),
    resolvePermission: vi.fn(),
    resolveAsk: vi.fn(),
    cancelBackgroundTask: vi.fn(),
    closeBackgroundTask: vi.fn(),
    sendBackgroundTask: vi.fn(),
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    isExecuting: vi.fn().mockReturnValue(true),
    on: ((event: string, handler: TListener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }) as IInteractiveSession['on'],
    off: ((event: string, handler: TListener) => {
      listeners.get(event)?.delete(handler);
    }) as IInteractiveSession['off'],
  });
  return Object.assign(session, {
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((handler) => handler(...args));
    },
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  });
}

function attach(
  session: IInteractiveSession,
  role?: 'drive' | 'observe',
): { sent: TServerMessage[]; send: (message: TClientMessage) => void; cleanup: () => void } {
  const sent: TServerMessage[] = [];
  const { onMessage, cleanup } = createSessionMessageHandler({
    session,
    deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
    driverId: role === 'observe' ? 'attach:2' : 'attach:1',
    ...(role === undefined ? {} : { role }),
  });
  return { sent, send: (message) => onMessage(JSON.stringify(message)), cleanup };
}

const MUTATING: readonly TClientMessage[] = [
  { type: 'submit', prompt: 'hello' },
  { type: 'command', name: 'exit' },
  { type: 'abort' },
  { type: 'cancel-queue' },
  { type: 'cancel-background-task', taskId: 't1' },
  { type: 'close-background-task', taskId: 't1' },
  { type: 'send-background-task', taskId: 't1', input: { prompt: 'x' } },
  { type: 'permission-response', id: 'p1', result: true },
  { type: 'ask-response', id: 'a1', response: { type: 'answer', values: ['React'] } } as TClientMessage,
  { type: 'get-personal-usage-report', requestId: 'r1', period: '7d', timezone: 'UTC' },
  { type: 'get-stored-session-usage-report', requestId: 'r2', sessionId: 'other' },
];

describe('observe role', () => {
  it('refuses every mutating or cross-session message with protocol_error and touches nothing', () => {
    const session = createSession();
    const observer = attach(session, 'observe');
    for (const message of MUTATING) {
      observer.sent.length = 0;
      observer.send(message);
      expect(observer.sent).toEqual([
        { type: 'protocol_error', message: `Not permitted for an observer: ${message.type}` },
      ]);
    }
    expect(session.submit).not.toHaveBeenCalled();
    expect(session.executeCommand).not.toHaveBeenCalled();
    expect(session.abort).not.toHaveBeenCalled();
    expect(session.cancelQueue).not.toHaveBeenCalled();
    expect(session.cancelBackgroundTask).not.toHaveBeenCalled();
    expect(session.closeBackgroundTask).not.toHaveBeenCalled();
    expect(session.sendBackgroundTask).not.toHaveBeenCalled();
    expect(session.resolvePermission).not.toHaveBeenCalled();
    expect(session.resolveAsk).not.toHaveBeenCalled();
  });

  it('keeps the read queries for this session', () => {
    const session = createSession();
    const observer = attach(session, 'observe');
    observer.send({ type: 'get-messages' });
    observer.send({ type: 'get-executing' });
    expect(observer.sent).toEqual([
      { type: 'messages', messages: [{ role: 'user', content: 'hi' }] },
      { type: 'executing', executing: true },
    ]);
  });

  it('never subscribes to prompt events, so it does not count as a surface that can answer', () => {
    const session = createSession();
    const observer = attach(session, 'observe');
    expect(session.listenerCount('permission_request')).toBe(0);
    expect(session.listenerCount('ask_request')).toBe(0);
    expect(session.listenerCount('prompt_resolved')).toBe(1);
    expect(session.listenerCount('text_delta')).toBe(1);
    session.emit('permission_request', { id: 'p1', toolName: 'Bash', toolArgs: {} });
    session.emit('ask_request', { id: 'a1', request: { id: 'r', title: 'Pick' } });
    session.emit('prompt_resolved', { id: 'p1' });
    expect(observer.sent).toEqual([{ type: 'prompt_resolved', event: { id: 'p1' } }]);
    observer.cleanup();
    expect(session.listenerCount('prompt_resolved')).toBe(0);
  });

  it('cannot answer a prompt that a drive surface holds', () => {
    const session = createSession();
    const drive = attach(session, 'drive');
    const observer = attach(session, 'observe');
    session.emit('permission_request', { id: 'p1', toolName: 'Bash', toolArgs: {} });
    expect(drive.sent).toContainEqual({
      type: 'permission_request',
      event: { id: 'p1', toolName: 'Bash', toolArgs: {} },
    });
    observer.send({ type: 'permission-response', id: 'p1', result: true });
    expect(session.resolvePermission).not.toHaveBeenCalled();
    drive.send({ type: 'permission-response', id: 'p1', result: false });
    expect(session.resolvePermission).toHaveBeenCalledExactlyOnceWith('p1', false, 'attach:1');
  });

  it('leaves the drive role unchanged', () => {
    const session = createSession();
    const drive = attach(session);
    expect(session.listenerCount('permission_request')).toBe(1);
    expect(session.listenerCount('ask_request')).toBe(1);
    drive.send({ type: 'abort' });
    drive.send({ type: 'permission-response', id: 'p1', result: true });
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.resolvePermission).toHaveBeenCalledExactlyOnceWith('p1', true, 'attach:1');
    expect(drive.sent).toEqual([]);
  });

  it('disconnects an observer that stops reading while the session keeps streaming to others', () => {
    const session = createSession();
    const drive = attach(session, 'drive');
    let pending = 0;
    const onDeliveryError = vi.fn();
    const received: TServerMessage[] = [];
    createSessionMessageHandler({
      session,
      role: 'observe',
      deliver: createOutboundDelivery(
        (message) => {
          received.push(message);
          pending += 64 * 1024;
        },
        onDeliveryError,
        () => pending,
        ATTACHED_SURFACE_MAX_PENDING_BYTES,
      ),
    });
    for (let index = 0; index < 64; index++) {
      expect(() => session.emit('text_delta', `delta ${index}`)).not.toThrow();
    }
    expect(onDeliveryError).toHaveBeenCalledTimes(1);
    expect(received.length).toBeLessThan(64);
    expect(drive.sent.filter((message) => message.type === 'text_delta')).toHaveLength(64);
  });
});
