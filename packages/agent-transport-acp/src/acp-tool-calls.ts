/** The tool-call rows one turn shows an editor: which session call each row stands for, and when it is done. */

import { permissionToolCall } from './acp-permission.js';
import { acpToolEndStatus, acpToolKind, acpToolStartTitle } from './acp-tool-mapping.js';

import type { IAcpUpdateStream } from './acp-updates.js';
import type { ToolCallUpdate } from '@agentclientprotocol/sdk';
import type { IPermissionRequestEvent, IToolState } from '@robota-sdk/agent-interface-session';

export interface IAcpToolCallTracker {
  start(tool: IToolState): void;
  end(tool: IToolState): void;
  /** The row a permission request asks about; its id is held for the call it is about. */
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

/** A permission request's row, held until the call it asks about starts or is refused. */
interface IAwaitedCall {
  readonly id: string;
  readonly rawInput: unknown;
  answered: boolean;
}

export function createToolCallTracker(deps: IAcpToolCallDeps): IAcpToolCallTracker {
  const { updates } = deps;
  const open: IOpenCall[] = [];
  /**
   * The session asks permission before it reports a call, and a refused call is reported ending
   * without ever having started. The request names no call, so its row is matched to the next
   * call of the same tool that the session reports after the editor answered, in the order asked.
   */
  const awaited = new Map<string, IAwaitedCall[]>();
  let finished = false;

  const take = (toolName: string): IAwaitedCall | undefined => {
    const queue = awaited.get(toolName);
    const index = queue?.findIndex((call) => call.answered) ?? -1;
    if (queue === undefined || index < 0) return undefined;
    const [call] = queue.splice(index, 1);
    if (queue.length === 0) awaited.delete(toolName);
    return call;
  };

  return {
    start(tool) {
      // An internal signal tool is not a call the person made or should see.
      if (tool.internal) return;
      const asked = take(tool.toolName);
      const id = asked?.id ?? tool.executionId ?? deps.nextToolCallId();
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
      const asked = take(tool.toolName);
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
      const call = permissionToolCall(event, `permission-${event.id}`, deps.cwd);
      // A background agent's call runs in its own session, which this one never reports.
      if (event.requester !== undefined) return call;
      const queue = awaited.get(event.toolName) ?? [];
      queue.push({ id: call.toolCallId, rawInput: call.rawInput, answered: false });
      awaited.set(event.toolName, queue);
      return call;
    },

    answered(event, allowed) {
      if (event.requester !== undefined) {
        // Nothing will report that call, so the row closes with the answer.
        if (!finished) {
          updates.send({
            sessionUpdate: 'tool_call_update',
            toolCallId: `permission-${event.id}`,
            status: allowed ? 'completed' : 'failed',
          });
        }
        return;
      }
      const asked = awaited
        .get(event.toolName)
        ?.find((call) => call.id === `permission-${event.id}`);
      if (asked !== undefined) asked.answered = true;
    },

    finish() {
      finished = true;
      for (const queue of awaited.values()) {
        for (const call of queue) {
          updates.send({
            sessionUpdate: 'tool_call_update',
            toolCallId: call.id,
            status: 'failed',
          });
        }
      }
      awaited.clear();
    },
  };
}
