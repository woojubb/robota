import type { TOutboundDeliver } from './outbound-delivery.js';
import type { IProtocolSession } from './protocol-session.js';
import type { TBackgroundControlAction, TClientMessage } from './ws-protocol.js';

export function handleBackgroundQueryMessage(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: Extract<
    TClientMessage,
    | { type: 'get-background-tasks' | 'get-background-task' | 'read-background-task-log' }
    | {
        type:
          'get-background-job-groups' | 'get-background-job-group' | 'wait-background-job-group';
      }
  >,
): void {
  if (msg.type === 'get-background-tasks') {
    deliver({ type: 'background_tasks', tasks: session.listBackgroundTasks(msg.filter) });
    return;
  }
  if (msg.type === 'get-background-task') {
    sendBackgroundTaskSnapshot(session, deliver, msg);
    return;
  }
  if (msg.type === 'get-background-job-groups') {
    deliver({ type: 'background_job_groups', groups: session.listBackgroundJobGroups() });
    return;
  }
  if (msg.type === 'get-background-job-group') {
    sendBackgroundJobGroupSnapshot(session, deliver, msg);
    return;
  }
  if (msg.type === 'wait-background-job-group') {
    sendBackgroundJobGroupWaitResult(session, deliver, msg);
    return;
  }
  sendBackgroundTaskLogPage(session, deliver, msg);
}

export function handleBackgroundControlMessage(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: Extract<
    TClientMessage,
    { type: 'cancel-background-task' | 'close-background-task' | 'send-background-task' }
  >,
): void {
  if (!msg.taskId) {
    deliver({ type: 'protocol_error', message: 'taskId is required' });
    return;
  }
  if (msg.type === 'cancel-background-task') {
    sendBackgroundTaskControlResult(
      deliver,
      'cancel',
      msg.taskId,
      session.cancelBackgroundTask(msg.taskId, msg.reason),
    );
    return;
  }
  if (msg.type === 'close-background-task') {
    sendBackgroundTaskControlResult(
      deliver,
      'close',
      msg.taskId,
      session.closeBackgroundTask(msg.taskId),
    );
    return;
  }
  sendBackgroundTaskInput(session, deliver, msg);
}

function sendBackgroundTaskSnapshot(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: Extract<TClientMessage, { type: 'get-background-task' }>,
): void {
  if (!msg.taskId) {
    deliver({ type: 'protocol_error', message: 'taskId is required' });
    return;
  }
  deliver({
    type: 'background_task',
    taskId: msg.taskId,
    task: session.getBackgroundTask(msg.taskId) ?? null,
  });
}

function sendBackgroundTaskLogPage(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: Extract<TClientMessage, { type: 'read-background-task-log' }>,
): void {
  if (!msg.taskId) {
    deliver({ type: 'protocol_error', message: 'taskId is required' });
    return;
  }
  session.readBackgroundTaskLog(msg.taskId, msg.cursor).then(
    (page) => deliver({ type: 'background_task_log', taskId: msg.taskId, page }),
    (error: Error) => deliver({ type: 'protocol_error', message: error.message }),
  );
}

function sendBackgroundJobGroupSnapshot(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: Extract<TClientMessage, { type: 'get-background-job-group' }>,
): void {
  if (!msg.groupId) {
    deliver({ type: 'protocol_error', message: 'groupId is required' });
    return;
  }
  deliver({
    type: 'background_job_group',
    groupId: msg.groupId,
    group: session.getBackgroundJobGroup(msg.groupId) ?? null,
  });
}

function sendBackgroundJobGroupWaitResult(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: Extract<TClientMessage, { type: 'wait-background-job-group' }>,
): void {
  if (!msg.groupId) {
    deliver({ type: 'protocol_error', message: 'groupId is required' });
    return;
  }
  session.waitBackgroundJobGroup(msg.groupId).then(
    (group) => deliver({ type: 'background_job_group', groupId: msg.groupId, group }),
    (error: Error) => deliver({ type: 'protocol_error', message: error.message }),
  );
}

function sendBackgroundTaskInput(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  msg: Extract<TClientMessage, { type: 'send-background-task' }>,
): void {
  if (!msg.input) {
    deliver({ type: 'protocol_error', message: 'input is required' });
    return;
  }
  sendBackgroundTaskControlResult(
    deliver,
    'send',
    msg.taskId,
    session.sendBackgroundTask(msg.taskId, msg.input),
  );
}

function sendBackgroundTaskControlResult(
  deliver: TOutboundDeliver,
  action: TBackgroundControlAction,
  taskId: string,
  operation: Promise<void>,
): void {
  operation.then(
    () => deliver({ type: 'background_task_control_result', action, taskId, success: true }),
    (error: Error) =>
      deliver({
        type: 'background_task_control_result',
        action,
        taskId,
        success: false,
        message: error.message,
      }),
  );
}
