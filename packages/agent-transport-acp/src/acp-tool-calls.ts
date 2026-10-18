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
  readonly toolName: string;
  readonly executionId: string | undefined;
  readonly id: string;
}

/** A permission request's row, held until the call it names starts or is refused. */
interface IAwaitedCall {
  readonly rawInput: unknown;
  /** A background agent's call can run after this prompt, so its row closes with the answer. */
  readonly background: boolean;
  allowed?: boolean;
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
  /** Rows of requests that name no call, by request id: nothing else will close them. */
  const unnamed = new Map<string, string>();
  let finished = false;

  const take = (executionId: string | undefined): IAwaitedCall | undefined => {
    if (executionId === undefined) return undefined;
    const call = awaited.get(executionId);
    awaited.delete(executionId);
    return call;
  };
  const close = (toolCallId: string, allowed: boolean): void =>
    updates.send({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: allowed ? 'completed' : 'failed',
    });

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
      if (take(tool.executionId) !== undefined) {
        updates.send({ sessionUpdate: 'tool_call_update', toolCallId: tool.executionId!, status });
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
      const { executionId } = event;
      if (executionId === undefined) {
        const call = permissionToolCall(event, `permission-${event.id}`, deps.cwd);
        unnamed.set(event.id, call.toolCallId);
        return call;
      }
      const call = permissionToolCall(event, executionId, deps.cwd);
      // A call that is already running (asked again before its effect) keeps the row it has.
      if (!open.some((running) => running.executionId === executionId)) {
        awaited.set(executionId, {
          rawInput: call.rawInput,
          background: event.requester !== undefined,
        });
      }
      return call;
    },

    answered(event, allowed) {
      if (event.executionId !== undefined) {
        // The call's own events say what the answer led to; the answer is kept for a call that
        // may run after this turn.
        const asked = awaited.get(event.executionId);
        if (asked !== undefined) asked.allowed = allowed;
        return;
      }
      const row = unnamed.get(event.id);
      if (row === undefined || finished) return;
      unnamed.delete(event.id);
      close(row, allowed);
    },

    finish() {
      finished = true;
      for (const [id, call] of awaited) close(id, call.background && call.allowed === true);
      for (const row of unnamed.values()) close(row, false);
      awaited.clear();
      unnamed.clear();
    },
  };
}
