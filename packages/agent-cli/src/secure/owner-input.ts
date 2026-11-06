/**
 * What counts as the owner being at the keyboard, for the idle lock.
 *
 * The idle lock exists for an owner who walked away, so only what a person does resets it: sending a
 * prompt, answering a question the session asked, changing the session or its settings. Anything a
 * client does on its own (paging through history, refreshing a status line, acknowledging frames,
 * reconnecting, waiting on a job) must not, or a viewer left open on a screen nobody watches would
 * keep the keys open for as long as it refreshes. Each table has one row per message or command, so a
 * message added without a decision does not compile.
 */
import { decodeClientMessage, decodeFrame, type TClientMessage } from '@robota-sdk/agent-transport';

import type { TControlCommandName } from '../session-inventory/control-access.js';

export const OWNER_INPUT: Readonly<Record<TClientMessage['type'], boolean>> = {
  submit: true,
  command: true,
  abort: true,
  'cancel-queue': true,
  'new-session': true,
  'switch-session': true,
  'rename-session': true,
  'delete-session': true,
  'stop-waiting-loop': true,
  'call-app-tool': true,
  'cancel-background-task': true,
  'close-background-task': true,
  'send-background-task': true,
  'permission-response': true,
  'ask-response': true,
  'update-settings': true,
  'get-messages': false,
  'get-history': false,
  'get-prompts': false,
  'get-context': false,
  'get-commands': false,
  'get-status': false,
  'list-models': false,
  'get-agent-definitions': false,
  'list-sessions': false,
  'get-usage-report': false,
  'get-personal-usage-report': false,
  'get-stored-session-usage-report': false,
  'get-executing': false,
  'get-pending': false,
  'get-execution-workspace': false,
  'read-execution-detail': false,
  'project-status': false,
  'project-diff': false,
  'project-memory': false,
  'read-app-view': false,
  'get-background-tasks': false,
  'get-background-task': false,
  'get-background-job-groups': false,
  'get-background-job-group': false,
  'wait-background-job-group': false,
  'read-background-task-log': false,
  resume: false,
  ack: false,
  'get-settings': false,
};

/**
 * Whether `data`, one serialized session-protocol message from an owner link, is the owner acting. A
 * message that does not decode counts for nothing, as does a type the table does not name.
 */
export function isOwnerInput(data: string): boolean {
  const decoded = decodeFrame(data, decodeClientMessage);
  if (!decoded.ok) return false;
  const { type } = decoded.message;
  return Object.hasOwn(OWNER_INPUT, type) && OWNER_INPUT[type];
}

/**
 * The commands an owner link can carry (see `CONTROL_ACCESS`), by whether they are the owner changing
 * something. A row for a command that never reaches an owner link is `false`: it is not a request
 * the owner makes there.
 */
export const OWNER_CONTROL_ACTS: Readonly<Record<TControlCommandName, boolean>> = {
  status: false,
  stop: false,
  lock: false,
  link: false,
  connect: false,
  'events-list': false,
  // A viewer arriving, re-binding or being refused is not a person acting, whatever role it asks for.
  attach: false,
  rename: true,
  'link-pr': true,
  'unlink-pr': true,
  'events-revoke': true,
  'take-daemon-role': true,
};

export function isOwnerControlAct(command: string): boolean {
  return Object.hasOwn(OWNER_CONTROL_ACTS, command) && OWNER_CONTROL_ACTS[command as TControlCommandName];
}
