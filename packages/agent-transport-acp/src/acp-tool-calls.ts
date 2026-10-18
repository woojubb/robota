/** The tool-call rows one turn shows an editor: which session call each row stands for, and when it is done. */

import { permissionToolCall } from './acp-permission.js';
import { acpToolEndStatus, acpToolKind, acpToolStartTitle } from './acp-tool-mapping.js';

import type { IAcpUpdateStream } from './acp-updates.js';
import type { ToolCallUpdate } from '@agentclientprotocol/sdk';
import type { IPermissionRequestEvent, IToolState } from '@robota-sdk/agent-interface-session';

export interface IAcpToolCallTracker {
  start(tool: IToolState): void;
  end(tool: IToolState): void;
  /** The row a permission request asks about; when the request names its call, the row is that call's. */
  requested(event: IPermissionRequestEvent): ToolCallUpdate;
  /** The editor answered; the session decides what happens next, and its tool events say so. */
  answered(event: IPermissionRequestEvent, allowed: boolean): void;
  /** The turn is over: close every row still waiting for a call that never came. */
  finish(): void;
}

export interface IAcpToolCallDeps {
  readonly updates: IAcpUpdateStream;
  /** Ids for tool calls the session gives no id; unique for the life of the session. */
  readonly nextToolCallId: () => string;
  /** The served directory, for paths the session reports relative to it. */
  readonly cwd: string;
}

interface IOpenCall {
  readonly id: string;
  readonly toolName: string;
  readonly executionId: string | undefined;
}

/** A permission request's row, held until the call it names starts or is refused. */
interface IAwaitedCall {
  readonly id: string;
  readonly rawInput: unknown;
}

/** Whether a request is about a call this session will report, and says which one. */
function namesOwnCall(
  event: IPermissionRequestEvent,
): event is IPermissionRequestEvent & { executionId: string } {
  return event.requester === undefined && event.executionId !== undefined;
}

export function createToolCallTracker(deps: IAcpToolCallDeps): IAcpToolCallTracker {
  const { updates } = deps;
  const open: IOpenCall[] = [];
  /**
   * The session asks permission before it reports a call, and a refused call is reported ending
   * without ever having started. A request names its call by the execution id the call's own
   * events carry, so the request's row is keyed by it and those events address the same row.
   */
  const awaited = new Map<string, IAwaitedCall>();
  let finished = false;

  const take = (executionId: string | undefined): IAwaitedCall | undefined => {
    if (executionId === undefined) return undefined;
    const call = awaited.get(executionId);
    awaited.delete(executionId);
    return call;
  };

  return {
    start(tool) {
      // An internal signal tool is not a call the person made or should see.
      if (tool.internal) return;
      const asked = take(tool.executionId);
      const id = tool.executionId ?? deps.nextToolCallId();
      open.push({ id, toolName: tool.toolName, executionId: tool.executionId });
      const call = {
        toolCallId: id,
        title: acpToolStartTitle(tool),
        kind: acpToolKind(tool.toolName),
        status: 'in_progress',
      } as const;
      if (asked === undefined) updates.send({ sessionUpdate: 'tool_call', ...call });
      else {
        updates.send({ sessionUpdate: 'tool_call_update', ...call, rawInput: asked.rawInput });
      }
    },

    end(tool) {
      if (tool.internal) return;
      const status = acpToolEndStatus(tool);
      const index = open.findIndex((call) =>
        tool.executionId !== undefined
          ? call.executionId === tool.executionId
          : call.executionId === undefined && call.toolName === tool.toolName,
      );
      if (index >= 0) {
        const [call] = open.splice(index, 1);
        updates.send({ sessionUpdate: 'tool_call_update', toolCallId: call!.id, status });
        return;
      }
      // A refused call ends with no start; when its permission was asked, that row is the call.
      const asked = take(tool.executionId);
      if (asked !== undefined) {
        updates.send({ sessionUpdate: 'tool_call_update', toolCallId: asked.id, status });
        return;
      }
      // Otherwise give the editor the call, finished, rather than an update for nothing.
      updates.send({
        sessionUpdate: 'tool_call',
        toolCallId: tool.executionId ?? deps.nextToolCallId(),
        title: acpToolStartTitle(tool),
        kind: acpToolKind(tool.toolName),
        status,
      });
    },

    requested(event) {
      if (!namesOwnCall(event)) return permissionToolCall(event, `permission-${event.id}`, deps.cwd);
      const call = permissionToolCall(event, event.executionId, deps.cwd);
      awaited.set(event.executionId, { id: call.toolCallId, rawInput: call.rawInput });
      return call;
    },

    answered(event, allowed) {
      // The call's own events say what the answer led to; a row that is not a call's closes now.
      if (namesOwnCall(event) || finished) return;
      updates.send({
        sessionUpdate: 'tool_call_update',
        toolCallId: `permission-${event.id}`,
        status: allowed ? 'completed' : 'failed',
      });
    },

    finish() {
      finished = true;
      for (const call of awaited.values()) {
        updates.send({ sessionUpdate: 'tool_call_update', toolCallId: call.id, status: 'failed' });
      }
      awaited.clear();
    },
  };
}
