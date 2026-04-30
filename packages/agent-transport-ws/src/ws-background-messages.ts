import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { TClientMessage, TServerMessage } from './ws-handler.js';

type TBackgroundControlAction = 'cancel' | 'close' | 'send';

export function handleBackgroundQueryMessage(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
  msg: Extract<
    TClientMessage,
    { type: 'get-background-tasks' | 'get-background-task' | 'read-background-task-log' }
  >,
): void {
  if (msg.type === 'get-background-tasks') {
    send({ type: 'background_tasks', tasks: session.listBackgroundTasks(msg.filter) });
    return;
  }
  if (msg.type === 'get-background-task') {
    sendBackgroundTaskSnapshot(session, send, msg);
    return;
  }
  sendBackgroundTaskLogPage(session, send, msg);
}

export function handleBackgroundControlMessage(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
  msg: Extract<
    TClientMessage,
    { type: 'cancel-background-task' | 'close-background-task' | 'send-background-task' }
  >,
): void {
  if (!msg.taskId) {
    send({ type: 'protocol_error', message: 'taskId is required' });
    return;
  }
  if (msg.type === 'cancel-background-task') {
    sendBackgroundTaskControlResult(
      send,
      'cancel',
      msg.taskId,
      session.cancelBackgroundTask(msg.taskId, msg.reason),
    );
    return;
  }
  if (msg.type === 'close-background-task') {
    sendBackgroundTaskControlResult(
      send,
      'close',
      msg.taskId,
      session.closeBackgroundTask(msg.taskId),
    );
    return;
  }
  sendBackgroundTaskInput(session, send, msg);
}

function sendBackgroundTaskSnapshot(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
  msg: Extract<TClientMessage, { type: 'get-background-task' }>,
): void {
  if (!msg.taskId) {
    send({ type: 'protocol_error', message: 'taskId is required' });
    return;
  }
  send({
    type: 'background_task',
    taskId: msg.taskId,
    task: session.getBackgroundTask(msg.taskId) ?? null,
  });
}

function sendBackgroundTaskLogPage(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
  msg: Extract<TClientMessage, { type: 'read-background-task-log' }>,
): void {
  if (!msg.taskId) {
    send({ type: 'protocol_error', message: 'taskId is required' });
    return;
  }
  session.readBackgroundTaskLog(msg.taskId, msg.cursor).then(
    (page) => send({ type: 'background_task_log', taskId: msg.taskId, page }),
    (error: Error) => send({ type: 'protocol_error', message: error.message }),
  );
}

function sendBackgroundTaskInput(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
  msg: Extract<TClientMessage, { type: 'send-background-task' }>,
): void {
  if (!msg.input) {
    send({ type: 'protocol_error', message: 'input is required' });
    return;
  }
  sendBackgroundTaskControlResult(
    send,
    'send',
    msg.taskId,
    session.sendBackgroundTask(msg.taskId, msg.input),
  );
}

function sendBackgroundTaskControlResult(
  send: (message: TServerMessage) => void,
  action: TBackgroundControlAction,
  taskId: string,
  operation: Promise<void>,
): void {
  operation.then(
    () => send({ type: 'background_task_control_result', action, taskId, success: true }),
    (error: Error) =>
      send({
        type: 'background_task_control_result',
        action,
        taskId,
        success: false,
        message: error.message,
      }),
  );
}
