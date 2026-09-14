import { attributedUserEcho } from './attributed-user-echo.js';
import { bindTuiSessionEvent, bindTuiSessionNoticeEvents } from './tui-session-binding.js';

import type { ITuiSessionEventBinding } from './tui-session-binding.js';
import type { TuiStateManager } from './tui-state-manager.js';
import type { IActionRequest, TActionResponse, TToolArgs } from '@robota-sdk/agent-core';
import type { InteractiveSession } from '@robota-sdk/agent-framework';
import type { IExecutionWorkspaceEvent } from '@robota-sdk/agent-interface-execution';
import type {
  IExecutionResult,
  IInteractiveSessionEvents,
  TInteractiveEventName,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-session';

export interface ITuiSessionEventProjectorOptions {
  session: InteractiveSession;
  manager: TuiStateManager;
  onUserMessage: (content: string) => void;
  requestPermission: (
    toolName: string,
    toolArgs: TToolArgs,
    id: string,
  ) => Promise<TPermissionResultValue>;
  askUser: (request: IActionRequest, id: string) => Promise<TActionResponse>;
  dismissPrompt: (id: string) => void;
  onDeliveryError?: (error: Error, event: TInteractiveEventName) => void;
}

/** Projects runtime session events into TUI state and owns the complete listener lifecycle. */
export class TuiSessionEventProjector {
  private readonly bindings: ITuiSessionEventBinding[] = [];

  constructor(private readonly options: ITuiSessionEventProjectorOptions) {}

  wire(): void {
    if (this.bindings.length > 0) return;
    const { session, manager } = this.options;

    const onUserMessage = (content: string): void => {
      this.options.onUserMessage(content);
      manager.addEntry(attributedUserEcho(content, session));
    };
    const syncHistory = (): void => manager.syncHistory(session.getFullHistory());
    const onComplete = (result: IExecutionResult): void => {
      manager.onComplete(result);
      syncHistory();
    };
    const onError = (error: Error): void => {
      manager.onError(error);
      syncHistory();
    };
    const onExecutionWorkspaceEvent = (event: IExecutionWorkspaceEvent): void => {
      manager.syncExecutionWorkspaceSnapshot(event.snapshot);
    };

    this.bind('user_message', onUserMessage);
    this.bind('text_delta', manager.onTextDelta);
    this.bind('tool_start', manager.onToolStart);
    this.bind('tool_end', manager.onToolEnd);
    this.bind('thinking', manager.onThinking);
    this.bind('complete', onComplete);
    this.bind('interrupted', manager.onInterrupted);
    this.bind('error', onError);
    this.bind('context_update', manager.onContextUpdate);
    this.bind('compact', syncHistory);
    this.bind('skill_activation', syncHistory);
    this.bind('memory_event', syncHistory);
    this.bind('execution_workspace_event', onExecutionWorkspaceEvent);
    this.bind('history_cleared', () => manager.clearHistory());
    bindTuiSessionNoticeEvents(this.bind.bind(this), manager);

    const onPermissionRequest: IInteractiveSessionEvents['permission_request'] = ({
      id,
      toolName,
      toolArgs,
    }) => {
      void this.options
        .requestPermission(toolName, toolArgs, id)
        .then((result) => session.resolvePermission(id, result))
        .catch(() => session.resolvePermission(id, false));
    };
    const onAskRequest: IInteractiveSessionEvents['ask_request'] = ({ id, request }) => {
      void this.options
        .askUser(request, id)
        .then((response) => session.resolveAsk(id, response))
        .catch(() => session.resolveAsk(id, { type: 'cancelled' }));
    };
    this.bind('permission_request', onPermissionRequest);
    this.bind('ask_request', onAskRequest);
    this.bind('prompt_resolved', ({ id }) => this.options.dismissPrompt(id));
  }

  unwire(): void {
    const { session } = this.options;
    for (const { event, handler } of this.bindings) {
      session.off(event, handler as IInteractiveSessionEvents[typeof event]);
    }
    this.bindings.length = 0;
  }

  private bind<E extends TInteractiveEventName>(
    event: E,
    handler: IInteractiveSessionEvents[E],
  ): void {
    bindTuiSessionEvent(
      this.options.session,
      event,
      handler,
      (error) => {
        const report = this.options.onDeliveryError;
        if (report) report(error, event);
        else this.options.manager.addSessionEventDeliveryError(error, event);
      },
      this.bindings,
    );
  }
}
