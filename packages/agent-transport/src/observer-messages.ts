import type { TClientMessage } from './wire-messages.js';

/**
 * The only inbound messages an observer may send: reads of this session. An allowlist, so a message
 * type added later is refused to observers until someone decides it is a read. `get-prompts` is left
 * out: an observer never receives prompts, open ones included.
 *
 * The host refuses anything else from an observer, and a client in observe mode sends only these, so
 * both sides read this one list.
 */
export const OBSERVER_MESSAGES: ReadonlySet<TClientMessage['type']> = new Set<
  TClientMessage['type']
>([
  'get-messages',
  'get-history',
  'get-context',
  'get-status',
  'get-commands',
  'get-executing',
  'get-pending',
  'get-execution-workspace',
  'read-execution-detail',
  'get-usage-report',
  'list-sessions',
  'get-background-tasks',
  'get-background-task',
  'get-background-job-groups',
  'get-background-job-group',
  'wait-background-job-group',
  'read-background-task-log',
]);

/** Whether an observer may send a message of this type. */
export function isObserverMessageType(type: string): boolean {
  return (OBSERVER_MESSAGES as ReadonlySet<string>).has(type);
}
